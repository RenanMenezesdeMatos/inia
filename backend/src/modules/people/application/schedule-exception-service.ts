import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { SCHEDULE_EXCEPTION_EFFECT_BY_CODE, SCHEDULE_EXCEPTION_LABELS, SUPERVISOR_PROVISIONABLE_CODES, type ScheduleExceptionCode, type ScheduleExceptionOrigin } from "../domain/schedule-exception.js"

/**
 * PROVISIONAMENTO/CANCELAMENTO de exceções de calendário pelo Supervisor — a MESMA tabela que a
 * Central escreve (`employee_schedule_exceptions`), com origem SUPERVISOR_MANUAL e auditoria em
 * `audit_logs` (quem, quando, motivo, datas, valor anterior). A INIA recebe o fato ("o Supervisor
 * decidiu que fulano não trabalha em X por Y"); não é WFM — não gera escala, não aprova, não calcula
 * banco de horas.
 *
 * Conflito entre origens nunca é sobrescrita silenciosa:
 *  - já existe a MESMA exceção ativa (pessoa × data × código), de qualquer origem → nada muda (acordo);
 *  - existe inativa → reativada pelo Supervisor com `manual_override = true` quando veio da Central
 *    (o writer da Central não a desativa de novo em silêncio — registra conflito);
 *  - cancelar uma exceção da Central → `active = false` + `manual_override = true` (auditável).
 * AJUSTE_ESCALA só nasce da resolução "Corrigir escala" de uma pendência (`allowScheduleAdjustment`).
 */
export type Queryable = Pick<pg.PoolClient, "query"> | Database

export type ScheduleExceptionRecord = {
  id: string
  personId: string
  date: string
  code: ScheduleExceptionCode
  label: string
  origin: ScheduleExceptionOrigin
  active: boolean
  rawReason: string | null
  source: string
  createdByPersonId: string | null
  createdAt: string
  cancelledAt: string | null
  cancelledByPersonId: string | null
  manualOverride: boolean
  provisionGroupId: string | null
}

export type ProvisionScheduleExceptionsInput = {
  organizationId: string
  personId: string
  code: ScheduleExceptionCode
  /** AAAA-MM-DD (inclusive). Um dia = from === to. */
  from: string
  to: string
  actorPersonId: string
  /** Só a resolução "Corrigir escala" pode registrar AJUSTE_ESCALA. */
  allowScheduleAdjustment?: boolean
}

export type ProvisionOutcome = { created: ScheduleExceptionRecord[]; reactivated: ScheduleExceptionRecord[]; unchanged: ScheduleExceptionRecord[]; provisionGroupId: string }

export const MAX_PROVISION_SPAN_DAYS = 31

const DATE = /^\d{4}-\d{2}-\d{2}$/

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 86_400_000)
  }
  return dates
}

const COLUMNS = `id, person_id, to_char(exception_date, 'YYYY-MM-DD') exception_date, code, origin, active, raw_reason, source, created_by_person_id, created_at, cancelled_at, cancelled_by_person_id, manual_override, provision_group_id`
const SELECT = `select ${COLUMNS} from employee_schedule_exceptions e`

type Row = { id: string; person_id: string; exception_date: string; code: ScheduleExceptionCode; origin: ScheduleExceptionOrigin; active: boolean; raw_reason: string | null; source: string; created_by_person_id: string | null; created_at: string; cancelled_at: string | null; cancelled_by_person_id: string | null; manual_override: boolean; provision_group_id: string | null }

