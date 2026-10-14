import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { emptyInterventionTypeDefinition } from "./intervention-type.js"
import { planReadinessIssues } from "./intervention-plan.js"
import { authorizeCommand, canViewIntervention, completionIssues, CONTINUITY_DECISIONS, isOverdue, transition, type ActorRelation } from "./intervention-state.js"

const relation = (extra: Omit<Partial<ActorRelation>, "can"> & { can?: Partial<ActorRelation["can"]> } = {}): ActorRelation => ({ human: true, isResponsible: false, isApprover: false, isOpener: false, isSubject: false, leadsSubject: false, ...extra, can: { view: false, execute: false, approve: false, sensitiveDecide: false, ...extra.can } })

describe("máquina de estados", () => {
  it("proposta → aprovação (quando exigida) → execução → conclusão; cancelamento de qualquer estado ativo", () => {
    expect(transition("ACCEPT", "PROPOSED", { approvalRequired: true, sensitive: false })).toEqual({ ok: true, to: "AWAITING_APPROVAL" })
    expect(transition("ACCEPT", "PROPOSED", { approvalRequired: false, sensitive: false })).toEqual({ ok: true, to: "IN_PROGRESS" })
    expect(transition("APPROVE", "AWAITING_APPROVAL", { approvalRequired: true, sensitive: false })).toEqual({ ok: true, to: "IN_PROGRESS" })
    expect(transition("RETURN", "AWAITING_APPROVAL", { approvalRequired: true, sensitive: false })).toEqual({ ok: true, to: "PROPOSED" })
    expect(transition("COMPLETE", "IN_PROGRESS", { approvalRequired: false, sensitive: false })).toEqual({ ok: true, to: "COMPLETED" })
    for (const from of ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"] as const) expect(transition("CANCEL", from, { approvalRequired: false, sensitive: false })).toEqual({ ok: true, to: "CANCELLED" })
    expect(transition("CANCEL", "COMPLETED", { approvalRequired: false, sensitive: false }).ok).toBe(false)
  })

  it("atraso é derivado do prazo e nunca troca o estado real", () => {
    expect(isOverdue("IN_PROGRESS", "2026-10-01", "2026-10-13")).toBe(true)
    expect(isOverdue("COMPLETED", "2026-10-01", "2026-10-13")).toBe(false)
    expect(isOverdue("IN_PROGRESS", "2026-10-13", "2026-10-13")).toBe(false)
  })

  it("avaliação de continuidade não é 'aprovada' nem 'concluída' — só decidida", () => {
    expect(transition("APPROVE", "AWAITING_APPROVAL", { approvalRequired: true, sensitive: true }).ok).toBe(false)
    expect(transition("COMPLETE", "IN_PROGRESS", { approvalRequired: true, sensitive: true }).ok).toBe(false)
    expect(transition("DECIDE_CONTINUITY", "AWAITING_APPROVAL", { approvalRequired: true, sensitive: true, continuityDecision: "MORE_EVIDENCE_NEEDED" })).toEqual({ ok: true, to: "PROPOSED" })
    expect(transition("DECIDE_CONTINUITY", "AWAITING_APPROVAL", { approvalRequired: true, sensitive: true, continuityDecision: "REFERRED_TO_FORMAL_PROCESS" })).toEqual({ ok: true, to: "COMPLETED" })
  })
})

describe("autorização (pura)", () => {
  it("o próprio colaborador nunca vê nem age sobre a intervenção dele", () => {
    expect(canViewIntervention(relation({ isSubject: true, can: { view: true } }))).toBe(false)
    expect(authorizeCommand("ACCEPT", relation({ isSubject: true, isResponsible: true }), false)).not.toBeNull()
  })
  it("executar: responsável ou permissão de executar no escopo; liderar não basta para executar", () => {
    expect(authorizeCommand("COMPLETE", relation({ isResponsible: true }), false)).toBeNull()
    expect(authorizeCommand("COMPLETE", relation({ can: { execute: true } }), false)).toBeNull()
    expect(authorizeCommand("COMPLETE", relation({ leadsSubject: true }), false)).not.toBeNull()
  })
  it("aprovar: aprovador designado ou permissão; quem abriu/aceitou não aprova a própria proposta", () => {
    expect(authorizeCommand("APPROVE", relation({ isApprover: true }), false)).toBeNull()
    expect(authorizeCommand("APPROVE", relation({ isApprover: true, isOpener: true }), false)).toMatchObject({ status: 403 })
    expect(authorizeCommand("APPROVE", relation({ can: { execute: true } }), false)).toMatchObject({ status: 403 })
  })
  it("decisão SENSÍVEL: só a permissão sensível no escopo; nunca pela cadeia, nunca por ser aprovador, nunca quem pediu", () => {
    expect(authorizeCommand("DECIDE_CONTINUITY", relation({ can: { sensitiveDecide: true } }), true)).toBeNull()
    expect(authorizeCommand("DECIDE_CONTINUITY", relation({ isApprover: true, leadsSubject: true, can: { approve: true, execute: true } }), true)).toMatchObject({ status: 403 })
    expect(authorizeCommand("DECIDE_CONTINUITY", relation({ isOpener: true, can: { sensitiveDecide: true } }), true)).toMatchObject({ status: 403 })
  })
})

describe("nenhuma decisão automática ou de desligamento existe", () => {
  it("o vocabulário fechado de decisões não tem 'desligar' nem 'alterar situação'", () => {
    expect(CONTINUITY_DECISIONS).toEqual(["CONTINUITY_CONFIRMED", "DEVELOPMENT_CONTINUES", "REFERRED_TO_FORMAL_PROCESS", "MORE_EVIDENCE_NEEDED"])
    for (const decision of CONTINUITY_DECISIONS) expect(decision).not.toMatch(/TERMINAT|DISMISS|DESLIG|FIRE|STATUS/)
  })
  it("o módulo de intervenções não escreve em situação funcional, cadastro de pessoa nem acesso (prova estrutural)", () => {
    const root = join(__dirname, "..")
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !path.includes(`${join(root, "testing")}`))
    const forbidden = /(insert\s+into|update|delete\s+from)\s+(employee_status_periods|people|user_accounts|access_role_assignments|employee_schedule_days|employee_schedule_exceptions)\b/i
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden)
  })
})

