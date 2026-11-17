import { describe, expect, it } from "vitest"
import { computeCallCost, type AiPricingVersion } from "./ai-pricing.js"
import { embeddingUsageOf } from "./ai-embedding.js"

/** RAG-04 (auditoria run-4): embedding sem tokens informados (Gemini) ficava com custo UNKNOWN e nenhum orçamento limitava o gasto. */
const pricing = { id: "p1", currency: "USD", inputPerMillion: "0.15", cachedInputPerMillion: null, outputPerMillion: "0", reasoningPerMillion: null } as unknown as AiPricingVersion
const NONE = { promptTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null }

describe("uso de uma chamada de embedding", () => {
  it("provider sem tokens (Gemini): entrada estimada pelo texto e saída 0 → custo ESTIMATED pela tabela", () => {
    const usage = embeddingUsageOf(NONE, ["a".repeat(4_000), "b".repeat(4_000)])
    expect(usage).toEqual({ promptTokens: 2_000, outputTokens: 0, totalTokens: 2_000, cachedInputTokens: null, reasoningTokens: null })
    expect(computeCallCost(usage, pricing)).toMatchObject({ status: "ESTIMATED", currency: "USD", amount: expect.stringMatching(/^0\.0003/) })
    expect(computeCallCost(NONE, pricing).status).toBe("UNKNOWN")
  })

  it("provider que informa a entrada (OpenAI): o número informado vale; saída ausente = 0 (embedding não gera texto)", () => {
    const usage = embeddingUsageOf({ ...NONE, promptTokens: 120, totalTokens: 120 }, ["qualquer"])
    expect(usage).toMatchObject({ promptTokens: 120, outputTokens: 0, totalTokens: 120 })
    expect(computeCallCost(usage, pricing).status).toBe("ESTIMATED")
  })

  it("sem tabela de preço continua UNKNOWN (nunca custo inventado)", () => {
    expect(computeCallCost(embeddingUsageOf(NONE, ["texto"]), null)).toMatchObject({ status: "UNKNOWN", reason: "NO_PRICING" })
  })
})