function toRecord(row: Row): ScheduleExceptionRecord {
  return {
    id: row.id,
    personId: row.person_id,
    date: row.exception_date,
    code: row.code,
    label: SCHEDULE_EXCEPTION_LABELS[row.code] ?? row.code,
    origin: row.origin,
    active: row.active,
    rawReason: row.raw_reason,
    source: row.source,
    createdByPersonId: row.created_by_person_id,
    createdAt: new Date(row.created_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    cancelledByPersonId: row.cancelled_by_person_id,
    manualOverride: row.manual_override,
    provisionGroupId: row.provision_group_id,
  }
}

async function audit(db: Queryable, input: { organizationId: string; actorId: string; action: string; exceptionId: string; payload: Record<string, unknown> }): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'employee_schedule_exception', $4, $5)`, [input.organizationId, input.actorId, input.action, input.exceptionId, JSON.stringify(input.payload)])
}

export function validateProvisionRange(from: string, to: string): string[] {
  if (!DATE.test(from) || !DATE.test(to)) throw new DomainError("Datas devem estar no formato AAAA-MM-DD.", "SCHEDULE_EXCEPTION_INVALID_DATE", 422)
  if (from > to) throw new DomainError("A data inicial não pode ser posterior à final.", "SCHEDULE_EXCEPTION_INVALID_RANGE", 422)
  const dates = datesBetween(from, to)
  if (dates.length > MAX_PROVISION_SPAN_DAYS) throw new DomainError(`O período não pode ultrapassar ${MAX_PROVISION_SPAN_DAYS} dias.`, "SCHEDULE_EXCEPTION_RANGE_TOO_LONG", 422)
  return dates
}

export async function provisionScheduleExceptions(db: Queryable, input: ProvisionScheduleExceptionsInput): Promise<ProvisionOutcome> {
  const provisionable = (SUPERVISOR_PROVISIONABLE_CODES as readonly ScheduleExceptionCode[]).includes(input.code) || (input.allowScheduleAdjustment === true && input.code === "AJUSTE_ESCALA")
  if (!provisionable) throw new DomainError(`O motivo "${SCHEDULE_EXCEPTION_LABELS[input.code] ?? input.code}" não pode ser provisionado diretamente.`, "SCHEDULE_EXCEPTION_CODE_NOT_ALLOWED", 422)
  const dates = validateProvisionRange(input.from, input.to)
  const person = await db.query<{ id: string }>(`select id from people where id = $1 and organization_id = $2`, [input.personId, input.organizationId])
  if (person.rowCount === 0) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const existing = await db.query<Row>(`${SELECT} where person_id = $1 and code = $2 and exception_date = any($3::date[])`, [input.personId, input.code, dates])
  const byDate = new Map(existing.rows.map((row) => [row.exception_date, row]))
  const groupId = (await db.query<{ id: string }>(`select gen_random_uuid() id`)).rows[0]!.id
  const outcome: ProvisionOutcome = { created: [], reactivated: [], unchanged: [], provisionGroupId: groupId }
  const effect = SCHEDULE_EXCEPTION_EFFECT_BY_CODE[input.code]
  const label = SCHEDULE_EXCEPTION_LABELS[input.code]
  for (const date of dates) {
    const current = byDate.get(date)
    if (current?.active) {
      outcome.unchanged.push(toRecord(current))
      continue
    }
    if (current) {
      const updated = await db.query<Row>(
        `update employee_schedule_exceptions set active = true, origin = 'SUPERVISOR_MANUAL', created_by_person_id = $2, provision_group_id = $3, cancelled_at = null, cancelled_by_person_id = null,
                manual_override = case when origin = 'CENTRAL_DATA' or manual_override then true else false end, updated_at = now()
          where id = $1 returning ${COLUMNS}`,
        [current.id, input.actorPersonId, groupId],
      )
      const record = toRecord(updated.rows[0]!)
      outcome.reactivated.push(record)
      await audit(db, { organizationId: input.organizationId, actorId: input.actorPersonId, action: "SCHEDULE_EXCEPTION_REACTIVATED", exceptionId: record.id, payload: { personId: input.personId, date, code: input.code, before: { active: false, origin: current.origin, cancelledAt: current.cancelled_at }, after: { active: true, origin: "SUPERVISOR_MANUAL", manualOverride: record.manualOverride }, provisionGroupId: groupId } })
      continue
    }
    const inserted = await db.query<Row>(
      `insert into employee_schedule_exceptions (organization_id, person_id, exception_date, code, effect, raw_reason, active, source, origin, created_by_person_id, provision_group_id)
       values ($1, $2, $3::date, $4, $5, $6, true, 'MANUAL', 'SUPERVISOR_MANUAL', $7, $8)
       returning ${COLUMNS}`,
      [input.organizationId, input.personId, date, input.code, effect, label, input.actorPersonId, groupId],
    )
    const record = toRecord(inserted.rows[0]!)
    outcome.created.push(record)
    await audit(db, { organizationId: input.organizationId, actorId: input.actorPersonId, action: "SCHEDULE_EXCEPTION_PROVISIONED", exceptionId: record.id, payload: { personId: input.personId, date, code: input.code, before: null, after: { active: true, origin: "SUPERVISOR_MANUAL" }, provisionGroupId: groupId } })
  }
  return outcome
}

export async function cancelScheduleException(db: Queryable, input: { organizationId: string; exceptionId: string; actorPersonId: string }): Promise<ScheduleExceptionRecord> {
  const current = await db.query<Row>(`${SELECT} where id = $1 and organization_id = $2`, [input.exceptionId, input.organizationId])
  const row = current.rows[0]
  if (!row) throw new DomainError("Exceção de calendário não encontrada.", "SCHEDULE_EXCEPTION_NOT_FOUND", 404)
  if (!row.active) return toRecord(row)
  const updated = await db.query<Row>(
    `update employee_schedule_exceptions set active = false, cancelled_at = now(), cancelled_by_person_id = $2,
            manual_override = case when origin = 'CENTRAL_DATA' or manual_override then true else false end, updated_at = now()
      where id = $1 returning ${COLUMNS}`,
    [row.id, input.actorPersonId],
  )
  const record = toRecord(updated.rows[0]!)
  await audit(db, { organizationId: input.organizationId, actorId: input.actorPersonId, action: "SCHEDULE_EXCEPTION_CANCELLED", exceptionId: record.id, payload: { personId: row.person_id, date: row.exception_date, code: row.code, before: { active: true, origin: row.origin, source: row.source }, after: { active: false, manualOverride: record.manualOverride } } })
  return record
}

/** Exceções (ativas e canceladas) de N pessoas num intervalo — para o Calendário da equipe e o perfil. */
export async function listScheduleExceptions(db: Queryable, input: { organizationId: string; personIds: string[]; from: string; to: string }): Promise<ScheduleExceptionRecord[]> {
  if (input.personIds.length === 0) return []
  const result = await db.query<Row>(`${SELECT} where organization_id = $1 and person_id = any($2::uuid[]) and exception_date between $3::date and $4::date order by exception_date, created_at`, [input.organizationId, input.personIds, input.from, input.to])
  return result.rows.map(toRecord)
}

/** Trilha de auditoria de uma exceção (quem provisionou/reativou/cancelou, quando, o que mudou). */
export async function loadScheduleExceptionAudit(db: Queryable, organizationId: string, exceptionId: string): Promise<{ action: string; actorPersonId: string | null; actorName: string | null; createdAt: string; payload: Record<string, unknown> }[]> {
  const result = await db.query<{ action: string; actor_id: string | null; actor_name: string | null; created_at: string; payload: Record<string, unknown> }>(
    `select a.action, a.actor_id, p.name actor_name, a.created_at, a.payload from audit_logs a left join people p on p.id = a.actor_id
      where a.organization_id = $1 and a.entity_type = 'employee_schedule_exception' and a.entity_id = $2 order by a.created_at`,
    [organizationId, exceptionId],
  )
  return result.rows.map((row) => ({ action: row.action, actorPersonId: row.actor_id, actorName: row.actor_name, createdAt: new Date(row.created_at).toISOString(), payload: row.payload }))
}
