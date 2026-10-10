import { AsyncLocalStorage } from "node:async_hooks"
import type { LlmCacheRecord, LlmRequestClassification, LlmUsage } from "../llm-telemetry.js"
import type { AiErrorCategory } from "./ai-errors.js"
import type { AiUseCaseKey } from "./ai-use-cases.js"
import type { CostEstimate } from "./model-pricing.js"
import type { AdapterFunctionDeclaration, AdapterResponse, AdapterTurn } from "./provider-adapter.js"
import type { RouteDecision } from "./route-policy.js"

/**
 * PORTA DO RUNTIME DE IA DA ORGANIZAÇÃO (§29, §32, §88). O roteador continua sendo o de sempre
 * (llm-gateway.ts + route-policy.ts); esta porta é a extensão que ele consulta ANTES de cair no
 * caminho legado:
 *
 *   1. policy ACTIVE da organização para o Use Case  → executa por ela (conexões/modelos do banco)
 *   2. sem policy                                    → caminho legado (perfis por ambiente — exatamente o comportamento anterior)
 *
 * A implementação concreta (Postgres, adapters, segredos, orçamento, uso) mora em
 * `modules/ai-management` e é registrada no bootstrap do servidor. Sem registro (testes unitários,
 * scripts de benchmark), o gateway se comporta EXATAMENTE como antes desta entrega.
 */
/**
 * V1.5.13 — CORRELAÇÃO com a execução de Workflow que faz a chamada: o motor processa UM nó de UMA matrícula por vez e
 * abre este contexto em volta do nó; o registro de uso (um só ponto) grava esses ids em `ai_usage_events`. Determinística
 * — nunca por horário, texto ou nome. Fora do motor (chat, voz, teste de modelo, QA Lab) não existe.
 */
export type AiWorkflowCorrelation = {
  workflowId: string
  workflowVersionId: string
  enrollmentId: string
  /** Disparo: a matrícula RAIZ (a própria, ou o pai de um filho de fan-out — o fan-out tem um nível só). */
  rootEnrollmentId: string
  nodeId: string
}

/**
 * De onde a chamada vem — só o que dá para afirmar com certeza: `USER_REQUEST` = request HTTP de uma pessoa com sessão
 * (middleware de auth). Ausente = fora de um request (motor de Workflow, jobs, scripts). Base da prioridade do limitador de
 * chamadas (ai-call-limiter.ts): pessoa esperando na tela passa à frente de lote.
 */
export type AiCallOrigin = "USER_REQUEST"

export type AiExecutionContext = { organizationId: string; workflow?: AiWorkflowCorrelation; origin?: AiCallOrigin }

const contextStorage = new AsyncLocalStorage<AiExecutionContext>()

/** Organização das chamadas de IA feitas dentro de `fn` (middleware de auth, motor de Workflow). */
export function runWithAiOrganization<T>(organizationId: string, fn: () => T, options: { origin?: AiCallOrigin } = {}): T {
  return contextStorage.run({ organizationId, ...(options.origin ? { origin: options.origin } : {}) }, fn)
}

/** Organização + execução de Workflow (motor, por nó) das chamadas de IA feitas dentro de `fn`. */
export function runWithAiWorkflowCorrelation<T>(organizationId: string, workflow: AiWorkflowCorrelation, fn: () => T): T {
  return contextStorage.run({ organizationId, workflow }, fn)
}

export function currentAiOrganizationId(): string | null {
  return contextStorage.getStore()?.organizationId ?? null
}

export function currentAiWorkflowCorrelation(): AiWorkflowCorrelation | null {
  return contextStorage.getStore()?.workflow ?? null
}

export function currentAiCallOrigin(): AiCallOrigin | null {
  return contextStorage.getStore()?.origin ?? null
}

export type AiUsageStatus = "SUCCESS" | "ERROR" | "BLOCKED"
export type AiRoutingModeRecord = "LEGACY" | "PINNED" | "FALLBACK_CHAIN" | "AUTO"
export type AiUsageOrigin = "RUNTIME" | "QA_LAB" | "ADMIN_TEST"

/** Um evento por TENTATIVA de chamada ao provider (§45) — sem prompt, sem resposta, sem segredo (§46). */
export type AiUsageEventInput = {
  organizationId: string | null
  occurredAt: Date
  useCase: AiUseCaseKey
  purpose: string | null
  phase: string | null
  source: string | null
  providerKey: string
  connectionId: string | null
  modelId: string | null
  modelName: string
  isLocal: boolean
  correlationId: string
  attempt: number
  fallbackIndex: number
  usage: LlmUsage | null
  durationMs: number | null
  status: AiUsageStatus
  errorCategory: AiErrorCategory | null
  routingMode: AiRoutingModeRecord
  routeReason: string
  fallbackReason: string | null
  origin: AiUsageOrigin
  /** Custo do caminho legado (tabela INIA_MODEL_PRICING do ambiente) — o caminho por policy usa a tabela versionada. */
  legacyCost?: CostEstimate | null
}

