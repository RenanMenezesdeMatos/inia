import { randomUUID } from "node:crypto"
import { env } from "../../../config/env.js"
import { DomainError } from "../../domain/domain-error.js"
import { AiCallBlockedError, annotateLastLlmCall, EMPTY_USAGE, hasLlmTelemetryStore, withLlmRequestMeta, type LlmCacheRecord, type LlmContextBreakdown, type LlmRequestClassification, type LlmRouteRecord, type LlmUsage } from "../llm-telemetry.js"
// Registro do único provedor configurado hoje (efeito colateral do import — ver provider-adapter.ts).
import "../../../modules/assistant/infrastructure/gemini-provider-adapter.js"
import { providerAdapterFor, type AdapterRequest, type AdapterResponse } from "./provider-adapter.js"
import { addCost, estimateCost, pricingFor, type CostEstimate } from "./model-pricing.js"
import { observedCacheRecord } from "./cache-record.js"
import { escalateRoute, resolveRoute, type RouteDecision, type RouteSignals, type RoutingMode } from "./route-policy.js"
import type { PromptComponentUsage } from "../prompting/prompt-components.js"
import { legacyGateKey, runThroughProviderGate } from "./provider-call-gate.js"
import { aiRuntime, currentAiAbortSignal, currentAiOrganizationId, type AiUsageEventInput, type AiUsageOrigin, type ResolvedAiRoute, type SpeechCacheIdentity } from "./ai-runtime.js"
import { useCaseForPurpose, type AiUseCaseKey } from "./ai-use-cases.js"
import { categorizeHttpStatus, retryAfterMsFrom, type AiErrorCategory } from "./ai-errors.js"
import { runLimitedAiCall } from "./ai-call-limiter.js"
import { estimateTokens } from "./token-estimate.js"

/**
 * GATEWAY — o ÚNICO ponto por onde uma request de IA do backend sai (V1.3 — §9/§44). Concentra:
 * rota (política determinística), adapter do provedor, classificação da request (fase/propósito/
 * origem/tipo semântico — nunca ids pessoais), telemetria, cache, custo e escalação.
 *
 * AI PROVIDERS V1 (§29, §32, §88) — o MESMO roteador, agora com a policy da organização por cima:
 *
 *   ordem de resolução:  1. policy ACTIVE da organização para o Use Case (conexão/modelo do banco)
 *                        2. configuração LEGADA do ambiente (perfis por tier + GEMINI_API_KEY)
 *
 * Sem policy ativa (ou sem runtime registrado — testes/benchmarks), a chamada segue EXATAMENTE o
 * caminho anterior: zero troca silenciosa de modelo depois da migration. Toda chamada (policy ou
 * legado) gera um evento de uso com a rota resolvida (§30, §45, §90). Os bypasses remanescentes
 * (streaming do chat e sessão de voz) também passam por aqui — `createChatStreamer`/`createVoiceSessionStarter`.
 *
 * CAPACIDADE: toda chamada daqui (inclusive chat/voz/recado) passa pelo limitador do processo (`ai-call-limiter.ts`) —
 * prioridade interativa × lote pelo contexto, vagas reservadas ao chat e backoff de 429/503. O fallback da policy acontece
 * DENTRO da vaga; o limitador só repete quando a rota inteira devolveu 429/503.
 */
export function routingMode(): RoutingMode {
  return env.INIA_MODEL_ROUTING
}

export function routeFor(signals: RouteSignals, mode: RoutingMode = routingMode()): RouteDecision {
  return resolveRoute(signals, mode)
}

export type GatewayRequest = Omit<AdapterRequest, "tools" | "structuredOutput"> & {
  tools?: AdapterRequest["tools"] | undefined
  structuredOutput?: boolean | undefined
  classification: LlmRequestClassification
  contextBreakdown?: LlmContextBreakdown | undefined
  promptComponents?: PromptComponentUsage[] | undefined
}

export type GatewayResponse = AdapterResponse & { cache: LlmCacheRecord; cost: CostEstimate; resolvedRoute?: ResolvedAiRoute }

