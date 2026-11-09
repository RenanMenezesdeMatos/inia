import { describe, expect, it } from "vitest"
import {
  AGGREGATION_STRATEGY_METADATA,
  INDICATOR_UNITS,
  changedSemanticFields,
  checkComponentCoherence,
  componentValueScale,
  componentsNotDefinedMessage,
  componentsProblem,
  describeAggregationStrategy,
  formatIndicatorValue,
  indicatorDefinitionInputSchema,
  normalizeIndicatorCode,
  unitValueProblem,
  validateIndicatorDefinition,
  valueFromComponents,
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

  it("valor por componentes: o fator é da ESTRATÉGIA (Taxa × 100, Média ponderada × 1), nunca da unidade; as demais não usam componentes", () => {
    expect(componentValueScale("RATE")).toBe(100)
    expect(componentValueScale("WEIGHTED_AVERAGE")).toBe(1)
    for (const kind of ["AVERAGE", "SUM", "LATEST"] as const) {
      expect(componentValueScale(kind)).toBeNull()
      expect(valueFromComponents(kind, 10, 2)).toBeNull()
    }
    expect(valueFromComponents("RATE", 17, 20)).toBe(85)
    // Média ponderada de notas em % (unidade PERCENT): Σ notas ÷ Σ avaliações, sem × 100.
    expect(valueFromComponents("WEIGHTED_AVERAGE", 553.5, 6)).toBe(92.25)
    expect(valueFromComponents("WEIGHTED_AVERAGE", 9500, 0)).toBeNull()
  })

  it("coerência valor × componentes tolera arredondamento (0,1; 1%; meia unidade da casa informada) e nunca corrige", () => {
    expect(checkComponentCoherence("RATE", 85, 17, 20)).toEqual({ expected: 85, tolerance: 0.85, coherent: true })
    expect(checkComponentCoherence("RATE", 90, 9, 20)?.coherent).toBe(false)
    // Taxa informada sem casas (2) para 12 ÷ 500 = 2,4%: arredondamento da fonte, aceito.
    expect(checkComponentCoherence("RATE", 2, 12, 500)).toMatchObject({ tolerance: 0.5, coherent: true })
    // Com uma casa (2,1) a mesma conta não confere: 2,4 está fora de ±0,1.
    expect(checkComponentCoherence("RATE", 2.1, 12, 500)?.coherent).toBe(false)
    expect(checkComponentCoherence("WEIGHTED_AVERAGE", 468, 9360, 20)?.coherent).toBe(true)
    expect(checkComponentCoherence("WEIGHTED_AVERAGE", 468, 9900, 20)?.coherent).toBe(false)
    expect(checkComponentCoherence("WEIGHTED_AVERAGE", 4.15, 249, 60)?.coherent).toBe(true)
    // Numerador negativo é válido numa média ponderada (pontos); o sinal precisa conferir.
    expect(checkComponentCoherence("WEIGHTED_AVERAGE", -12.5, -500, 40)?.coherent).toBe(true)
    expect(checkComponentCoherence("WEIGHTED_AVERAGE", 12.5, -500, 40)?.coherent).toBe(false)
    expect(checkComponentCoherence("SUM", 10, 10, 1)).toBeNull()
    expect(checkComponentCoherence("RATE", 0, 0, 0)).toBeNull()
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

describe("regra única de numerador e denominador em uma linha", () => {
  it("estratégia sem componentes recusa os dois; com componentes confere; denominador zero não é incoerência", () => {
    for (const kind of ["SUM", "AVERAGE", "LATEST"] as const) expect(componentsProblem(kind, 450, 8100, 18)).toEqual({ kind: "NOT_DEFINED_BY_COMPONENTS" })
    expect(componentsProblem("WEIGHTED_AVERAGE", 450, 8100, 18)).toBeNull()
    expect(componentsProblem("RATE", 85, 17, 20)).toBeNull()
    expect(componentsProblem("RATE", 0, 0, 0)).toBeNull()
    expect(componentsProblem("WEIGHTED_AVERAGE", 900, 8100, 18)).toEqual({ kind: "INCOHERENT", expected: 450, tolerance: 4.5 })
  })

  it("a mensagem fala da estratégia e do indicador", () => {
    expect(componentsNotDefinedMessage("SUM", "QUALQUER")).toBe('A estratégia "Soma" do indicador "QUALQUER" não define o valor por numerador e denominador. Envie a linha sem os componentes ou revise a estratégia no catálogo — nada foi gravado.')
  })

  it("faixa de valor vem da unidade", () => {
    expect(unitValueProblem("PERCENT", 100)).toBeNull()
    expect(unitValueProblem("PERCENT", 100.1)).toMatch(/entre 0 e 100/)
    expect(unitValueProblem("PERCENT", -1)).toMatch(/entre 0 e 100/)
    expect(unitValueProblem("SECONDS", -1)).toMatch(/negativo/)
    expect(unitValueProblem("COUNT", -1)).toBeNull()
  })
})
