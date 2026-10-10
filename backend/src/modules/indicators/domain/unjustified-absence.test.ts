import { describe, expect, it } from "vitest"
import { applyZeroContribution, combineWindowComponents, zeroContributionSupported, type RawWindowComponents } from "./operational-aggregation.js"
import { indicatorDefinitionInputSchema, validateIndicatorDefinition } from "./indicator-definition.js"

const raw: RawWindowComponents = { sampleCount: 3, daysWithData: 3, avg: 10, min: 8, max: 12, sum: 30, latest: 12, weightedSum: null, weightTotal: null, numeratorSum: null, denominatorSum: null, rowsWithComponents: 0, sampleTotal: null }
const empty: RawWindowComponents = { sampleCount: 0, daysWithData: 0, avg: null, min: null, max: null, sum: null, latest: null, weightedSum: null, weightTotal: null, numeratorSum: null, denominatorSum: null, rowsWithComponents: 0, sampleTotal: null }

describe("falta injustificada — política por indicador (metadata, nunca código)", () => {
  it("ZERO_CONTRIBUTION só para soma/média de contagens: Produção sim, TMA/Qualidade/taxa/snapshot não", () => {
    expect(zeroContributionSupported("SUM", "COUNT")).toBe(true)
    expect(zeroContributionSupported("AVERAGE", "CASES_PER_DAY")).toBe(true)
    expect(zeroContributionSupported("AVERAGE", "SECONDS")).toBe(false)
    expect(zeroContributionSupported("AVERAGE", "POINTS")).toBe(false)
    expect(zeroContributionSupported("RATE", "PERCENT")).toBe(false)
    expect(zeroContributionSupported("WEIGHTED_AVERAGE", "SECONDS")).toBe(false)
    expect(zeroContributionSupported("LATEST", "COUNT")).toBe(false)
  })

  it("validação bloqueia combinações absurdas (TMA com contribuição zero) e exige medição operacional", () => {
    const base = { code: "PRODUCAO", name: "Produção", unit: "COUNT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "SUM", officialClosureSupported: false, unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" }
    expect(() => validateIndicatorDefinition(indicatorDefinitionInputSchema.parse(base))).not.toThrow()
    expect(() => validateIndicatorDefinition(indicatorDefinitionInputSchema.parse({ ...base, code: "TMA", unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE" }))).toThrow(/Contribuição zero/)
    expect(() => validateIndicatorDefinition(indicatorDefinitionInputSchema.parse({ ...base, dailySupported: false, officialClosureSupported: true }))).toThrow(/medição operacional/)
    expect(() => validateIndicatorDefinition(indicatorDefinitionInputSchema.parse({ ...base, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: { lagDays: 2, availableByLocalTime: "08:00" } }))).not.toThrow()
    expect(indicatorDefinitionInputSchema.parse({ ...base, unjustifiedAbsencePolicy: undefined }).unjustifiedAbsencePolicy).toBe("NO_SAMPLE")
  })

  it("contribuição zero na SOMA: 2 dias de falta → soma inalterada, 5 períodos, 5 dias com dado (cobertura conhecida, não 'integração perdeu dado')", () => {
    const adjusted = applyZeroContribution(raw, 2)
    expect(adjusted).toMatchObject({ sampleCount: 5, daysWithData: 5, sum: 30, min: 0, max: 12 })
    expect(combineWindowComponents(adjusted, "SUM", "SUM")).toMatchObject({ value: 30, sampleCount: 5, daysWithData: 5 })
    expect(combineWindowComponents(adjusted, "AVERAGE", "SUM")).toMatchObject({ value: 6 })
  })

  it("só faltas, nenhuma medição: Produção = 0 (resultado conhecido), nunca null", () => {
    const adjusted = applyZeroContribution(empty, 3)
    expect(combineWindowComponents(adjusted, "SUM", "SUM")).toMatchObject({ value: 0, sampleCount: 3, daysWithData: 3 })
    expect(combineWindowComponents(adjusted, "AVERAGE", "AVERAGE")).toMatchObject({ value: 0 })
  })

  it("zero dias → componentes intactos (NO_SAMPLE nunca chama isto: sem medição = SEM DADOS)", () => {
    expect(applyZeroContribution(raw, 0)).toBe(raw)
    expect(combineWindowComponents(empty, "WEIGHTED_AVERAGE", "WEIGHTED_AVERAGE").value).toBeNull()
  })
})