/** Provider legado (enum dos perfis por ambiente) → chave do catálogo de providers (só agregação/dashboard). */
const LEGACY_PROVIDER_KEYS: Record<string, string> = { GEMINI: "GOOGLE_GENAI", OPENAI: "OPENAI", XAI: "XAI", ANTHROPIC: "ANTHROPIC", LOCAL: "OPENAI_COMPATIBLE" }
export function legacyProviderKey(provider: string): string {
  return LEGACY_PROVIDER_KEYS[provider] ?? provider
}

function usageOrigin(): AiUsageOrigin {
  return hasLlmTelemetryStore() ? "QA_LAB" : "RUNTIME"
}

function textOfTurns(contents: AdapterRequest["contents"]): string {
  return contents.map((turn) => ("text" in turn ? turn.text : JSON.stringify(turn))).join("\n")
}

/** Erro de cliente legado sem o corpo cru do provider (o handler HTTP devolveria `details` ao navegador — §93). Só a dica de
 * espera do 429/503 (Retry-After / RetryInfo do Google) é extraída do corpo — para o limitador de chamadas. */
function sanitizeLegacyError(error: unknown): { error: unknown; category: AiErrorCategory } {
  if (error instanceof DomainError && error.details && typeof error.details === "object" && "body" in error.details) {
    const status = (error.details as { status?: unknown }).status
    const body = String((error.details as { body?: unknown }).body ?? "")
    const category = typeof status === "number" ? categorizeHttpStatus(status, body) : "UNKNOWN"
    const retryAfterMs = status === 429 || status === 503 ? retryAfterMsFrom(null, body) : null
    return { error: new DomainError(error.message, error.code, error.statusCode, { status: typeof status === "number" ? status : null, category, ...(retryAfterMs !== null ? { retryAfterMs } : {}) }), category }
  }
  if (error instanceof DomainError) return { error, category: /TIMEOUT/.test(error.code) ? "TIMEOUT" : /NETWORK/.test(error.code) ? "NETWORK" : /NOT_CONFIGURED/.test(error.code) ? "ROUTE_UNAVAILABLE" : "UNKNOWN" }
  return { error, category: "UNKNOWN" }
}

type LegacyUsageInput = { organizationId: string | null; useCase: AiUseCaseKey; classification: LlmRequestClassification | null; route: RouteDecision | null; providerKey: string; modelName: string; correlationId: string; usage: LlmUsage | null; durationMs: number | null; status: AiUsageEventInput["status"]; errorCategory: AiErrorCategory | null; legacyCost: CostEstimate | null; routeReason?: string }

async function recordLegacyUsage(input: Omit<LegacyUsageInput, "useCase"> & { useCase: AiUseCaseKey | null }): Promise<void> {
  const runtime = aiRuntime()
  if (!runtime || !input.useCase) return
  await runtime.recordUsage({
    organizationId: input.organizationId,
    occurredAt: new Date(),
    useCase: input.useCase,
    purpose: input.classification?.purpose ?? input.route?.purpose ?? null,
    phase: input.classification?.phase ?? null,
    source: input.classification?.source ?? null,
    providerKey: input.providerKey,
    connectionId: null,
    modelId: null,
    modelName: input.modelName,
    isLocal: input.providerKey === "OPENAI_COMPATIBLE",
    correlationId: input.correlationId,
    attempt: 1,
    fallbackIndex: 0,
    usage: input.usage,
    durationMs: input.durationMs,
    status: input.status,
    errorCategory: input.errorCategory,
    routingMode: "LEGACY",
    routeReason: input.routeReason ?? `DEFAULT_POLICY · ${input.route ? `${input.route.tier} (${input.route.mode})` : "configuração do ambiente"}`,
    fallbackReason: null,
    origin: usageOrigin(),
    legacyCost: input.legacyCost,
  })
}