describe("conclusão: atividades, aprendizagem e evolução operacional são registros separados", () => {
  const definition = { ...emptyInterventionTypeDefinition("Treinar"), capabilities: ["TRAINING" as const, "TASKS" as const], completion: { requireAllTasksDone: true, requireLearningAssessment: true, requireOperationalReading: true, requireOutcomeNote: true } }
  const counts = { tasksTotal: 2, tasksDone: 2, tasksSkipped: 0, checkpointsTotal: 0, checkpointsDone: 0, activitiesTotal: 1, activitiesDone: 1 }
  it("tarefas concluídas não dispensam a avaliação de aprendizagem nem a leitura do indicador", () => {
    const issues = completionIssues(definition, { note: "Feito.", learning: null, operational: null, formValues: {} }, counts).map((issue) => issue.code)
    expect(issues).toEqual(expect.arrayContaining(["INTERVENTION_LEARNING_REQUIRED", "INTERVENTION_OPERATIONAL_REQUIRED"]))
  })
  it("'melhorou' exige a leitura que sustenta", () => {
    const issues = completionIssues(definition, { note: "Feito.", learning: { result: "ACHIEVED", note: "" }, operational: { result: "IMPROVED", reading: "" }, formValues: {} }, counts).map((issue) => issue.code)
    expect(issues).toContain("INTERVENTION_OPERATIONAL_READING")
  })
  it("treinamento só sai de 'proposta' com objetivo, conteúdo aprovado, atividade e avaliação", () => {
    const issues = planReadinessIssues(definition, {}, { tasks: 1, tasksWithOwnerAndDue: 1, checkpoints: 0, activities: 0 }, 1).map((issue) => issue.code)
    expect(issues).toEqual(expect.arrayContaining(["TRAINING_OBJECTIVE_REQUIRED", "TRAINING_CONTENTS_REQUIRED", "TRAINING_ACTIVITIES_REQUIRED", "TRAINING_ASSESSMENT_REQUIRED"]))
  })
})
