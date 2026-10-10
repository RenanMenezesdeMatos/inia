import { DEFAULT_FALLBACK_ON, FALLBACK_ELIGIBLE_CATEGORIES } from "../../../shared/application/model-routing/ai-errors.js"
import type { AiUseCaseDefinition } from "../../../shared/application/model-routing/ai-use-cases.js"
import { missingCapabilities, QUALITY_TIER_RANK, ROUTABLE_MODEL_KINDS, supportsCapability, type AiModelKind, type AiQualityTier, type ModelCapabilities } from "./ai-capabilities.js"
import { blendedPrice, estimateInputCost, isZeroPricing, type AiPricingVersion } from "./ai-pricing.js"
import { findAiProvider } from "./ai-provider-catalog.js"
import { SPEECH_SYNTHESIS_ADAPTERS, type SpeechSettings } from "./ai-speech.js"
import { compareDecimal, parseDecimal, type Decimal } from "./decimal.js"

/**
 * POLÍTICA DE ROTEAMENTO por Use Case (§21–§28, §61–§64). Função PURA: dado o snapshot da
 * configuração da organização, devolve a lista ORDENADA de candidatos (o primeiro é o escolhido; os
 * seguintes só são tentados em erro elegível a fallback) e os descartados com o motivo. AUTO é
 * ordenação determinística por dados disponíveis — nunca um LLM escolhendo outro LLM.
 */
export const AI_ROUTING_MODES = ["PINNED", "FALLBACK_CHAIN", "AUTO"] as const
export type AiRoutingMode = (typeof AI_ROUTING_MODES)[number]

/**
 * QUALITY_FIRST ordena pelo TIER declarado pelo admin (não há benchmark medido — §27: nenhum número
 * mágico por vendor). LATENCY_FIRST usa a latência mediana REAL das chamadas bem-sucedidas recentes.
 * COST_FIRST usa o preço vigente configurado. BALANCED = soma dos postos de custo e latência.
 */
export const AI_AUTO_STRATEGIES = ["COST_FIRST", "LATENCY_FIRST", "BALANCED", "QUALITY_FIRST"] as const
export type AiAutoStrategy = (typeof AI_AUTO_STRATEGIES)[number]

export const AI_POLICY_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const
export type AiPolicyStatus = (typeof AI_POLICY_STATUSES)[number]

export const MAX_POLICY_MODELS: Record<AiRoutingMode, number> = { PINNED: 1, FALLBACK_CHAIN: 5, AUTO: 8 }
/** Rate limit recente de um modelo o empurra para o fim da fila (§56) — janela curta, sem polling. */
export const RATE_LIMIT_DEPRIORITIZE_MS = 60_000

export type RouteReasonCode = "PINNED" | "FALLBACK_CHAIN_PRIMARY" | "FALLBACK_CHAIN_NEXT" | "AUTO_COST" | "AUTO_LATENCY" | "AUTO_BALANCED" | "AUTO_QUALITY_TIER" | "DEFAULT_POLICY"

export type ModelSnapshot = {
  id: string
  displayName: string
  providerModelId: string
  enabled: boolean
  kind: AiModelKind
  capabilities: ModelCapabilities
  contextWindow: number | null
  maxOutputTokens: number | null
  qualityTier: AiQualityTier | null
  timeoutMs: number | null
  isLocal: boolean
  pricing: AiPricingVersion | null
  recentLatencyMs: number | null
  lastRateLimitedAt: Date | null
  connection: { id: string; name: string; enabled: boolean; providerKey: string; providerActive: boolean }
  /** Voz cadastrada no modelo (síntese de voz) — ausente = sem voz. */
  speech?: SpeechSettings | null
}

export type PolicySnapshot = {
  id: string
  useCase: string
  status: AiPolicyStatus
  mode: AiRoutingMode
  strategy: AiAutoStrategy | null
  maxEstimatedCostPerRequest: string | null
  costCurrency: string | null
  fallbackOn: string[]
  modelIds: string[]
}

