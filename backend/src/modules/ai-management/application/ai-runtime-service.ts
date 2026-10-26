import type { Database } from "../../../infrastructure/database/pool.js"
import { beforeLlmCall, countTechnicalIdsInPrompt, EMPTY_USAGE, hasLlmTelemetryStore, recordLlmCall, type LlmUsage } from "../../../shared/application/llm-telemetry.js"
import { observedCacheRecord } from "../../../shared/application/model-routing/cache-record.js"
import { AiBudgetExceededError, AiCallCancelledError, AiProviderError, canFallbackOn, type AiErrorCategory } from "../../../shared/application/model-routing/ai-errors.js"
import type { AiRuntime, AiUsageEventInput, PolicyExecutionRequest, PolicyExecutionResult, PolicySpeechRequest, PolicySpeechResult, PolicyStreamRequest, ResolvedAiRoute, SpeechCacheIdentity } from "../../../shared/application/model-routing/ai-runtime.js"
import { currentAiRequesterPersonId, currentAiWorkflowCorrelation } from "../../../shared/application/model-routing/ai-runtime.js"
import { currentAiCallLimiterRecord } from "../../../shared/application/model-routing/ai-call-limiter.js"
import { connectionGateKey, providerCallGate, runThroughProviderGate } from "../../../shared/application/model-routing/provider-call-gate.js"
import { findUseCase, type AiUseCaseKey } from "../../../shared/application/model-routing/ai-use-cases.js"
import type { CostEstimate } from "../../../shared/application/model-routing/model-pricing.js"
import type { ModelProvider } from "../../../shared/application/model-routing/model-profile.js"
import type { AdapterTurn } from "../../../shared/application/model-routing/provider-adapter.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { evaluateBudget, type AiBudgetEvaluation } from "../domain/ai-budget.js"
import { supportsCapability } from "../domain/ai-capabilities.js"
import { findAiProvider } from "../domain/ai-provider-catalog.js"
import { computeCallCost, isZeroPricing, pricingAt, type AiCostResult } from "../domain/ai-pricing.js"
import { planRoute, type ModelSnapshot, type PolicySnapshot, type RouteCandidate } from "../domain/ai-routing-policy.js"
import { speechCacheModelKey } from "../domain/ai-speech.js"
import { formatDecimal, parseDecimal } from "../domain/decimal.js"
import { createAdapterRegistry, type AdapterRegistry } from "../infrastructure/adapters/adapter-registry.js"
import { decryptAiSecret } from "./ai-secrets.js"
import { insertUsageEvent, legacyPricingKey, loadMonthSpend, loadOrgSnapshot, type ConnectionRuntime, type MonthSpendRow, type OrgAiSnapshot, type UsageRow } from "./ai-runtime-store.js"
import { syncBudgetAlerts } from "./ai-budget-alerts.js"
import type { AiExecuteResult, AiStreamExecuteResult, ResolvedConnection } from "./provider-adapter-port.js"

/**
 * RUNTIME DE IA DA ORGANIZAÇÃO — implementação da porta consultada pelo gateway (ai-runtime.ts).
 *
 *  - policy ACTIVE do Use Case → plano determinístico (PINNED / FALLBACK_CHAIN / AUTO) → adapter
 *    da conexão (segredo decifrado só aqui) → fallback APENAS em categoria elegível e permitida
 *    pela policy (§24) → evento de uso por tentativa com o MESMO correlation id (§71);
 *  - policy sem candidato elegível → erro claro (nunca troca silenciosa para o legado — §62);
 *  - orçamento com hard limit atingido → AI_BUDGET_EXCEEDED antes da chamada paga (§51);
 *  - retry: os adapters desta camada NÃO repetem; a única repetição é o fallback da policy (§70).
 */
type Queryable = Pick<Database, "query">

export type AiRuntimeOptions = {
  adapters?: AdapterRegistry
  now?: () => Date
  snapshotTtlMs?: number
  spendTtlMs?: number
  alertThrottleMs?: number
}

const PROVIDER_ENUM: Record<string, ModelProvider> = { GOOGLE_GENAI: "GEMINI", OPENAI: "OPENAI", XAI: "XAI", ANTHROPIC: "ANTHROPIC" }

