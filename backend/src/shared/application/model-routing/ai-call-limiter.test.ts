import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DomainError } from "../../domain/domain-error.js"
import { createLlmTelemetryStore, runWithLlmTelemetry } from "../llm-telemetry.js"
import { AiProviderError, retryAfterMsFrom } from "./ai-errors.js"
import { AiCapacityBusyError, classifyAiCall, createAiCallLimiter, currentAiCallLimiterRecord, DEFAULT_AI_CALL_LIMITER_CONFIG, INTERACTIVE_RATE_LIMIT_MESSAGE, retrySignalOf, type AiCallLimiter, type AiCallLimiterConfig, type AiCallLimiterLogEvent, type AiCallLimiterRecord, type AiCallPriority } from "./ai-call-limiter.js"
import { runWithAiOrganization, runWithAiWorkflowCorrelation } from "./ai-runtime.js"

/**
 * LIMITADOR DE CHAMADAS DE IA — regras de capacidade sem provider nenhum (relógio falso): prioridade derivada do contexto,
 * vagas reservadas ao chat, fila com interativa à frente, backoff do lote com Retry-After, limite de tentativas, uma única
 * nova tentativa rápida da interativa com erro claro, e o que NÃO se repete (credencial, orçamento, `retries: 0`, stream já
 * entregue).
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const WORKFLOW = { workflowId: "w", workflowVersionId: "v", enrollmentId: "e", rootEnrollmentId: "e", nodeId: "n" }

function deferred<T = string>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const rateLimited = (retryAfterMs: number | null = null) => new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs })
const overloaded = () => new AiProviderError("PROVIDER_ERROR", { httpStatus: 503 })
/** Erro do cliente legado do Gemini depois de sanitizado pelo gateway. */
const legacyError = (status: number, retryAfterMs?: number) => new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status, category: status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR", ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) })

function limiterWith(overrides: Partial<AiCallLimiterConfig> = {}, random = () => 0.5) {
  const logs: AiCallLimiterLogEvent[] = []
  const limiter = createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, ...overrides }, { random, log: (event) => logs.push(event) })
  return { limiter, logs }
}

const call = (priority: AiCallPriority, extra: Partial<Parameters<AiCallLimiter["run"]>[0]> = {}) => ({ priority, priorityReason: priority === "INTERACTIVE" ? ("USER_REQUEST" as const) : ("WORKFLOW_EXECUTION" as const), useCase: priority === "INTERACTIVE" ? ("CHAT" as const) : ("SPECIALIST_RESPONSE" as const), ...extra })

/** Dispara `fn` pelo limitador e marca quando ela COMEÇOU (= ganhou vaga). */
function track(limiter: AiCallLimiter, priority: AiCallPriority, fn: () => Promise<string>, extra: Partial<Parameters<AiCallLimiter["run"]>[0]> = {}) {
  const state = { started: false, record: null as AiCallLimiterRecord | null, settled: false, value: null as string | null, error: null as unknown }
  const promise = limiter
    .run(call(priority, extra), async () => {
      state.started = true
      state.record = currentAiCallLimiterRecord()
      return fn()
    })
    .then(
      (value) => {
        state.settled = true
        state.value = value
        return value
      },
      (error: unknown) => {
        state.settled = true
        state.error = error
        return null
      },
    )
  return { state, promise }
}

describe("classe da chamada — derivada do Use Case + origem, nunca do modelo", () => {
  it("chat/voz/recado são interativos em qualquer contexto; Workflow = lote; request de pessoa e QA Lab = interativa; resto = lote", async () => {
    expect(classifyAiCall("CHAT")).toEqual({ priority: "INTERACTIVE", reason: "INTERACTIVE_USE_CASE" })
    expect(runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => classifyAiCall("VOICE_REALTIME"))).toEqual({ priority: "INTERACTIVE", reason: "INTERACTIVE_USE_CASE" })
    // O MESMO especialista: lote dentro de um nó de Workflow, interativo atendendo o chat.
    expect(runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => classifyAiCall("SPECIALIST_RESPONSE"))).toEqual({ priority: "BATCH", reason: "WORKFLOW_EXECUTION" })
    expect(runWithAiOrganization(ORG, () => classifyAiCall("SPECIALIST_RESPONSE"), { origin: "USER_REQUEST" })).toEqual({ priority: "INTERACTIVE", reason: "USER_REQUEST" })
    expect(runWithAiOrganization(ORG, () => classifyAiCall("FEEDBACK_ANALYSIS"))).toEqual({ priority: "BATCH", reason: "BACKGROUND" })
    expect(classifyAiCall("FEEDBACK_ANALYSIS")).toEqual({ priority: "BATCH", reason: "BACKGROUND" })
    expect(await runWithLlmTelemetry(createLlmTelemetryStore({ policy: "REAL" }), async () => classifyAiCall("AGENT_RESPONSE"))).toEqual({ priority: "INTERACTIVE", reason: "QA_LAB" })
  })
})