export type RouteCandidate = { model: ModelSnapshot; position: number; reason: RouteReasonCode }
export type SkippedCandidate = { modelId: string; displayName: string | null; reason: string }
export type RoutePlan = { candidates: RouteCandidate[]; skipped: SkippedCandidate[]; notes: string[] }

export type RouteRequestContext = { estimatedInputTokens: number | null; now: Date }

/** Por que este modelo NÃO pode atender o Use Case agora — null = elegível. */
export function ineligibilityReason(model: ModelSnapshot | undefined, useCase: AiUseCaseDefinition, policy: PolicySnapshot, context: RouteRequestContext): string | null {
  if (!model) return "modelo removido"
  if (!model.connection.providerActive) return "provider indisponível neste ambiente"
  if (!model.connection.enabled) return `conexão "${model.connection.name}" desabilitada`
  if (!model.enabled) return "modelo desabilitado"
  if (!ROUTABLE_MODEL_KINDS.includes(model.kind)) return `modelo do tipo ${model.kind} não atende requisições generativas`
  const missing = missingCapabilities(model.capabilities, useCase.requiredCapabilities)
  if (missing.length > 0) return `capacidade ausente ou não declarada: ${missing.join(", ")}`
  if (useCase.requiresSpeechVoice) {
    const adapterType = findAiProvider(model.connection.providerKey)?.adapterType
    if (!adapterType || !SPEECH_SYNTHESIS_ADAPTERS.includes(adapterType)) return "o provider não faz síntese de voz na INIA (hoje: OpenAI e servidores compatíveis)"
    if (!model.speech) return "voz não configurada no modelo"
  }
  if (context.estimatedInputTokens !== null && model.contextWindow !== null && context.estimatedInputTokens > model.contextWindow) return `contexto estimado (${context.estimatedInputTokens}) acima da janela (${model.contextWindow})`
  if (policy.maxEstimatedCostPerRequest !== null) {
    if (model.pricing === null) return "limite de custo por requisição ativo e o modelo não tem preço configurado"
    if (policy.costCurrency !== null && model.pricing.currency !== policy.costCurrency) return `preço em ${model.pricing.currency}, limite em ${policy.costCurrency} (sem conversão)`
    if (context.estimatedInputTokens !== null) {
      const estimate = estimateInputCost(context.estimatedInputTokens, model.pricing)
      if (estimate !== null && compareDecimal(estimate, parseDecimal(policy.maxEstimatedCostPerRequest)) > 0) return "custo estimado da entrada acima do limite por requisição"
    }
  }
  return null
}

function autoReason(strategy: AiAutoStrategy): RouteReasonCode {
  return strategy === "COST_FIRST" ? "AUTO_COST" : strategy === "LATENCY_FIRST" ? "AUTO_LATENCY" : strategy === "QUALITY_FIRST" ? "AUTO_QUALITY_TIER" : "AUTO_BALANCED"
}

type Ranked = { model: ModelSnapshot; position: number }

/** Posto (0 = melhor) por uma métrica; desconhecido fica depois de todos os conhecidos, empates pela posição configurada. */
function ranks(items: Ranked[], metric: (item: Ranked) => Decimal | number | null, ascending = true): Map<string, number> {
  const known = items.filter((item) => metric(item) !== null)
  const unknown = items.filter((item) => metric(item) === null)
  known.sort((left, right) => {
    const a = metric(left)!
    const b = metric(right)!
    const diff = typeof a === "bigint" && typeof b === "bigint" ? compareDecimal(a, b) : Number(a) - Number(b)
    return (ascending ? diff : -diff) || left.position - right.position
  })
  const result = new Map<string, number>()
  known.forEach((item, index) => result.set(item.model.id, index))
  unknown.sort((left, right) => left.position - right.position).forEach((item, index) => result.set(item.model.id, known.length + index))
  return result
}

