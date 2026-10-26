import { afterEach, describe, expect, it } from "vitest"
import { DomainError } from "../../domain/domain-error.js"
import { setModelProfilesForTests } from "./model-registry.js"
import { registerProviderAdapter, type AdapterRequest } from "./provider-adapter.js"
import { createChatStreamer, generateForRoute, routeFor } from "./llm-gateway.js"
import type { RoutePurpose } from "./route-policy.js"
import { registerAiRuntime, runWithAiOrganization, type AiRuntime, type AiUsageEventInput, type PolicyExecutionRequest } from "./ai-runtime.js"
import { AiBudgetExceededError } from "./ai-errors.js"

const textOf = (response: { kind: string; text?: string }) => (response.kind === "text" ? response.text : "")

/**
 * Gateway × runtime da organização (AI Providers V1 — §29, §32, §88, §90): policy ativa primeiro;
 * sem policy o caminho LEGADO é exatamente o de antes; sem runtime registrado nada muda; uso é
 * registrado nos dois caminhos; o corpo cru do provider nunca volta na exceção.
 */
const ORG = "11111111-1111-4111-8111-111111111111"
const legacyCalls: AdapterRequest[] = []
let legacyBehavior: "ok" | "fail" = "ok"
registerProviderAdapter({
  provider: "LOCAL",
  async generate(request) {
    legacyCalls.push(request)
    if (legacyBehavior === "fail") throw new DomainError("O modelo de IA não retornou uma resposta válida.", "AGENT_EXECUTION_FAILED", 502, { status: 401, body: "API key not valid: AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE" })
    return { kind: "text", text: "legado", usage: { promptTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: null, reasoningTokens: null }, durationMs: 3, model: request.route.profile.model, provider: "LOCAL" }
  },
})

function fakeRuntime(options: { policy?: boolean; blockLegacy?: boolean } = {}) {
  const usage: AiUsageEventInput[] = []
  const policyRequests: PolicyExecutionRequest[] = []
  const runtime: AiRuntime = {
    async executeWithPolicy(request) {
      policyRequests.push(request)
      if (!options.policy) return null
      return { kind: "text", text: "via policy", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "m", provider: "OPENAI", cache: { mode: "NONE", cacheKeyVersion: null, cachedTokens: null, hitRate: null }, cost: { status: "NOT_CONFIGURED" }, resolvedRoute: { requestedUseCase: request.useCase, routingMode: "PINNED", providerKey: "OPENAI", connectionId: "c", connectionName: "C", modelId: "m", modelName: "m", routeReason: "PINNED", fallbackAttempt: 0, fallbackReason: null, correlationId: request.correlationId } }
    },
    async streamWithPolicy() {
      return null
    },
    async assertLegacyCallAllowed({ organizationId }) {
      if (options.blockLegacy) throw new AiBudgetExceededError("Orçamento atingido", { budgetId: "b", scope: "GLOBAL", scopeKey: null, currency: "USD", limit: "1", spent: "2" })
      void organizationId
    },
    async recordUsage(event) {
      usage.push(event)
    },
  }
  return { runtime, usage, policyRequests }
}