export async function generateForRoute(request: GatewayRequest): Promise<GatewayResponse> {
  const meta = { classification: request.classification, ...(request.promptComponents ? { promptComponents: request.promptComponents } : {}), ...(request.contextBreakdown ? { contextBreakdown: request.contextBreakdown } : {}) }
  return withLlmRequestMeta(meta, async () => {
    const runtime = aiRuntime()
    const organizationId = currentAiOrganizationId()
    // Propósito sem mapeamento NUNCA escapa do registro de uso nem do orçamento: vira UNCLASSIFIED
    // (não roteável — nenhuma policy é escolhida por palpite; segue o legado).
    const useCase: AiUseCaseKey = useCaseForPurpose(request.route.purpose ?? request.classification.purpose, request.classification) ?? "UNCLASSIFIED"
    const correlationId = randomUUID()

    // Capacidade: espera vaga no limitador do processo (interativa à frente do lote) e repete 429/503 conforme a classe.
    // `transport.retries: 0` = o chamador decide a falha sozinho (Feedback Writer) — só enfileira, nunca repete.
    return runLimitedAiCall(useCase, { noRetry: request.transport?.retries === 0 }, async () => {
      // 1) Policy ACTIVE da organização para o Use Case (null = não há → legado).
      if (runtime && organizationId) {
        const viaPolicy = useCase === "UNCLASSIFIED" ? null : await runtime.executeWithPolicy({
          organizationId,
          useCase,
          classification: request.classification,
          correlationId,
          systemPrompt: request.systemPrompt,
          contents: request.contents,
          tools: request.tools ?? [],
          structuredOutput: request.structuredOutput ?? false,
          estimatedInputTokens: estimateTokens(request.systemPrompt, textOfTurns(request.contents), request.tools && request.tools.length > 0 ? JSON.stringify(request.tools) : ""),
          legacyRoute: request.route,
          // O que a etapa exige vale também pela policy (o legado recebe o mesmo, abaixo): schema, teto de saída e tempo.
          ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          ...(request.transport?.timeoutMs ? { timeoutMs: request.transport.timeoutMs } : {}),
        })
        if (viaPolicy) {
          const route = viaPolicy.resolvedRoute
          annotateLastLlmCall({ cache: viaPolicy.cache, cost: viaPolicy.cost, aiRoute: { requestedUseCase: route.requestedUseCase, routingMode: route.routingMode, providerKey: route.providerKey, connectionName: route.connectionName, modelName: route.modelName, routeReason: route.routeReason, fallbackAttempt: route.fallbackAttempt, fallbackReason: route.fallbackReason, correlationId: route.correlationId } })
          return viaPolicy
        }
        await runtime.assertLegacyCallAllowed({ organizationId, useCase, providerKey: legacyProviderKey(request.route.profile.provider) })
      }

      // 2) Caminho LEGADO — idêntico ao anterior (perfil do tier + adapter registrado por provider).
      const adapter = providerAdapterFor(request.route.profile)
      const providerKey = legacyProviderKey(request.route.profile.provider)
      const startedAt = Date.now()
      // Rota do ambiente (sem conexão cadastrada): sem teto compartilhado, mas a pausa depois de um 429 vale para todas as
      // instâncias (chave do provedor da rota).
      const raw: AdapterResponse = await runThroughProviderGate(legacyGateKey(providerKey), null, async () => {
        try {
          return await adapter.generate({ systemPrompt: request.systemPrompt, contents: request.contents, tools: request.tools ?? [], structuredOutput: request.structuredOutput ?? false, route: request.route, cache: request.cache, ...(request.transport ? { transport: request.transport } : {}), ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}), ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}) })
        } catch (error) {
          if (error instanceof AiCallBlockedError) throw error
          const sanitized = sanitizeLegacyError(error)
          await recordLegacyUsage({ organizationId, useCase, classification: request.classification, route: request.route, providerKey, modelName: request.route.profile.model, correlationId, usage: null, durationMs: Date.now() - startedAt, status: "ERROR", errorCategory: sanitized.category, legacyCost: null })
          throw sanitized.error
        }
      })
      // Adapters (e clientes mockados em teste) podem não informar uso/modelo — nunca inventamos números.
      const response: AdapterResponse = { ...raw, usage: raw.usage ?? EMPTY_USAGE, durationMs: raw.durationMs ?? 0, model: raw.model ?? request.route.profile.model, provider: raw.provider ?? request.route.profile.provider }
      const { createdTokens, ...declaredCache } = response.cache ?? { ...observedCacheRecord(response.usage, request.cache?.cacheKeyVersion ?? null), createdTokens: 0 }
      const pricing = pricingFor(request.route.profile.id, response.model)
      let cost = estimateCost(response.usage, pricing)
      // Criar o cache explícito cobra os tokens do prefixo como entrada UMA vez — entra no custo da request que o criou.
      if (createdTokens && createdTokens > 0) cost = addCost(cost, estimateCost({ promptTokens: createdTokens, cachedInputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null }, pricing))
      const cache: LlmCacheRecord = declaredCache
      annotateLastLlmCall({ cache, cost })
      await recordLegacyUsage({ organizationId, useCase, classification: request.classification, route: request.route, providerKey, modelName: response.model, correlationId, usage: response.usage, durationMs: response.durationMs, status: "SUCCESS", errorCategory: null, legacyCost: pricing ? cost : null })
      return { ...response, cache, cost }
    })
  })
}