export function orderAuto(items: Ranked[], strategy: AiAutoStrategy): Ranked[] {
  const cost = ranks(items, (item) => blendedPrice(item.model.pricing))
  const latency = ranks(items, (item) => item.model.recentLatencyMs)
  const quality = ranks(items, (item) => (item.model.qualityTier ? QUALITY_TIER_RANK[item.model.qualityTier] : null), false)
  const score = (item: Ranked): number => {
    switch (strategy) {
      case "COST_FIRST":
        return cost.get(item.model.id)!
      case "LATENCY_FIRST":
        return latency.get(item.model.id)!
      case "QUALITY_FIRST":
        return quality.get(item.model.id)!
      case "BALANCED":
        return cost.get(item.model.id)! + latency.get(item.model.id)!
    }
  }
  return [...items].sort((left, right) => score(left) - score(right) || left.position - right.position)
}

export function planRoute(policy: PolicySnapshot, useCase: AiUseCaseDefinition, models: ReadonlyMap<string, ModelSnapshot>, context: RouteRequestContext): RoutePlan {
  const skipped: SkippedCandidate[] = []
  const notes: string[] = []
  const eligible: Ranked[] = []
  policy.modelIds.forEach((modelId, position) => {
    const model = models.get(modelId)
    const reason = ineligibilityReason(model, useCase, policy, context)
    if (reason) skipped.push({ modelId, displayName: model?.displayName ?? null, reason })
    else eligible.push({ model: model!, position })
  })
  let ordered: Ranked[]
  if (policy.mode === "AUTO") {
    const strategy = policy.strategy ?? "BALANCED"
    ordered = orderAuto(eligible, strategy)
    if (strategy === "QUALITY_FIRST") notes.push("QUALITY_FIRST ordena pelo tier declarado pelo admin — não é benchmark de qualidade medido.")
    if ((strategy === "LATENCY_FIRST" || strategy === "BALANCED") && eligible.every((item) => item.model.recentLatencyMs === null)) notes.push("Sem latência recente medida — ordem configurada usada como desempate.")
  } else {
    ordered = eligible
  }
  if (policy.mode === "PINNED") ordered = ordered.slice(0, 1)
  // Rate limit recente (§56): o modelo vai para o fim da fila — só quando há alternativa.
  if (policy.mode !== "PINNED" && ordered.length > 1) {
    const limited = ordered.filter((item) => item.model.lastRateLimitedAt !== null && context.now.getTime() - item.model.lastRateLimitedAt.getTime() < RATE_LIMIT_DEPRIORITIZE_MS)
    if (limited.length > 0 && limited.length < ordered.length) {
      ordered = [...ordered.filter((item) => !limited.includes(item)), ...limited]
      notes.push(`Rate limit recente: ${limited.map((item) => item.model.displayName).join(", ")} movido(s) para o fim da fila.`)
    }
  }
  const candidates = ordered.map((item, index): RouteCandidate => ({
    model: item.model,
    position: item.position,
    reason: policy.mode === "PINNED" ? "PINNED" : policy.mode === "AUTO" ? autoReason(policy.strategy ?? "BALANCED") : index === 0 ? "FALLBACK_CHAIN_PRIMARY" : "FALLBACK_CHAIN_NEXT",
  }))
  return { candidates, skipped, notes }
}

export type PolicyIssue = { code: string; message: string; modelId?: string }

/**
 * Validação para ATIVAR (§62, §63): policy inválida nunca é ativada, e uma policy ativa que ficou
 * inválida (modelo desabilitado depois) é mostrada como inválida — o runtime nunca troca de modelo
 * em silêncio (PINNED sem candidato = erro claro).
 */
