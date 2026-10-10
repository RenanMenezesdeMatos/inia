import { describe, expect, it } from "vitest"
import { computeCallCost, estimateInputCost, isZeroPricing, pricingAt, validatePricingInput, type AiPricingVersion } from "./ai-pricing.js"
import { costOfTokens, formatDecimal, parseDecimal } from "./decimal.js"
import { evaluateBudget, validateBudgetInput, type AiBudget } from "./ai-budget.js"

const usage = (overrides: Partial<{ promptTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null }> = {}) => ({ promptTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000, cachedInputTokens: null, reasoningTokens: null, ...overrides })

const version = (overrides: Partial<AiPricingVersion> = {}): AiPricingVersion => ({ id: "p1", modelId: "m1", currency: "USD", inputPerMillion: "0.30", outputPerMillion: "2.50", cachedInputPerMillion: "0.03", reasoningPerMillion: null, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, source: "MANUAL", note: null, ...overrides })

describe("decimal — dinheiro sem float (§94)", () => {
  it("0.1 + 0.2 é exatamente 0.3 (o que float não garante)", () => {
    expect(formatDecimal(parseDecimal("0.1") + parseDecimal("0.2"))).toBe("0.3")
  })
  it("tokens × preço por milhão é exato na 12ª casa", () => {
    expect(formatDecimal(costOfTokens(1, parseDecimal("0.30")))).toBe("0.0000003")
    expect(formatDecimal(costOfTokens(333_333, parseDecimal("3")))).toBe("0.999999")
    expect(formatDecimal(costOfTokens(7, parseDecimal("0.000001")))).toBe("0.000000000007")
  })
  it("recusa valor não decimal", () => {
    expect(() => parseDecimal("1e-3")).toThrow()
    expect(() => parseDecimal("abc")).toThrow()
  })
})

describe("custo por chamada = uso real × preço configurado (§40, §99)", () => {
  it("input + output", () => {
    const cost = computeCallCost(usage(), version())
    expect(cost).toMatchObject({ status: "ESTIMATED", currency: "USD", amount: "1.55", pricingId: "p1", breakdown: { input: "0.3", cachedInput: "0", output: "1.25", reasoning: "0" } })
  })
  it("entrada cacheada usa a tarifa cacheada; sem tarifa cacheada cai na de entrada", () => {
    expect(computeCallCost(usage({ cachedInputTokens: 600_000 }), version())).toMatchObject({ amount: "1.388", breakdown: { input: "0.12", cachedInput: "0.018" } })
    expect(computeCallCost(usage({ cachedInputTokens: 600_000 }), version({ cachedInputPerMillion: null }))).toMatchObject({ amount: "1.55" })
  })
  it("raciocínio só é cobrado à parte quando a tabela o tarifa (senão já está na saída)", () => {
    expect(computeCallCost(usage({ reasoningTokens: 100_000 }), version())).toMatchObject({ amount: "1.55" })
    expect(computeCallCost(usage({ reasoningTokens: 100_000 }), version({ reasoningPerMillion: "3.5" }))).toMatchObject({ amount: "1.9", breakdown: { reasoning: "0.35" } })
  })
  it("uso não informado = UNKNOWN (nunca contagem fabricada — §77)", () => {
    expect(computeCallCost(usage({ promptTokens: null }), version())).toEqual({ status: "UNKNOWN", reason: "NO_USAGE", currency: "USD", amount: null, pricingId: "p1" })
    expect(computeCallCost(usage({ outputTokens: null }), version()).status).toBe("UNKNOWN")
  })
  it("sem preço vigente = UNKNOWN/NO_PRICING", () => {
    expect(computeCallCost(usage(), null)).toMatchObject({ status: "UNKNOWN", reason: "NO_PRICING" })
  })
  it("modelo local com tabela zerada: custo de API = 0 (não \"grátis\" — computação não medida fica a cargo da UI)", () => {
    const zero = version({ inputPerMillion: "0", outputPerMillion: "0", cachedInputPerMillion: null })
    expect(isZeroPricing(zero)).toBe(true)
    expect(computeCallCost(usage(), zero)).toMatchObject({ status: "ESTIMATED", amount: "0" })
  })
})

