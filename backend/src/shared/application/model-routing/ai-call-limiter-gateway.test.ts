import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DomainError } from "../../domain/domain-error.js"
import { AiProviderError } from "./ai-errors.js"
import { createAiCallLimiter, currentAiCallLimiterRecord, DEFAULT_AI_CALL_LIMITER_CONFIG, INTERACTIVE_RATE_LIMIT_MESSAGE, setAiCallLimiter, type AiCallLimiterRecord } from "./ai-call-limiter.js"
import { registerAiRuntime, runWithAiOrganization, runWithAiWorkflowCorrelation, type AiRuntime, type AiUsageEventInput, type PolicyExecutionResult } from "./ai-runtime.js"
import { createChatStreamer, generateForRoute, routeFor } from "./llm-gateway.js"
import { setModelProfilesForTests } from "./model-registry.js"
import { registerProviderAdapter } from "./provider-adapter.js"

/**
 * Limitador DENTRO do gateway (o mesmo caminho de sempre): a classe vem do contexto (motor de Workflow × request de uma
 * pessoa), o fallback da policy continua por dentro da vaga (o limitador só repete quando a rota inteira devolveu 429), a dica
 * do corpo do 429 do Google chega ao backoff sem o corpo vazar, e o chat em streaming nunca repete depois do primeiro pedaço.
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const WORKFLOW = { workflowId: "w", workflowVersionId: "v", enrollmentId: "e", rootEnrollmentId: "e", nodeId: "n" }
const GOOGLE_429_BODY = '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota). key AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3s"}]}}'

const legacyScript: (() => unknown)[] = []
const legacyRecords: (AiCallLimiterRecord | null)[] = []
registerProviderAdapter({
  provider: "LOCAL",
  async generate(request) {
    legacyRecords.push(currentAiCallLimiterRecord())
    const step = legacyScript.shift()
    const outcome = step ? step() : null
    if (outcome instanceof Error) throw outcome
    return { kind: "text", text: "legado", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: request.route.profile.model, provider: "LOCAL" }
  },
})

const request = (transport?: { retries?: number }) => ({ classification: { phase: "SYNTHESIS" as const, purpose: "SPECIALIST_SYNTHESIS", source: "SPECIALIST" as const, semanticType: "TEXT" as const }, systemPrompt: "s", contents: [{ role: "user" as const, text: "t" }], route: routeFor({ purpose: "SPECIALIST_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT"), ...(transport ? { transport } : {}) })

const legacy429 = () => new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status: 429, body: GOOGLE_429_BODY })

function policyResult(useCase: string, correlationId: string): PolicyExecutionResult {
  return { kind: "text", text: "via policy", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "b", provider: "OPENAI", cache: { mode: "NONE", cacheKeyVersion: null, cachedTokens: null, hitRate: null }, cost: { status: "NOT_CONFIGURED" }, resolvedRoute: { requestedUseCase: useCase as never, routingMode: "FALLBACK_CHAIN", providerKey: "OPENAI", connectionId: "c", connectionName: "C", modelId: "b", modelName: "b", routeReason: "FALLBACK_CHAIN", fallbackAttempt: 1, fallbackReason: "FALLBACK_RATE_LIMIT", correlationId } }
}

/** Runtime falso que simula a POLICY com FALLBACK_CHAIN: cada execução é a cadeia inteira (A → B) e devolve só o desfecho. */
function fallbackRuntime(outcomes: ("FALLBACK_OK" | "CHAIN_EXHAUSTED")[]) {
  const executions: { correlationId: string; record: AiCallLimiterRecord | null }[] = []
  const usage: AiUsageEventInput[] = []
  const runtime: AiRuntime = {
    async executeWithPolicy(request) {
      executions.push({ correlationId: request.correlationId, record: currentAiCallLimiterRecord() })
      const outcome = outcomes.shift() ?? "FALLBACK_OK"
      if (outcome === "CHAIN_EXHAUSTED") throw new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 4_000 })
      return policyResult(request.useCase, request.correlationId)
    },
    async streamWithPolicy() {
      return null
    },
    async assertLegacyCallAllowed() {},
    async recordUsage(event) {
      usage.push(event)
    },
  }
  return { runtime, executions, usage }
}