export function validatePolicy(policy: Omit<PolicySnapshot, "id" | "status">, useCase: AiUseCaseDefinition | null, models: ReadonlyMap<string, ModelSnapshot>): PolicyIssue[] {
  const issues: PolicyIssue[] = []
  if (!useCase) return [{ code: "AI_USE_CASE_UNKNOWN", message: "Use Case desconhecido." }]
  if (!useCase.routable) issues.push({ code: "AI_USE_CASE_NOT_ROUTABLE", message: `"${useCase.label}" não é configurável nesta versão.` })
  if (policy.modelIds.length === 0) issues.push({ code: "AI_POLICY_EMPTY", message: "Selecione ao menos um modelo." })
  if (policy.modelIds.length > MAX_POLICY_MODELS[policy.mode]) issues.push({ code: "AI_POLICY_TOO_MANY_MODELS", message: `O modo ${policy.mode} aceita no máximo ${MAX_POLICY_MODELS[policy.mode]} modelo(s).` })
  if (policy.mode === "FALLBACK_CHAIN" && policy.modelIds.length < 2) issues.push({ code: "AI_POLICY_CHAIN_TOO_SHORT", message: "Uma cadeia de fallback precisa de ao menos 2 modelos." })
  if (new Set(policy.modelIds).size !== policy.modelIds.length) issues.push({ code: "AI_POLICY_DUPLICATE_MODEL", message: "O mesmo modelo aparece mais de uma vez." })
  if (policy.mode === "AUTO" && !policy.strategy) issues.push({ code: "AI_POLICY_STRATEGY_REQUIRED", message: "Escolha a estratégia do modo automático." })
  if (policy.mode !== "AUTO" && policy.strategy) issues.push({ code: "AI_POLICY_STRATEGY_NOT_ALLOWED", message: "Estratégia só se aplica ao modo automático." })
  const invalidFallback = policy.fallbackOn.filter((category) => !(FALLBACK_ELIGIBLE_CATEGORIES as readonly string[]).includes(category))
  if (invalidFallback.length > 0) issues.push({ code: "AI_POLICY_FALLBACK_NOT_ALLOWED", message: `Fallback não permitido para: ${invalidFallback.join(", ")} (trocar de provider não resolve esse tipo de erro).` })
  if (policy.maxEstimatedCostPerRequest !== null && !policy.costCurrency) issues.push({ code: "AI_POLICY_COST_CURRENCY_REQUIRED", message: "Informe a moeda do limite de custo por requisição." })
  const context: RouteRequestContext = { estimatedInputTokens: null, now: new Date(0) }
  for (const modelId of policy.modelIds) {
    const reason = ineligibilityReason(models.get(modelId), useCase, { ...policy, id: "", status: "DRAFT" }, context)
    if (reason) issues.push({ code: "AI_POLICY_MODEL_INELIGIBLE", message: `${models.get(modelId)?.displayName ?? modelId}: ${reason}.`, modelId })
  }
  if (policy.mode === "AUTO" && policy.strategy === "QUALITY_FIRST") {
    const undeclared = policy.modelIds.map((id) => models.get(id)).filter((model) => model && !model.qualityTier)
    if (undeclared.length > 0) issues.push({ code: "AI_POLICY_QUALITY_TIER_MISSING", message: `QUALITY_FIRST exige o tier declarado em todos os modelos (faltando: ${undeclared.map((model) => model!.displayName).join(", ")}).` })
  }
  return issues
}

export function defaultFallbackOn(): string[] {
  return [...DEFAULT_FALLBACK_ON]
}

/** Modelo local sem preço configurado: custo de API desconhecido; com tabela zerada: custo de API = 0 (computação não medida — §44). */
export function localCostLabel(model: Pick<ModelSnapshot, "isLocal" | "pricing">): "NOT_LOCAL" | "API_COST_ZERO" | "API_COST_UNKNOWN" | "API_COST_CONFIGURED" {
  if (!model.isLocal) return "NOT_LOCAL"
  if (model.pricing === null) return "API_COST_UNKNOWN"
  return isZeroPricing(model.pricing) ? "API_COST_ZERO" : "API_COST_CONFIGURED"
}

export { supportsCapability }