describe("dica de espera do provider (Retry-After / RetryInfo)", () => {
  it("lê retry-after-ms, Retry-After em segundos ou data HTTP, e o retryDelay do corpo do 429 do Google", () => {
    expect(retryAfterMsFrom(new Headers({ "retry-after-ms": "1500" }))).toBe(1500)
    expect(retryAfterMsFrom(new Headers({ "retry-after": "7" }))).toBe(7000)
    const now = Date.parse("2026-10-08T12:00:00Z")
    expect(retryAfterMsFrom(new Headers({ "retry-after": "Thu, 08 Oct 2026 12:00:30 GMT" }), "", now)).toBe(30_000)
    expect(retryAfterMsFrom(null, '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"31s"}]}}')).toBe(31_000)
    expect(retryAfterMsFrom(new Headers(), "sem dica")).toBeNull()
  })

  it("o que se repete: 429 sempre; 503 também (o cliente legado já repetiu o 503 uma vez); credencial/pedido/orçamento nunca", () => {
    expect(retrySignalOf(rateLimited(4000))).toEqual({ kind: "RATE_LIMIT", retryAfterMs: 4000, providerAlreadyRetried: false })
    expect(retrySignalOf(overloaded())).toEqual({ kind: "UNAVAILABLE", retryAfterMs: null, providerAlreadyRetried: false })
    expect(retrySignalOf(legacyError(429, 31_000))).toEqual({ kind: "RATE_LIMIT", retryAfterMs: 31_000, providerAlreadyRetried: false })
    expect(retrySignalOf(legacyError(503))).toMatchObject({ kind: "UNAVAILABLE", providerAlreadyRetried: true })
    expect(retrySignalOf(new AiProviderError("AUTH", { httpStatus: 401 }))).toBeNull()
    expect(retrySignalOf(new AiProviderError("PROVIDER_ERROR", { httpStatus: 500 }))).toBeNull()
    expect(retrySignalOf(new AiProviderError("ROUTE_UNAVAILABLE"))).toBeNull()
    expect(retrySignalOf(new DomainError("Orçamento", "AI_BUDGET_EXCEEDED", 402, { budgetId: "b" }))).toBeNull()
    expect(retrySignalOf(new Error("503"))).toBeNull()
  })
})

