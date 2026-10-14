import { describe, expect, it } from "vitest"
import { buildIntelligenceReport, type ReportInput } from "./intelligence-report.js"
import { emptyInterventionTypeDefinition } from "./intervention-type.js"
import { INTERVENTION_POLICY_SCHEMA_VERSION, type PolicyCondition, type PolicyRule } from "./policy-definition.js"
import type { ConditionStatus, PlannedDecision, RuleTrace } from "./policy-evaluation.js"

const QUARTILE = "TMA: Q4 em 2 dos últimos 2 fechamentos oficiais"
const condition: PolicyCondition = { kind: "PUBLISHED_FEEDBACK", feedbackKind: null, indicatorCode: null, withinDays: 30, comparator: "GTE", threshold: 1 }
const item = (statement: string, status: ConditionStatus) => ({ type: "CONDITION" as const, path: "when.items.0", kind: "INDICATOR" as const, outcome: { status, summary: statement, facts: {}, references: [{ kind: "INDICATOR_RESULT" as const, ref: "perf-1", label: "Fechamento oficial" }] } })
const ruleTrace = (key: string, priority: number, status: ConditionStatus, items: ReturnType<typeof item>[]): RuleTrace => ({ key, name: `Regra ${key}`, priority, status, trace: { type: "GROUP", path: "when", operator: "ALL", status, items } })
const rule = (key: string, priority: number): PolicyRule => ({ key, name: `Regra ${key}`, priority, justification: `Porque ${key}.`, when: { operator: "ALL", items: [condition] }, actions: [{ typeKey: "PLANO", effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] })

function input(): ReportInput {
  const rules = [rule("R1", 1), rule("R2", 2)]
  const decision: PlannedDecision = { typeKey: "PLANO", typeName: "Plano de ação", ruleKey: "R2", alsoRequestedBy: [], mode: "MATCHED", action: rules[1]!.actions[0]!, effectiveEffect: "OPEN", status: "CREATED", existingInterventionId: null, updated: false, note: null }
  return {
    asOf: new Date("2026-10-13T12:00:00Z"),
    subject: { personId: "p1", personName: "Karoline", teamName: "Atendimento", indicatorCode: "TMA", indicatorName: "Tempo médio de atendimento" },
    policy: { id: "pol", key: "POL", name: "Política", version: 1, versionId: "pv", effectiveFrom: "2026-10-01T00:00:00.000Z", matchStrategy: "FIRST_MATCH" },
    definition: { schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION, description: "", indicatorCode: "TMA", matchStrategy: "FIRST_MATCH", rules, report: { aiNarrative: false } },
    // O mesmo quartil oficial aparece nas duas regras; a cobertura inconclusiva também.
    rules: [
      ruleTrace("R1", 1, "NOT_MET", [item(QUARTILE, "MET"), item("Diagnóstico sustentado: nenhum", "NOT_MET")]),
      ruleTrace("R2", 2, "MET", [item(QUARTILE, "MET"), item("Cobertura insuficiente", "INCONCLUSIVE"), item("Cobertura insuficiente", "INCONCLUSIVE")]),
    ],
    selection: { selected: [{ rule: rules[1]!, mode: "MATCHED" }], status: "MATCHED", blockedBy: null, inconclusiveRules: [] },
    decisions: [decision],
    outcome: "CREATED",
    types: new Map([["PLANO", { definition: { ...emptyInterventionTypeDefinition("Plano de ação"), capabilities: ["ACTION_PLAN"] } }]]),
    assignments: new Map([["PLANO", { responsible: { personId: "s1", name: "Vanessa" }, approver: null, dueAt: "2026-11-12" }]]),
    interventionIds: new Map([["PLANO", "int-1"]]),
    priorInterventions: [],
    diagnoses: [],
    extraSources: [],
  }
}

describe("relatório de inteligência — parte estruturada", () => {
  it("a mesma condição em várias regras vira UM fato (e uma incerteza), citado por todas as ações que ela sustenta", () => {
    const report = buildIntelligenceReport(input())
    expect(report.facts.filter((fact) => fact.statement === QUARTILE)).toHaveLength(1)
    expect(report.uncertainties).toHaveLength(1)
    expect(report.sources).toHaveLength(1)
    const quartile = report.facts.find((fact) => fact.statement === QUARTILE)!
    expect(report.actions[0]!.supportingFacts).toEqual([`${quartile.handle}: ${QUARTILE}`])
  })

  it("é determinístico: a mesma entrada gera o mesmo relatório", () => {
    expect(buildIntelligenceReport(input())).toEqual(buildIntelligenceReport(input()))
  })
})