describe("preço versionado por vigência (§42)", () => {
  const old = version({ id: "old", inputPerMillion: "1", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: new Date("2026-06-01T00:00:00Z") })
  const current = version({ id: "new", inputPerMillion: "0.5", effectiveFrom: new Date("2026-06-01T00:00:00Z") })
  it("a chamada usa o preço vigente no seu instante — custo antigo continua reproduzível", () => {
    expect(pricingAt([current, old], new Date("2026-03-10T12:00:00Z"))?.id).toBe("old")
    expect(pricingAt([current, old], new Date("2026-06-01T00:00:00Z"))?.id).toBe("new")
    expect(pricingAt([current, old], new Date("2025-12-31T23:59:59Z"))).toBeNull()
    expect(computeCallCost(usage({ outputTokens: 0 }), pricingAt([current, old], new Date("2026-03-10T12:00:00Z")))).toMatchObject({ amount: "1", pricingId: "old" })
  })
  it("valida moeda e decimais não negativos", () => {
    expect(validatePricingInput({ currency: "usd", inputPerMillion: "-1", outputPerMillion: "x", effectiveFrom: new Date() })).toHaveLength(3)
    expect(validatePricingInput({ currency: "BRL", inputPerMillion: "1.5", outputPerMillion: "3", effectiveFrom: new Date() })).toEqual([])
  })
  it("estimativa antes da chamada só considera a entrada (saída é variável — limitação documentada)", () => {
    expect(formatDecimal(estimateInputCost(2_000_000, version())!)).toBe("0.6")
    expect(estimateInputCost(10, null)).toBeNull()
  })
})

describe("orçamento com moeda explícita (§49–§52, §96)", () => {
  const budget: AiBudget = { id: "b1", scope: "GLOBAL", scopeKey: null, currency: "USD", monthlyAmount: "100", warningThresholds: [70, 90, 100], hardLimit: true, enabled: true }
  it("limiares 70/90/100 e hard limit", () => {
    expect(evaluateBudget(budget, { USD: "69.99" }, 0)).toMatchObject({ status: "OK", reachedThresholds: [], hardLimitReached: false })
    expect(evaluateBudget(budget, { USD: "90" }, 0)).toMatchObject({ status: "WARNING", reachedThresholds: [70, 90], hardLimitReached: false })
    expect(evaluateBudget(budget, { USD: "100" }, 0)).toMatchObject({ status: "EXCEEDED", reachedThresholds: [70, 90, 100], hardLimitReached: true })
    expect(evaluateBudget({ ...budget, hardLimit: false }, { USD: "150" }, 0).hardLimitReached).toBe(false)
  })
  it("gasto em outra moeda NÃO é somado nem convertido — aparece como não comparável", () => {
    const evaluation = evaluateBudget(budget, { BRL: "5000", USD: "10" }, 2)
    expect(evaluation).toMatchObject({ spent: "10", status: "OK", notComparableCurrencies: ["BRL"], unknownCostCalls: 2 })
  })
  it("orçamento em BRL com gasto só em USD: nada é comparado nem convertido — o hard limit em BRL não dispara por gasto em USD", () => {
    const evaluation = evaluateBudget({ ...budget, currency: "BRL", monthlyAmount: "1" }, { USD: "999" }, 0)
    expect(evaluation).toMatchObject({ spent: "0", currency: "BRL", status: "OK", percent: 0, hardLimitReached: false, notComparableCurrencies: ["USD"] })
  })
  it("validação de escopo e valor", () => {
    expect(validateBudgetInput({ scope: "GLOBAL", scopeKey: "X", currency: "USD", monthlyAmount: "10", warningThresholds: [70] })).toHaveLength(1)
    expect(validateBudgetInput({ scope: "USE_CASE", scopeKey: null, currency: "USD", monthlyAmount: "0", warningThresholds: [150] })).toHaveLength(3)
  })
})
