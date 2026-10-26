import { AsyncLocalStorage } from "node:async_hooks"
import { env } from "../../../config/env.js"
import { DomainError } from "../../domain/domain-error.js"
import { hasLlmTelemetryStore } from "../llm-telemetry.js"
import { AiCallCancelledError, AiProviderError } from "./ai-errors.js"
import { currentAiAbortSignal, currentAiCallOrigin, currentAiWorkflowCorrelation } from "./ai-runtime.js"
import type { AiUseCaseKey } from "./ai-use-cases.js"

/**
 * LIMITADOR DE CHAMADAS DE IA (capacidade) — o MESMO caminho de sempre (`llm-gateway.ts`), com uma fila na frente do provedor.
 * Antes dele cada chamada saía direto: um lote de monitorias podia ocupar a cota do provedor e o 429 derrubava o chat na hora.
 *
 *  - PRIORIDADE derivada do contexto da chamada (nunca do modelo): INTERATIVA = alguém esperando na tela (chat, voz, request
 *    de uma pessoa, QA Lab); LOTE = execução de Workflow e trabalho de fundo. `classifyAiCall` é a regra única.
 *  - VAGAS por processo: `maxConcurrent` no total, das quais `reservedInteractive` o lote nunca ocupa; interativa passa à frente
 *    na fila. Uma chamada aninhada (dentro de outra já limitada) usa a vaga da de fora — nunca trava esperando por si mesma.
 *  - 429 / 503 do provedor: LOTE espera com backoff exponencial + jitter (respeitando o Retry-After, até um teto) e tenta de novo
 *    até `batchMaxRetries`; o 429 também PAUSA o início de novas chamadas de lote pelo tempo pedido, para sobrar cota ao chat.
 *    INTERATIVA tenta no máximo UMA vez a mais, rápido, e falha com erro claro. O FALLBACK_CHAIN da policy continua por dentro
 *    (troca de modelo na hora); o limitador só repete quando a rota inteira devolveu 429/503.
 *  - Telemetria: espera na fila e motivo vão para o evento de uso de cada tentativa (`ai_usage_events`, via contexto
 *    assíncrono — sem prompt/resposta) e para o log estruturado (`ai_call_queued`, `ai_call_retry`).
 *
 * O limitador é POR PROCESSO (fila, prioridade e vagas locais — `INIA_AI_MAX_CONCURRENT_CALLS` de cada instância). Com API e
 * processamento separados (`INIA_PROCESS_ROLE`), o processamento só tem lote — o teto de lote dele
 * (`maxConcurrent − reservedInteractive`) é o quanto da cota o lote consegue ocupar; o chat roda na API.
 *
 * O que vale para TODAS as instâncias fica por CONEXÃO de IA, no ponto em que a conexão é conhecida (provider-call-gate.ts):
 * vagas simultâneas da conexão (configuradas na tela de Provedores de IA) e a pausa depois de um 429 daquela conexão.
 */
export const AI_CALL_PRIORITIES = ["INTERACTIVE", "BATCH"] as const
export type AiCallPriority = (typeof AI_CALL_PRIORITIES)[number]
export type AiCallPriorityReason = "INTERACTIVE_USE_CASE" | "QA_LAB" | "USER_REQUEST" | "WORKFLOW_EXECUTION" | "BACKGROUND"
/** NONE = saiu sem esperar · CAPACITY = esperou vaga · PROVIDER_COOLDOWN = lote pausado depois de um 429 · RETRY_BACKOFF = espera antes de repetir. */
export const AI_CALL_QUEUE_REASONS = ["NONE", "CAPACITY", "PROVIDER_COOLDOWN", "RETRY_BACKOFF"] as const
export type AiCallQueueReason = (typeof AI_CALL_QUEUE_REASONS)[number]

/** O que o evento de uso de cada tentativa carrega sobre a fila (ai_usage_events — migration 121). */
export type AiCallLimiterRecord = {
  priority: AiCallPriority
  priorityReason: AiCallPriorityReason
  /** 1 = primeira tentativa desta chamada; 2+ = repetida pelo limitador depois de 429/503 (o fallback da policy é outro contador). */
  attempt: number
  queueWaitMs: number
  queueReason: AiCallQueueReason
}

