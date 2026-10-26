import { afterEach, describe, expect, it, vi } from "vitest"
import { AiProviderError } from "./ai-errors.js"
import { createAiCallLimiter, DEFAULT_AI_CALL_LIMITER_CONFIG } from "./ai-call-limiter.js"
import { batchShareOf, connectionGateKey, cooldownMsOf, gateSignalOf, legacyGateKey, runThroughProviderGate, runWithEstimatedTokens, setProviderCallGate, type ProviderCallGate } from "./provider-call-gate.js"
import { runWithAiCancellation } from "./ai-runtime.js"

/** Regras do portão por conexão (sem banco): reserva da interativa, duração da pausa, chaves e contexto da chamada. */
afterEach(() => setProviderCallGate(null))

describe("portão por conexão de IA — regras", () => {
  it("o lote nunca ocupa a reserva da interativa: um quarto do teto (pelo menos 1 com teto ≥ 2)", () => {
    expect([1, 2, 3, 4, 6, 8, 20].map(batchShareOf)).toEqual([1, 1, 2, 3, 4, 6, 15])
  })

  it("pausa: 429 = Retry-After ou 5 s (do chat, pelo menos 15 s); 503 = Retry-After ou 2 s; nunca acima de 60 s; credencial/pedido inválido = sem pausa", () => {
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 8_000 })))).toBe(8_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429 })))).toBe(5_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("PROVIDER_ERROR", { httpStatus: 503 })))).toBe(2_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 600_000 })))).toBe(60_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("AUTH", { httpStatus: 401 })))).toBe(0)
    // O chat tem prioridade: o 429 de uma chamada interativa pausa os lotes por pelo menos 15 s (Retry-After maior vale; teto 60 s).
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429 })), "INTERACTIVE")).toBe(15_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 20_000 })), "INTERACTIVE")).toBe(20_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 600_000 })), "INTERACTIVE")).toBe(60_000)
    expect(cooldownMsOf(gateSignalOf(new AiProviderError("PROVIDER_ERROR", { httpStatus: 503 })), "INTERACTIVE")).toBe(2_000)
  })

  it("chaves: conexão cadastrada e rota do ambiente — nenhum provedor conhecido pelo código", () => {
    expect(connectionGateKey("c-1")).toBe("connection:c-1")
    expect(legacyGateKey("OPENAI_COMPATIBLE")).toBe("legacy:OPENAI_COMPATIBLE")
  })

  it("sem portão registrado a chamada sai direto; com portão, leva a classe do limitador e o cancelamento do contexto", async () => {
    await expect(runThroughProviderGate("connection:x", 3, async () => "direto")).resolves.toBe("direto")
    const seen: unknown[] = []
    const gate: ProviderCallGate = { run: vi.fn(async (call, fn) => { seen.push(call); return fn() }), cooldownRemainingMs: () => 0, stats: () => ({ held: {}, waiting: {}, cooldowns: {} }) }
    setProviderCallGate(gate)
    const limiter = createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG })
    const cancel = new AbortController()
    await runWithAiCancellation(cancel.signal, () => limiter.run({ priority: "INTERACTIVE", priorityReason: "USER_REQUEST", useCase: "CHAT" }, () => runThroughProviderGate("connection:x", 3, async () => "ok")))
    expect(seen).toEqual([{ key: "connection:x", maxConcurrent: 3, priority: "INTERACTIVE", signal: cancel.signal, estimatedTokens: null }])
    // O gateway marca os tokens de entrada estimados da chamada: é o que a vazão adaptativa do lote conta.
    await runWithEstimatedTokens(1_234, () => limiter.run({ priority: "BATCH", priorityReason: "WORKFLOW_EXECUTION", useCase: "AGENT_RESPONSE" }, () => runThroughProviderGate("legacy:X", null, async () => "ok")))
    expect(seen.at(-1)).toMatchObject({ key: "legacy:X", maxConcurrent: null, priority: "BATCH", estimatedTokens: 1_234 })
  })
})
