import { describe, expect, it } from "vitest"
import { buildIndicatorAnalysisConfig } from "./node-config-panel"
import { describeNodeConfig } from "./node-visuals"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

type ConditionConfig = Extract<FlowNode, { type: "condition" }>["config"]

const emptyCondition: ConditionConfig = { comparator: "EQUALS", thresholdNumeric: null, thresholdBoolean: null }

function conditionNode(config: ConditionConfig): FlowNode {
  return { id: "cond-1", type: "condition", label: "Condição", position: { x: 0, y: 0 }, config }
}

describe("buildIndicatorAnalysisConfig — revalida os campos dependentes ao trocar 'O que deseja analisar?'", () => {
  it("Valor do indicador (Últimos 3 meses fechados) -> Atingimento: preserva o período (count=3) e o indicador, nunca converte pra dias", () => {
    const value: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    }
    const next = buildIndicatorAnalysisConfig("ACHIEVEMENT", value)
    expect(next.historicalQuery).toMatchObject({
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      source: "INDICATOR_ACHIEVEMENT",
      period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
    })
    // A intenção do admin ("3 períodos fechados anteriores") sobrevive — nunca "3 fechamentos"
    // virando "90 dias" ou qualquer outra aproximação por calendário.
    expect(next.historicalQuery?.period?.kind).not.toBe("ROLLING_DAYS")
    expect(next.comparator).toBe("LT")
    expect(next.thresholdNumeric).toBe(3.3)
  })

  it("Atingimento do indicador (Últimos 3 fechamentos) -> Valor do indicador: preserva o período (count=3), remove a origem", () => {
    const achievement: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: 90,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "QUALIDADE",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
      },
    }
    const next = buildIndicatorAnalysisConfig("VALUE", achievement)
    expect(next.historicalQuery?.source).toBeUndefined()
    expect(next.historicalQuery?.indicatorCode).toBe("QUALIDADE")
    expect(next.historicalQuery?.period).toEqual({ kind: "CLOSURES", unit: "MONTH", count: 3 })
    expect(next.historicalQuery?.aggregation).toBe("AVERAGE")
  })

  it("Quantidade de ocorrências (COUNT) -> Atingimento: agregação incompatível cai pra Média (default oficial já existente na aplicação, nunca uma regra nova) e reseta comparação externa", () => {
    // Valor do indicador recém-selecionado começa em Quantidade de ocorrências (default de sempre).
    const count = buildIndicatorAnalysisConfig("VALUE", emptyCondition)
    expect(count.historicalQuery?.aggregation).toBe("COUNT")

    const next = buildIndicatorAnalysisConfig("ACHIEVEMENT", count)
    expect(next.historicalQuery?.aggregation).toBe("AVERAGE")
    // Nunca inventa um valor de referência — exige nova seleção (thresholdNumeric null).
    expect(next.thresholdNumeric).toBeNull()
    expect(next.comparator).toBe("LT")
    // Campos exclusivos de Quantidade não sobrevivem escondidos pra uma origem que não conta.
    expect(next.historicalQuery?.comparator).toBeUndefined()
    expect(next.historicalQuery?.indicatorThreshold).toBeUndefined()
  })

  it("Média com Mínimo de medições (sem Meta) -> Atingimento: preserva minimumSampleSize (agregação compatível pras 3 origens)", () => {
    const media: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "NOTA_URA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 30 },
        minimumSampleSize: 3,
      },
    }
    const next = buildIndicatorAnalysisConfig("ACHIEVEMENT", media)
    expect(next.historicalQuery?.minimumSampleSize).toBe(3)
  })

  it("Média com Meta vigente -> Atingimento: Meta vigente é referência do VALOR DO INDICADOR — nunca sobrevive escondida quando a origem deixa de suportá-la, exige nova escolha", () => {
    const media: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } },
    }
    const next = buildIndicatorAnalysisConfig("ACHIEVEMENT", media)
    expect(next.historicalQuery?.compareTo).toBeUndefined()
    // Não inventa uma nova referência automaticamente — cai pra "Valor fixo" com valor vazio,
    // exigindo que o admin escolha de novo.
    expect(next.thresholdNumeric).toBeNull()
  })

  it("Média com Meta vigente -> Atingimento do PRV: mesma regra (PRV também não tem meta bruta pra comparar)", () => {
    const media: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: null,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } },
    }
    const next = buildIndicatorAnalysisConfig("PRV_ACHIEVEMENT", media)
    expect(next.historicalQuery?.compareTo).toBeUndefined()
  })

  it("Atingimento com Período anterior -> Valor do indicador: Período anterior é compatível pras 3 origens, sempre preservado (nunca confundido com Meta)", () => {
    const achievement: ConditionConfig = {
      comparator: "GT",
      thresholdNumeric: null,
      historicalQuery: {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "NOTA_URA",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "ROLLING_DAYS", days: 30 },
        compareTo: { kind: "PREVIOUS_PERIOD" },
      },
    }
    const next = buildIndicatorAnalysisConfig("VALUE", achievement)
    expect(next.historicalQuery?.compareTo).toEqual({ kind: "PREVIOUS_PERIOD" })
  })

  it("minimumSampleSize nunca sobrevive escondido quando a agregação precisa mudar pra Quantidade/Média forçada (só se aplica a Média/Mínimo/Máximo)", () => {
    const count = buildIndicatorAnalysisConfig("VALUE", emptyCondition)
    const next = buildIndicatorAnalysisConfig("ACHIEVEMENT", count)
    expect(next.historicalQuery?.minimumSampleSize).toBeUndefined()
  })

  it("Valor do indicador (numérico) -> Quartil do indicador: remove agregação/valor de referência/comparação, mostra só quartil-alvo", () => {
    const value = buildIndicatorAnalysisConfig("VALUE", emptyCondition)
    const next = buildIndicatorAnalysisConfig("QUARTILE", value)
    expect(next.performanceQuery).toEqual({ kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "" })
    expect(next.thresholdText).toBe("Q4")
    expect(next.historicalQuery).toBeUndefined()
  })

  it("Quartil do indicador com recorrência configurada -> Quartil do PRV: preserva a recorrência (mesma forma nas duas origens), remove o indicador (PRV não tem)", () => {
    const quartile = buildIndicatorAnalysisConfig("QUARTILE", emptyCondition)
    const withRecurrence: ConditionConfig = {
      ...quartile,
      comparator: "GTE",
      thresholdNumeric: 3,
      thresholdText: undefined,
      performanceQuery: { ...quartile.performanceQuery!, recurrence: { periods: 5, matchQuartile: "Q1" } },
    }
    const next = buildIndicatorAnalysisConfig("PRV_QUARTILE", withRecurrence)
    expect(next.performanceQuery?.recurrence).toEqual({ periods: 5, matchQuartile: "Q1" })
    expect(next.performanceQuery?.indicatorCode).toBeUndefined()
    // "Últimos N fechamentos" da recorrência é uma CONTAGEM comparada externamente — preservada
    // junto (mesmo padrão de historicalQuery COUNT: filtro interno + comparação externa).
    expect(next.comparator).toBe("GTE")
    expect(next.thresholdNumeric).toBe(3)
  })

  it("Quartil do indicador (fechamento mais recente, Q4) -> Valor do indicador: nenhuma configuração de quartil sobrevive escondida", () => {
    const quartile = buildIndicatorAnalysisConfig("QUARTILE", emptyCondition)
    const next = buildIndicatorAnalysisConfig("VALUE", quartile)
    expect(next.thresholdText).toBeUndefined()
    expect(next.performanceQuery).toBeUndefined()
  })

  it("o card do node reflete a nova semântica imediatamente após a troca (Valor -> Atingimento)", () => {
    const value: ConditionConfig = {
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    }
    expect(describeNodeConfig(conditionNode(value), {})).toBe("Média de NOTA_URA nos últimos 3 meses fechados é menor que 3.3")

    const achievement = buildIndicatorAnalysisConfig("ACHIEVEMENT", value)
    expect(describeNodeConfig(conditionNode(achievement), {})).toBe("Média do atingimento de NOTA_URA nos últimos 3 fechamentos mensais é menor que 3.3")
  })
})
