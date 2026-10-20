import { AsyncLocalStorage } from "node:async_hooks"
import { DomainError } from "../domain/domain-error.js"
import type { KnowledgeTrace } from "../../modules/knowledge/application/retrieve-knowledge.js"
import type { CostEstimate } from "./model-routing/model-pricing.js"
import type { PromptComponentUsage } from "./prompting/prompt-components.js"

/**
 * Telemetria de chamadas ao modelo de IA — cross-cutting, por AsyncLocalStorage, pra não
 * precisar enfiar um "observer" como parâmetro em runAgent → generateAgentReplyWithUsage e em
 * runOrchestratedReply → runSpecialistTool → generateWithTools (cinco assinaturas só pra
 * contar tokens). Fora de um `runWithLlmTelemetry` não existe store: cada hook abaixo vira
 * no-op e a produção segue exatamente como sempre.
 *
 * Quem abre um store hoje é só o QA Lab, que precisa de três coisas que a produção não usa:
 * contabilizar tokens/duração por chamada (Gemini devolve `usageMetadata` em toda resposta de
 * generateContent), aplicar a política "Parar antes da IA" e o orçamento "Máximo de chamadas".
 * As duas últimas viram `AiCallBlockedError` ANTES da request sair — nenhum token é consumido.
 */
export type LlmCallRole = "agent" | "orchestrator_routing" | "orchestrator_synthesis" | "specialist" | "agent_synthesis" | "intervention_writer" | "report_analyst" | "knowledge_clarification"

/**
 * FASE da request dentro de uma execução com investigação (investigation-runtime.ts):
 * PREFLIGHT nunca chama o modelo (só aparece nas Tools), PLANNING = rodada de escolha de Tools,
 * SEMANTIC_ANALYSIS = leitura de transcrições (analyze_*), KNOWLEDGE = consulta à base com IA
 * (hoje nenhuma — o retrieval é lexical), SYNTHESIS = resposta final. Ausente = request de antes
 * desta telemetria ou fora de uma investigação (chat simples, orquestrador).
 */
export type LlmPhase = "PREFLIGHT" | "PLANNING" | "SEMANTIC_ANALYSIS" | "KNOWLEDGE" | "SYNTHESIS"
export const LLM_PHASES: LlmPhase[] = ["PREFLIGHT", "PLANNING", "SEMANTIC_ANALYSIS", "KNOWLEDGE", "SYNTHESIS"]

/** Composição ESTIMADA do prompt em caracteres (o número oficial de tokens vem do provider):
 * o que é estático (prompt do sistema/Agent/política), schemas de Tools declaradas, entrada
 * dinâmica. Serve pra responder "de onde vêm os tokens", nunca pra cobrar. */
export type LlmPromptBreakdown = { systemPromptChars: number; toolSchemaChars: number; inputChars: number; declaredTools: number; /** UUIDs presentes no prompt (system + entrada) — prova do Zero-ID Model Context (V1.2). */ technicalIds?: number }

/** Tamanho lógico (caracteres) por categoria do que compôs o prompt — contagens, nunca o texto duplicado (V1.2). */
export type LlmContextBreakdown = {
  staticPromptChars: number
  /** Componentes dinâmicos do prompt (sujeito, KB recuperada, materiais) movidos para o turno do usuário (V1.3, perfil COMPACT). */
  dynamicPromptChars?: number
  toolSchemaChars: number
  evidenceLedgerChars: number
  interactionContentChars: number
  knowledgeContentChars: number
  structuredSchemaChars: number
  objectiveChars: number
}

/** Decisão de roteamento de modelo registrada na request (V1.2 — model-routing/). */
export type LlmRouteRecord = { provider: string; tier: "BASIC" | "STANDARD" | "DEEP"; reason: string; mode: "CURRENT" | "EFFICIENCY"; escalated: boolean; fallback: boolean }