export type AiCallLimiterConfig = {
  enabled: boolean
  /** Chamadas ao provedor em andamento ao mesmo tempo neste processo (interativas + lote). */
  maxConcurrent: number
  /** Vagas que só chamadas interativas usam — o lote nunca passa de `maxConcurrent − reservedInteractive`. */
  reservedInteractive: number
  /** Quanto uma chamada interativa espera por vaga antes de desistir com erro claro (o lote espera o quanto precisar). */
  interactiveQueueTimeoutMs: number
  /** Espera antes da 1ª nova tentativa interativa (sem Retry-After; dobra a cada nova) e o teto de cada espera (com Retry-After
   * maior, espera só o teto). */
  interactiveRetryDelayMs: number
  interactiveMaxRetryWaitMs: number
  /** O CHAT TEM PRIORIDADE: novas tentativas da interativa depois de 429 (503 = uma só), dentro de `interactiveRetryBudgetMs`
   * de espera somada; e quanto o 429 dela pausa os lotes deste processo (o portão compartilhado pausa os das outras instâncias). */
  interactiveRateLimitRetries: number
  interactiveRetryBudgetMs: number
  interactiveBatchPauseMs: number
  /** Novas tentativas do lote depois de 429/503 (total = 1 + isto). */
  batchMaxRetries: number
  /** Backoff exponencial do lote: base × 2^(tentativa−1), com jitter, nunca acima do teto — o Retry-After também respeita o teto. */
  batchBackoffBaseMs: number
  batchBackoffMaxMs: number
}

/**
 * Padrões (escolhidos para não mudar quem não configurar nada, só impedir o estouro): 16 chamadas por processo, 4 reservadas ao
 * chat (lote até 12 — o worker roda 8 matrículas e cada nó dispara no máximo ~4 chamadas paralelas); interativa desiste depois
 * de 20 s na fila; lote repete até 5 vezes com backoff de 2 s → 60 s (no pior caso ~2 min de espera antes de a falha voltar
 * para a política de retentativa do nó do Workflow, que tenta de novo em 5 min). Chat em 429 (decisão do usuário, 21/10: "a
 * prioridade é sempre do CHAT"): pausa os lotes por 15 s e tenta até mais 4 vezes (0,75 → 1,5 → 3 → 6 s), no máximo 15 s de espera.
 */
export const DEFAULT_AI_CALL_LIMITER_CONFIG: AiCallLimiterConfig = {
  enabled: true,
  maxConcurrent: 16,
  reservedInteractive: 4,
  interactiveQueueTimeoutMs: 20_000,
  interactiveRetryDelayMs: 750,
  interactiveMaxRetryWaitMs: 6_000,
  interactiveRateLimitRetries: 4,
  interactiveRetryBudgetMs: 15_000,
  interactiveBatchPauseMs: 15_000,
  batchMaxRetries: 5,
  batchBackoffBaseMs: 2_000,
  batchBackoffMaxMs: 60_000,
}

/** Vagas coerentes: pelo menos 2 no total e 1 reservada; o lote sempre fica com pelo menos 1. */
export function normalizeAiCallLimiterConfig(config: AiCallLimiterConfig): AiCallLimiterConfig {
  const maxConcurrent = Math.max(2, Math.floor(config.maxConcurrent))
  const reservedInteractive = Math.min(maxConcurrent - 1, Math.max(1, Math.floor(config.reservedInteractive)))
  const batchBackoffBaseMs = Math.max(1, config.batchBackoffBaseMs)
  return { ...config, maxConcurrent, reservedInteractive, batchBackoffBaseMs, batchBackoffMaxMs: Math.max(batchBackoffBaseMs, config.batchBackoffMaxMs), batchMaxRetries: Math.max(0, Math.floor(config.batchMaxRetries)) }
}

export function aiCallLimiterConfigFromEnv(source: Pick<typeof env, "INIA_AI_LIMITER" | "INIA_AI_MAX_CONCURRENT_CALLS" | "INIA_AI_RESERVED_INTERACTIVE_CALLS" | "INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS" | "INIA_AI_BATCH_MAX_RETRIES" | "INIA_AI_BATCH_BACKOFF_BASE_MS" | "INIA_AI_BATCH_BACKOFF_MAX_MS"> = env): AiCallLimiterConfig {
  return normalizeAiCallLimiterConfig({
    ...DEFAULT_AI_CALL_LIMITER_CONFIG,
    enabled: source.INIA_AI_LIMITER === "ON",
    maxConcurrent: source.INIA_AI_MAX_CONCURRENT_CALLS,
    reservedInteractive: source.INIA_AI_RESERVED_INTERACTIVE_CALLS,
    interactiveQueueTimeoutMs: source.INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS,
    batchMaxRetries: source.INIA_AI_BATCH_MAX_RETRIES,
    batchBackoffBaseMs: source.INIA_AI_BATCH_BACKOFF_BASE_MS,
    batchBackoffMaxMs: source.INIA_AI_BATCH_BACKOFF_MAX_MS,
  })
}

