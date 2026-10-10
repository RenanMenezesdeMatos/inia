import { describe, expect, it } from "vitest"

import { formatCostByCurrency, formatMoney, formatTokens, moneyEntries, normalizeDecimalInput, NO_KNOWN_COST_LABEL } from "./ai-format"

describe("ai-format", () => {
  it("formata por moeda sem somar nem converter; moeda desconhecida pelo Intl cai para o código", () => {
    expect(formatMoney("1.5", "USD")).toContain("US$")
    expect(formatMoney("2", "BRL")).toContain("R$")
    expect(formatMoney("0.000123", "USD")).toContain("0,000123")
    expect(formatMoney("10", "XX1")).toBe("XX1 10,00")
    expect(moneyEntries({ USD: "1", BRL: "2" }).map((entry) => entry.currency)).toEqual(["BRL", "USD"])
    expect(formatCostByCurrency({ USD: "1", BRL: "2" })).toMatch(/R\$.*·.*US\$/)
  })

  it("sem custo = rótulo explícito; token null = '—' (nunca 0)", () => {
    expect(formatCostByCurrency({})).toBe(NO_KNOWN_COST_LABEL)
    expect(formatTokens(null)).toBe("—")
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(1234567)).toBe("1.234.567")
  })

  it("decimal digitado com vírgula vira o formato do backend", () => {
    expect(normalizeDecimalInput(" 0,30 ")).toBe("0.30")
  })
})