/** Rota efetivamente usada (§30) — registrada na telemetria do QA Lab e no evento de uso. */
export type ResolvedAiRoute = {
  requestedUseCase: AiUseCaseKey
  routingMode: AiRoutingModeRecord
  providerKey: string
  connectionId: string | null
  connectionName: string | null
  modelId: string | null
  modelName: string
  routeReason: string
  fallbackAttempt: number
  fallbackReason: string | null
  correlationId: string
}

export type PolicyExecutionRequest = {
  organizationId: string
  useCase: AiUseCaseKey
  classification: LlmRequestClassification
  correlationId: string
  systemPrompt: string
  contents: AdapterTurn[]
  tools: AdapterFunctionDeclaration[]
  structuredOutput: boolean
  estimatedInputTokens: number | null
  /** Rota legada que seria usada (telemetria de comparação; nunca usada como fallback silencioso). */
  legacyRoute: RouteDecision
  /** O que a ETAPA exige, como no caminho legado (motor de feedback, redatores): schema da saída estruturada, teto de saída
   * (limitado pelo do modelo cadastrado) e tempo da etapa (o maior entre ele e o do modelo/conexão — o admin só estende). */
  responseSchema?: Record<string, unknown> | undefined
  maxOutputTokens?: number | undefined
  timeoutMs?: number | undefined
}

export type PolicyExecutionResult = AdapterResponse & { cache: LlmCacheRecord; cost: CostEstimate; resolvedRoute: ResolvedAiRoute }

export type PolicyStreamRequest = Omit<PolicyExecutionRequest, "tools" | "structuredOutput" | "legacyRoute" | "responseSchema" | "maxOutputTokens" | "timeoutMs"> & { onChunk: (text: string) => void }

/** Síntese de voz pela policy da organização (Use Case SPEECH_SYNTHESIS): o texto EXATO, lido com a voz cadastrada no modelo. */
export type PolicySpeechRequest = { organizationId: string; useCase: AiUseCaseKey; classification: LlmRequestClassification; correlationId: string; text: string }
/** `model` = identidade do áudio para o cache (modelo do provider + hash da instrução de tom — ai-speech.ts). */
export type PolicySpeechResult = { pcm16: Buffer; sampleRate: number; voice: string; model: string; usage: LlmUsage; resolvedRoute: ResolvedAiRoute }
/** Voz e identidades de áudio que o cache aceita (mesma forma do caminho legado: voz da INIA + `acceptedRecadoModels`). */
export type SpeechCacheIdentity = { voice: string; models: readonly string[] }

export interface AiRuntime {
  /** null = a organização não tem policy ACTIVE para o Use Case → o gateway segue pelo legado. */
  executeWithPolicy(request: PolicyExecutionRequest): Promise<PolicyExecutionResult | null>
  /** null = sem policy (legado). Streaming quando o adapter suporta; senão uma resposta única como um chunk. */
  streamWithPolicy(request: PolicyStreamRequest): Promise<{ resolvedRoute: ResolvedAiRoute; usage: LlmUsage } | null>
  /** Antes de uma chamada LEGADA paga: aplica o hard limit do orçamento da organização (§51). */
  assertLegacyCallAllowed(input: { organizationId: string; useCase: AiUseCaseKey; providerKey: string }): Promise<void>
  /** Persistência do uso (§45) — nunca derruba a chamada se falhar. */
  recordUsage(event: AiUsageEventInput): Promise<void>
  /** null = sem policy ACTIVE do Use Case de voz (o cache aceita as identidades do legado). Opcional: runtime sem voz = legado. */
  speechIdentityWithPolicy?(input: { organizationId: string; useCase: AiUseCaseKey }): Promise<SpeechCacheIdentity | null>
  /** null = sem policy (legado). Com policy, lê o texto pela conexão/modelo/voz dela — fallback e uso como em `executeWithPolicy`. */
  synthesizeSpeechWithPolicy?(request: PolicySpeechRequest): Promise<PolicySpeechResult | null>
}

let runtime: AiRuntime | null = null

export function registerAiRuntime(next: AiRuntime | null): void {
  runtime = next
}

export function aiRuntime(): AiRuntime | null {
  return runtime
}
