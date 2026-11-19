import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { INTERVENTION_TYPE_SCHEMA_VERSION } from "../domain/intervention-type.js"
import { completeIntervention, updateInterventionItem } from "./intervention-service.js"

/**
 * POL-01 — com a linha da intervenção travada (`for update`), NADA pode pedir outra conexão ao pool: numa rajada de comandos na
 * mesma intervenção, cada requisição segura uma conexão esperando a trava e a dona da trava fica na fila do pool, sem conexão
 * livre — a API inteira para até a espera de conexão vencer. A medição da INIA roda na conexão da própria transação.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const INTERVENTION = "11111111-1111-4111-8111-111111111111"
const CHECKPOINT = "22222222-2222-4222-8222-222222222222"
const LEADER = "33333333-3333-4333-8333-333333333333"
const OPERATOR = "44444444-4444-4444-8444-444444444444"

const definition = {
  schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION,
  name: "Orientar",
  description: "Orientação (teste)",
  capabilities: ["GUIDANCE", "CHECKPOINTS"],
  responsibleRole: "SUPERVISOR",
  defaultDueDays: 15,
  approval: { required: false },
  evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "INDICATOR_RESULT", "FEEDBACK"] },
  form: [],
  completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false },
  incompatibleWith: [],
  aiDraft: false,
  script: [],
  collaboratorVisible: false,
}

const row = {
  id: INTERVENTION, person_id: OPERATOR, person_name: "Operadora", team_name: null, case_id: "55555555-5555-4555-8555-555555555555", case_title: "Caso", type_key: "ORIENTAR", type_version_id: "66666666-6666-4666-8666-666666666666",
  subject_key: "GENERAL", indicator_code: null, policy_id: null, policy_name: null, policy_version_id: null, policy_version: null, evaluation_id: null, report_id: null, rule_key: null, origin: "MANUAL", workflow_id: null, workflow_name: null,
  enrollment_id: null, node_id: null, opened_by: LEADER, accepted_by: LEADER, responsible_id: LEADER, responsible_name: "Líder", approver_id: null, approver_name: null, approval_recipient_ids: [], status: "IN_PROGRESS", sensitive: false,
  reason: "Motivo", initial_situation: {}, evidence: [], plan: {}, form_values: {}, ai_draft: null, outcome: null, due_at: "2026-12-01", started_at: new Date("2026-11-01T12:00:00Z"), completed_at: null, cancelled_at: null, signal_count: 0,
  last_signal_at: null, revision: 3, created_at: new Date("2026-11-01T12:00:00Z"), updated_at: new Date("2026-11-01T12:00:00Z"),
}

function fakeDatabase() {
  const state = { inTransaction: false, poolQueriesInsideTransaction: [] as string[], measuredOn: [] as ("pool" | "transaction")[], committed: 0 }
  const answer = (sql: string, on: "pool" | "transaction") => {
    if (sql.includes("join supervision_cases c on c.id = i.case_id")) return { rows: [row], rowCount: 1 }
    if (sql.includes("from intervention_type_versions v join intervention_types t")) return { rows: [{ key: "ORIENTAR", version: 1, definition }], rowCount: 1 }
    if (sql.includes("from intervention_items it left join people o")) return { rows: [{ id: CHECKPOINT, kind: "CHECKPOINT", title: "Conferir", description: "", owner_id: LEADER, owner_name: "Líder", due_at: null, status: "PENDING", result: null, completed_at: null, completed_by_name: null, position: 0 }], rowCount: 1 }
    if (sql.includes("i.started_at, i.created_at") && sql.includes("left join indicator_definitions d")) {
      state.measuredOn.push(on)
      return { rows: [{ person_id: OPERATOR, indicator_code: null, indicator_name: null, started_at: row.started_at, created_at: row.created_at }], rowCount: 1 }
    }
    if (/^\s*update /i.test(sql)) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const client = {
    query: async (sql: string) => {
      if (/^begin/.test(sql)) state.inTransaction = true
      else if (sql === "commit" || sql === "rollback") {
        state.inTransaction = false
        if (sql === "commit") state.committed += 1
      }
      return answer(sql, "transaction")
    },
    release: () => undefined,
  }
  const db = {
    connect: async () => client,
    query: async (sql: string) => {
      if (state.inTransaction) state.poolQueriesInsideTransaction.push(sql.trim().slice(0, 80))
      return answer(sql, "pool")
    },
  } as unknown as Database
  return { db, state }
}

const viewer = { organizationId: ORG, personId: LEADER, access: { organizationId: ORG, accountId: "77777777-7777-4777-8777-777777777777", personId: LEADER, assignments: [] } satisfies AccessContext }

describe("comandos da intervenção não pedem conexão ao pool com a trava na mão (POL-01)", () => {
  it("concluir: a medição desde o início roda na conexão da transação", async () => {
    const { db, state } = fakeDatabase()
    await completeIntervention(db, viewer, INTERVENTION, { worked: "YES", reasons: ["APPLIED_AGREEMENT"], note: "Acompanhamento concluído." })
    expect(state.committed).toBe(1)
    expect(state.measuredOn).toEqual(["transaction"])
    expect(state.poolQueriesInsideTransaction).toEqual([])
  })

  it("checkpoint concluído: a medição anexada também roda na conexão da transação", async () => {
    const { db, state } = fakeDatabase()
    await updateInterventionItem(db, viewer, INTERVENTION, CHECKPOINT, { status: "DONE", reading: "Indicador em 92% nesta semana." })
    expect(state.committed).toBe(1)
    expect(state.measuredOn).toEqual(["transaction"])
    expect(state.poolQueriesInsideTransaction).toEqual([])
  })
})