/** Registro compacto da decisão (telemetria) — sem o perfil inteiro. */
export function routeRecordOf(route: RouteDecision): LlmRouteRecord {
  return { provider: route.profile.provider, tier: route.tier, reason: route.reason, mode: route.mode, escalated: route.escalated, fallback: route.fallback }
}

export type ChatHistoryTurn = { role: "user" | "model"; text: string }
export type LegacyChatStream = (history: ChatHistoryTurn[], systemInstruction: string, onChunk: (text: string) => void, cancel?: AbortSignal | null) => Promise<LlmUsage | null | void>

/**
 * CHAT sem Orquestrador (antes: bypass do gateway — §90). Mesma assinatura do cliente de streaming
 * legado, para o router de realtime não mudar: policy CHAT da organização quando existir; senão o
 * streaming legado de sempre. Uso registrado nos dois caminhos.
 */
export function createChatStreamer(legacy: LegacyChatStream): (history: ChatHistoryTurn[], systemInstruction: string, onChunk: (text: string) => void) => Promise<void> {
  return async (history, systemInstruction, userOnChunk) => {
    const runtime = aiRuntime()
    const organizationId = currentAiOrganizationId()
    const correlationId = randomUUID()
    const classification: LlmRequestClassification = { phase: "SYNTHESIS", purpose: "CHAT_STREAM", source: "CHAT", semanticType: "TEXT" }
    // Depois do primeiro pedaço entregue ao usuário, nunca repete (trocaria a resposta no meio).
    let emitted = false
    const onChunk = (text: string) => {
      emitted = true
      userOnChunk(text)
    }
    return runLimitedAiCall("CHAT", { canRetry: () => !emitted }, async () => {
      if (runtime && organizationId) {
        const contents = history.map((turn) => ({ role: turn.role, text: turn.text }))
        const viaPolicy = await runtime.streamWithPolicy({ organizationId, useCase: "CHAT", classification, correlationId, systemPrompt: systemInstruction, contents, estimatedInputTokens: estimateTokens(systemInstruction, ...history.map((turn) => turn.text)), onChunk })
        if (viaPolicy) return
        await runtime.assertLegacyCallAllowed({ organizationId, useCase: "CHAT", providerKey: "GOOGLE_GENAI" })
      }
      const startedAt = Date.now()
      await runThroughProviderGate(legacyGateKey(LEGACY_CHAT_PROVIDER_KEY), null, async () => {
        try {
          const usage = await legacy(history, systemInstruction, onChunk, currentAiAbortSignal())
          await recordLegacyUsage({ organizationId, useCase: "CHAT", classification, route: null, providerKey: LEGACY_CHAT_PROVIDER_KEY, modelName: LEGACY_CHAT_MODEL, correlationId, usage: usage ?? null, durationMs: Date.now() - startedAt, status: "SUCCESS", errorCategory: null, legacyCost: null })
        } catch (error) {
          const sanitized = sanitizeLegacyError(error)
          await recordLegacyUsage({ organizationId, useCase: "CHAT", classification, route: null, providerKey: LEGACY_CHAT_PROVIDER_KEY, modelName: LEGACY_CHAT_MODEL, correlationId, usage: null, durationMs: Date.now() - startedAt, status: "ERROR", errorCategory: sanitized.category, legacyCost: null })
          throw sanitized.error
        }
      })
    })
  }
}