/** Use Cases que só existem com alguém esperando na tela — interativos em qualquer contexto. */
const INTERACTIVE_USE_CASES: ReadonlySet<AiUseCaseKey> = new Set<AiUseCaseKey>(["CHAT", "VOICE_REALTIME", "SPEECH_SYNTHESIS", "MODEL_TEST"])

/**
 * Classe da chamada — DETERMINÍSTICA, pelo Use Case + origem (contexto assíncrono já existente), nunca pelo modelo:
 *   1. Use Case interativo (chat, voz, recado falado, teste de modelo) → INTERATIVA;
 *   2. dentro de um nó de Workflow (motor: `runWithAiWorkflowCorrelation`) → LOTE — o mesmo especialista/Orquestrador que
 *      responde ao chat é lote quando roda num Workflow;
 *   3. QA Lab (telemetria do laboratório) → INTERATIVA;
 *   4. request de uma pessoa com sessão (`requireAuth`) → INTERATIVA — inclui "Testar diagnóstico" e testes no admin;
 *   5. o resto (scripts, jobs) → LOTE.
 */
export function classifyAiCall(useCase: AiUseCaseKey): { priority: AiCallPriority; reason: AiCallPriorityReason } {
  if (INTERACTIVE_USE_CASES.has(useCase)) return { priority: "INTERACTIVE", reason: "INTERACTIVE_USE_CASE" }
  if (currentAiWorkflowCorrelation()) return { priority: "BATCH", reason: "WORKFLOW_EXECUTION" }
  if (hasLlmTelemetryStore()) return { priority: "INTERACTIVE", reason: "QA_LAB" }
  if (currentAiCallOrigin() === "USER_REQUEST") return { priority: "INTERACTIVE", reason: "USER_REQUEST" }
  return { priority: "BATCH", reason: "BACKGROUND" }
}

/** O que dá para repetir: 429 e 503 (provedor sobrecarregado). Tudo o mais (credencial, pedido inválido, orçamento…) falha na hora. */
export type AiRetrySignal = {
  kind: "RATE_LIMIT" | "UNAVAILABLE"
  retryAfterMs: number | null
  /** O cliente legado do Gemini já repete o 503 uma vez por conta própria — a interativa não empilha mais uma. */
  providerAlreadyRetried: boolean
}

export function retrySignalOf(error: unknown): AiRetrySignal | null {
  if (!(error instanceof DomainError)) return null
  const details = error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : {}
  const retryAfterMs = typeof details.retryAfterMs === "number" ? details.retryAfterMs : null
  if (error instanceof AiProviderError) {
    if (error.category === "RATE_LIMIT") return { kind: "RATE_LIMIT", retryAfterMs, providerAlreadyRetried: false }
    return details.providerStatus === 503 ? { kind: "UNAVAILABLE", retryAfterMs, providerAlreadyRetried: false } : null
  }
  // Cliente legado: o gateway sanitiza para { status, category, retryAfterMs? } (sem o corpo do provider).
  const status = typeof details.status === "number" ? details.status : null
  if (details.category === "RATE_LIMIT" || status === 429) return { kind: "RATE_LIMIT", retryAfterMs, providerAlreadyRetried: false }
  return status === 503 ? { kind: "UNAVAILABLE", retryAfterMs, providerAlreadyRetried: true } : null
}

export const INTERACTIVE_RATE_LIMIT_MESSAGE = "A IA está recebendo muitas solicitações agora e não conseguiu responder. Tente de novo em alguns segundos."

/** Fila local cheia por tempo demais (nenhuma chamada saiu para o provedor). */
export class AiCapacityBusyError extends DomainError {
  constructor(waitedMs: number) {
    super("A INIA está atendendo muitas solicitações neste momento. Tente de novo em alguns segundos.", "AI_CAPACITY_BUSY", 503, { reason: "QUEUE_TIMEOUT", waitedMs })
    this.name = "AiCapacityBusyError"
  }
}