describe("gateway + limitador", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setAiCallLimiter(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, maxConcurrent: 4, reservedInteractive: 1 }, { random: () => 0, log: () => {} }))
    setModelProfilesForTests([{ id: "l-s", provider: "LOCAL", model: "legacy-std", tier: "STANDARD", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }, { id: "l-b", provider: "LOCAL", model: "legacy-basic", tier: "BASIC", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }])
  })
  afterEach(() => {
    vi.useRealTimers()
    setAiCallLimiter(null)
    registerAiRuntime(null)
    setModelProfilesForTests(null)
    legacyScript.length = 0
    legacyRecords.length = 0
  })

  it("lote (nó de Workflow) no legado: 429 do Google → espera o RetryInfo do corpo (3 s) e repete; o corpo nunca vaza", async () => {
    legacyScript.push(legacy429)
    const result = runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => generateForRoute(request()))
    await vi.advanceTimersByTimeAsync(2_999)
    expect(legacyRecords).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toMatchObject({ kind: "text", text: "legado" })
    expect(legacyRecords).toEqual([
      { priority: "BATCH", priorityReason: "WORKFLOW_EXECUTION", attempt: 1, queueWaitMs: 0, queueReason: "NONE" },
      { priority: "BATCH", priorityReason: "WORKFLOW_EXECUTION", attempt: 2, queueWaitMs: 3_000, queueReason: "RETRY_BACKOFF" },
    ])
  })

  it("interativa (request de uma pessoa) no legado: insiste dentro de 15 s (RetryInfo de 3 s como mínimo) e dá erro claro, sem o corpo do provider", async () => {
    legacyScript.push(legacy429, legacy429, legacy429, legacy429, legacy429)
    const result = runWithAiOrganization(ORG, () => generateForRoute(request()), { origin: "USER_REQUEST" }).catch((error: unknown) => error)
    // Esperas: 3 s, 3 s, 3 s (o RetryInfo vale como mínimo) e 6 s (a que dobrou) = 15 s.
    await vi.advanceTimersByTimeAsync(15_000)
    const error = await result
    expect(legacyRecords.map((record) => record?.priority)).toEqual(["INTERACTIVE", "INTERACTIVE", "INTERACTIVE", "INTERACTIVE", "INTERACTIVE"])
    expect(error).toMatchObject({ code: "AI_RATE_LIMIT", statusCode: 429, message: INTERACTIVE_RATE_LIMIT_MESSAGE })
    expect(JSON.stringify((error as DomainError).details)).not.toContain("AIza")
  })

  it("convivência com o FALLBACK_CHAIN: a troca de modelo acontece dentro da vaga — o limitador NÃO repete quando o fallback resolve", async () => {
    const fake = fallbackRuntime(["FALLBACK_OK"])
    registerAiRuntime(fake.runtime)
    const result = await runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => generateForRoute(request()))
    expect(result).toMatchObject({ text: "via policy", resolvedRoute: { fallbackReason: "FALLBACK_RATE_LIMIT" } })
    expect(fake.executions).toHaveLength(1)
    expect(legacyRecords).toHaveLength(0)
  })

  it("convivência com o FALLBACK_CHAIN: cadeia inteira em 429 → o lote espera e repete a POLICY (mesma correlação), nunca cai no legado", async () => {
    const fake = fallbackRuntime(["CHAIN_EXHAUSTED", "FALLBACK_OK"])
    registerAiRuntime(fake.runtime)
    const result = runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => generateForRoute(request()))
    await vi.advanceTimersByTimeAsync(4_000)
    await expect(result).resolves.toMatchObject({ text: "via policy" })
    expect(fake.executions.map((execution) => execution.record?.attempt)).toEqual([1, 2])
    expect(new Set(fake.executions.map((execution) => execution.correlationId)).size).toBe(1)
    expect(fake.executions[1]!.record).toMatchObject({ queueReason: "RETRY_BACKOFF", queueWaitMs: 4_000 })
    expect(legacyRecords).toHaveLength(0)
  })

  it("`transport.retries: 0` (Feedback Writer): o limitador só enfileira — a falha volta na hora, uma chamada só", async () => {
    legacyScript.push(legacy429)
    const error = await runWithAiWorkflowCorrelation(ORG, WORKFLOW, () => generateForRoute(request({ retries: 0 }))).catch((caught: unknown) => caught)
    expect(legacyRecords).toHaveLength(1)
    expect(error).toMatchObject({ code: "AGENT_EXECUTION_FAILED", details: { status: 429, retryAfterMs: 3_000 } })
  })

  it("chat em streaming: 429 antes do primeiro pedaço repete; depois de entregar texto, nunca", async () => {
    let calls = 0
    const stream = createChatStreamer(async (_history, _system, onChunk) => {
      calls++
      if (calls === 1) throw legacy429()
      onChunk("oi")
      return null
    })
    const chunks: string[] = []
    const ok = runWithAiOrganization(ORG, () => stream([{ role: "user", text: "olá" }], "sys", (chunk) => chunks.push(chunk)), { origin: "USER_REQUEST" })
    await vi.advanceTimersByTimeAsync(3_000)
    await ok
    expect([calls, chunks]).toEqual([2, ["oi"]])

    let midCalls = 0
    const breaksMidway = createChatStreamer(async (_history, _system, onChunk) => {
      midCalls++
      onChunk("começo")
      throw legacy429()
    })
    const error = await runWithAiOrganization(ORG, () => breaksMidway([{ role: "user", text: "olá" }], "sys", () => {}), { origin: "USER_REQUEST" }).catch((caught: unknown) => caught)
    expect(midCalls).toBe(1)
    expect(error).toMatchObject({ code: "AI_RATE_LIMIT", message: INTERACTIVE_RATE_LIMIT_MESSAGE })
  })
})