/** CLASSIFICAÇÃO da request (V1.3 — §44): toda request via gateway diz de onde vem e para quê — nunca ids pessoais. */
export type LlmRequestSource = "AGENT" | "SPECIALIST" | "ORCHESTRATOR" | "INVESTIGATION_TOOL" | "WORKFLOW_POST_JOIN" | "WORKFLOW_ORCHESTRATOR" | "CHAT" | "VOICE" | "FEEDBACK_WRITER" | "INTERVENTION" | "REPORT"
export type LlmSemanticType = "INVESTIGATION" | "FEEDBACK" | "PROCESS_AUDIT" | "INDICATOR_SUMMARY" | "TEXT" | "SEMANTIC_ANALYSIS" | "MANAGERIAL_SUMMARY" | "STRUCTURED_RESULT" | "ROUTING" | "INTERVENTION_REPORT" | "RECURRING_REPORT" | "KNOWLEDGE_CLARIFICATION"
export type LlmRequestClassification = { phase: LlmPhase; purpose: string; source: LlmRequestSource; semanticType: LlmSemanticType; tags?: string[] }

/** Cache de prompt observado na request (V1.3 — §27): modo, versão da chave (hash, nunca conteúdo) e tokens servidos do cache. */
export type LlmCacheRecord = { mode: "NONE" | "IMPLICIT" | "EXPLICIT"; cacheKeyVersion: string | null; cachedTokens: number | null; hitRate: number | null }

export type LlmCallRecord = {
  sequence: number
  role: LlmCallRole
  /** Agent/especialista por trás da chamada — null pras fases do próprio orquestrador. */
  agentId: string | null
  model: string
  promptTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** Tokens de entrada servidos do cache do provider (Gemini `cachedContentTokenCount`) — null = não informado. */
  cachedInputTokens?: number | null
  /** Tokens de raciocínio (Gemini `thoughtsTokenCount`) — null = não informado. */
  reasoningTokens?: number | null
  phase?: LlmPhase
  /** Tools solicitadas pelo modelo NESTA request (uma rodada de planejamento pode pedir várias). */
  toolCalls?: string[]
  promptBreakdown?: LlmPromptBreakdown
  contextBreakdown?: LlmContextBreakdown
  route?: LlmRouteRecord
  /** V1.3 — anexados pelo gateway (ausentes em requests fora dele ou registradas antes). */
  classification?: LlmRequestClassification
  promptComponents?: PromptComponentUsage[]
  cache?: LlmCacheRecord
  cost?: CostEstimate
  /** Rota resolvida pela policy da organização (AI Providers V1 — §30): Use Case, conexão, modelo, motivo, fallback. Ausente = caminho legado. */
  aiRoute?: { requestedUseCase: string; routingMode: string; providerKey: string; connectionName: string | null; modelName: string; routeReason: string; fallbackAttempt: number; fallbackReason: string | null; correlationId: string }
  durationMs: number
  startedAt: string
  /** Prompt final e entrada enviados ao modelo — só expostos em ambiente administrativo
   * (QA Lab); nunca contém chave/segredo (a API key vai no header, não no corpo). */
  systemPrompt: string
  input: string
  outputText: string | null
  /** Bases autorizadas × trechos efetivamente recuperados para ESTA chamada (ver
   * retrieve-knowledge.ts) — ausente nas chamadas sem Agent por trás (ex.: síntese do
   * orquestrador) ou registradas antes desta telemetria existir. */
  knowledge?: KnowledgeTrace
}

export type LlmUsage = { promptTokens: number | null; outputTokens: number | null; totalTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null }

export type LlmAiPolicy = "REAL" | "STOP_BEFORE_AI"

export type LlmTelemetryStore = {
  policy: LlmAiPolicy
  maxCalls: number | null
  calls: LlmCallRecord[]
  scope: LlmScope
  /** Todo retrieval de KB feito na sessão, mesmo quando a request de IA seguinte foi bloqueada
   * ("Parar antes da IA"/orçamento) — o QA Lab mostra o que TERIA entrado no prompt sem gastar
   * token nenhum. Compartilhado entre escopos (mesma referência), como `calls`. */
  knowledge: KnowledgeRetrievalRecord[]
}

export type KnowledgeRetrievalRecord = KnowledgeTrace & { agentId: string | null; role: LlmCallRole }

export type LlmScope = { role: LlmCallRole; agentId: string | null; knowledge?: KnowledgeTrace; phase?: LlmPhase; contextBreakdown?: LlmContextBreakdown; classification?: LlmRequestClassification; promptComponents?: PromptComponentUsage[] }

