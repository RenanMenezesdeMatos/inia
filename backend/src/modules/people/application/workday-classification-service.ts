import { systemClock } from "../../../shared/domain/clock.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  CLASSIFICATION_SUPERSEDED_REASON_LABELS,
  JUSTIFIED_ABSENCE_REASON_LABELS,
  WORKDAY_CLASSIFICATION_LABELS,
  describeWorkdayClassification,
  type ClassificationSupersededReason,
  type JustifiedAbsenceReason,
  type WorkdayClassificationKind,
  type WorkdayClassificationRef,
} from "../domain/workday-classification.js"
import type { Queryable } from "./schedule-exception-service.js"

/**
 * CLASSIFICAÇÃO OPERACIONAL — persistência por REVISÃO (`workday_classifications`): nunca overwrite.
 * A vigente é a linha sem `superseded_at`; cada mudança cria uma linha nova apontando para a anterior
 * (`supersedes_id`) e marca a anterior com quem/quando/por quê (REVISED pelo Supervisor, CONTRADICTED_BY_
 * WORK_EVIDENCE pelo job quando produção real aparece, SUPERSEDED_BY_AUTHORITATIVE_STATUS quando RH informa
 * férias/INSS…). Tudo também vai para `audit_logs` (entity_type `workday_classification`).
 *
 * O que NÃO é guardado: CID, diagnóstico, documento, descrição clínica — não existe coluna para isso.
 * O que NÃO acontece aqui: medição sintética (indicator_measurements segue só com dado real), exceção
 * de calendário (falta injustificada não muda a escala), decisão por IA.
 */
export type WorkdayClassificationRecord = WorkdayClassificationRef & {
  organizationId: string
  personId: string
  workday: string
  label: string
  reasonLabel: string | null
  origin: "SUPERVISOR_MANUAL"
  classifiedByPersonId: string | null
  classifiedByName: string | null
  classifiedAt: string
  reconciliationId: string | null
  supersedesId: string | null
  supersededAt: string | null
  supersededByPersonId: string | null
  supersededByName: string | null
  supersededReason: ClassificationSupersededReason | null
  supersededReasonLabel: string | null
}

type Row = {
  id: string
  organization_id: string
  person_id: string
  workday: string
  classification: WorkdayClassificationKind
  reason_code: JustifiedAbsenceReason | null
  origin: "SUPERVISOR_MANUAL"
  classified_by_person_id: string | null
  classified_by_name: string | null
  classified_at: string
  reconciliation_id: string | null
  supersedes_id: string | null
  superseded_at: string | null
  superseded_by_person_id: string | null
  superseded_by_name: string | null
  superseded_reason: ClassificationSupersededReason | null
}

function isoOf(value: string | Date | null | undefined): string {
  const time = value ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(time) ? "" : new Date(time).toISOString()
}

const SELECT = `select c.id, c.organization_id, c.person_id, to_char(c.workday, 'YYYY-MM-DD') workday, c.classification, c.reason_code, c.origin, c.classified_by_person_id, cb.name classified_by_name, c.classified_at,
                       c.reconciliation_id, c.supersedes_id, c.superseded_at, c.superseded_by_person_id, sb.name superseded_by_name, c.superseded_reason
                  from workday_classifications c left join people cb on cb.id = c.classified_by_person_id left join people sb on sb.id = c.superseded_by_person_id`

export function toClassification(row: Row): WorkdayClassificationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    workday: row.workday,
    classification: row.classification,
    reasonCode: row.reason_code,
    label: describeWorkdayClassification({ classification: row.classification, reasonCode: row.reason_code }),
    reasonLabel: row.reason_code ? JUSTIFIED_ABSENCE_REASON_LABELS[row.reason_code] : null,
    origin: row.origin,
    classifiedByPersonId: row.classified_by_person_id,
    classifiedByName: row.classified_by_name,
    classifiedAt: isoOf(row.classified_at),
    reconciliationId: row.reconciliation_id,
    supersedesId: row.supersedes_id,
    supersededAt: row.superseded_at ? new Date(row.superseded_at).toISOString() : null,
    supersededByPersonId: row.superseded_by_person_id,
    supersededByName: row.superseded_by_name,
    supersededReason: row.superseded_reason,
    supersededReasonLabel: row.superseded_reason ? CLASSIFICATION_SUPERSEDED_REASON_LABELS[row.superseded_reason] : null,
  }
}

