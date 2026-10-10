import { afterEach, describe, expect, it } from "vitest"
import { setModelProfilesForTests } from "./model-registry.js"
import { escalateRoute, resolveRoute, targetTier } from "./route-policy.js"
import { hasProviderAdapter, providerAdapterFor, registerProviderAdapter, type ProviderAdapter } from "./provider-adapter.js"
import type { ModelProfile } from "./model-profile.js"

const profile = (overrides: Partial<ModelProfile>): ModelProfile => ({ id: "p", provider: "GEMINI", model: "m", tier: "BASIC", contextWindow: 100_000, maxOutput: 8_000, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: true, enabled: true, ...overrides })

afterEach(() => setModelProfilesForTests(null))

describe("model routing — política determinística (nunca um LLM escolhe o LLM)", () => {
  it("modo CURRENT espelha a V1.1: function calling/orquestrador no STANDARD, análise semântica e síntese do Agent no BASIC", () => {
    expect(resolveRoute({ purpose: "PLANNING", phase: "PLANNING" }, "CURRENT")).toMatchObject({ tier: "STANDARD", profile: { model: "gemini-3.8-flash" }, mode: "CURRENT", escalated: false, fallback: false })
    expect(resolveRoute({ purpose: "ANALYZE_INTERACTIONS", phase: "SEMANTIC_ANALYSIS" }, "CURRENT")).toMatchObject({ tier: "BASIC", profile: { model: "gemini-3.1-flash-lite" } })
    expect(resolveRoute({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT").tier).toBe("BASIC")
    expect(resolveRoute({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT").tier).toBe("STANDARD")
  })

  it("modo EFFICIENCY: planejamento/roteamento no BASIC; análise e sínteses no STANDARD; DEEP por sinais (transcrições, multidomínio, conflito, saída complexa)", () => {
    expect(targetTier({ purpose: "PLANNING", phase: "PLANNING", toolSchemaCount: 10 }, "EFFICIENCY")).toMatchObject({ tier: "BASIC" })
    expect(targetTier({ purpose: "ORCHESTRATOR_ROUTING", phase: "PLANNING" }, "EFFICIENCY").tier).toBe("BASIC")
    expect(targetTier({ purpose: "ANALYZE_INTERACTIONS", phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: 2, transcriptChars: 5_000 }, "EFFICIENCY").tier).toBe("STANDARD")
    expect(targetTier({ purpose: "ANALYZE_INTERACTIONS", phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: 8, transcriptChars: 40_000 }, "EFFICIENCY").tier).toBe("DEEP")
    expect(targetTier({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "EFFICIENCY").tier).toBe("STANDARD")
    expect(targetTier({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", structuredOutputComplexity: "COMPLEX" }, "EFFICIENCY").tier).toBe("DEEP")
    expect(targetTier({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS", specialistCount: 1 }, "EFFICIENCY").tier).toBe("STANDARD")
    expect(targetTier({ purpose: "ORCHESTRATOR_SYNTHESIS", phase: "SYNTHESIS", specialistCount: 2, crossDomain: true }, "EFFICIENCY").tier).toBe("DEEP")
    // Retry de gating / parse anterior sobem um tier já na decisão.
    expect(targetTier({ purpose: "PLANNING", phase: "PLANNING", gatingRetry: true }, "EFFICIENCY").tier).toBe("STANDARD")
    const decision = resolveRoute({ purpose: "PLANNING", phase: "PLANNING", toolSchemaCount: 10 }, "EFFICIENCY")
    expect(decision.reason).toContain("10 tool schemas")
    expect(decision.reason).toContain("modo EFFICIENCY")
  })

  it("capability check: perfil BASIC sem function calling/saída estruturada ou com janela pequena nunca é escolhido — sobe de tier com fallback registrado", () => {
    setModelProfilesForTests([
      profile({ id: "local-basic", provider: "LOCAL", model: "local-7b", tier: "BASIC", supportsTools: false, supportsStructuredOutput: false, contextWindow: 8_000 }),
      profile({ id: "std", provider: "GEMINI", model: "gemini-3.8-flash", tier: "STANDARD" }),
      profile({ id: "deep", provider: "GEMINI", model: "gemini-3.8-flash", tier: "DEEP" }),
    ])
    const planning = resolveRoute({ purpose: "PLANNING", phase: "PLANNING" }, "EFFICIENCY")
    expect(planning).toMatchObject({ tier: "STANDARD", fallback: true })
    expect(planning.reason).toContain("local-basic: não suporta function calling")
    const tooBig = resolveRoute({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS", estimatedInputTokens: 50_000 }, "CURRENT")
    expect(tooBig).toMatchObject({ tier: "STANDARD", fallback: true })
    setModelProfilesForTests([profile({ id: "only-basic", tier: "BASIC", supportsTools: false })])
    expect(() => resolveRoute({ purpose: "PLANNING", phase: "PLANNING" }, "CURRENT")).toThrow(/Nenhum perfil de modelo suporta/)
  })

  it("escalação de modelo por causa explícita (parse/gating) sobe um tier no modo EFFICIENCY; no CURRENT o retry fica no mesmo tier; no tier máximo mantém o perfil — nunca por erro de rede", () => {
    const current = resolveRoute({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT")
    expect(escalateRoute(current, "GATING_CORRECTION")).toMatchObject({ tier: "BASIC", escalated: false })
    expect(escalateRoute(current, "GATING_CORRECTION").reason).toContain("retry no mesmo tier")
    const basic = { ...current, mode: "EFFICIENCY" as const }
    const escalated = escalateRoute(basic, "GATING_CORRECTION")
    expect(escalated).toMatchObject({ tier: "STANDARD", escalated: true })
    expect(escalated.reason).toContain("escalado por gating_correction")
    const deep = escalateRoute(escalated, "PARSE_FAILURE")
    expect(deep.tier).toBe("DEEP")
    expect(escalateRoute(deep, "PARSE_FAILURE")).toMatchObject({ tier: "DEEP" })
    expect(escalateRoute(deep, "PARSE_FAILURE").reason).toContain("já no tier máximo")
  })

  it("adapters por provedor: registro e resolução pelo perfil; provedor sem adapter é erro explícito", () => {
    const fake: ProviderAdapter = { provider: "OPENAI", generate: async () => ({ kind: "text", text: "ok", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "gpt-x", provider: "OPENAI" }) }
    registerProviderAdapter(fake)
    expect(hasProviderAdapter("OPENAI")).toBe(true)
    expect(providerAdapterFor(profile({ provider: "OPENAI" }))).toBe(fake)
    expect(() => providerAdapterFor(profile({ provider: "XAI" }))).toThrow(/XAI não tem adapter/)
  })
})
