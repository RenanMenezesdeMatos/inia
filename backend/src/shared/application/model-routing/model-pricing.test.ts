import { afterEach, describe, expect, it } from "vitest"
import { addCost, estimateCost, pricingFor, setModelPricingForTests } from "./model-pricing.js"

// V1.3 — §28/29/57: pricing só por configuração; custo sempre ESTIMATED_PROVIDER_COST; ausente = NOT_CONFIGURED.
describe("model pricing configurável e custo estimado", () => {
  afterEach(() => setModelPricingForTests(null))

  it("sem pricing configurado o custo é NOT_CONFIGURED — nunca um número inventado", () => {
    setModelPricingForTests([])
    expect(pricingFor("gemini-flash", "gemini-3.8-flash")).toBeNull()
    expect(estimateCost({ promptTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 500, totalTokens: 10_500, reasoningTokens: 100 }, null)).toEqual({ status: "NOT_CONFIGURED" })
  })

  it("cached usa a tarifa cacheada, uncached usa input, output e reasoning (só quando configurado) — tudo por milhão", () => {
    setModelPricingForTests([{ model: "gemini-3.8-flash", inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 4, reasoningPerMillion: 4, currency: "USD" }])
    const pricing = pricingFor(null, "gemini-3.8-flash")
    const cost = estimateCost({ promptTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 250_000, totalTokens: 0, reasoningTokens: 100_000 }, pricing)
    expect(cost).toEqual({ status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.5, cachedInputCost: 0.05, outputCost: 1, reasoningCost: 0.4, totalEstimatedCost: 1.95 })
  })

  it("sem tarifa de reasoning o raciocínio não é cobrado à parte; sem tarifa cacheada a entrada cacheada vale como input; pricing por id de perfil tem precedência", () => {
    setModelPricingForTests([{ model: "m", inputPerMillion: 2, cachedInputPerMillion: null, outputPerMillion: 1, reasoningPerMillion: null, currency: "BRL" }, { profileId: "p1", model: "m", inputPerMillion: 10, cachedInputPerMillion: null, outputPerMillion: 1, reasoningPerMillion: null, currency: "BRL" }])
    expect(pricingFor("p1", "m")?.inputPerMillion).toBe(10)
    const cost = estimateCost({ promptTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0, totalTokens: 0, reasoningTokens: 1_000_000 }, pricingFor(null, "m"))
    expect(cost).toMatchObject({ inputCost: 1, cachedInputCost: 1, reasoningCost: 0, totalEstimatedCost: 2, currency: "BRL" })
    expect(addCost({ status: "NOT_CONFIGURED" }, cost)).toEqual(cost)
    expect(addCost(cost, cost)).toMatchObject({ totalEstimatedCost: 4 })
  })
})