export type AiLimitedCall = {
  priority: AiCallPriority
  priorityReason: AiCallPriorityReason
  useCase: AiUseCaseKey
  /** O chamador decide a falha sozinho (`transport.retries: 0`, ex.: Feedback Writer) — o limitador só enfileira. */
  noRetry?: boolean
  /** Ainda dá para repetir? (streaming: depois do primeiro pedaço entregue, nunca — trocaria a resposta no meio). */
  canRetry?: () => boolean
  /** Quem pediu foi embora (SSE fechado): sai da fila na hora, não repete, e a vaga volta para os outros. */
  signal?: AbortSignal | undefined
}

export type AiCallLimiterStats = {
  enabled: boolean
  maxConcurrent: number
  reservedInteractive: number
  running: Record<AiCallPriority, number>
  queued: Record<AiCallPriority, number>
  batchPausedUntil: string | null
}

export type AiCallLimiter = {
  run<T>(call: AiLimitedCall, fn: () => Promise<T>): Promise<T>
  stats(): AiCallLimiterStats
  readonly config: AiCallLimiterConfig
}

export type AiCallLimiterLogEvent = Record<string, unknown> & { event: "ai_call_queued" | "ai_call_retry" | "ai_call_capacity_busy" }

export type AiCallLimiterDeps = {
  /** Jitter (0 ≤ x < 1) — determinístico nos testes. */
  random?: () => number
  log?: (event: AiCallLimiterLogEvent) => void
}

type Slot = { waitedMs: number; reason: AiCallQueueReason; release: () => void }
type Waiter = { priority: AiCallPriority; enqueuedAt: number; reason: AiCallQueueReason; resolve: (slot: Slot) => void; reject: (error: unknown) => void; timer?: ReturnType<typeof setTimeout>; detach?: () => void }

const records = new AsyncLocalStorage<AiCallLimiterRecord>()

/** Fila desta chamada (lido pelo registro de uso, junto com a correlação do Workflow). Fora do limitador = null. */
export function currentAiCallLimiterRecord(): AiCallLimiterRecord | null {
  return records.getStore() ?? null
}

const QUEUE_LOG_THRESHOLD_MS = 250

function defaultLog(event: AiCallLimiterLogEvent): void {
  const line = JSON.stringify(event)
  if (event.event === "ai_call_queued") console.info(line)
  else console.warn(line)
}

