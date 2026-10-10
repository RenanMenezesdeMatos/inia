import { afterEach, describe, expect, it } from "vitest"
import { createLlmTelemetryStore, recordLlmCall, runWithLlmTelemetry, withLlmScope } from "../llm-telemetry.js"
import { setModelPricingForTests } from "./model-pricing.js"
import { setModelProfilesForTests } from "./model-registry.js"
import { registerProviderAdapter, type AdapterRequest } from "./provider-adapter.js"
import { generateForRoute, routeFor } from "./llm-gateway.js"

// V1.3 — §9/§44/§53: toda request pelo gateway carrega classificação, rota, cache observado e custo — e a
// telemetria do QA Lab recebe tudo sem que o domínio conheça o provedor.
describe("llm-gateway — ponto único de saída", () => {
  const received: AdapterRequest[] = []
  const fakeAdapter = {
    provider: "LOCAL" as const,
    async generate(request: AdapterRequest) {
      received.push(request)
      // Simula o cliente do provedor registrando a request na telemetria (como os clientes Gemini fazem).
      recordLlmCall({ model: request.route.profile.model, promptTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 600, reasoningTokens: null, durationMs: 5, startedAt: new Date(), systemPrompt: request.systemPrompt, input: "in", outputText: "out" })
      return { kind: "text" as const, text: "ok", usage: { promptTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 600, reasoningTokens: null }, durationMs: 5, model: request.route.profile.model, provider: "LOCAL" as const }
    },
  }

  afterEach(() => {
    setModelProfilesForTests(null)
    setModelPricingForTests(null)
    received.length = 0
  })

  it("classificação + componentes + contexto entram no registro da request; cache implícito é observado do uso; custo só com pricing", async () => {
    setModelProfilesForTests([{ id: "local-basic", provider: "LOCAL", model: "local-7b", tier: "BASIC", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }, { id: "local-std", provider: "LOCAL", model: "local-70b", tier: "STANDARD", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }])
    setModelPricingForTests([{ model: "local-70b", inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 2, reasoningPerMillion: null, currency: "USD" }])
    registerProviderAdapter(fakeAdapter)
    const store = createLlmTelemetryStore({ policy: "REAL" })
    const route = routeFor({ purpose: "PLANNING", phase: "PLANNING" }, "CURRENT")
    expect(route.profile.provider).toBe("LOCAL")
    const response = await runWithLlmTelemetry(store, () =>
      withLlmScope({ role: "agent", agentId: "a1" }, () =>
        generateForRoute({
          classification: { phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION" },
          promptComponents: [{ id: "agent.identity", version: 1, chars: 10, static: true, placement: "SYSTEM" }],
          contextBreakdown: { staticPromptChars: 10, toolSchemaChars: 0, evidenceLedgerChars: 0, interactionContentChars: 0, knowledgeContentChars: 0, structuredSchemaChars: 0, objectiveChars: 2 },
          cache: { cacheable: true, cacheKeyVersion: "abc123" },
          systemPrompt: "S",
          contents: [{ role: "user", text: "in" }],
          route,
        }),
      ),
    )
    expect(received[0]).toMatchObject({ tools: [], structuredOutput: false, cache: { cacheable: true, cacheKeyVersion: "abc123" } })
    expect(response.cache).toEqual({ mode: "IMPLICIT", cacheKeyVersion: "abc123", cachedTokens: 600, hitRate: 0.6 })
    expect(response.cost).toEqual({ status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.0004, cachedInputCost: 0.00006, outputCost: 0.0002, reasoningCost: 0, totalEstimatedCost: 0.00066 })
    const call = store.calls[0]!
    expect(call.classification).toEqual({ phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION" })
    expect(call.phase).toBe("PLANNING")
    expect(call.promptComponents?.[0]?.id).toBe("agent.identity")
    expect(call.contextBreakdown?.staticPromptChars).toBe(10)
    expect(call.cache?.mode).toBe("IMPLICIT")
    expect(call.cost?.status).toBe("ESTIMATED_PROVIDER_COST")
  })

  it("sem pricing o custo é NOT_CONFIGURED e sem tokens cacheados o cache observado é NONE — nada estimado", async () => {
    setModelProfilesForTests([{ id: "local-basic", provider: "LOCAL", model: "local-7b", tier: "BASIC", contextWindow: null, maxOutput: null, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: false, enabled: true }])
    registerProviderAdapter({ ...fakeAdapter, async generate(request) { received.push(request); return { kind: "text" as const, text: "ok", usage: { promptTokens: 10, outputTokens: 1, totalTokens: 11, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "local-7b", provider: "LOCAL" as const } } })
    const response = await generateForRoute({ classification: { phase: "SYNTHESIS", purpose: "AGENT_SYNTHESIS", source: "AGENT", semanticType: "FEEDBACK" }, systemPrompt: "S", contents: [{ role: "user", text: "in" }], route: routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT") })
    expect(response.cache).toEqual({ mode: "NONE", cacheKeyVersion: null, cachedTokens: null, hitRate: null })
    expect(response.cost).toEqual({ status: "NOT_CONFIGURED" })
  })
})