export class AiCallBlockedError extends DomainError {
  constructor(public readonly reason: "STOP_BEFORE_AI" | "BUDGET_REACHED", maxCalls: number | null) {
    super(
      // "request de IA", nunca "chamada": no QA Lab "chamada" é a ligação da operação (Parte 4).
      reason === "STOP_BEFORE_AI"
        ? "Execução pausada antes da request de IA (política \"Parar antes da IA\")."
        : `Limite de requests de IA atingido antes da próxima etapa (utilizado: ${maxCalls ?? 0} / ${maxCalls ?? 0}).`,
      reason === "STOP_BEFORE_AI" ? "QA_AI_CALL_BLOCKED" : "QA_AI_BUDGET_REACHED",
      409,
    )
  }
}

const storage = new AsyncLocalStorage<LlmTelemetryStore>()

export function createLlmTelemetryStore(options: { policy: LlmAiPolicy; maxCalls?: number | null }): LlmTelemetryStore {
  return { policy: options.policy, maxCalls: options.maxCalls ?? null, calls: [], knowledge: [], scope: { role: "agent", agentId: null } }
}

export function runWithLlmTelemetry<T>(store: LlmTelemetryStore, fn: () => Promise<T>): Promise<T> {
  return storage.run(store, fn)
}

/** Etiqueta as chamadas feitas dentro de `fn` (papel + agente) — o cliente Gemini não sabe se
 * está servindo um Agent, um especialista ou a síntese do orquestrador; quem sabe é quem chama. */
export async function withLlmScope<T>(scope: LlmScope, fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore()
  if (!store) return fn()
  return storage.run({ ...store, scope, calls: store.calls, knowledge: store.knowledge }, fn)
}

/** Etiqueta a FASE das requests feitas dentro de `fn`, preservando papel/agente do escopo corrente. */
export async function withLlmPhase<T>(phase: LlmPhase, fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore()
  if (!store) return fn()
  return storage.run({ ...store, scope: { ...store.scope, phase }, calls: store.calls, knowledge: store.knowledge }, fn)
}

/** Etiqueta as requests feitas dentro de `fn` com o breakdown de contexto conhecido por quem monta o prompt. */
export async function withLlmContext<T>(contextBreakdown: LlmContextBreakdown, fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore()
  if (!store) return fn()
  return storage.run({ ...store, scope: { ...store.scope, contextBreakdown }, calls: store.calls, knowledge: store.knowledge }, fn)
}

/** Etiqueta as requests feitas dentro de `fn` com a classificação e os componentes de prompt (gateway V1.3). */
export async function withLlmRequestMeta<T>(meta: { classification?: LlmRequestClassification; promptComponents?: PromptComponentUsage[]; contextBreakdown?: LlmContextBreakdown }, fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore()
  if (!store) return fn()
  const scope: LlmScope = { ...store.scope, ...(meta.classification ? { classification: meta.classification, phase: meta.classification.phase } : {}), ...(meta.promptComponents ? { promptComponents: meta.promptComponents } : {}), ...(meta.contextBreakdown ? { contextBreakdown: meta.contextBreakdown } : {}) }
  return storage.run({ ...store, scope, calls: store.calls, knowledge: store.knowledge }, fn)
}

/** Completa a ÚLTIMA request registrada com o que só se sabe depois da resposta (cache observado, custo estimado). */
export function annotateLastLlmCall(extra: { cache?: LlmCacheRecord; cost?: CostEstimate; aiRoute?: LlmCallRecord["aiRoute"] }): void {
  const store = storage.getStore()
  const last = store?.calls[store.calls.length - 1]
  if (!last) return
  if (extra.cache) last.cache = extra.cache
  if (extra.cost) last.cost = extra.cost
  if (extra.aiRoute) last.aiRoute = extra.aiRoute
}

/** true dentro de uma execução do QA Lab (store aberto) — só para etiquetar a ORIGEM do evento de uso. */
export function hasLlmTelemetryStore(): boolean {
  return storage.getStore() !== undefined
}