const request = () => ({ classification: { phase: "SYNTHESIS" as const, purpose: "AGENT_SYNTHESIS", source: "AGENT" as const, semanticType: "FEEDBACK" as const }, systemPrompt: "s", contents: [{ role: "user" as const, text: "t" }], structuredOutput: true, route: routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT") })

describe("gateway + runtime da organização", () => {
  afterEach(() => {
    registerAiRuntime(null)
    setModelProfilesForTests(null)
    legacyCalls.length = 0
    legacyBehavior = "ok"
  })
  const localProfiles = () => setModelProfilesForTests([{ id: "l-b", provider: "LOCAL", model: "legacy-basic", tier: "BASIC", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }, { id: "l-s", provider: "LOCAL", model: "legacy-std", tier: "STANDARD", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }])

  it("sem runtime registrado: caminho legado idêntico ao anterior", async () => {
    localProfiles()
    const response = await runWithAiOrganization(ORG, () => generateForRoute(request()))
    expect(response).toMatchObject({ kind: "text", text: "legado", model: "legacy-basic" })
    expect(legacyCalls).toHaveLength(1)
  })

  it("policy ativa: executa pela policy com o Use Case derivado do propósito — o legado nem é chamado", async () => {
    localProfiles()
    const fake = fakeRuntime({ policy: true })
    registerAiRuntime(fake.runtime)
    const response = await runWithAiOrganization(ORG, () => generateForRoute(request()))
    expect(response).toMatchObject({ text: "via policy", resolvedRoute: { requestedUseCase: "AGENT_RESPONSE", routingMode: "PINNED" } })
    expect(fake.policyRequests[0]).toMatchObject({ organizationId: ORG, useCase: "AGENT_RESPONSE", structuredOutput: true })
    expect(legacyCalls).toHaveLength(0)
  })

  it("sem policy: legado (ZERO troca silenciosa) + evento de uso LEGACY com a organização da sessão", async () => {
    localProfiles()
    const fake = fakeRuntime({ policy: false })
    registerAiRuntime(fake.runtime)
    await runWithAiOrganization(ORG, () => generateForRoute(request()))
    expect(legacyCalls).toHaveLength(1)
    expect(fake.usage).toHaveLength(1)
    expect(fake.usage[0]).toMatchObject({ organizationId: ORG, useCase: "AGENT_RESPONSE", routingMode: "LEGACY", status: "SUCCESS", modelName: "legacy-basic", usage: { promptTokens: 10 } })
  })

  it("hard limit do orçamento bloqueia a chamada legada paga com AI_BUDGET_EXCEEDED (nunca silencioso)", async () => {
    localProfiles()
    registerAiRuntime(fakeRuntime({ policy: false, blockLegacy: true }).runtime)
    await expect(runWithAiOrganization(ORG, () => generateForRoute(request()))).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED" })
    expect(legacyCalls).toHaveLength(0)
  })

  it("erro do cliente legado: sem corpo cru do provider na exceção (o handler HTTP devolveria ao navegador); evento com categoria", async () => {
    localProfiles()
    legacyBehavior = "fail"
    const fake = fakeRuntime()
    registerAiRuntime(fake.runtime)
    const error = await runWithAiOrganization(ORG, () => generateForRoute(request())).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DomainError)
    expect((error as DomainError).code).toBe("AGENT_EXECUTION_FAILED")
    expect(JSON.stringify((error as DomainError).details)).not.toContain("AIza")
    expect(fake.usage[0]).toMatchObject({ status: "ERROR", errorCategory: "AUTH" })
  })

  it("sem organização no contexto: nunca consulta policy (não existe \"organização padrão\")", async () => {
    localProfiles()
    const fake = fakeRuntime({ policy: true })
    registerAiRuntime(fake.runtime)
    const response = await generateForRoute(request())
    expect(textOf(response)).toBe("legado")
    expect(fake.policyRequests).toHaveLength(0)
  })

  it("chat em streaming (antigo bypass) agora passa pelo gateway: uso registrado com o uso informado pelo stream", async () => {
    const fake = fakeRuntime()
    registerAiRuntime(fake.runtime)
    const chunks: string[] = []
    const stream = createChatStreamer(async (_history, _system, onChunk) => {
      onChunk("oi")
      return { promptTokens: 4, outputTokens: 1, totalTokens: 5, cachedInputTokens: null, reasoningTokens: null }
    })
    await runWithAiOrganization(ORG, () => stream([{ role: "user", text: "olá" }], "sys", (chunk) => chunks.push(chunk)))
    expect(chunks).toEqual(["oi"])
    expect(fake.usage[0]).toMatchObject({ useCase: "CHAT", routingMode: "LEGACY", usage: { totalTokens: 5 } })
  })

  // ZERO SPEND SEM EVENTO DE USO: toda chamada que sai pelo gateway — qualquer propósito, com ou sem
  // organização, sucesso ou erro — grava exatamente UM evento. O Record força cobrir cada RoutePurpose.
  const EVERY_PURPOSE = { PLANNING: true, INVESTIGATION_NOTES: true, TOOL_ARGUMENT_GENERATION: true, ANALYZE_INTERACTIONS: true, ANALYZE_PEER_PATTERNS: true, AGENT_SYNTHESIS: true, SPECIALIST_SYNTHESIS: true, ORCHESTRATOR_ROUTING: true, ORCHESTRATOR_SYNTHESIS: true, POST_JOIN_SYNTHESIS: true, GATING_CORRECTION: true, FEEDBACK_WRITING: true, FEEDBACK_ANALYSIS: true, INTERVENTION_WRITING: true, REPORT_ANALYSIS: true, KNOWLEDGE_CLARIFICATION: true, BEST_PRACTICE_ANALYSIS: true } satisfies Record<RoutePurpose, true>

  it("zero spend sem uso: cada RoutePurpose (com e sem organização, sucesso e erro) grava exatamente um evento", async () => {
    localProfiles()
    const fake = fakeRuntime()
    registerAiRuntime(fake.runtime)
    const purposes = Object.keys(EVERY_PURPOSE) as RoutePurpose[]
    for (const purpose of purposes) {
      const routed = { ...request(), classification: { ...request().classification, purpose }, route: routeFor({ purpose, phase: "SYNTHESIS" }, "CURRENT") }
      await runWithAiOrganization(ORG, () => generateForRoute(routed))
      await generateForRoute(routed)
      legacyBehavior = "fail"
      await expect(runWithAiOrganization(ORG, () => generateForRoute(routed))).rejects.toThrow()
      legacyBehavior = "ok"
    }
    expect(legacyCalls).toHaveLength(purposes.length * 3)
    expect(fake.usage).toHaveLength(purposes.length * 3)
    expect(fake.usage.every((event) => event.useCase !== "UNCLASSIFIED")).toBe(true)
    expect(fake.usage.filter((event) => event.organizationId === null)).toHaveLength(purposes.length)
  })

  it("propósito sem mapeamento: vira UNCLASSIFIED — uso registrado, orçamento aplicado, nenhuma policy escolhida por palpite", async () => {
    localProfiles()
    const fake = fakeRuntime({ policy: true })
    registerAiRuntime(fake.runtime)
    const routeWithoutPurpose = { ...routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT") }
    delete routeWithoutPurpose.purpose
    const unmapped = { ...request(), classification: { ...request().classification, purpose: "ALGO_NOVO" }, route: routeWithoutPurpose }
    const response = await runWithAiOrganization(ORG, () => generateForRoute(unmapped))
    expect(textOf(response)).toBe("legado")
    expect(fake.policyRequests).toHaveLength(0)
    expect(fake.usage).toHaveLength(1)
    expect(fake.usage[0]).toMatchObject({ useCase: "UNCLASSIFIED", routingMode: "LEGACY", organizationId: ORG })
    const blocked = fakeRuntime({ blockLegacy: true })
    registerAiRuntime(blocked.runtime)
    await expect(runWithAiOrganization(ORG, () => generateForRoute(unmapped))).rejects.toBeInstanceOf(AiBudgetExceededError)
    expect(legacyCalls).toHaveLength(1)
  })

  it("chat em streaming: erro do provider também grava evento; hard limit bloqueia antes do stream", async () => {
    const fake = fakeRuntime()
    registerAiRuntime(fake.runtime)
    const failing = createChatStreamer(async () => {
      throw new DomainError("falhou", "GEMINI_TEXT_FAILED", 502, { status: 503, body: "overloaded" })
    })
    await expect(runWithAiOrganization(ORG, () => failing([{ role: "user", text: "olá" }], "sys", () => {}))).rejects.toThrow()
    expect(fake.usage[0]).toMatchObject({ useCase: "CHAT", status: "ERROR" })
    const blocked = fakeRuntime({ blockLegacy: true })
    registerAiRuntime(blocked.runtime)
    let streamed = false
    const guarded = createChatStreamer(async () => {
      streamed = true
    })
    await expect(runWithAiOrganization(ORG, () => guarded([{ role: "user", text: "olá" }], "sys", () => {}))).rejects.toBeInstanceOf(AiBudgetExceededError)
    expect(streamed).toBe(false)
  })
})
