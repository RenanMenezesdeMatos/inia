import { describe, expect, it } from "vitest"
import {
  AGGREGATION_STRATEGY_METADATA,
  INDICATOR_UNITS,
  changedSemanticFields,
  describeAggregationStrategy,
  formatIndicatorValue,
  indicatorDefinitionInputSchema,
  normalizeIndicatorCode,
  validateIndicatorDefinition,
} from "./indicator-definition.js"
import { OPERATIONAL_AGGREGATION_KINDS } from "./operational-aggregation.js"

const base = () => indicatorDefinitionInputSchema.parse({ code: "digital_resolution_rate", name: "Taxa de Resolução Digital", unit: "PERCENT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "RATE" })

describe("definição de indicador — catálogo metadata-driven", () => {
  it("normaliza o código (maiúsculo) e aceita a configuração canônica do pedido (PERCENT/HIGHER/operacional/RATE)", () => {
    const valid = validateIndicatorDefinition(base())
    expect(valid.code).toBe("DIGITAL_RESOLUTION_RATE")
    expect(normalizeIndicatorCode("  tma ")).toBe("TMA")
  })

  it("rejeita código fora do padrão (espaços, acento, começando por número)", () => {
    for (const code of ["taxa digital", "1RATE", "TAXA-DIGITAL", "Ç"]) {
      expect(() => validateIndicatorDefinition({ ...base(), code })).toThrow(/código/i)
    }
  })

  it("Taxa (RATE) só em percentual — a engine multiplica Σ ocorrências ÷ Σ elegíveis por 100", () => {
    expect(() => validateIndicatorDefinition({ ...base(), unit: "SECONDS" })).toThrow(/Taxa.*Percentual/)
    expect(AGGREGATION_STRATEGY_METADATA.RATE.allowedUnits).toEqual(["PERCENT"])
    for (const kind of OPERATIONAL_AGGREGATION_KINDS.filter((item) => item !== "RATE")) expect(AGGREGATION_STRATEGY_METADATA[kind].allowedUnits).toBeNull()
  })

  it("amostra/cobertura mínimas só com medição operacional; um indicador precisa de ao menos uma capacidade", () => {
    expect(() => validateIndicatorDefinition({ ...base(), dailySupported: false, minimumSampleSize: 5 })).toThrow(/medição operacional/)
    expect(() => validateIndicatorDefinition({ ...base(), dailySupported: false, officialClosureSupported: false })).toThrow(/ao menos uma capacidade/)
    expect(validateIndicatorDefinition({ ...base(), minimumSampleSize: 5, minimumCoverage: 0.6 }).minimumCoverage).toBe(0.6)
  })

  it("estratégias declaram componentes genéricos da medição (contrato da ingestão futura) — nunca colunas por indicador", () => {
    expect(AGGREGATION_STRATEGY_METADATA.RATE.requiredComponents).toEqual(["value", "numerator", "denominator"])
    expect(AGGREGATION_STRATEGY_METADATA.WEIGHTED_AVERAGE.requiredComponents).toEqual(["value", "numerator", "denominator"])
    expect(AGGREGATION_STRATEGY_METADATA.LATEST.requiredComponents).toEqual(["value"])
    expect(AGGREGATION_STRATEGY_METADATA.SUM.requiredComponents).toEqual(["value"])
    expect(AGGREGATION_STRATEGY_METADATA.AVERAGE.requiredComponents).toEqual(["value"])
    for (const kind of OPERATIONAL_AGGREGATION_KINDS) expect(AGGREGATION_STRATEGY_METADATA[kind].help).not.toMatch(/TMA|FCR|Backlog|Monitoria/)
  })

  it("texto funcional do cálculo deriva de estratégia + unidade (TMA, Monitoria, FCR e Backlog são só dados)", () => {
    expect(describeAggregationStrategy("WEIGHTED_AVERAGE", "SECONDS")).toEqual({ label: "Tempo consolidado dos atendimentos", description: "Tempo total ÷ total de atendimentos do período." })
    expect(describeAggregationStrategy("WEIGHTED_AVERAGE", "PERCENT").label).toBe("Média das avaliações realizadas")
    expect(describeAggregationStrategy("WEIGHTED_AVERAGE", "STARS").label).toBe("Média das avaliações realizadas")
    expect(describeAggregationStrategy("WEIGHTED_AVERAGE", "COUNT").label).toBe("Média ponderada pelo volume")
    expect(describeAggregationStrategy("RATE", "PERCENT").label).toBe("Taxa consolidada do período")
    expect(describeAggregationStrategy("LATEST", "COUNT").label).toBe("Último valor registrado")
    expect(describeAggregationStrategy("SUM", "COUNT").label).toBe("Soma do período")
    expect(describeAggregationStrategy("AVERAGE", "CASES_PER_DAY").label).toBe("Média dos períodos")
  })

  it("formata pela UNIDADE, nunca pelo código", () => {
    expect(formatIndicatorValue(480, "SECONDS")).toBe("480 s")
    expect(formatIndicatorValue(87.5, "PERCENT")).toBe("87,5%")
    expect(formatIndicatorValue(4.6, "STARS")).toBe("4,6 ★")
    expect(formatIndicatorValue(35, "COUNT")).toBe("35")
    expect(formatIndicatorValue(12, "UNKNOWN_UNIT")).toBe("12 UNKNOWN_UNIT")
    expect(INDICATOR_UNITS).toContain("COUNT")
  })

  it("campos semânticos: código, unidade, direção e estratégia — nome não é", () => {
    const current = base()
    expect(changedSemanticFields(current, { ...current, name: "Outro nome" })).toEqual([])
    expect(changedSemanticFields(current, { ...current, unit: "COUNT", desiredDirection: "LOWER" })).toEqual(["unit", "desiredDirection"])
  })
})