/** Anexa ao escopo corrente o rastro de retrieval de KB do prompt que está sendo montado — as
 * chamadas registradas em seguida (dentro do mesmo `withLlmScope`) carregam esse rastro. Sem
 * store (produção): no-op. */
export function attachKnowledgeTrace(knowledge: KnowledgeTrace): void {
  const store = storage.getStore()
  if (!store) return
  store.scope = { ...store.scope, knowledge }
  store.knowledge.push({ ...knowledge, agentId: store.scope.agentId, role: store.scope.role })
}

/** Chamado pelos clientes Gemini imediatamente antes da request — decide se a chamada pode
 * acontecer. Sem store (produção): sempre pode. */
export function beforeLlmCall(): void {
  const store = storage.getStore()
  if (!store) return
  if (store.policy === "STOP_BEFORE_AI") throw new AiCallBlockedError("STOP_BEFORE_AI", store.maxCalls)
  if (store.maxCalls !== null && store.calls.length >= store.maxCalls) throw new AiCallBlockedError("BUDGET_REACHED", store.maxCalls)
}

export function recordLlmCall(record: Omit<LlmCallRecord, "sequence" | "role" | "agentId" | "startedAt" | "knowledge" | "phase" | "contextBreakdown" | "classification" | "promptComponents"> & { startedAt: Date }): void {
  const store = storage.getStore()
  if (!store) return
  store.calls.push({
    ...record,
    sequence: store.calls.length + 1,
    role: store.scope.role,
    agentId: store.scope.agentId,
    ...(store.scope.phase ? { phase: store.scope.phase } : {}),
    ...(store.scope.contextBreakdown ? { contextBreakdown: store.scope.contextBreakdown } : {}),
    ...(store.scope.classification ? { classification: store.scope.classification } : {}),
    ...(store.scope.promptComponents ? { promptComponents: store.scope.promptComponents } : {}),
    ...(store.scope.knowledge ? { knowledge: store.scope.knowledge } : {}),
    startedAt: record.startedAt.toISOString(),
  })
}

/** Lê `usageMetadata` de uma resposta generateContent — null em cada campo ausente (nunca
 * inventa 0 quando a API não informou). */
export function usageFromGeminiPayload(payload: unknown): LlmUsage {
  const usage = (payload as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number } })?.usageMetadata
  return {
    promptTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : null,
    outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    totalTokens: typeof usage?.totalTokenCount === "number" ? usage.totalTokenCount : null,
    cachedInputTokens: typeof usage?.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : null,
    reasoningTokens: typeof usage?.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : null,
  }
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** UUIDs num texto enviado ao modelo — contagem, nunca o texto. */
export function countTechnicalIdsInPrompt(...texts: string[]): number {
  return texts.reduce((sum, text) => sum + (text.match(UUID_PATTERN)?.length ?? 0), 0)
}

export const EMPTY_USAGE: LlmUsage = { promptTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null }

/** Soma de usos — campos "não informados" (null) só viram número quando ALGUMA request informou. */
export function addUsage(acc: LlmUsage, usage: LlmUsage): LlmUsage {
  const sum = (left: number | null, right: number | null) => (left === null && right === null ? null : (left ?? 0) + (right ?? 0))
  return {
    promptTokens: sum(acc.promptTokens, usage.promptTokens),
    outputTokens: sum(acc.outputTokens, usage.outputTokens),
    totalTokens: sum(acc.totalTokens, usage.totalTokens),
    cachedInputTokens: sum(acc.cachedInputTokens, usage.cachedInputTokens),
    reasoningTokens: sum(acc.reasoningTokens, usage.reasoningTokens),
  }
}

export function summarizeLlmCalls(calls: LlmCallRecord[]): { aiCalls: number; inputTokens: number; outputTokens: number; totalTokens: number } {
  return calls.reduce(
    (acc, call) => ({
      aiCalls: acc.aiCalls + 1,
      inputTokens: acc.inputTokens + (call.promptTokens ?? 0),
      outputTokens: acc.outputTokens + (call.outputTokens ?? 0),
      totalTokens: acc.totalTokens + (call.totalTokens ?? 0),
    }),
    { aiCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  )
}
