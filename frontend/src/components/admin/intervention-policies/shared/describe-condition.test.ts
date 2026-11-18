import { describe, expect, it } from "vitest"

import { policyConditionSchema, type PolicyCondition } from "@/schemas/admin/intervention-policy.schema"

import { SITUATION_PRESETS } from "../policy-editor/defaults"
import { describeCondition, describeWhen, type DescribeContext } from "./describe-condition"

const context: DescribeContext = {
  policyIndicatorCode: "TMA",
  indicatorName: (code) => ({ TMA: "Tempo Médio de Atendimento", FCR: "Resolução no primeiro contato" })[code] ?? code,
  typeName: (key) => ({ PLANO_DE_ACAO: "Plano de ação", LADO_A_LADO: "Lado a lado" })[key] ?? key,
  competencyName: (key) => ({ GESTAO_DO_TEMPO: "Gestão do tempo de atendimento" })[key] ?? key,
}
const say = (condition: PolicyCondition) => describeCondition(condition, context)

describe("a condição dita em frase (nenhum código cru quando há nome no catálogo)", () => {
  it("indicador: quartil recorrente, quartil do último fechamento, atingimento, medição diária contra a meta e recorrência de medições", () => {
    expect(say({ kind: "INDICATOR", criterion: { comparator: "GTE", thresholdNumeric: 3, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA", recurrence: { periods: 3, matchQuartile: "Q4" } } } })).toBe("Tempo Médio de Atendimento ficou no pior quartil (Q4) em pelo menos 3 dos últimos 3 fechamentos")
    expect(say({ kind: "INDICATOR", criterion: { comparator: "EQUALS", thresholdText: "Q1", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "FCR" } } })).toBe("Resolução no primeiro contato ficou no melhor quartil (Q1) no último fechamento")
    expect(say({ kind: "INDICATOR", criterion: { comparator: "LT", thresholdNumeric: 100, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT" } } })).toBe("atingimento oficial de Tempo Médio de Atendimento ficou menor que 100% no último fechamento")
    expect(say({ kind: "INDICATOR", criterion: { comparator: "GT", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", source: "MEASUREMENT", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } } } })).toBe("Tempo Médio de Atendimento (medição diária) ficou maior que a meta vigente nos últimos 30 dias")
    expect(say({ kind: "INDICATOR", criterion: { comparator: "GTE", thresholdNumeric: 5, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", source: "MEASUREMENT", aggregation: "COUNT", comparator: "GT", indicatorThreshold: 400, period: { kind: "ROLLING_DAYS", days: 15 } } } })).toBe("Tempo Médio de Atendimento teve pelo menos 5 medições com valor maior que 400 nos últimos 15 dias (medição diária)")
    // O rótulo escrito pelo administrador vence a frase gerada.
    expect(say({ kind: "INDICATOR", label: "Fora da meta no mês", criterion: { comparator: "LT", thresholdNumeric: 100, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT" } } })).toBe("Fora da meta no mês")
  })

  it("evolução, histórico de intervenções, feedback, diagnóstico, flag e situação funcional", () => {
    expect(say({ kind: "EVOLUTION", indicatorCode: null, withinDays: 90, expectation: "NOT_IMPROVED", minimumImprovementPercent: 5 })).toBe("Tempo Médio de Atendimento não melhorou pelo menos 5% desde o último feedback (publicado nos últimos 90 dias)")
    expect(say({ kind: "EVOLUTION", indicatorCode: "FCR", withinDays: 60, expectation: "NOT_IMPROVED", minimumImprovementPercent: 0 })).toBe("Resolução no primeiro contato não melhorou nada desde o último feedback (publicado nos últimos 60 dias)")
    expect(say({ kind: "PRIOR_INTERVENTIONS", typeKeys: ["PLANO_DE_ACAO", "LADO_A_LADO"], statuses: ["COMPLETED"], operationalResults: ["UNCHANGED", "WORSENED"], sameSubject: true, withinDays: 180, comparator: "GTE", threshold: 1 })).toBe("teve pelo menos 1 “Plano de ação” ou “Lado a lado” concluída com resultado “não mudou” ou “piorou” nos últimos 180 dias, sobre o mesmo assunto")
    expect(say({ kind: "PUBLISHED_FEEDBACK", feedbackKind: "INDICATOR", indicatorCode: "TMA", withinDays: 90, comparator: "GTE", threshold: 2 })).toBe("recebeu pelo menos 2 feedbacks de indicador sobre Tempo Médio de Atendimento nos últimos 90 dias")
    expect(say({ kind: "SUPPORTED_DIAGNOSIS", indicatorCode: null, competencyKeys: ["GESTAO_DO_TEMPO"], withinDays: 60, expectation: "EXISTS" })).toBe("tem diagnóstico sustentado de Tempo Médio de Atendimento que aponta “Gestão do tempo de atendimento” nos últimos 60 dias")
    expect(say({ kind: "INTERACTION_FLAG", channel: "VOICE", flagName: "rechamada", match: { type: "BOOLEAN", value: true }, withinDays: 30, measure: "COUNT", comparator: "GTE", threshold: 3, minimumInteractions: 1 })).toBe("teve a flag “rechamada” em pelo menos 3 atendimentos nos últimos 30 dias")
    expect(say({ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true })).toBe("está em produção hoje")
  })

  it("o 'quando' inteiro: condições ligadas por e/ou, com parênteses nos grupos aninhados", () => {
    const quartile: PolicyCondition = { kind: "INDICATOR", label: "Q4 em 3 fechamentos", criterion: { comparator: "GTE", thresholdNumeric: 3 } }
    const noEvolution: PolicyCondition = { kind: "EVOLUTION", indicatorCode: null, withinDays: 90, expectation: "NOT_IMPROVED", minimumImprovementPercent: 0 }
    const eligible: PolicyCondition = { kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true }
    expect(describeWhen({ operator: "ALL", items: [quartile, { operator: "ANY", items: [noEvolution, eligible] }] }, context)).toBe("Q4 em 3 fechamentos e (Tempo Médio de Atendimento não melhorou nada desde o último feedback (publicado nos últimos 90 dias) ou está em produção hoje)")
  })
})

describe("situações prontas do editor", () => {
  it("cada situação já nasce como uma condição completa do contrato e tem frase própria", () => {
    const sentences = SITUATION_PRESETS.map((preset) => {
      const condition = preset.build({ policyIndicatorCode: "TMA" })
      expect(policyConditionSchema.safeParse(condition).success, preset.key).toBe(true)
      return describeCondition(condition, context)
    })
    expect(new Set(sentences).size).toBe(SITUATION_PRESETS.length)
    expect(sentences).toContain("Tempo Médio de Atendimento ficou no pior quartil (Q4) em pelo menos 3 dos últimos 3 fechamentos")
    expect(sentences).toContain("Tempo Médio de Atendimento não melhorou nada desde o último feedback (publicado nos últimos 90 dias)")
    expect(sentences).toContain("teve pelo menos 1 intervenção concluída com resultado “não mudou” ou “piorou” nos últimos 180 dias, sobre o mesmo assunto")
  })
})