describe("limitador — vagas, prioridade e repetição", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("vagas reservadas: o lote nunca ocupa as vagas do chat — a interativa entra na hora com o lote saturado", async () => {
    const { limiter } = limiterWith({ maxConcurrent: 4, reservedInteractive: 1 })
    const gates = Array.from({ length: 5 }, () => deferred())
    const batch = gates.map((gate) => track(limiter, "BATCH", () => gate.promise))
    await vi.advanceTimersByTimeAsync(0)
    expect(batch.map((item) => item.state.started)).toEqual([true, true, true, false, false])
    expect(limiter.stats()).toMatchObject({ running: { INTERACTIVE: 0, BATCH: 3 }, queued: { INTERACTIVE: 0, BATCH: 2 } })

    const chat = track(limiter, "INTERACTIVE", async () => "resposta")
    await vi.advanceTimersByTimeAsync(0)
    expect(chat.state).toMatchObject({ started: true, value: "resposta", record: { priority: "INTERACTIVE", attempt: 1, queueWaitMs: 0, queueReason: "NONE" } })

    gates[0]!.resolve("ok")
    await vi.advanceTimersByTimeAsync(0)
    expect(batch[3]!.state.started).toBe(true)
    gates.forEach((gate) => gate.resolve("ok"))
    await Promise.all(batch.map((item) => item.promise))
  })

  it("prioridade: com tudo ocupado, a interativa que chegou DEPOIS passa à frente do lote que já esperava", async () => {
    const { limiter } = limiterWith({ maxConcurrent: 3, reservedInteractive: 1 })
    const [b1, b2, i1] = [deferred(), deferred(), deferred()]
    const first = [track(limiter, "BATCH", () => b1.promise), track(limiter, "BATCH", () => b2.promise), track(limiter, "INTERACTIVE", () => i1.promise)]
    await vi.advanceTimersByTimeAsync(0)
    expect(first.every((item) => item.state.started)).toBe(true)

    const queuedBatch = track(limiter, "BATCH", async () => "lote")
    await vi.advanceTimersByTimeAsync(100)
    const chatGate = deferred()
    const lateChat = track(limiter, "INTERACTIVE", () => chatGate.promise)
    await vi.advanceTimersByTimeAsync(400)
    expect(limiter.stats().queued).toEqual({ INTERACTIVE: 1, BATCH: 1 })

    b1.resolve("ok")
    await vi.advanceTimersByTimeAsync(0)
    expect(lateChat.state).toMatchObject({ started: true, record: { queueReason: "CAPACITY", queueWaitMs: 400 } })
    expect(queuedBatch.state.started).toBe(false)

    b2.resolve("ok")
    await vi.advanceTimersByTimeAsync(0)
    expect(queuedBatch.state).toMatchObject({ started: true, record: { priority: "BATCH", queueReason: "CAPACITY", queueWaitMs: 500 } })
    i1.resolve("ok")
    chatGate.resolve("ok")
    await Promise.all([...first, queuedBatch, lateChat].map((item) => item.promise))
  })

  it("lote em 429: espera o Retry-After (mínimo, com teto), pausa o início de outros lotes e repete; o chat não é pausado", async () => {
    const { limiter, logs } = limiterWith({ maxConcurrent: 4, reservedInteractive: 1 })
    let attempts = 0
    const records: AiCallLimiterRecord[] = []
    const batch = track(limiter, "BATCH", async () => {
      attempts++
      records.push(currentAiCallLimiterRecord()!)
      if (attempts === 1) throw rateLimited(5_000)
      return "ok"
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    // Durante a pausa: lote novo espera (PROVIDER_COOLDOWN); interativa sai na hora.
    const otherBatch = track(limiter, "BATCH", async () => "outro lote")
    const chat = track(limiter, "INTERACTIVE", async () => "chat")
    await vi.advanceTimersByTimeAsync(0)
    expect(chat.state).toMatchObject({ settled: true, value: "chat" })
    expect(otherBatch.state.started).toBe(false)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(attempts).toBe(1)
    expect(otherBatch.state.started).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(otherBatch.state).toMatchObject({ value: "outro lote", record: { queueReason: "PROVIDER_COOLDOWN", queueWaitMs: 5_000 } })
    expect(attempts).toBe(2)
    await batch.promise
    expect(batch.state.value).toBe("ok")
    // Retry-After 5 s + jitter (até 1 s · 0,5) = 5.500 ms na segunda tentativa.
    expect(records.map((record) => [record.attempt, record.queueReason, record.queueWaitMs])).toEqual([[1, "NONE", 0], [2, "RETRY_BACKOFF", 5_500]])
    expect(logs.find((event) => event.event === "ai_call_retry")).toMatchObject({ priority: "BATCH", kind: "RATE_LIMIT", retryAfterMs: 5_000, waitMs: 5_500, batchPausedMs: 5_000 })
  })

  it("lote: backoff exponencial com jitter, limite de tentativas e o ERRO ORIGINAL no fim (a política do nó do Workflow decide depois)", async () => {
    const { limiter } = limiterWith({ batchMaxRetries: 3, batchBackoffBaseMs: 1_000, batchBackoffMaxMs: 3_000 }, () => 0)
    const waits: number[] = []
    let attempts = 0
    const failing = track(limiter, "BATCH", async () => {
      attempts++
      waits.push(currentAiCallLimiterRecord()!.queueWaitMs)
      throw legacyError(429)
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await failing.promise
    expect(attempts).toBe(4)
    // jitter 0 → metade do backoff: 1 s → 2 s → 4 s (teto 3 s) = 500, 1000, 1500.
    expect(waits).toEqual([0, 500, 1_000, 1_500])
    expect(failing.state.error).toMatchObject({ code: "AGENT_EXECUTION_FAILED", details: { status: 429 } })
  })

  it("lote: Retry-After maior que o teto espera só o teto (nunca trava a matrícula indefinidamente)", async () => {
    const { limiter } = limiterWith({ batchBackoffMaxMs: 10_000 })
    let attempts = 0
    const records: AiCallLimiterRecord[] = []
    const batch = track(limiter, "BATCH", async () => {
      attempts++
      records.push(currentAiCallLimiterRecord()!)
      if (attempts === 1) throw rateLimited(120_000)
      return "ok"
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await batch.promise
    expect(records[1]).toMatchObject({ attempt: 2, queueWaitMs: 10_000 })
  })

  it("interativa: tenta UMA vez a mais, rápido (Retry-After de 30 s vira ≤ 2 s), e falha com erro claro", async () => {
    const { limiter } = limiterWith({}, () => 0)
    let attempts = 0
    const records: AiCallLimiterRecord[] = []
    const chat = track(limiter, "INTERACTIVE", async () => {
      attempts++
      records.push(currentAiCallLimiterRecord()!)
      throw rateLimited(30_000)
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await chat.promise
    expect(attempts).toBe(2)
    expect(records[1]).toMatchObject({ attempt: 2, queueReason: "RETRY_BACKOFF", queueWaitMs: 2_000 })
    expect(chat.state.error).toBeInstanceOf(AiProviderError)
    expect(chat.state.error).toMatchObject({ code: "AI_RATE_LIMIT", statusCode: 429, message: INTERACTIVE_RATE_LIMIT_MESSAGE, details: { retryAfterMs: 30_000 } })
  })

  it("interativa: a segunda tentativa que dá certo devolve a resposta; sem Retry-After espera ~750 ms", async () => {
    const { limiter } = limiterWith({}, () => 0)
    let attempts = 0
    const chat = track(limiter, "INTERACTIVE", async () => {
      attempts++
      if (attempts === 1) throw legacyError(429)
      return "respondeu"
    })
    await vi.advanceTimersByTimeAsync(749)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await chat.promise
    expect(chat.state.value).toBe("respondeu")
  })

  it("interativa: 503 do cliente legado (que já repetiu) não repete; 503 de adapter (que nunca repete) repete uma vez", async () => {
    const { limiter } = limiterWith()
    let legacyAttempts = 0
    const legacy = track(limiter, "INTERACTIVE", async () => {
      legacyAttempts++
      throw legacyError(503)
    })
    let adapterAttempts = 0
    const adapter = track(limiter, "INTERACTIVE", async () => {
      adapterAttempts++
      throw overloaded()
    })
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([legacy.promise, adapter.promise])
    expect(legacyAttempts).toBe(1)
    expect(adapterAttempts).toBe(2)
    expect(legacy.state.error).toMatchObject({ code: "AGENT_EXECUTION_FAILED" })
  })

  it("nunca repete: credencial, `retries: 0` do chamador, ou stream que já entregou pedaço ao usuário", async () => {
    const { limiter } = limiterWith()
    let auth = 0
    const authCall = track(limiter, "BATCH", async () => {
      auth++
      throw new AiProviderError("AUTH", { httpStatus: 401 })
    })
    let explicit = 0
    const writer = track(limiter, "BATCH", async () => {
      explicit++
      throw rateLimited(1_000)
    }, { noRetry: true })
    let streamed = 0
    const stream = track(limiter, "INTERACTIVE", async () => {
      streamed++
      throw rateLimited()
    }, { canRetry: () => false })
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all([authCall.promise, writer.promise, stream.promise])
    expect([auth, explicit, streamed]).toEqual([1, 1, 1])
    expect(writer.state.error).toMatchObject({ code: "AI_RATE_LIMIT", message: "O provedor de IA limitou as requisições (rate limit)." })
    expect(stream.state.error).toMatchObject({ message: INTERACTIVE_RATE_LIMIT_MESSAGE })
  })

  it("interativa que não acha vaga em tempo desiste com AI_CAPACITY_BUSY (nada saiu para o provider) e sai da fila", async () => {
    const { limiter, logs } = limiterWith({ maxConcurrent: 2, reservedInteractive: 1, interactiveQueueTimeoutMs: 1_000 })
    const gates = [deferred(), deferred()]
    const busy = [track(limiter, "INTERACTIVE", () => gates[0]!.promise), track(limiter, "INTERACTIVE", () => gates[1]!.promise)]
    let ran = false
    const waiting = track(limiter, "INTERACTIVE", async () => {
      ran = true
      return "x"
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await waiting.promise
    expect(ran).toBe(false)
    expect(waiting.state.error).toBeInstanceOf(AiCapacityBusyError)
    expect(waiting.state.error).toMatchObject({ code: "AI_CAPACITY_BUSY", statusCode: 503 })
    expect(limiter.stats().queued.INTERACTIVE).toBe(0)
    expect(logs.some((event) => event.event === "ai_call_capacity_busy")).toBe(true)
    gates.forEach((gate) => gate.resolve("ok"))
    await Promise.all(busy.map((item) => item.promise))
  })

  it("chamada aninhada usa a vaga da de fora (nunca espera por uma vaga que ela mesma segura)", async () => {
    const { limiter } = limiterWith({ maxConcurrent: 2, reservedInteractive: 1 })
    const outer = track(limiter, "BATCH", () => limiter.run(call("BATCH"), async () => "aninhada"))
    await vi.advanceTimersByTimeAsync(0)
    expect(outer.state.value).toBe("aninhada")
  })

  it("desligado (INIA_AI_LIMITER=OFF): sai direto, sem fila e sem repetir — como antes", async () => {
    const { limiter } = limiterWith({ enabled: false, maxConcurrent: 2, reservedInteractive: 1 })
    const gates = Array.from({ length: 4 }, () => deferred())
    const calls = gates.map((gate) => track(limiter, "BATCH", () => gate.promise))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.every((item) => item.state.started)).toBe(true)
    let attempts = 0
    const failing = track(limiter, "BATCH", async () => {
      attempts++
      throw rateLimited(10)
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await failing.promise
    expect(attempts).toBe(1)
    gates.forEach((gate) => gate.resolve("ok"))
  })

  it("configuração incoerente é ajustada: o lote sempre fica com pelo menos uma vaga", () => {
    expect(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 3, reservedInteractive: 10 }).config).toMatchObject({ maxConcurrent: 3, reservedInteractive: 2 })
    expect(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 1, reservedInteractive: 0 }).config).toMatchObject({ maxConcurrent: 2, reservedInteractive: 1 })
  })
})

describe("cancelamento de quem pediu (SSE fechado)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("cancelada na fila: sai sem ocupar vaga e a próxima da fila segue; cancelada no backoff: não repete", async () => {
    const { limiter } = limiterWith({ maxConcurrent: 2, reservedInteractive: 1 })
    const gate = deferred()
    const busy = [track(limiter, "INTERACTIVE", () => gate.promise), track(limiter, "INTERACTIVE", () => gate.promise)]
    const cancel = new AbortController()
    let ran = false
    const queued = track(limiter, "INTERACTIVE", async () => {
      ran = true
      return "x"
    }, { signal: cancel.signal })
    const next = track(limiter, "INTERACTIVE", async () => "próxima")
    await vi.advanceTimersByTimeAsync(0)
    expect(limiter.stats().queued.INTERACTIVE).toBe(2)
    cancel.abort()
    await vi.advanceTimersByTimeAsync(0)
    await queued.promise
    expect(ran).toBe(false)
    expect(queued.state.error).toMatchObject({ code: "AI_CALL_CANCELLED" })
    expect(limiter.stats().queued.INTERACTIVE).toBe(1)
    gate.resolve("ok")
    await Promise.all(busy.map((item) => item.promise))
    await next.promise
    expect(next.state.value).toBe("próxima")
    expect(limiter.stats().running).toEqual({ INTERACTIVE: 0, BATCH: 0 })

    const stop = new AbortController()
    let attempts = 0
    const retrying = track(limiter, "BATCH", async () => {
      attempts++
      throw rateLimited(10_000)
    }, { signal: stop.signal })
    await vi.advanceTimersByTimeAsync(1_000)
    stop.abort()
    await vi.advanceTimersByTimeAsync(20_000)
    await retrying.promise
    expect(attempts).toBe(1)
    expect(retrying.state.error).toMatchObject({ code: "AI_CALL_CANCELLED" })
  })

  it("já cancelada antes de pedir vaga: nem entra na fila", async () => {
    const { limiter } = limiterWith()
    const cancel = new AbortController()
    cancel.abort()
    const call = track(limiter, "INTERACTIVE", async () => "x", { signal: cancel.signal })
    await call.promise
    expect(call.state).toMatchObject({ started: false, error: { code: "AI_CALL_CANCELLED" } })
  })
})