export type AiRuntimeService = AiRuntime & {
  /** Descarta o cache da organização (chamado por toda escrita administrativa). */
  invalidate(organizationId: string): void
  snapshot(organizationId: string): Promise<OrgAiSnapshot>
  budgetEvaluations(organizationId: string): Promise<AiBudgetEvaluation[]>
}

export function resolveConnection(connection: ConnectionRuntime): ResolvedConnection {
  const provider = findAiProvider(connection.providerKey)
  if (!provider) throw new AiProviderError("ROUTE_UNAVAILABLE", { message: `Provider ${connection.providerKey} não está disponível neste ambiente.` })
  if (!connection.baseUrl) throw new AiProviderError("INVALID_REQUEST", { message: `A conexão "${connection.name}" não tem endpoint configurado.` })
  let headers: Record<string, string> = {}
  if (connection.headers) {
    try {
      headers = JSON.parse(decryptAiSecret(connection.headers)) as Record<string, string>
    } catch {
      throw new AiProviderError("AUTH", { message: `Não foi possível decifrar os cabeçalhos da conexão "${connection.name}".` })
    }
  }
  let apiKey: string | null = null
  if (connection.apiKey) {
    try {
      apiKey = decryptAiSecret(connection.apiKey)
    } catch {
      throw new AiProviderError("AUTH", { message: `Não foi possível decifrar a credencial da conexão "${connection.name}" (chave de criptografia do ambiente mudou?).` })
    }
  }
  if (provider.credential === "REQUIRED" && !apiKey) throw new AiProviderError("AUTH", { message: `A conexão "${connection.name}" não tem API key configurada.` })
  return { id: connection.id, name: connection.name, providerKey: connection.providerKey, adapterType: provider.adapterType, baseUrl: connection.baseUrl, apiVersion: connection.apiVersion, apiKey, headers, timeoutMs: connection.timeoutMs }
}

function toCostEstimate(cost: AiCostResult): CostEstimate {
  if (cost.status !== "ESTIMATED") return { status: "NOT_CONFIGURED" }
  // Número só para a telemetria do QA Lab (exibição); o valor persistido é o decimal exato.
  const n = (value: string) => Number(value)
  return { status: "ESTIMATED_PROVIDER_COST", currency: cost.currency, inputCost: n(cost.breakdown.input), cachedInputCost: n(cost.breakdown.cachedInput), outputCost: n(cost.breakdown.output), reasoningCost: n(cost.breakdown.reasoning), totalEstimatedCost: n(cost.amount) }
}

/** Teto de saída pela policy: o da etapa, limitado pelo do modelo cadastrado (acima dele o provider recusaria); sem etapa = o do modelo. */
export function effectiveMaxOutputTokens(requested: number | undefined, modelMax: number | null): number | null {
  if (!requested) return modelMax
  return modelMax ? Math.min(requested, modelMax) : requested
}

/** Tempo pela policy: o da etapa (calibrado no caminho legado) é o piso; o do modelo/conexão só estende, nunca encurta. */
export function effectiveTimeoutMs(requested: number | undefined, configured: number): number {
  return requested ? Math.max(requested, configured) : configured
}

function describeInput(contents: AdapterTurn[]): string {
  const last = contents[contents.length - 1]
  if (!last) return ""
  if ("functionResponses" in last) return `[respostas de ferramentas] ${last.functionResponses.map((item) => item.name).join(", ")}`
  if ("functionCalls" in last) return `[function calls] ${last.functionCalls.map((item) => item.name).join(", ")}`
  return last.text
}

function legacyCostRow(event: AiUsageEventInput): Pick<UsageRow, "cost" | "currency" | "costStatus" | "costUnknownReason" | "pricingId" | "pricingSource"> {
  const legacy = event.legacyCost
  if (legacy && legacy.status === "ESTIMATED_PROVIDER_COST") return { cost: formatDecimal(parseDecimal(legacy.totalEstimatedCost)), currency: legacy.currency, costStatus: "ESTIMATED", costUnknownReason: null, pricingId: null, pricingSource: "LEGACY_ENV" }
  return { cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: event.usage && event.usage.promptTokens !== null ? "NO_PRICING" : event.status === "SUCCESS" ? "NO_USAGE" : null, pricingId: null, pricingSource: "NONE" }
}

