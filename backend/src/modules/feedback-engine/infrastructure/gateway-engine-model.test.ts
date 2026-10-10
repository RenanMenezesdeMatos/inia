import { afterEach, describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { registerAiRuntime, runWithAiOrganization, type AiRuntime, type AiUsageEventInput, type PolicyExecutionRequest } from "../../../shared/application/model-routing/ai-runtime.js"
import { registerProviderAdapter, type AdapterRequest } from "../../../shared/application/model-routing/provider-adapter.js"
import { STAGE_MAX_OUTPUT_TOKENS } from "../application/engine-meter.js"
import type { EngineModelRequest } from "../application/ports.js"
import { COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, VERIFICATION_RESPONSE_SCHEMA, VERIFICATION_SYSTEM_PROMPT } from "../domain/composition-prompt.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "./gateway-engine-model.js"

/**
 * Motor de feedback × policy da organização (zero rede): a redação e a verificação (Use Case FEEDBACK_WRITER) e a análise
 * (FEEDBACK_ANALYSIS) levam à policy o que cada etapa exige — schema, teto de saída e tempo — e, SEM policy, o pedido ao caminho
 * legado é exatamente o de antes (gemini-3.8-flash, retries 0, uma chamada só mesmo num 503).
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const legacyCalls: AdapterRequest[] = []
let legacyFails = false
registerProviderAdapter({
  provider: "GEMINI",
  async generate(request) {
    legacyCalls.push(request)
    if (legacyFails) throw new DomainError("Serviço indisponível.", "AGENT_EXECUTION_FAILED", 502, { status: 503, body: "Service Unavailable" })
    return { kind: "text", text: "{}", usage: { promptTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: null, reasoningTokens: null }, durationMs: 3, model: request.route.profile.model, provider: "GEMINI", finishReason: "STOP" }
  },
})

function fakeRuntime(policy: boolean) {
  const policyRequests: PolicyExecutionRequest[] = []
  const usage: AiUsageEventInput[] = []
  const runtime: AiRuntime = {
    async executeWithPolicy(request) {
      policyRequests.push(request)
      if (!policy) return null
      return { kind: "text", text: "{}", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "gpt-x", provider: "OPENAI", finishReason: "STOP", cache: { mode: "NONE", cacheKeyVersion: null, cachedTokens: null, hitRate: null }, cost: { status: "NOT_CONFIGURED" }, resolvedRoute: { requestedUseCase: request.useCase, routingMode: "PINNED", providerKey: "OPENAI", connectionId: "c", connectionName: "OpenAI", modelId: "m", modelName: "gpt-x", routeReason: "PINNED", fallbackAttempt: 0, fallbackReason: null, correlationId: request.correlationId } }
    },
    async streamWithPolicy() {
      return null
    },
    async assertLegacyCallAllowed() {},
    async recordUsage(event) {
      usage.push(event)
    },
  }
  return { runtime, policyRequests, usage }
}

const composition: EngineModelRequest = { stage: "COMPOSITION", systemPrompt: COMPOSITION_SYSTEM_PROMPT, contents: [{ role: "user", text: "CASO (JSON): {}" }], responseSchema: COMPOSITION_RESPONSE_SCHEMA, tag: "draft" }
const verification: EngineModelRequest = { stage: "VERIFICATION", systemPrompt: VERIFICATION_SYSTEM_PROMPT, contents: [{ role: "user", text: "FATOS DO CASO (JSON): {}" }], responseSchema: VERIFICATION_RESPONSE_SCHEMA, tag: "draft" }
const run = (request: EngineModelRequest) => runWithAiOrganization(ORG, () => createGatewayEngineModel().generate(request))

describe("motor de feedback pelo gateway: policy da organização × rota fixa", () => {
  afterEach(() => {
    registerAiRuntime(null)
    legacyCalls.length = 0
    legacyFails = false
  })

  it("SEM policy: composição e verificação saem pela rota fixa de antes — mesmo pedido ao legado, com ou sem runtime registrado", async () => {
    await run(composition)
    const withoutRuntime = legacyCalls.splice(0)
    const fake = fakeRuntime(false)
    registerAiRuntime(fake.runtime)
    await run(composition)
    await run(verification)
    const [composed, verified] = legacyCalls
    // Byte a byte: o runtime registrado (sem policy) não muda nada no pedido ao legado.
    expect(JSON.stringify(composed)).toBe(JSON.stringify(withoutRuntime[0]))
    expect(Object.keys(composed!).sort()).toEqual(["cache", "contents", "maxOutputTokens", "responseSchema", "route", "structuredOutput", "systemPrompt", "tools", "transport"])
    expect(composed).toMatchObject({ structuredOutput: true, tools: [], transport: { timeoutMs: 120_000, retries: 0 }, responseSchema: COMPOSITION_RESPONSE_SCHEMA, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.COMPOSITION, route: { profile: { provider: "GEMINI", model: ENGINE_MODEL }, escalated: false, fallback: false } })
    expect(verified).toMatchObject({ transport: { timeoutMs: 120_000, retries: 0 }, responseSchema: VERIFICATION_RESPONSE_SCHEMA, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.VERIFICATION })
    expect(fake.policyRequests.map((request) => request.useCase)).toEqual(["FEEDBACK_WRITER", "FEEDBACK_WRITER"])
    expect(fake.usage.map((event) => [event.useCase, event.routingMode, event.providerKey, event.modelName])).toEqual([["FEEDBACK_WRITER", "LEGACY", "GOOGLE_GENAI", ENGINE_MODEL], ["FEEDBACK_WRITER", "LEGACY", "GOOGLE_GENAI", ENGINE_MODEL]])
  })

  it("SEM policy: 503 do provider = UMA chamada só (retries 0 — quem repete é o medidor do motor, nunca o transporte)", async () => {
    registerAiRuntime(fakeRuntime(false).runtime)
    legacyFails = true
    await expect(run(composition)).rejects.toMatchObject({ code: "AGENT_EXECUTION_FAILED" })
    expect(legacyCalls).toHaveLength(1)
  })

  it("COM policy: a policy recebe o schema, o teto de saída e o tempo de cada etapa; o legado nem é chamado", async () => {
    const fake = fakeRuntime(true)
    registerAiRuntime(fake.runtime)
    const response = await run(composition)
    await run(verification)
    await run({ stage: "CALL_ANALYSIS", systemPrompt: "Analise. Responda somente com o JSON do schema.", contents: [{ role: "user", text: "chamada" }], responseSchema: { type: "object" } })
    expect(response).toMatchObject({ model: "gpt-x", finishReason: "STOP" })
    expect(legacyCalls).toHaveLength(0)
    expect(fake.policyRequests.map((request) => ({ useCase: request.useCase, structuredOutput: request.structuredOutput, maxOutputTokens: request.maxOutputTokens, timeoutMs: request.timeoutMs }))).toEqual([
      { useCase: "FEEDBACK_WRITER", structuredOutput: true, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.COMPOSITION, timeoutMs: 120_000 },
      { useCase: "FEEDBACK_WRITER", structuredOutput: true, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.VERIFICATION, timeoutMs: 120_000 },
      { useCase: "FEEDBACK_ANALYSIS", structuredOutput: true, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.CALL_ANALYSIS, timeoutMs: 240_000 },
    ])
    expect(fake.policyRequests[0]!.responseSchema).toBe(COMPOSITION_RESPONSE_SCHEMA)
    expect(fake.policyRequests[1]!.responseSchema).toBe(VERIFICATION_RESPONSE_SCHEMA)
    expect(fake.policyRequests[0]!.classification.tags).toEqual(["stage:ENGINE_COMPOSITION", "step:draft"])
  })
})