export function createAiCallLimiter(rawConfig: AiCallLimiterConfig = DEFAULT_AI_CALL_LIMITER_CONFIG, deps: AiCallLimiterDeps = {}): AiCallLimiter {
  const config = normalizeAiCallLimiterConfig(rawConfig)
  const random = deps.random ?? Math.random
  const log = deps.log ?? defaultLog
  const batchCap = config.maxConcurrent - config.reservedInteractive
  const running: Record<AiCallPriority, number> = { INTERACTIVE: 0, BATCH: 0 }
  const queues: Record<AiCallPriority, Waiter[]> = { INTERACTIVE: [], BATCH: [] }
  let batchPausedUntil = 0
  let pauseTimer: ReturnType<typeof setTimeout> | null = null

  const total = () => running.INTERACTIVE + running.BATCH
  const canStart = (priority: AiCallPriority, now: number) => total() < config.maxConcurrent && (priority === "INTERACTIVE" || (running.BATCH < batchCap && now >= batchPausedUntil))

  const releaser = (priority: AiCallPriority) => {
    let released = false
    return () => {
      if (released) return
      released = true
      running[priority]--
      dispatch()
    }
  }

  function grant(waiter: Waiter, now: number): void {
    running[waiter.priority]++
    if (waiter.timer) clearTimeout(waiter.timer)
    waiter.detach?.()
    waiter.resolve({ waitedMs: now - waiter.enqueuedAt, reason: waiter.reason, release: releaser(waiter.priority) })
  }

  // Interativas primeiro; o lote só entra se sobrar vaga fora da reserva e não estiver pausado por um 429.
  function dispatch(): void {
    const now = Date.now()
    while (queues.INTERACTIVE.length > 0 && canStart("INTERACTIVE", now)) grant(queues.INTERACTIVE.shift()!, now)
    while (queues.BATCH.length > 0 && canStart("BATCH", now)) grant(queues.BATCH.shift()!, now)
    if (queues.BATCH.length > 0 && now < batchPausedUntil && !pauseTimer) {
      pauseTimer = setTimeout(() => {
        pauseTimer = null
        dispatch()
      }, batchPausedUntil - now)
      pauseTimer.unref?.()
    }
  }

  function acquire(priority: AiCallPriority, timeoutMs: number | null, useCase: AiUseCaseKey, signal: AbortSignal | undefined): Promise<Slot> {
    return new Promise<Slot>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AiCallCancelledError())
        return
      }
      const now = Date.now()
      if (queues[priority].length === 0 && canStart(priority, now)) {
        running[priority]++
        resolve({ waitedMs: 0, reason: "NONE", release: releaser(priority) })
        return
      }
      const waiter: Waiter = { priority, enqueuedAt: now, reason: priority === "BATCH" && now < batchPausedUntil ? "PROVIDER_COOLDOWN" : "CAPACITY", resolve, reject }
      if (timeoutMs !== null) {
        waiter.timer = setTimeout(() => {
          const queue = queues[priority]
          const index = queue.indexOf(waiter)
          if (index < 0) return
          queue.splice(index, 1)
          waiter.detach?.()
          const waitedMs = Date.now() - waiter.enqueuedAt
          log({ event: "ai_call_capacity_busy", useCase, priority, waitedMs, running: { ...running }, queued: { INTERACTIVE: queues.INTERACTIVE.length, BATCH: queues.BATCH.length } })
          reject(new AiCapacityBusyError(waitedMs))
        }, timeoutMs)
        waiter.timer.unref?.()
      }
      if (signal) {
        // Cancelada na fila: sai sem ter ocupado vaga nenhuma.
        const onAbort = () => {
          const queue = queues[priority]
          const index = queue.indexOf(waiter)
          if (index < 0) return
          queue.splice(index, 1)
          if (waiter.timer) clearTimeout(waiter.timer)
          reject(new AiCallCancelledError())
        }
        signal.addEventListener("abort", onAbort, { once: true })
        waiter.detach = () => signal.removeEventListener("abort", onAbort)
      }
      queues[priority].push(waiter)
      dispatch()
    })
  }

  /** Espera antes de repetir — interrompida se quem pediu for embora. */
  function backoff(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AiCallCancelledError())
        return
      }
      const onAbort = () => {
        clearTimeout(timer)
        reject(new AiCallCancelledError())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, ms)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  function pauseBatch(ms: number): void {
    if (ms <= 0) return
    batchPausedUntil = Math.max(batchPausedUntil, Date.now() + ms)
  }

  type Decision = { retry: true; waitMs: number; pauseBatchMs: number; signal: AiRetrySignal } | { retry: false; error: unknown }

  function decide(call: AiLimitedCall, attempt: number, error: unknown, waitedMs: number): Decision {
    const signal = retrySignalOf(error)
    if (!signal || call.noRetry || call.signal?.aborted) return { retry: false, error }
    const canRetry = call.canRetry ? call.canRetry() : true
    if (call.priority === "INTERACTIVE") {
      const rateLimited = signal.kind === "RATE_LIMIT"
      // O chat tem prioridade: em 429, os lotes param (aqui e, pelo portão, nas outras instâncias) enquanto ele tenta de novo.
      const pauseBatchMs = rateLimited ? config.interactiveBatchPauseMs : 0
      const retries = rateLimited ? config.interactiveRateLimitRetries : 1
      const giveUp = (): Decision => ({ retry: false, error: rateLimited ? new AiProviderError("RATE_LIMIT", { message: INTERACTIVE_RATE_LIMIT_MESSAGE, httpStatus: 429, retryAfterMs: signal.retryAfterMs }) : error })
      if (!canRetry || attempt > retries || (signal.kind === "UNAVAILABLE" && signal.providerAlreadyRetried)) return giveUp()
      const grown = config.interactiveRetryDelayMs * 2 ** (attempt - 1)
      const base = Math.min(Math.max(signal.retryAfterMs ?? 0, grown), config.interactiveMaxRetryWaitMs)
      const waitMs = Math.round(Math.min(config.interactiveMaxRetryWaitMs, base + random() * base * 0.25))
      if (waitedMs + waitMs > config.interactiveRetryBudgetMs) return giveUp()
      return { retry: true, waitMs, pauseBatchMs, signal }
    }
    if (!canRetry || attempt > config.batchMaxRetries) return { retry: false, error }
    const backoff = Math.min(config.batchBackoffMaxMs, config.batchBackoffBaseMs * 2 ** (attempt - 1))
    const jittered = backoff / 2 + random() * (backoff / 2)
    // Retry-After é o MÍNIMO (com um jitter pequeno para N chamadas não voltarem no mesmo milissegundo), dentro do teto.
    const hinted = signal.retryAfterMs !== null ? signal.retryAfterMs + random() * Math.min(1_000, signal.retryAfterMs * 0.2) : 0
    const waitMs = Math.round(Math.min(config.batchBackoffMaxMs, Math.max(jittered, hinted)))
    // Pausa do lote = o que o provider pediu (Retry-After, dentro do teto); sem dica, a própria espera desta chamada.
    const pauseBatchMs = signal.retryAfterMs !== null ? Math.min(config.batchBackoffMaxMs, signal.retryAfterMs) : waitMs
    return { retry: true, waitMs, pauseBatchMs, signal }
  }

  return {
    config,
    async run<T>(call: AiLimitedCall, fn: () => Promise<T>): Promise<T> {
      // Aninhada (dentro de outra chamada já limitada): usa a vaga de fora — nunca espera por uma vaga que ela mesma segura.
      if (records.getStore()) return fn()
      if (!config.enabled) return records.run({ priority: call.priority, priorityReason: call.priorityReason, attempt: 1, queueWaitMs: 0, queueReason: "NONE" }, fn)
      let attempt = 1
      let backoffWaitMs = 0
      let totalBackoffMs = 0
      for (;;) {
        const slot = await acquire(call.priority, call.priority === "INTERACTIVE" ? config.interactiveQueueTimeoutMs : null, call.useCase, call.signal)
        const record: AiCallLimiterRecord = { priority: call.priority, priorityReason: call.priorityReason, attempt, queueWaitMs: backoffWaitMs + slot.waitedMs, queueReason: attempt > 1 ? "RETRY_BACKOFF" : slot.reason }
        if (slot.waitedMs >= QUEUE_LOG_THRESHOLD_MS) log({ event: "ai_call_queued", useCase: call.useCase, priority: call.priority, priorityReason: call.priorityReason, attempt, waitedMs: slot.waitedMs, reason: slot.reason })
        let decision: Decision
        try {
          return await records.run(record, fn)
        } catch (error) {
          decision = decide(call, attempt, error, totalBackoffMs)
          // 429 do chat pausa os lotes mesmo quando ele desiste (a próxima pergunta encontra a cota mais livre).
          if (!decision.retry && call.priority === "INTERACTIVE" && retrySignalOf(error)?.kind === "RATE_LIMIT") pauseBatch(config.interactiveBatchPauseMs)
        } finally {
          slot.release()
        }
        if (!decision.retry) throw decision.error
        pauseBatch(decision.pauseBatchMs)
        log({ event: "ai_call_retry", useCase: call.useCase, priority: call.priority, attempt, kind: decision.signal.kind, retryAfterMs: decision.signal.retryAfterMs, waitMs: decision.waitMs, batchPausedMs: decision.pauseBatchMs })
        await backoff(decision.waitMs, call.signal)
        backoffWaitMs = decision.waitMs
        totalBackoffMs += decision.waitMs
        attempt++
      }
    },
    stats() {
      return {
        enabled: config.enabled,
        maxConcurrent: config.maxConcurrent,
        reservedInteractive: config.reservedInteractive,
        running: { ...running },
        queued: { INTERACTIVE: queues.INTERACTIVE.length, BATCH: queues.BATCH.length },
        batchPausedUntil: batchPausedUntil > Date.now() ? new Date(batchPausedUntil).toISOString() : null,
      }
    },
  }
}

let processLimiter: AiCallLimiter | null = null

/** O limitador do processo (criado do ambiente no primeiro uso). */
export function aiCallLimiter(): AiCallLimiter {
  processLimiter ??= createAiCallLimiter(aiCallLimiterConfigFromEnv())
  return processLimiter
}

/** Testes e a demonstração trocam o limitador do processo (null = volta ao do ambiente). */
export function setAiCallLimiter(next: AiCallLimiter | null): void {
  processLimiter = next
}

/** Atalho do gateway: classifica pelo contexto e passa pelo limitador do processo. */
export function runLimitedAiCall<T>(useCase: AiUseCaseKey, options: Pick<AiLimitedCall, "noRetry" | "canRetry">, fn: () => Promise<T>): Promise<T> {
  const { priority, reason } = classifyAiCall(useCase)
  return aiCallLimiter().run({ priority, priorityReason: reason, useCase, ...options, signal: currentAiAbortSignal() ?? undefined }, fn)
}