/** Modelo do streaming legado do chat (gemini-text-client.ts) — só para o registro de uso. */
export const LEGACY_CHAT_MODEL = "gemini-3.1-flash-lite"
/** Provedor do streaming legado do chat (registro de uso e chave da pausa compartilhada). */
const LEGACY_CHAT_PROVIDER_KEY = "GOOGLE_GENAI"

/**
 * VOZ em tempo real (§90 — exceção documentada): a sessão Live roda no navegador com token efêmero;
 * a INIA não vê os tokens da conversa. O que dá para fazer com honestidade: aplicar o hard limit do
 * orçamento ANTES de abrir a sessão e registrar a sessão iniciada (uso = desconhecido, nunca 0).
 */
export function createVoiceSessionStarter<TConfig, T extends { model: string }>(legacy: (config: TConfig) => Promise<T>): (config: TConfig) => Promise<T> {
  return (config) => runLimitedAiCall("VOICE_REALTIME", {}, async () => {
    const runtime = aiRuntime()
    const organizationId = currentAiOrganizationId()
    if (runtime && organizationId) await runtime.assertLegacyCallAllowed({ organizationId, useCase: "VOICE_REALTIME", providerKey: "GOOGLE_GENAI" })
    const correlationId = randomUUID()
    const startedAt = Date.now()
    const classification: LlmRequestClassification = { phase: "SYNTHESIS", purpose: "VOICE_SESSION", source: "VOICE", semanticType: "TEXT" }
    try {
      const session = await legacy(config)
      await recordLegacyUsage({ organizationId, useCase: "VOICE_REALTIME", classification, route: null, providerKey: "GOOGLE_GENAI", modelName: session.model, correlationId, usage: null, durationMs: Date.now() - startedAt, status: "SUCCESS", errorCategory: null, legacyCost: null, routeReason: "DEFAULT_POLICY · sessão de voz (tokens não informados pela sessão no navegador)" })
      return session
    } catch (error) {
      const sanitized = sanitizeLegacyError(error)
      await recordLegacyUsage({ organizationId, useCase: "VOICE_REALTIME", classification, route: null, providerKey: "GOOGLE_GENAI", modelName: "voice", correlationId, usage: null, durationMs: Date.now() - startedAt, status: "ERROR", errorCategory: sanitized.category, legacyCost: null })
      throw sanitized.error
    }
  })
}

/**
 * VOZ DO RECADO (Workflow Output → Avatar): TTS do texto EXATO do recado. Não é roteável (modelo fixo por ambiente); aplica o
 * hard limit do orçamento antes e grava um evento de uso por síntese (tokens como o provider informar).
 */
export function createSpeechSynthesizer<TRequest, TResult extends { model: string; usage: LlmUsage | null }>(legacy: (request: TRequest) => Promise<TResult>): (request: TRequest) => Promise<TResult> {
  return (request) => runLimitedAiCall("SPEECH_SYNTHESIS", {}, async () => {
    const runtime = aiRuntime()
    const organizationId = currentAiOrganizationId()
    if (runtime && organizationId) await runtime.assertLegacyCallAllowed({ organizationId, useCase: "SPEECH_SYNTHESIS", providerKey: "GOOGLE_GENAI" })
    const correlationId = randomUUID()
    const startedAt = Date.now()
    const classification: LlmRequestClassification = { phase: "SYNTHESIS", purpose: "SPEECH_SYNTHESIS", source: "VOICE", semanticType: "TEXT", tags: ["surface:AVATAR_RECADO"] }
    try {
      const result = await legacy(request)
      await recordLegacyUsage({ organizationId, useCase: "SPEECH_SYNTHESIS", classification, route: null, providerKey: "GOOGLE_GENAI", modelName: result.model, correlationId, usage: result.usage, durationMs: Date.now() - startedAt, status: "SUCCESS", errorCategory: null, legacyCost: null, routeReason: "DEFAULT_POLICY · voz do recado (modelo fixo por ambiente)" })
      return result
    } catch (error) {
      const sanitized = sanitizeLegacyError(error)
      await recordLegacyUsage({ organizationId, useCase: "SPEECH_SYNTHESIS", classification, route: null, providerKey: "GOOGLE_GENAI", modelName: "tts", correlationId, usage: null, durationMs: Date.now() - startedAt, status: "ERROR", errorCategory: sanitized.category, legacyCost: null })
      throw sanitized.error
    }
  })
}