export function createAiRuntime(db: Queryable, options: AiRuntimeOptions = {}): AiRuntimeService {
  const adapters = options.adapters ?? createAdapterRegistry()
  const now = options.now ?? (() => new Date())
  const snapshotTtl = options.snapshotTtlMs ?? 15_000
  const spendTtl = options.spendTtlMs ?? 15_000
  const alertThrottle = options.alertThrottleMs ?? 60_000
  const snapshots = new Map<string, Promise<OrgAiSnapshot>>()
  const spends = new Map<string, { at: number; rows: Promise<MonthSpendRow[]> }>()
  const lastAlertSync = new Map<string, number>()

  const snapshot = async (organizationId: string): Promise<OrgAiSnapshot> => {
    const cached = snapshots.get(organizationId)
    if (cached) {
      const value = await cached.catch(() => null)
      if (value && now().getTime() - value.loadedAt < snapshotTtl) return value
    }
    const loading = loadOrgSnapshot(db, organizationId, now())
    snapshots.set(organizationId, loading)
    loading.catch(() => snapshots.delete(organizationId))
    return loading
  }

  const monthSpend = (organizationId: string): Promise<MonthSpendRow[]> => {
    const cached = spends.get(organizationId)
    if (cached && now().getTime() - cached.at < spendTtl) return cached.rows
    const rows = loadMonthSpend(db, organizationId, now())
    spends.set(organizationId, { at: now().getTime(), rows })
    rows.catch(() => spends.delete(organizationId))
    return rows
  }

  const budgetEvaluations = async (organizationId: string): Promise<AiBudgetEvaluation[]> => {
    const snap = await snapshot(organizationId)
    if (snap.budgets.length === 0) return []
    const rows = await monthSpend(organizationId)
    return snap.budgets.map((budget) => {
      const inScope = rows.filter((row) => budget.scope === "GLOBAL" || (budget.scope === "USE_CASE" && row.use_case === budget.scopeKey) || (budget.scope === "PROVIDER" && row.provider_key === budget.scopeKey))
      const byCurrency: Record<string, string> = {}
      for (const row of inScope) if (row.currency && row.amount) byCurrency[row.currency] = formatDecimal(parseDecimal(byCurrency[row.currency] ?? "0") + parseDecimal(row.amount))
      return evaluateBudget(budget, byCurrency, inScope.reduce((sum, row) => sum + row.unknown_calls, 0))
    })
  }

  const legacyTableCost = async (event: AiUsageEventInput) => {
    if (!event.organizationId || !event.usage || event.status !== "SUCCESS") return null
    const snap = await snapshot(event.organizationId).catch(() => null)
    const versions = snap?.legacyPricing.get(legacyPricingKey(event.providerKey, event.modelName))
    const pricing = versions ? pricingAt(versions, event.occurredAt) : null
    return pricing ? costRow(computeCallCost(event.usage, pricing)) : null
  }

  /** Orçamentos com hard limit estourados que se aplicam a esta chamada. */
  const blockingBudget = async (organizationId: string, useCase: AiUseCaseKey, providerKey: string) => {
    const snap = await snapshot(organizationId)
    if (!snap.budgets.some((budget) => budget.hardLimit)) return null
    const evaluations = await budgetEvaluations(organizationId)
    for (const budget of snap.budgets) {
      if (!budget.hardLimit) continue
      const applies = budget.scope === "GLOBAL" || (budget.scope === "USE_CASE" && budget.scopeKey === useCase) || (budget.scope === "PROVIDER" && budget.scopeKey === providerKey)
      const evaluation = evaluations.find((item) => item.budgetId === budget.id)
      if (applies && evaluation?.hardLimitReached) return { budget, evaluation }
    }
    return null
  }

  const budgetError = (blocking: NonNullable<Awaited<ReturnType<typeof blockingBudget>>>) => {
    const scopeLabel = blocking.budget.scope === "GLOBAL" ? "global" : `${blocking.budget.scope === "USE_CASE" ? "do Use Case" : "do provider"} ${blocking.budget.scopeKey}`
    return new AiBudgetExceededError(`Orçamento mensal de IA ${scopeLabel} atingido (${blocking.evaluation.spent} de ${blocking.evaluation.limit} ${blocking.budget.currency}) com bloqueio ativado. Ajuste o orçamento em Administração › IA / Modelos.`, { budgetId: blocking.budget.id, scope: blocking.budget.scope, scopeKey: blocking.budget.scopeKey, currency: blocking.budget.currency, limit: blocking.evaluation.limit, spent: blocking.evaluation.spent })
  }

  const afterCostlyEvent = (organizationId: string) => {
    spends.delete(organizationId)
    const last = lastAlertSync.get(organizationId) ?? 0
    if (now().getTime() - last < alertThrottle) return
    lastAlertSync.set(organizationId, now().getTime())
    void budgetEvaluations(organizationId)
      .then(async (evaluations) => {
        const snap = await snapshot(organizationId)
        await syncBudgetAlerts(db, organizationId, snap.budgets, evaluations, now(), snap.timezone)
      })
      .catch((error) => console.error(JSON.stringify({ event: "ai_budget_alert_sync_failed", organizationId, message: error instanceof Error ? error.message : "erro" })))
  }

  const persist = async (row: UsageRow) => {
    try {
      // V1.5.13 — ponto ÚNICO de registro: a execução de Workflow em curso (contexto do motor) vai junto, sem heurística.
      // Capacidade (migration 121): classe, espera na fila e motivo desta tentativa, do limitador de chamadas.
      // Quem pediu (migration 143): a pessoa da sessão do request, do mesmo contexto assíncrono que já trazia a organização.
      await insertUsageEvent(db, { ...row, workflow: row.workflow ?? currentAiWorkflowCorrelation(), limiter: row.limiter ?? currentAiCallLimiterRecord(), requesterPersonId: row.requesterPersonId ?? currentAiRequesterPersonId() })
      if (row.organizationId && row.cost !== null && parseDecimal(row.cost) > 0n) afterCostlyEvent(row.organizationId)
    } catch (error) {
      // Nunca derruba a chamada de IA por falha de registro; a falha fica no log (sem conteúdo).
      console.error(JSON.stringify({ event: "ai_usage_record_failed", useCase: row.useCase, message: error instanceof Error ? error.message : "erro" }))
    }
  }

  const baseEvent = (request: Pick<PolicyExecutionRequest, "organizationId" | "useCase" | "classification" | "correlationId">, policy: PolicySnapshot, candidate: RouteCandidate, attempt: number, fallbackReason: string | null) => ({
    organizationId: request.organizationId,
    occurredAt: now(),
    useCase: request.useCase,
    purpose: request.classification.purpose,
    phase: request.classification.phase,
    source: request.classification.source,
    origin: hasLlmTelemetryStore() ? ("QA_LAB" as const) : request.useCase === "MODEL_TEST" ? ("ADMIN_TEST" as const) : ("RUNTIME" as const),
    providerKey: candidate.model.connection.providerKey,
    connectionId: candidate.model.connection.id,
    modelId: candidate.model.id,
    modelName: candidate.model.providerModelId,
    isLocal: candidate.model.isLocal,
    correlationId: request.correlationId,
    attempt,
    fallbackIndex: attempt - 1,
    routingMode: policy.mode,
    routeReason: fallbackReason ? `${candidate.reason} · ${fallbackReason}` : candidate.reason,
    fallbackReason,
    policyId: policy.id,
  })

  const costRow = (cost: AiCostResult) => ({ cost: cost.status === "ESTIMATED" ? cost.amount : null, currency: cost.currency, costStatus: cost.status, costUnknownReason: cost.status === "UNKNOWN" ? cost.reason : null, pricingId: cost.pricingId, pricingSource: cost.pricingId ? ("TABLE" as const) : ("NONE" as const) })

  /** Plano + orçamento: candidatos que podem ser tentados; lança erro claro quando nenhum pode. */
  const prepare = async (request: Pick<PolicyExecutionRequest, "organizationId" | "useCase" | "classification" | "correlationId" | "estimatedInputTokens">) => {
    const snap = await snapshot(request.organizationId)
    const policy = snap.policies.get(request.useCase)
    if (!policy) return null
    const useCase = findUseCase(request.useCase)
    if (!useCase) return null
    const plan = planRoute(policy, useCase, snap.models, { estimatedInputTokens: request.estimatedInputTokens, now: now() })
    const allowed: RouteCandidate[] = []
    let budgetBlock: Awaited<ReturnType<typeof blockingBudget>> = null
    for (const candidate of plan.candidates) {
      // "Chamada paga" = custo de API: modelo LOCAL nunca é bloqueado pelo orçamento (sem preço = custo de API
      // desconhecido, computação local não medida); remoto só escapa com tabela explicitamente zerada.
      const paid = !candidate.model.isLocal && !(candidate.model.pricing && isZeroPricing(candidate.model.pricing))
      const blocking = paid ? await blockingBudget(request.organizationId, request.useCase, candidate.model.connection.providerKey) : null
      if (blocking) {
        budgetBlock = blocking
        plan.skipped.push({ modelId: candidate.model.id, displayName: candidate.model.displayName, reason: "orçamento com bloqueio atingido" })
      } else allowed.push(candidate)
    }
    if (allowed.length === 0) {
      const blockedEvent = { organizationId: request.organizationId, occurredAt: now(), useCase: request.useCase, purpose: request.classification.purpose, phase: request.classification.phase, source: request.classification.source, origin: hasLlmTelemetryStore() ? ("QA_LAB" as const) : ("RUNTIME" as const), providerKey: "NONE", connectionId: null, modelId: null, modelName: "—", isLocal: false, correlationId: request.correlationId, attempt: 1, fallbackIndex: 0, usage: null, durationMs: null, status: "BLOCKED" as const, routingMode: policy.mode, policyId: policy.id, fallbackReason: null }
      if (budgetBlock) {
        await persist({ ...blockedEvent, errorCategory: "BUDGET_EXCEEDED", routeReason: "BLOCKED_BY_BUDGET", cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: null, pricingId: null, pricingSource: "NONE" })
        throw budgetError(budgetBlock)
      }
      await persist({ ...blockedEvent, errorCategory: "ROUTE_UNAVAILABLE", routeReason: "NO_ELIGIBLE_MODEL", cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: null, pricingId: null, pricingSource: "NONE" })
      const reasons = plan.skipped.map((item) => `${item.displayName ?? "modelo removido"}: ${item.reason}`).join("; ")
      throw new AiProviderError("ROUTE_UNAVAILABLE", { message: `Nenhum modelo da política de "${useCase.label}" pode atender agora${reasons ? ` (${reasons})` : ""}. A INIA não troca de modelo sem configuração — revise a política em Administração › IA / Modelos.` })
    }
    return { snap, policy, candidates: allowed }
  }

  const resolvedRouteOf = (request: { useCase: AiUseCaseKey; correlationId: string }, policy: PolicySnapshot, candidate: RouteCandidate, attempt: number, fallbackReason: string | null): ResolvedAiRoute => ({
    requestedUseCase: request.useCase,
    routingMode: policy.mode,
    providerKey: candidate.model.connection.providerKey,
    connectionId: candidate.model.connection.id,
    connectionName: candidate.model.connection.name,
    modelId: candidate.model.id,
    modelName: candidate.model.providerModelId,
    routeReason: candidate.reason,
    fallbackAttempt: attempt - 1,
    fallbackReason,
    correlationId: request.correlationId,
  })

  const markRateLimited = (snap: OrgAiSnapshot, model: ModelSnapshot) => {
    const current = snap.models.get(model.id)
    if (current) snap.models.set(model.id, { ...current, lastRateLimitedAt: now() })
  }

  /** Executa candidato a candidato; `run` faz a chamada concreta. Fallback só em categoria elegível. */
  const attemptAll = async <T>(request: Pick<PolicyExecutionRequest, "organizationId" | "useCase" | "classification" | "correlationId">, prepared: NonNullable<Awaited<ReturnType<typeof prepare>>>, run: (candidate: RouteCandidate, connection: ResolvedConnection, timeoutMs: number) => Promise<{ value: T; usage: LlmUsage; durationMs: number }>, canRetry: () => boolean = () => true): Promise<{ value: T; candidate: RouteCandidate; attempt: number; fallbackReason: string | null; cost: AiCostResult; usage: LlmUsage }> => {
    // QA Lab ("Parar antes da IA"/orçamento de requests) decide ANTES de qualquer request sair.
    beforeLlmCall()
    let fallbackReason: string | null = null
    for (let index = 0; index < prepared.candidates.length; index++) {
      const candidate = prepared.candidates[index]!
      const attempt = index + 1
      const hasNext = index + 1 < prepared.candidates.length
      const gateKey = connectionGateKey(candidate.model.connection.id)
      // Conexão em pausa por 429 (em QUALQUER instância): o lote passa para o próximo modelo da cadeia, quando a policy permite
      // fallback por limite de requisições — nenhuma chamada sai para a conexão pausada. Sem próximo, o portão espera a pausa.
      if (hasNext && canRetry() && currentAiCallLimiterRecord()?.priority === "BATCH" && (providerCallGate()?.cooldownRemainingMs(gateKey) ?? 0) > 0 && canFallbackOn("RATE_LIMIT", prepared.policy.fallbackOn)) {
        fallbackReason = "FALLBACK_RATE_LIMIT"
        console.warn(JSON.stringify({ event: "ai_route_fallback", organizationId: request.organizationId, useCase: request.useCase, correlationId: request.correlationId, from: candidate.model.id, category: "RATE_LIMIT", attempt, reason: "CONNECTION_COOLDOWN" }))
        continue
      }
      const startedAt = now().getTime()
      try {
        const connectionRuntime = prepared.snap.connections.get(candidate.model.connection.id)
        if (!connectionRuntime) throw new AiProviderError("ROUTE_UNAVAILABLE")
        const connection = resolveConnection(connectionRuntime)
        const timeoutMs = candidate.model.timeoutMs ?? connection.timeoutMs
        // Vagas da conexão em todas as instâncias (configuradas na conexão) + pausa depois de um 429 dela.
        const { value, usage, durationMs } = await runThroughProviderGate(gateKey, connectionRuntime.maxConcurrentCalls, () => run(candidate, connection, timeoutMs))
        const cost = computeCallCost(usage, candidate.model.pricing)
        await persist({ ...baseEvent(request, prepared.policy, candidate, attempt, fallbackReason), usage, durationMs, status: "SUCCESS", errorCategory: null, ...costRow(cost) })
        return { value, candidate, attempt, fallbackReason, cost, usage }
      } catch (error) {
        const category: AiErrorCategory = error instanceof AiProviderError ? error.category : "UNKNOWN"
        await persist({ ...baseEvent(request, prepared.policy, candidate, attempt, fallbackReason), usage: null, durationMs: now().getTime() - startedAt, status: "ERROR", errorCategory: category, cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: null, pricingId: null, pricingSource: "NONE" })
        if (category === "RATE_LIMIT") markRateLimited(prepared.snap, candidate.model)
        if (hasNext && canRetry() && canFallbackOn(category, prepared.policy.fallbackOn)) {
          fallbackReason = `FALLBACK_${category}`
          console.warn(JSON.stringify({ event: "ai_route_fallback", organizationId: request.organizationId, useCase: request.useCase, correlationId: request.correlationId, from: candidate.model.id, category, attempt }))
          continue
        }
        if (error instanceof AiProviderError || error instanceof AiCallCancelledError) throw error
        throw new AiProviderError("UNKNOWN")
      }
    }
    throw new AiProviderError("ROUTE_UNAVAILABLE")
  }

  return {
    invalidate(organizationId) {
      snapshots.delete(organizationId)
      spends.delete(organizationId)
    },
    snapshot,
    budgetEvaluations,

    async executeWithPolicy(request: PolicyExecutionRequest): Promise<PolicyExecutionResult | null> {
      const prepared = await prepare(request)
      if (!prepared) return null
      const startedAtDate = now()
      // Em fluxo (chat): depois do primeiro pedaço entregue, nenhum fallback — trocaria a resposta no meio.
      let streamed = 0
      const onText = request.onText
      const result = await attemptAll(request, prepared, async (candidate, connection, timeoutMs) => {
        const provider = findAiProvider(connection.providerKey)!
        const adapter = adapters(provider.adapterType)
        const executeRequest = { systemPrompt: request.systemPrompt, contents: request.contents, tools: request.tools, structuredOutput: request.structuredOutput, maxOutputTokens: effectiveMaxOutputTokens(request.maxOutputTokens, candidate.model.maxOutputTokens), ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}), ...(request.reasoningEffort && supportsCapability(candidate.model.capabilities, "REASONING") ? { reasoningEffort: request.reasoningEffort } : {}) }
        const timeout = effectiveTimeoutMs(request.timeoutMs, timeoutMs)
        // Saída estruturada em fluxo: o texto entregue é o JSON cru — só quem extrai o que mostra pede (esclarecimento pelas bases).
        const executed = onText && adapter.streamExecute && supportsCapability(candidate.model.capabilities, "STREAMING")
          ? await adapter.streamExecute(connection, candidate.model.providerModelId, executeRequest, timeout, (text) => {
              streamed += text.length
              onText(text)
            })
          : await adapter.execute(connection, candidate.model.providerModelId, executeRequest, timeout)
        return { value: executed, usage: executed.usage, durationMs: executed.durationMs }
      }, () => streamed === 0)
      const executed = result.value
      // Telemetria do QA Lab (no-op fora dele) — o mesmo registro que os clientes legados fazem.
      recordLlmCall({
        model: executed.model,
        ...executed.usage,
        durationMs: executed.durationMs,
        startedAt: startedAtDate,
        systemPrompt: request.systemPrompt,
        input: describeInput(request.contents),
        outputText: executed.kind === "functionCalls" ? `[function calls] ${executed.calls.map((call) => call.name).join(", ")}` : executed.text || null,
        ...(executed.kind === "functionCalls" ? { toolCalls: executed.calls.map((call) => call.name) } : {}),
        promptBreakdown: { systemPromptChars: request.systemPrompt.length, toolSchemaChars: request.tools.length > 0 ? JSON.stringify(request.tools).length : 0, inputChars: request.contents.reduce((sum, turn) => sum + ("text" in turn ? turn.text.length : JSON.stringify(turn).length), 0), declaredTools: request.tools.length, technicalIds: countTechnicalIdsInPrompt(request.systemPrompt, ...request.contents.map((turn) => ("text" in turn ? turn.text : JSON.stringify(turn)))) },
      })
      const { usage: _usage, model, durationMs, streamedChars, firstTokenMs, ...payload } = executed as AiExecuteResult & Partial<Pick<AiStreamExecuteResult, "streamedChars" | "firstTokenMs">>
      void _usage
      if (payload.kind === "text" && !payload.text.trim()) throw new AiProviderError("PROVIDER_ERROR", { message: "O modelo não retornou nenhum texto." })
      return {
        ...payload,
        ...(streamedChars !== undefined ? { streamedChars, firstTokenMs: firstTokenMs ?? null } : {}),
        usage: result.usage ?? EMPTY_USAGE,
        durationMs,
        model,
        provider: PROVIDER_ENUM[result.candidate.model.connection.providerKey] ?? "LOCAL",
        cache: observedCacheRecord(result.usage, null),
        cost: toCostEstimate(result.cost),
        resolvedRoute: resolvedRouteOf(request, prepared.policy, result.candidate, result.attempt, result.fallbackReason),
      }
    },

    async streamWithPolicy(request: PolicyStreamRequest) {
      const prepared = await prepare(request)
      if (!prepared) return null
      let emitted = false
      const onChunk = (text: string) => {
        emitted = true
        request.onChunk(text)
      }
      const result = await attemptAll(
        request,
        prepared,
        async (candidate, connection, timeoutMs) => {
          const provider = findAiProvider(connection.providerKey)!
          const adapter = adapters(provider.adapterType)
          if (adapter.stream && supportsCapability(candidate.model.capabilities, "STREAMING")) {
            const streamed = await adapter.stream(connection, candidate.model.providerModelId, { systemPrompt: request.systemPrompt, contents: request.contents, maxOutputTokens: candidate.model.maxOutputTokens }, timeoutMs, onChunk)
            if (!streamed.text.trim()) throw new AiProviderError("PROVIDER_ERROR", { message: "O modelo não retornou nenhum texto." })
            return { value: streamed, usage: streamed.usage, durationMs: streamed.durationMs }
          }
          const executed = await adapter.execute(connection, candidate.model.providerModelId, { systemPrompt: request.systemPrompt, contents: request.contents, tools: [], structuredOutput: false, maxOutputTokens: candidate.model.maxOutputTokens }, timeoutMs)
          const text = executed.kind === "text" ? executed.text : ""
          if (!text.trim()) throw new AiProviderError("PROVIDER_ERROR", { message: "O modelo não retornou nenhum texto." })
          onChunk(text)
          return { value: { text, usage: executed.usage, model: executed.model, durationMs: executed.durationMs }, usage: executed.usage, durationMs: executed.durationMs }
        },
        // Depois do primeiro chunk entregue ao usuário não há fallback: trocaria a resposta no meio.
        () => !emitted,
      )
      return { resolvedRoute: resolvedRouteOf(request, prepared.policy, result.candidate, result.attempt, result.fallbackReason), usage: result.usage }
    },

    async speechIdentityWithPolicy({ organizationId, useCase }): Promise<SpeechCacheIdentity | null> {
      const snap = await snapshot(organizationId)
      const policy = snap.policies.get(useCase)
      const definition = findUseCase(useCase)
      if (!policy || !definition) return null
      const candidates = planRoute(policy, definition, snap.models, { estimatedInputTokens: null, now: now() }).candidates
      const primary = candidates[0]?.model.speech
      // Policy ativa sem candidato: identidade que não casa com nenhum áudio guardado — nunca serve a voz de outra rota (a síntese
      // falha com o erro claro da policy). Áudio de um fallback com OUTRA voz também não é reaproveitado: o primário tenta de novo.
      if (!primary) return { voice: "", models: [] }
      return { voice: primary.voice, models: candidates.filter((candidate) => candidate.model.speech?.voice === primary.voice).map((candidate) => speechCacheModelKey(candidate.model.providerModelId, candidate.model.speech!)) }
    },

    async synthesizeSpeechWithPolicy(request: PolicySpeechRequest): Promise<PolicySpeechResult | null> {
      const prepared = await prepare({ ...request, estimatedInputTokens: estimateTokens(request.text) })
      if (!prepared) return null
      const result = await attemptAll(request, prepared, async (candidate, connection, timeoutMs) => {
        const adapter = adapters(findAiProvider(connection.providerKey)!.adapterType)
        const speech = candidate.model.speech
        // A elegibilidade já exige os dois; esta é a trava de quem chama o adapter.
        if (!adapter.synthesizeSpeech || !speech) throw new AiProviderError("ROUTE_UNAVAILABLE", { message: `O modelo "${candidate.model.displayName}" não faz síntese de voz na INIA (provider sem síntese ou voz não configurada).` })
        const spoken = await adapter.synthesizeSpeech(connection, candidate.model.providerModelId, { text: request.text, voice: speech.voice, instructions: speech.instructions }, timeoutMs)
        return { value: { ...spoken, speech }, usage: spoken.usage, durationMs: spoken.durationMs }
      })
      const spoken = result.value
      return { pcm16: spoken.pcm16, sampleRate: spoken.sampleRate, voice: spoken.speech.voice, model: speechCacheModelKey(result.candidate.model.providerModelId, spoken.speech), usage: result.usage, resolvedRoute: resolvedRouteOf(request, prepared.policy, result.candidate, result.attempt, result.fallbackReason) }
    },

    async assertLegacyCallAllowed({ organizationId, useCase, providerKey }) {
      const blocking = await blockingBudget(organizationId, useCase, providerKey)
      if (!blocking) return
      await persist({ organizationId, occurredAt: now(), useCase, purpose: null, phase: null, source: null, origin: hasLlmTelemetryStore() ? "QA_LAB" : "RUNTIME", providerKey, connectionId: null, modelId: null, modelName: "—", isLocal: false, correlationId: crypto.randomUUID(), attempt: 1, fallbackIndex: 0, usage: null, durationMs: null, status: "BLOCKED", errorCategory: "BUDGET_EXCEEDED", routingMode: "LEGACY", routeReason: "BLOCKED_BY_BUDGET", fallbackReason: null, policyId: null, cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: null, pricingId: null, pricingSource: "NONE" })
      throw budgetError(blocking)
    },

    async recordUsage(event: AiUsageEventInput) {
      // Uso LEGADO (sem policy) também é precificado pela tabela da organização quando o MESMO modelo
      // (provider + id) está cadastrado com preço vigente naquele instante — só contabilidade, a rota
      // não muda. Sem cadastro (ou cadastro ambíguo) → preço do ambiente, se houver; senão UNKNOWN.
      const table = await legacyTableCost(event)
      await persist({ ...event, policyId: null, ...(table ?? legacyCostRow(event)) })
    },
  }
}
