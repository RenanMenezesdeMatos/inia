import { afterEach, describe, expect, it } from "vitest"
import { DomainError } from "../../domain/domain-error.js"
import { setModelProfilesForTests } from "./model-registry.js"
import { registerProviderAdapter, type AdapterRequest, type AdapterResponse } from "./provider-adapter.js"
import { routeFor, streamForRoute } from "./llm-gateway.js"
import { createAiCallLimiter, DEFAULT_AI_CALL_LIMITER_CONFIG, setAiCallLimiter } from "./ai-call-limiter.js"
import { runWithAiOrganization } from "./ai-runtime.js"
import { createChatTurnTrace, runWithChatTurnTrace } from "../observability/chat-turn-trace.js"

/**
 * `streamForRoute`: a MESMA chamada do gateway (limitador, uso), com o texto entregue em fluxo. Garantias: texto → `onText` recebe
 * o texto inteiro exatamente uma vez (em pedaços, ou de uma vez quando o adapter não faz fluxo); depois do primeiro pedaço
 * entregue, nada repete; a chamada entra no rastreamento do turno do chat (propósito, duração, 1º pedaço).
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const usage = { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }
let script: (request: AdapterRequest, onText?: (text: string) => void) => Promise<AdapterResponse & { streamedChars?: number; firstTokenMs?: number | null }>
let attempts = 0

registerProviderAdapter({
  provider: "XAI",
  async generate(request) {
    attempts += 1
    return script(request)
  },
  async stream(request, onText) {
    attempts += 1
    const response = await script(request, onText)
    return { ...response, streamedChars: response.streamedChars ?? 0, firstTokenMs: response.firstTokenMs ?? null }
  },
})
registerProviderAdapter({
  provider: "LOCAL",
  async generate() {
    attempts += 1
    return { kind: "text", text: "inteiro de uma vez", usage, durationMs: 1, model: "m", provider: "LOCAL" }
  },
})

const profile = (provider: "XAI" | "LOCAL") => setModelProfilesForTests([{ id: "p", provider, model: "m", tier: "STANDARD", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }, { id: "p-b", provider, model: "m-basic", tier: "BASIC", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }])
const request = () => ({ classification: { phase: "SYNTHESIS" as const, purpose: "ORCHESTRATOR_SYNTHESIS", source: "ORCHESTRATOR" as const, semanticType: "TEXT" as const }, systemPrompt: "s", contents: [{ role: "user" as const, text: "t" }], tools: [], structuredOutput: false, route: routeFor({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT") })

afterEach(() => {
  setModelProfilesForTests(null)
  setAiCallLimiter(null)
  attempts = 0
})

describe("streamForRoute", () => {
  it("adapter em fluxo: os pedaços chegam a onText na ordem e o texto final é o mesmo", async () => {
    profile("XAI")
    script = async (_request, onText) => {
      onText?.("Olá, ")
      onText?.("mundo.")
      return { kind: "text", text: "Olá, mundo.", usage, durationMs: 1, model: "m", provider: "XAI", streamedChars: 11, firstTokenMs: 5 }
    }
    const chunks: string[] = []
    const response = await runWithAiOrganization(ORG, () => streamForRoute(request(), (text) => chunks.push(text)))
    expect(chunks).toEqual(["Olá, ", "mundo."])
    expect(response).toMatchObject({ kind: "text", text: "Olá, mundo.", streamedChars: 11, firstTokenMs: 5 })
  })

  it("adapter SEM fluxo: o texto inteiro chega a onText uma vez, no fim", async () => {
    profile("LOCAL")
    const chunks: string[] = []
    const response = await runWithAiOrganization(ORG, () => streamForRoute(request(), (text) => chunks.push(text)))
    expect(chunks).toEqual(["inteiro de uma vez"])
    expect(response).toMatchObject({ kind: "text", streamedChars: 0 })
  })

  it("429 DEPOIS do primeiro pedaço entregue: não repete (a resposta mudaria no meio); antes dele, repete normalmente", async () => {
    profile("XAI")
    setAiCallLimiter(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 4, reservedInteractive: 1, interactiveQueueTimeoutMs: 1_000, interactiveRetryDelayMs: 1, interactiveMaxRetryWaitMs: 1, batchMaxRetries: 2, batchBackoffBaseMs: 1, batchBackoffMaxMs: 1 }, { random: () => 0, log: () => {} }))
    const rateLimited = () => new DomainError("limite", "ASSISTANT_FAILED", 502, { status: 429, category: "RATE_LIMIT" })
    script = async (_request, onText) => {
      onText?.("parcial")
      throw rateLimited()
    }
    await expect(runWithAiOrganization(ORG, () => streamForRoute(request(), () => {}), { origin: "USER_REQUEST" })).rejects.toBeTruthy()
    expect(attempts).toBe(1)

    attempts = 0
    let calls = 0
    script = async (_request, onText) => {
      calls += 1
      if (calls === 1) throw rateLimited()
      onText?.("ok")
      return { kind: "text", text: "ok", usage, durationMs: 1, model: "m", provider: "XAI", streamedChars: 2, firstTokenMs: 1 }
    }
    const response = await runWithAiOrganization(ORG, () => streamForRoute(request(), () => {}), { origin: "USER_REQUEST" })
    expect(response).toMatchObject({ kind: "text", text: "ok" })
    expect(attempts).toBe(2)
  })

  it("a chamada entra no rastreamento do turno do chat (propósito, em fluxo, 1º pedaço) — sem conteúdo", async () => {
    profile("XAI")
    script = async (_request, onText) => {
      onText?.("x")
      return { kind: "text", text: "x", usage, durationMs: 1, model: "m", provider: "XAI", streamedChars: 1, firstTokenMs: 7 }
    }
    const trace = createChatTurnTrace({ channel: "chat" })
    await runWithChatTurnTrace(trace, () => runWithAiOrganization(ORG, () => streamForRoute(request(), () => {})))
    const summary = trace.finish("OK")
    expect(summary.llm).toEqual([expect.objectContaining({ purpose: "ORCHESTRATOR_SYNTHESIS", streamed: true, firstTokenMs: 7, status: "OK" })])
    expect(JSON.stringify(summary)).not.toContain('"x"')
  })
})
