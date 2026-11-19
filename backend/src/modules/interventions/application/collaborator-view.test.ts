import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { INTERVENTION_TYPE_SCHEMA_VERSION } from "../domain/intervention-type.js"
import { markMyStep } from "./collaborator-view.js"

/**
 * POL-04 — o passo do colaborador entra na mesma disciplina dos comandos de quem conduz: a intervenção é travada antes de tudo,
 * intervenção encerrada recusa (409) em vez de mudar o passo, e desmarcar não apaga o registro de um passo que o líder concluiu.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const INTERVENTION = "11111111-1111-4111-8111-111111111111"
const STEP = "22222222-2222-4222-8222-222222222222"
const LEADER = "33333333-3333-4333-8333-333333333333"
const OPERATOR = "44444444-4444-4444-8444-444444444444"

const definition = {
  schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION,
  name: "Plano de ação",
  description: "Plano (teste)",
  capabilities: ["TASKS"],
  responsibleRole: "SUPERVISOR",
  defaultDueDays: 15,
  approval: { required: false },
  evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "INDICATOR_RESULT", "FEEDBACK"] },
  form: [],
  completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false },
  incompatibleWith: [],
  aiDraft: false,
  script: [],
  collaboratorVisible: true,
}

function fakeDatabase(input: { status: string; item: { status: string; completed_by: string | null } }) {
  const statements: string[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    statements.push(sql.replace(/\s+/g, " ").trim())
    if (sql.includes("from interventions i") && sql.includes("join intervention_type_versions v")) {
      const statuses = params[3] as string[]
      const rows = statuses.includes(input.status) ? [{ id: INTERVENTION, case_id: "55555555-5555-4555-8555-555555555555", status: input.status, revision: 4, due_at: "2026-12-01", started_at: new Date("2026-11-01T12:00:00Z"), created_at: new Date("2026-11-01T12:00:00Z"), responsible_name: "Líder", plan: {}, definition }] : []
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from intervention_items where id = $1")) return { rows: [{ id: STEP, kind: "TASK", title: "Revisar o roteiro", owner_id: OPERATOR, ...input.item }], rowCount: 1 }
    return { rows: [], rowCount: /^\s*update /i.test(sql) ? 1 : 0 }
  }
  const client = { query, release: () => undefined }
  const db = { connect: async () => client, query } as unknown as Database
  return { db, statements, writes: () => statements.filter((sql) => /^(update|insert) /i.test(sql)) }
}

const viewer = { organizationId: ORG, personId: OPERATOR }

describe("passo do colaborador (POL-04)", () => {
  it("trava a linha da intervenção antes de ler o passo", async () => {
    const { db, statements } = fakeDatabase({ status: "IN_PROGRESS", item: { status: "PENDING", completed_by: null } })
    await markMyStep(db, viewer, INTERVENTION, STEP, { done: true })
    const lock = statements.findIndex((sql) => sql.includes("from interventions i") && sql.endsWith("for update of i"))
    const item = statements.findIndex((sql) => sql.includes("from intervention_items where id = $1"))
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(item)
  })

  it.each(["COMPLETED", "CANCELLED"])("intervenção %s: recusa com 409 e não grava nada", async (status) => {
    const { db, writes } = fakeDatabase({ status, item: { status: "DONE", completed_by: OPERATOR } })
    await expect(markMyStep(db, viewer, INTERVENTION, STEP, { done: false })).rejects.toMatchObject({ code: "INTERVENTION_NOT_IN_PROGRESS", statusCode: 409 })
    expect(writes()).toEqual([])
  })

  it("intervenção que ainda não está em execução continua não encontrada (nunca revela)", async () => {
    const { db, writes } = fakeDatabase({ status: "PROPOSED", item: { status: "PENDING", completed_by: null } })
    await expect(markMyStep(db, viewer, INTERVENTION, STEP, { done: true })).rejects.toMatchObject({ code: "INTERVENTION_NOT_FOUND", statusCode: 404 })
    expect(writes()).toEqual([])
  })

  it("desmarcar um passo que o líder concluiu é recusado: a anotação dele não é apagada", async () => {
    const { db, writes } = fakeDatabase({ status: "IN_PROGRESS", item: { status: "DONE", completed_by: LEADER } })
    await expect(markMyStep(db, viewer, INTERVENTION, STEP, { done: false })).rejects.toMatchObject({ code: "INTERVENTION_STEP_DONE_BY_LEADER", statusCode: 409 })
    expect(writes()).toEqual([])
  })

  it("o colaborador continua desmarcando o passo que ele mesmo marcou", async () => {
    const { db, writes } = fakeDatabase({ status: "IN_PROGRESS", item: { status: "DONE", completed_by: OPERATOR } })
    await markMyStep(db, viewer, INTERVENTION, STEP, { done: false })
    expect(writes().some((sql) => sql.startsWith("update intervention_items set status"))).toBe(true)
  })
})