type SpokenAudio = { pcm16: Buffer; sampleRate: number; model: string; voice: string }
/** Mesma classificação do recado no legado (`createSpeechSynthesizer`) — o uso pela policy aparece junto no dashboard. */
const SPEECH_CLASSIFICATION: LlmRequestClassification = { phase: "SYNTHESIS", purpose: "SPEECH_SYNTHESIS", source: "VOICE", semanticType: "TEXT", tags: ["surface:AVATAR_RECADO"] }

/**
 * VOZ DO RECADO pela policy da organização (Use Case SPEECH_SYNTHESIS — recado do avatar e "Ouvir com a INIA"). Com policy
 * ACTIVE, o modelo dela lê o texto exato com a voz cadastrada no modelo (limitador, orçamento, fallback e uso como qualquer
 * chamada por policy). Sem policy, `legacy` — a composição de sempre (voz da conversa conferida + TTS de reserva, cada uma já
 * embrulhada por `createSpeechSynthesizer`) — exatamente como antes. A policy é a que vale para a VOZ DO RECADO; a conversa por
 * voz (Gemini Live no navegador) não muda.
 */
export function createRoutedSpeechSynthesizer(legacy: (request: { text: string }) => Promise<SpokenAudio>): (request: { text: string }) => Promise<SpokenAudio> {
  return async (request) => {
    const runtime = aiRuntime()
    const organizationId = currentAiOrganizationId()
    // A checagem (snapshot em cache) vem antes da vaga do limitador: sem policy, o legado entra na fila uma vez só, como antes.
    if (runtime?.synthesizeSpeechWithPolicy && runtime.speechIdentityWithPolicy && organizationId && (await runtime.speechIdentityWithPolicy({ organizationId, useCase: "SPEECH_SYNTHESIS" }))) {
      const viaPolicy = await runLimitedAiCall("SPEECH_SYNTHESIS", {}, () => runtime.synthesizeSpeechWithPolicy!({ organizationId, useCase: "SPEECH_SYNTHESIS", classification: SPEECH_CLASSIFICATION, correlationId: randomUUID(), text: request.text }))
      if (viaPolicy) return { pcm16: viaPolicy.pcm16, sampleRate: viaPolicy.sampleRate, model: viaPolicy.model, voice: viaPolicy.voice }
    }
    return legacy(request)
  }
}

/**
 * Voz e identidades de áudio que o cache do recado/"Ouvir" aceita AGORA: as da policy ativa de SPEECH_SYNTHESIS, ou `legacy`
 * (sem policy, sem runtime ou sem organização — exatamente as de antes). Trocar a policy nunca serve o áudio de outra voz.
 */
export async function speechCacheIdentity(legacy: SpeechCacheIdentity): Promise<SpeechCacheIdentity> {
  const runtime = aiRuntime()
  const organizationId = currentAiOrganizationId()
  if (!runtime?.speechIdentityWithPolicy || !organizationId) return legacy
  return (await runtime.speechIdentityWithPolicy({ organizationId, useCase: "SPEECH_SYNTHESIS" })) ?? legacy
}

export { escalateRoute, observedCacheRecord }
export type { RouteDecision, RouteSignals, RoutingMode }
