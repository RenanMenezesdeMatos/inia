import { describe, expect, it } from "vitest"
import { allowedMeasurementAggregations, combineWindowComponents, defaultMeasurementAggregation, isMeasurementAggregationAllowed, type RawWindowComponents } from "./operational-aggregation.js"

const raw = (overrides: Partial<RawWindowComponents>): RawWindowComponents => ({
  sampleCount: 0, daysWithData: 0, avg: null, min: null, max: null, sum: null, latest: null, weightedSum: null, weightTotal: null, numeratorSum: null, denominatorSum: null, rowsWithComponents: 0, sampleTotal: null,
  ...overrides,
})

describe("agregação operacional — semântica por indicador", () => {
  it("TMA semanal NUNCA é média de médias: Σ tempo ÷ Σ contatos (600s×10 e 400s×100 → 418,18, não 500)", () => {
    const result = combineWindowComponents(raw({ sampleCount: 2, daysWithData: 2, avg: 500, numeratorSum: 6000 + 40000, denominatorSum: 110, rowsWithComponents: 2, weightedSum: 46000, weightTotal: 110 }), "WEIGHTED_AVERAGE", "WEIGHTED_AVERAGE")
    expect(result.value).toBe(418.18)
    expect(result.method).toContain("÷")
  })

  it("taxa = Σ ocorrências ÷ Σ elegíveis × 100 (3/20 e 30/80 → 33%, não a média 32,5%)", () => {
    const result = combineWindowComponents(raw({ sampleCount: 2, daysWithData: 2, avg: 26.25, numeratorSum: 33, denominatorSum: 100, rowsWithComponents: 2 }), "WEIGHTED_AVERAGE", "RATE")
    expect(result.value).toBe(33)
  })

  it("linhas legadas sem componentes caem pra Σ(valor×peso)÷Σpeso com peso 1 (= média simples), nunca inventam volume", () => {
    const result = combineWindowComponents(raw({ sampleCount: 2, daysWithData: 2, avg: 5, weightedSum: 10, weightTotal: 2, rowsWithComponents: 0 }), "WEIGHTED_AVERAGE", "WEIGHTED_AVERAGE")
    expect(result.value).toBe(5)
  })

  it("janela vazia = SEM DADOS (null), nunca zero; denominador zero também", () => {
    expect(combineWindowComponents(raw({}), "WEIGHTED_AVERAGE", "RATE").value).toBeNull()
    expect(combineWindowComponents(raw({ sampleCount: 1, daysWithData: 1, numeratorSum: 0, denominatorSum: 0, rowsWithComponents: 1 }), "WEIGHTED_AVERAGE", "RATE").value).toBeNull()
  })

  it("backlog usa o último snapshot, soma usa Σ, mínimo/máximo/contagem valem pra todos", () => {
    const components = raw({ sampleCount: 3, daysWithData: 3, avg: 200, min: 150, max: 260, sum: 600, latest: 180 })
    expect(combineWindowComponents(components, "LATEST", "LATEST").value).toBe(180)
    expect(combineWindowComponents(components, "SUM", "SUM").value).toBe(600)
    expect(combineWindowComponents(components, "MINIMUM", "LATEST").value).toBe(150)
    expect(combineWindowComponents(components, "MAXIMUM", "LATEST").value).toBe(260)
    expect(combineWindowComponents(components, "COUNT", "LATEST").value).toBe(3)
  })

  it("catálogo de agregações permitidas: SUM de TMA e média simples de taxa não existem; padrão = agregação natural", () => {
    expect(isMeasurementAggregationAllowed("WEIGHTED_AVERAGE", "SUM")).toBe(false)
    expect(isMeasurementAggregationAllowed("RATE", "AVERAGE")).toBe(false)
    expect(isMeasurementAggregationAllowed("WEIGHTED_AVERAGE", "WEIGHTED_AVERAGE")).toBe(true)
    expect(allowedMeasurementAggregations("LATEST")).toContain("LATEST")
    expect(defaultMeasurementAggregation("RATE")).toBe("WEIGHTED_AVERAGE")
    expect(defaultMeasurementAggregation("LATEST")).toBe("LATEST")
  })
})
