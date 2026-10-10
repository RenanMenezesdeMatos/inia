import { describe, expect, it } from "vitest"
import { addTokens, EMPTY_TOKENS, evaluateTokenBudget } from "./token-budget.js"

describe("token budget (observabilidade, sem teto cego)", () => {
  it("soma o informado; campo fica null enquanto nenhuma request o informou", () => {
    const a = addTokens(EMPTY_TOKENS, { promptTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: null, reasoningTokens: null })
    const b = addTokens(a, { promptTokens: 200, outputTokens: 20, totalTokens: 220, cachedInputTokens: 50, reasoningTokens: null })
    expect(b).toEqual({ input: 300, cached: 50, output: 30, reasoning: null, total: 330 })
  })

  it("avalia limiares (0/null = desligado); sem contagem = NOT_INFORMED", () => {
    expect(evaluateTokenBudget({ input: 70000, cached: null, output: 500, reasoning: null, total: 70500 }, { total: 60000, input: 50000, output: 0 })).toEqual({ status: "WARNING", thresholds: { total: 60000, input: 50000, output: null }, exceeded: ["total", "input"] })
    expect(evaluateTokenBudget({ input: 1000, cached: null, output: 500, reasoning: null, total: 1500 }, { total: 60000, input: 50000, output: 8000 }).status).toBe("OK")
    expect(evaluateTokenBudget(EMPTY_TOKENS, { total: 60000, input: null, output: null }).status).toBe("NOT_INFORMED")
  })
})
