import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { emptyInterventionTypeDefinition } from "../domain/intervention-type.js"
import { INTERVENTION_POLICY_SCHEMA_VERSION, type PolicyCondition, type PolicyRule } from "../domain/policy-definition.js"
import type { PlannedDecision, RuleTrace } from "../domain/policy-evaluation.js"
import { applyEvaluation, CONTINUITY_NOT_APPLIED_NOTE } from "./apply-evaluation.js"
import type { PolicyEvaluation } from "./evaluate-policy.js"

/**
 * QA-07 — política publicada ANTES da regra fixa da continuidade (a regra não exige "Intervenções anteriores concluídas sem
 * evolução"): a ação de continuidade é IGNORADA com o motivo registrado, e as outras ações da mesma avaliação nascem. Antes,
 * a avaliação inteira falhava com 422 e o nó do Workflow ficava bloqueado. A continuidade segue nunca decidida por regra.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "33333333-3333-4333-8333-333333333333"
const LEADER = { personId: "66666666-6666-4666-8666-666666666666", name: "Líder" }
const GUIDANCE_ID = "77777777-7777-4777-8777-777777777777"

const feedback: PolicyCondition = { kind: "PUBLISHED_FEEDBACK", feedbackKind: null, indicatorCode: null, withinDays: 30, comparator: "GTE", threshold: 1 }
const priorFollowUp = { kind: "PRIOR_INTERVENTIONS", typeKeys: [], statuses: ["COMPLETED"], withinDays: 365, comparator: "GTE", threshold: 1, sameSubject: false, operationalResults: ["UNCHANGED", "WORSENED"] } as unknown as PolicyCondition
const rule = (key: string, typeKey: string, conditions: PolicyCondition[]): PolicyRule => ({ key, name: `Regra ${key}`, priority: key === "R1" ? 1 : 2, justification: `Justificativa da regra ${key}, com mais de trinta caracteres.`, when: { operator: "ALL", items: conditions }, actions: [{ typeKey, effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] })
const trace = (item: PolicyRule): RuleTrace => ({ key: item.key, name: item.name, priority: item.priority, status: "MET", trace: { type: "GROUP", path: "when", operator: "ALL", status: "MET", items: [{ type: "CONDITION", path: "when.items.0", kind: "PUBLISHED_FEEDBACK", outcome: { status: "MET", summary: "Feedbacks publicados: 2", facts: {}, references: [{ kind: "FEEDBACK", ref: "fb-1", label: "Feedback de indicador" }] } }] } })

function evaluationWith(continuityConditions: PolicyCondition[]): PolicyEvaluation {
  const rules = [rule("R1", "CONTINUIDADE", continuityConditions), rule("R2", "ORIENTAR", [feedback])]
  const decision = (item: PolicyRule, typeName: string, status: PlannedDecision["status"]): PlannedDecision => ({ typeKey: item.actions[0]!.typeKey, typeName, ruleKey: item.key, alsoRequestedBy: [], mode: "MATCHED", action: item.actions[0]!, effectiveEffect: "OPEN", status, existingInterventionId: null, updated: false, note: null })
  const type = (key: string, name: string, capabilities: string[]) => [key, { typeId: `type-${key}`, versionId: `version-${key}`, key, version: 1, definition: { ...emptyInterventionTypeDefinition(name), capabilities } }] as const
  const assignment = (key: string) => [key, { responsible: LEADER, approver: LEADER, approvalRecipientIds: [LEADER.personId], dueAt: "2026-12-01", problem: null }] as const
  return {
    organizationId: ORG,
    policy: { id: "11111111-1111-4111-8111-111111111111", key: "POLITICA", name: "Política antiga" },
    version: { id: "22222222-2222-4222-8222-222222222222", version: 1, effectiveFrom: "2026-10-01T00:00:00.000Z", definition: { schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION, description: "", indicatorCode: null, matchStrategy: "ALL_MATCHES", rules, report: { aiNarrative: false } } },
    person: { id: PERSON, name: "Operadora", teamId: "88888888-8888-4888-8888-888888888888", teamName: "Atendimento" },
    asOf: new Date("2026-11-19T12:00:00Z"),
    timeZone: "America/Sao_Paulo",
    subjectKey: "GENERAL",
    indicatorCode: null,
    indicatorName: null,
    notApplicableReason: null,
    rules: rules.map(trace),
    selection: { selected: rules.map((item) => ({ rule: item, mode: "MATCHED" })), status: "MATCHED", blockedBy: null, inconclusiveRules: [] },
    decisions: [decision(rules[0]!, "Solicitar avaliação de continuidade", "PENDING_APPROVAL"), decision(rules[1]!, "Orientar", "CREATED")],
    outcome: "CREATED",
    justification: "Regras atendidas.",
    types: new Map([type("CONTINUIDADE", "Solicitar avaliação de continuidade", ["CONTINUITY_REVIEW"]), type("ORIENTAR", "Orientar", ["GUIDANCE"])]),
    assignments: new Map([assignment("CONTINUIDADE"), assignment("ORIENTAR")]),
    priorInterventions: [],
    diagnoses: [],
    recommendOnly: false,
  } as unknown as PolicyEvaluation
}

function fakeDatabase() {
  const statements: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim()
    statements.push({ sql: text, params })
    if (text.startsWith("insert into supervision_cases")) return { rows: [{ id: "99999999-9999-4999-8999-999999999999" }], rowCount: 1 }
    if (text.startsWith("insert into interventions")) return { rows: [{ id: GUIDANCE_ID }], rowCount: 1 }
    if (text.startsWith("insert into")) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, statements }
}

const run = (evaluation: PolicyEvaluation, db: Database) => applyEvaluation(db, { evaluation, origin: "WORKFLOW", idempotencyKey: "wf:teste:no" })

describe("regra fixa da continuidade na abertura × versão antiga da política (QA-07)", () => {
  it("regra sem acompanhamento anterior: a continuidade é ignorada com o motivo e a outra ação nasce", async () => {
    const { db, statements } = fakeDatabase()
    const result = await run(evaluationWith([feedback]), db)

    const continuity = result.decisions.find((decision) => decision.typeKey === "CONTINUIDADE")!
    expect(continuity).toMatchObject({ status: "SUPPRESSED", interventionId: null, note: CONTINUITY_NOT_APPLIED_NOTE })
    expect(CONTINUITY_NOT_APPLIED_NOTE).toMatch(/anterior à regra fixa/)
    expect(CONTINUITY_NOT_APPLIED_NOTE).toMatch(/publique a política de novo/)
    expect(result.decisions.find((decision) => decision.typeKey === "ORIENTAR")).toMatchObject({ status: "CREATED", interventionId: GUIDANCE_ID })
    expect(result.outcome).toBe("CREATED")

    // UMA intervenção gravada (a comum), nenhuma sensível; nenhum aviso de decisão de continuidade.
    const opened = statements.filter((item) => item.sql.startsWith("insert into interventions"))
    expect(opened).toHaveLength(1)
    expect(opened[0]!.params[5]).toBe("ORIENTAR")
    expect(opened[0]!.params[23]).toBe(false)
    expect(statements.some((item) => item.sql.startsWith("insert into alerts") && item.params.includes("INTERVENTION_DECISION_REQUESTED"))).toBe(false)

    // O registro fica na avaliação gravada (decisão não aplicada + o que a regra tinha pedido) e no relatório.
    const recorded = statements.find((item) => item.sql.startsWith("insert into intervention_policy_evaluations"))!
    const decisions = JSON.parse(recorded.params[16] as string) as { typeKey: string; status: string; note: string | null; plannedStatus: string }[]
    expect(decisions.find((decision) => decision.typeKey === "CONTINUIDADE")).toMatchObject({ status: "SUPPRESSED", note: CONTINUITY_NOT_APPLIED_NOTE, plannedStatus: "PENDING_APPROVAL" })
    expect(statements.find((item) => item.sql.startsWith("insert into intervention_reports"))!.params[6]).toContain("anterior à regra fixa")
  })

  it("regra que exige acompanhamento anterior concluído sem evolução: a solicitação continua nascendo (aguardando decisão humana)", async () => {
    const { db, statements } = fakeDatabase()
    const result = await run(evaluationWith([feedback, priorFollowUp]), db)
    expect(result.decisions.find((decision) => decision.typeKey === "CONTINUIDADE")).toMatchObject({ status: "PENDING_APPROVAL", note: null })
    const opened = statements.filter((item) => item.sql.startsWith("insert into interventions"))
    expect(opened.map((item) => [item.params[5], item.params[22], item.params[23]])).toEqual([["CONTINUIDADE", "AWAITING_APPROVAL", true], ["ORIENTAR", "IN_PROGRESS", false]])
  })
})
