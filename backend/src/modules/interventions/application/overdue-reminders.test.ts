import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { INTERVENTION_TYPE_SCHEMA_VERSION } from "../domain/intervention-type.js"
import { acceptIntervention, forwardIntervention, updateInterventionItem } from "./intervention-service.js"
import { sendOverdueReminders } from "./overdue-reminders.js"

/**
 * QA-04 — o lembrete de prazo vencido (`INTERVENTION_OVERDUE`) é resolvido quando o que ele cobrava foi atendido (aceitar,
 * encaminhar, registrar o passo), não só ao concluir/cancelar; e a repetição é por janela MÓVEL de 7 dias — com a semana ISO na
 * chave, um lembrete no domingo e outro na segunda eram "semanas diferentes".
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const INTERVENTION = "11111111-1111-4111-8111-111111111111"
const ITEM = "22222222-2222-4222-8222-222222222222"
const LEADER = "33333333-3333-4333-8333-333333333333"
const MANAGER = "88888888-8888-4888-8888-888888888888"
const OPERATOR = "44444444-4444-4444-8444-444444444444"
const OVERDUE_KEY = `intervention:${INTERVENTION}:OVERDUE:%`

const definition = {
  schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION, name: "Orientar", description: "Orientação (teste)", capabilities: ["GUIDANCE"], responsibleRole: "SUPERVISOR", defaultDueDays: 15, approval: { required: false },
  evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION"] }, form: [], completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false },
  incompatibleWith: [], aiDraft: false, script: [], collaboratorVisible: false,
}

const rowWith = (status: "PROPOSED" | "IN_PROGRESS") => ({
  id: INTERVENTION, person_id: OPERATOR, person_name: "Operadora", team_name: null, case_id: "55555555-5555-4555-8555-555555555555", case_title: "Caso", type_key: "ORIENTAR", type_version_id: "66666666-6666-4666-8666-666666666666",
  subject_key: "GENERAL", indicator_code: null, policy_id: null, policy_name: null, policy_version_id: null, policy_version: null, evaluation_id: null, report_id: null, rule_key: null, origin: "MANUAL", workflow_id: null, workflow_name: null,
  enrollment_id: null, node_id: null, opened_by: null, accepted_by: null, responsible_id: LEADER, responsible_name: "Líder", approver_id: null, approver_name: null, approval_recipient_ids: [], status, sensitive: false,
  reason: "Motivo", initial_situation: {}, evidence: [{ kind: "EVALUATION", ref: "e-1", label: "Avaliação", occurredAt: null, addedBy: null }], plan: {}, form_values: {}, ai_draft: null, outcome: null, due_at: "2026-11-01",
  started_at: status === "IN_PROGRESS" ? new Date("2026-10-20T12:00:00Z") : null, completed_at: null, cancelled_at: null, signal_count: 0, last_signal_at: null, revision: 3, created_at: new Date("2026-10-20T12:00:00Z"), updated_at: new Date("2026-10-20T12:00:00Z"),
})

function fakeDatabase(status: "PROPOSED" | "IN_PROGRESS") {
  const statements: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim()
    statements.push({ sql: text, params })
    if (text.includes("join supervision_cases c on c.id = i.case_id")) return { rows: [rowWith(status)], rowCount: 1 }
    if (text.includes("from intervention_type_versions v join intervention_types t")) return { rows: [{ key: "ORIENTAR", version: 1, definition }], rowCount: 1 }
    if (text.includes("from intervention_items it left join people o")) return { rows: [{ id: ITEM, kind: "TASK", title: "Ouvir duas chamadas", description: "", owner_id: LEADER, owner_name: "Líder", due_at: "2026-11-05", status: "PENDING", result: null, completed_at: null, completed_by_name: null, position: 0 }], rowCount: 1 }
    if (text.startsWith("with recursive up as")) return { rows: [{ id: MANAGER, name: "Gerente" }], rowCount: 1 }
    if (/^(update|insert) /i.test(text)) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, statements }
}

const viewer = { organizationId: ORG, personId: LEADER, access: { organizationId: ORG, accountId: "77777777-7777-4777-8777-777777777777", personId: LEADER, assignments: [] } satisfies AccessContext }
const resolved = (statements: { sql: string; params: unknown[] }[]) => statements.filter((item) => item.sql.startsWith("update alerts set status = 'RESOLVED'") && item.params[1] === OVERDUE_KEY)

describe("lembrete de prazo vencido é resolvido quando atendido (QA-04)", () => {
  it("aceitar a recomendação vencida resolve o lembrete", async () => {
    const { db, statements } = fakeDatabase("PROPOSED")
    await acceptIntervention(db, viewer, INTERVENTION, {})
    expect(resolved(statements)).toHaveLength(1)
  })

  it("encaminhar resolve o lembrete de quem respondia até ali", async () => {
    const { db, statements } = fakeDatabase("IN_PROGRESS")
    await forwardIntervention(db, viewer, INTERVENTION, { toPersonId: MANAGER, reason: "Fora do meu alcance." })
    expect(resolved(statements)).toHaveLength(1)
  })

  it("registrar o passo resolve o lembrete só se não sobrar passo vencido nem prazo passado", async () => {
    const { db, statements } = fakeDatabase("IN_PROGRESS")
    await updateInterventionItem(db, viewer, INTERVENTION, ITEM, { status: "DONE", note: "Feito." })
    const [statement] = resolved(statements)
    expect(statement).toBeDefined()
    expect(statement!.sql).toContain("not exists (select 1 from interventions i where i.id = $3 and i.due_at < $4::date)")
    expect(statement!.sql).toContain("not exists (select 1 from intervention_items it where it.intervention_id = $3 and it.status = 'PENDING' and it.due_at < $4::date)")
    expect(statement!.params[2]).toBe(INTERVENTION)
    expect(statement!.params[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("repetição do lembrete: janela móvel de 7 dias (QA-04)", () => {
  it("domingo e segunda não geram dois lembretes: a consulta exige 7 dias desde o último, e a chave não usa a semana ISO", async () => {
    const statements: { sql: string; params: unknown[] }[] = []
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        const text = sql.replace(/\s+/g, " ").trim()
        statements.push({ sql: text, params })
        if (text.startsWith("select distinct organization_id")) return { rows: [{ organization_id: ORG }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    } as unknown as Database
    const monday = new Date("2026-11-23T12:00:00Z")
    await sendOverdueReminders(db, monday)
    const insert = statements.find((item) => item.sql.startsWith("insert into alerts"))!
    expect(insert.sql).not.toContain("IW")
    expect(insert.sql).toContain("and a.dedupe_key like 'intervention:' || i.id || ':OVERDUE:%' and a.created_at > $3::timestamptz - make_interval(days => 7))")
    expect(insert.sql).toContain("a.recipient_id = i.responsible_id")
    expect(insert.sql).toContain("':OVERDUE:' || i.responsible_id || ':' || $2::text")
    expect(insert.params).toEqual([ORG, "2026-11-23", monday])
  })
})