export type ClassifyWorkdayInput = {
  organizationId: string
  personId: string
  workday: string
  classification: WorkdayClassificationKind
  reasonCode?: JustifiedAbsenceReason | null
  actorPersonId: string
  reconciliationId?: string | null
  /** Instante da decisão (Clock) — padrão: relógio do sistema. */
  now?: Date
}

export type ClassifyWorkdayOutcome = { current: WorkdayClassificationRecord; previous: WorkdayClassificationRecord | null; changed: boolean }

async function audit(db: Queryable, input: { organizationId: string; actorId: string | null; action: string; classificationId: string; payload: Record<string, unknown> }): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'workday_classification', $4, $5)`, [input.organizationId, input.actorId, input.action, input.classificationId, JSON.stringify(input.payload)])
}

export function validateClassificationInput(classification: WorkdayClassificationKind, reasonCode: JustifiedAbsenceReason | null | undefined): JustifiedAbsenceReason | null {
  if (classification === "JUSTIFIED_ABSENCE") {
    if (!reasonCode) throw new DomainError("Ausência justificada exige um motivo (atestado, day off, banco de horas, folga extraordinária ou outro).", "WORKDAY_CLASSIFICATION_REASON_REQUIRED", 422)
    return reasonCode
  }
  if (reasonCode) throw new DomainError(`"${WORKDAY_CLASSIFICATION_LABELS[classification]}" não aceita motivo.`, "WORKDAY_CLASSIFICATION_REASON_NOT_ALLOWED", 422)
  return null
}

export async function loadActiveClassification(db: Queryable, organizationId: string, personId: string, workday: string): Promise<WorkdayClassificationRecord | null> {
  const result = await db.query<Row>(`${SELECT} where c.organization_id = $1 and c.person_id = $2 and c.workday = $3::date and c.superseded_at is null limit 1`, [organizationId, personId, workday])
  return result.rows[0] ? toClassification(result.rows[0]) : null
}

/**
 * Classifica (ou REVISA) um dia. Idempotente: mesma classificação + motivo já vigente → nada muda.
 * Diferente → a vigente é marcada REVISED (ator, instante) e uma nova revisão nasce apontando para ela.
 * A reconciliação "Produção não identificada" do mesmo dia, se existir, passa a refletir a classificação
 * vigente (resolução + `classification_id`) — o histórico fica nas revisões e na auditoria.
 */
export async function classifyWorkday(db: Queryable, input: ClassifyWorkdayInput): Promise<ClassifyWorkdayOutcome> {
  const reasonCode = validateClassificationInput(input.classification, input.reasonCode)
  const now = input.now ?? systemClock.now()
  const person = await db.query<{ id: string }>(`select id from people where id = $1 and organization_id = $2`, [input.personId, input.organizationId])
  if (person.rowCount === 0) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const previous = await loadActiveClassification(db, input.organizationId, input.personId, input.workday)
  if (previous && previous.classification === input.classification && previous.reasonCode === reasonCode) return { current: previous, previous: null, changed: false }
  if (previous) {
    await db.query(`update workday_classifications set superseded_at = $3, superseded_by_person_id = $2, superseded_reason = 'REVISED' where id = $1`, [previous.id, input.actorPersonId, now])
  }
  const inserted = await db.query<{ id: string }>(
    `insert into workday_classifications (organization_id, person_id, workday, classification, reason_code, origin, classified_by_person_id, reconciliation_id, supersedes_id, classified_at)
     values ($1, $2, $3::date, $4, $5, 'SUPERVISOR_MANUAL', $6, $7, $8, $9) returning id`,
    [input.organizationId, input.personId, input.workday, input.classification, reasonCode, input.actorPersonId, input.reconciliationId ?? previous?.reconciliationId ?? null, previous?.id ?? null, now],
  )
  const current = (await loadActiveClassification(db, input.organizationId, input.personId, input.workday))!
  await db.query(
    `update workday_reconciliations set resolution = $3, classification_id = $4, resolved_by_person_id = $5, resolved_at = $7, status = 'RESOLVED', updated_at = $7
      where organization_id = $1 and person_id = $2 and workday = $6::date and kind = 'MISSING_EXPECTED_PRODUCTION'`,
    [input.organizationId, input.personId, input.classification, inserted.rows[0]!.id, input.actorPersonId, input.workday, now],
  )
  await audit(db, {
    organizationId: input.organizationId,
    actorId: input.actorPersonId,
    action: previous ? "WORKDAY_CLASSIFICATION_REVISED" : "WORKDAY_CLASSIFIED",
    classificationId: current.id,
    payload: { personId: input.personId, workday: input.workday, before: previous ? { id: previous.id, classification: previous.classification, reasonCode: previous.reasonCode } : null, after: { classification: input.classification, reasonCode }, reconciliationId: current.reconciliationId },
  })
  return { current, previous, changed: true }
}

/** O SISTEMA (job) marca uma classificação como superada por fato mais forte — nunca apaga, nunca cria outra. */
export async function supersedeClassificationBySystem(db: Queryable, input: { organizationId: string; classificationId: string; reason: Exclude<ClassificationSupersededReason, "REVISED">; detail: Record<string, unknown>; now?: Date }): Promise<boolean> {
  const updated = await db.query<{ id: string }>(`update workday_classifications set superseded_at = $4, superseded_by_person_id = null, superseded_reason = $2 where id = $1 and organization_id = $3 and superseded_at is null returning id`, [input.classificationId, input.reason, input.organizationId, input.now ?? systemClock.now()])
  if (updated.rowCount === 0) return false
  await audit(db, { organizationId: input.organizationId, actorId: null, action: "WORKDAY_CLASSIFICATION_SUPERSEDED", classificationId: input.classificationId, payload: { reason: input.reason, ...input.detail } })
  return true
}

/** Classificações VIGENTES de N pessoas num intervalo (resolvedor de elegibilidade; uma consulta). */
export async function listActiveClassifications(db: Queryable, input: { personIds: string[]; from: string; to: string }): Promise<WorkdayClassificationRecord[]> {
  if (input.personIds.length === 0) return []
  const result = await db.query<Row>(`${SELECT} where c.person_id = any($1::uuid[]) and c.workday between $2::date and $3::date and c.superseded_at is null order by c.workday`, [input.personIds, input.from, input.to])
  return result.rows.filter((row) => typeof row.classification === "string" && typeof row.workday === "string").map(toClassification)
}

/** Histórico completo (todas as revisões) de um dia — em ordem cronológica. */
export async function loadClassificationHistory(db: Queryable, organizationId: string, personId: string, workday: string): Promise<WorkdayClassificationRecord[]> {
  const result = await db.query<Row>(`${SELECT} where c.organization_id = $1 and c.person_id = $2 and c.workday = $3::date order by c.classified_at`, [organizationId, personId, workday])
  return result.rows.map(toClassification)
}

/** Pessoas com classificação vigente numa janela (para o job revisar contradições em lote). */
export async function listPeopleWithActiveClassifications(db: Queryable, organizationId: string, from: string, to: string): Promise<string[]> {
  const result = await db.query<{ person_id: string }>(`select distinct person_id from workday_classifications where organization_id = $1 and superseded_at is null and workday between $2::date and $3::date`, [organizationId, from, to])
  return result.rows.map((row) => row.person_id)
}
