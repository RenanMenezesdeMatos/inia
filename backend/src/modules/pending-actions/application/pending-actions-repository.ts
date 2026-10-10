import type { Database } from "../../../infrastructure/database/pool.js"
import { toReconciliation, type ReconciliationRow } from "../../people/application/workday-reconciliation-service.js"
import type { ClassificationSupersededReason, JustifiedAbsenceReason, WorkdayClassificationKind } from "../../people/domain/workday-classification.js"
import { flowGraphSchema, type FlowGraph } from "../../workflows/domain/graph-schema.js"
import type { PendingActionPerson, ReviewEvidence, ReviewTimelineEvent } from "../domain/view-models.js"

/**
 * Leitura de "revisão humana endereçada a mim". A FONTE da pendência é a execução real
 * (`workflow_enrollments` em `waiting` no node), nunca o alerta: o alerta WORKFLOW_HUMAN_REVIEW
 * só diz QUEM foi chamado a decidir (recipient_id) e QUANDO. Um alerta cuja execução não existe
 * mais (workflow apagado, execução cancelada) não é pendência — some da fila em vez de virar um
 * botão que nunca funciona. Chave de ligação: `dedupe_key = workflow_human_review:<enrollment>:<node>`,
 * gravada pelo próprio motor (human-review-executor.ts).
 */
export type ReviewAlertRow = {
  alertId: string
  alertStatus: string
  requestedAt: string
  caseId: string | null
  enrollmentId: string
  nodeId: string
  enrollment: {
    status: string
    currentNodeId: string
    nodeOutputs: Record<string, unknown>
    versionId: string
    workflowName: string
    operatorId: string | null
  } | null
}

export type ReviewCase = { title: string; summary: string; evidences: ReviewEvidence[] }

/** Reconciliação "Produção não identificada" endereçada ao viewer (recipient_person_id) — fonte: `workday_reconciliations`. */
export type WorkdayReconciliationRecord = ReconciliationRow & {
  resolutionException: { id: string; code: string } | null
  /** Classificação vinculada à resolução (vigente ou já superada por fato posterior). */
  classification: { id: string; classification: WorkdayClassificationKind; reasonCode: JustifiedAbsenceReason | null; classifiedAt: string | null; supersededReason: ClassificationSupersededReason | null } | null
}

export interface PendingActionsRepository {
  loadReviewAlerts(viewerId: string, organizationId: string): Promise<ReviewAlertRow[]>
  loadReviewAlert(viewerId: string, organizationId: string, enrollmentId: string, nodeId: string): Promise<ReviewAlertRow | null>
  /** Pendências de produção do viewer: abertas + resolvidas recentes (histórico). Só MISSING_EXPECTED_PRODUCTION é acionável. */
  loadWorkdayReconciliations(viewerId: string, organizationId: string): Promise<WorkdayReconciliationRecord[]>
  loadWorkdayReconciliation(viewerId: string, organizationId: string, reconciliationId: string): Promise<WorkdayReconciliationRecord | null>
  loadGraph(versionId: string): Promise<FlowGraph | null>
  loadPeople(personIds: string[]): Promise<Map<string, PendingActionPerson>>
  loadCase(caseId: string): Promise<ReviewCase | null>
  loadEnrollmentEvents(enrollmentId: string): Promise<ReviewTimelineEvent[]>
  /** Alerta deixa de ser "aberto" quando a decisão é tomada — consequência de negócio, não estado de leitura. */
  resolveAlert(alertId: string): Promise<void>
  countPendingByOperator(viewerId: string, organizationId: string, operatorIds: string[]): Promise<Map<string, number>>
  countPending(viewerId: string, organizationId: string): Promise<number>
}

const REVIEW_ALERTS_CTE = `
  with review_alerts as (
    select a.id, a.status, a.created_at, a.case_id,
           substring(a.dedupe_key from '^workflow_human_review:([0-9a-f-]{36}):') enrollment_key,
           substring(a.dedupe_key from '^workflow_human_review:[0-9a-f-]{36}:(.+)$') node_key
    from alerts a
    where a.recipient_id = $1 and a.organization_id = $2 and a.alert_type = 'WORKFLOW_HUMAN_REVIEW'
      and a.dedupe_key ~ '^workflow_human_review:[0-9a-f-]{36}:.+$'
  )`

const REVIEW_ALERT_SELECT = `
  select ra.id "alertId", ra.status::text "alertStatus", ra.created_at "requestedAt", ra.case_id "caseId",
         ra.enrollment_key "enrollmentId", ra.node_key "nodeId",
         e.id "enrollmentExists", e.status "enrollmentStatus", e.current_node_id "currentNodeId", e.node_outputs "nodeOutputs",
         e.version_id "versionId", w.name "workflowName",
         coalesce(c.operator_id, e.scheduled_subject_id, m.subject_id, i.operator_id) "operatorId"
  from review_alerts ra
  left join workflow_enrollments e on e.id = ra.enrollment_key::uuid
  left join workflows w on w.id = e.workflow_id
  left join supervision_cases c on c.id = ra.case_id
  left join indicator_measurements m on m.id = e.indicator_measurement_id
  left join interactions i on i.id = e.interaction_id`

type ReviewAlertDbRow = {
  alertId: string; alertStatus: string; requestedAt: string; caseId: string | null; enrollmentId: string; nodeId: string
  enrollmentExists: string | null; enrollmentStatus: string | null; currentNodeId: string | null; nodeOutputs: Record<string, unknown> | null
  versionId: string | null; workflowName: string | null; operatorId: string | null
}

function mapReviewAlert(row: ReviewAlertDbRow): ReviewAlertRow {
  return {
    alertId: row.alertId,
    alertStatus: row.alertStatus,
    requestedAt: new Date(row.requestedAt).toISOString(),
    caseId: row.caseId,
    enrollmentId: row.enrollmentId,
    nodeId: row.nodeId,
    enrollment: row.enrollmentExists
      ? {
          status: row.enrollmentStatus ?? "unknown",
          currentNodeId: row.currentNodeId ?? "",
          nodeOutputs: row.nodeOutputs ?? {},
          versionId: row.versionId ?? "",
          workflowName: row.workflowName ?? "Workflow",
          operatorId: row.operatorId,
        }
      : null,
  }
}

/** Mesma definição de "pendente" usada por lista, contadores da Equipe e badge do sino. */
const PENDING_CONDITION = `e.status = 'waiting' and e.current_node_id = ra.node_key`

/** Pendência de produção: reconciliação MISSING_EXPECTED_PRODUCTION ainda OPEN, endereçada ao viewer. */
const OPEN_RECONCILIATION_CONDITION = `r.recipient_person_id = $1 and r.organization_id = $2 and r.kind = 'MISSING_EXPECTED_PRODUCTION' and r.status = 'OPEN'`

const RECONCILIATION_SELECT = `select r.id, r.organization_id, r.person_id, to_char(r.workday, 'YYYY-MM-DD') workday, r.kind, r.status, r.snapshot, r.recipient_person_id, r.alert_id, r.resolution, r.resolution_exception_id, r.classification_id, r.resolved_by_person_id, r.resolved_at, r.detected_at, x.code exception_code,
       c.classification, c.reason_code, c.classified_at, c.superseded_reason
  from workday_reconciliations r left join employee_schedule_exceptions x on x.id = r.resolution_exception_id left join workday_classifications c on c.id = r.classification_id`

type ReconciliationDbRow = Parameters<typeof toReconciliation>[0] & { exception_code: string | null; classification: string | null; reason_code: string | null; classified_at: string | null; superseded_reason: string | null }

function mapReconciliation(row: ReconciliationDbRow): WorkdayReconciliationRecord {
  const base = toReconciliation(row)
  return {
    ...base,
    resolutionException: base.resolutionExceptionId && row.exception_code ? { id: base.resolutionExceptionId, code: row.exception_code } : null,
    classification: base.classificationId && row.classification ? { id: base.classificationId, classification: row.classification as WorkdayClassificationKind, reasonCode: (row.reason_code as JustifiedAbsenceReason | null) ?? null, classifiedAt: row.classified_at ? new Date(row.classified_at).toISOString() : null, supersededReason: (row.superseded_reason as ClassificationSupersededReason | null) ?? null } : null,
  }
}

export class PgPendingActionsRepository implements PendingActionsRepository {
  constructor(private readonly db: Database) {}

  async loadReviewAlerts(viewerId: string, organizationId: string): Promise<ReviewAlertRow[]> {
    const result = await this.db.query<ReviewAlertDbRow>(`${REVIEW_ALERTS_CTE} ${REVIEW_ALERT_SELECT} order by ra.created_at desc limit 200`, [viewerId, organizationId])
    return result.rows.map(mapReviewAlert)
  }

  async loadReviewAlert(viewerId: string, organizationId: string, enrollmentId: string, nodeId: string): Promise<ReviewAlertRow | null> {
    const result = await this.db.query<ReviewAlertDbRow>(
      `${REVIEW_ALERTS_CTE} ${REVIEW_ALERT_SELECT} where ra.enrollment_key = $3 and ra.node_key = $4 limit 1`,
      [viewerId, organizationId, enrollmentId, nodeId],
    )
    const row = result.rows[0]
    return row ? mapReviewAlert(row) : null
  }

  async loadWorkdayReconciliations(viewerId: string, organizationId: string): Promise<WorkdayReconciliationRecord[]> {
    const result = await this.db.query<ReconciliationDbRow>(
      `${RECONCILIATION_SELECT}
        where r.recipient_person_id = $1 and r.organization_id = $2 and r.kind = 'MISSING_EXPECTED_PRODUCTION'
          and (r.status = 'OPEN' or r.resolved_at >= now() - interval '30 days')
        order by (r.status = 'OPEN') desc, r.workday desc, r.detected_at desc limit 200`,
      [viewerId, organizationId],
    )
    return result.rows.map(mapReconciliation)
  }

  async loadWorkdayReconciliation(viewerId: string, organizationId: string, reconciliationId: string): Promise<WorkdayReconciliationRecord | null> {
    const result = await this.db.query<ReconciliationDbRow>(`${RECONCILIATION_SELECT} where r.recipient_person_id = $1 and r.organization_id = $2 and r.id = $3 limit 1`, [viewerId, organizationId, reconciliationId])
    return result.rows[0] ? mapReconciliation(result.rows[0]) : null
  }

  async loadGraph(versionId: string): Promise<FlowGraph | null> {
    const result = await this.db.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [versionId])
    const raw = result.rows[0]?.graph
    if (!raw) return null
    const parsed = flowGraphSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  async loadPeople(personIds: string[]): Promise<Map<string, PendingActionPerson>> {
    const people = new Map<string, PendingActionPerson>()
    if (personIds.length === 0) return people
    const result = await this.db.query<{ id: string; name: string; team_name: string | null; job_title: string | null }>(
      `select p.id, p.name, t.name team_name, p.job_title from people p left join teams t on t.id = p.team_id where p.id = any($1::uuid[])`,
      [personIds],
    )
    for (const row of result.rows) people.set(row.id, { personId: row.id, name: row.name, teamName: row.team_name, jobTitle: row.job_title })
    return people
  }

  async loadCase(caseId: string): Promise<ReviewCase | null> {
    const [caseResult, evidenceResult] = await Promise.all([
      this.db.query<{ title: string; summary: string }>(`select title, summary from supervision_cases where id = $1`, [caseId]),
      this.db.query<{ id: string; evidence_type: string; title: string; description: string; occurred_at: string }>(
        `select id, evidence_type, title, description, occurred_at from evidences where case_id = $1 order by occurred_at desc limit 20`,
        [caseId],
      ),
    ])
    const row = caseResult.rows[0]
    if (!row) return null
    return {
      title: row.title,
      summary: row.summary,
      evidences: evidenceResult.rows.map((evidence) => ({ id: evidence.id, type: evidence.evidence_type, title: evidence.title, description: evidence.description, occurredAt: new Date(evidence.occurred_at).toISOString() })),
    }
  }

  async loadEnrollmentEvents(enrollmentId: string): Promise<ReviewTimelineEvent[]> {
    const result = await this.db.query<{ event_type: string; node_id: string | null; created_at: string }>(
      `select event_type, node_id, created_at from workflow_enrollment_events where enrollment_id = $1 order by created_at asc limit 100`,
      [enrollmentId],
    )
    return result.rows.map((row) => ({ eventType: row.event_type, nodeId: row.node_id, createdAt: new Date(row.created_at).toISOString() }))
  }

  async resolveAlert(alertId: string): Promise<void> {
    await this.db.query(`update alerts set status = 'RESOLVED', resolved_at = now() where id = $1 and status <> 'RESOLVED'`, [alertId])
  }

  async countPendingByOperator(viewerId: string, organizationId: string, operatorIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    if (operatorIds.length === 0) return counts
    const result = await this.db.query<{ operator_id: string; pending: number }>(
      `${REVIEW_ALERTS_CTE}
       select operator_id, sum(pending)::int pending from (
         select coalesce(c.operator_id, e.scheduled_subject_id, m.subject_id, i.operator_id) operator_id, count(*)::int pending
         from review_alerts ra
         join workflow_enrollments e on e.id = ra.enrollment_key::uuid
         left join supervision_cases c on c.id = ra.case_id
         left join indicator_measurements m on m.id = e.indicator_measurement_id
         left join interactions i on i.id = e.interaction_id
         where ${PENDING_CONDITION}
           and coalesce(c.operator_id, e.scheduled_subject_id, m.subject_id, i.operator_id) = any($3::uuid[])
         group by 1
         union all
         select r.person_id operator_id, count(*)::int pending from workday_reconciliations r where ${OPEN_RECONCILIATION_CONDITION} and r.person_id = any($3::uuid[]) group by 1
       ) t group by operator_id`,
      [viewerId, organizationId, operatorIds],
    )
    for (const row of result.rows) counts.set(row.operator_id, Number(row.pending))
    return counts
  }

  async countPending(viewerId: string, organizationId: string): Promise<number> {
    const result = await this.db.query<{ pending: number }>(
      `${REVIEW_ALERTS_CTE}
       select ((select count(*) from review_alerts ra join workflow_enrollments e on e.id = ra.enrollment_key::uuid where ${PENDING_CONDITION})
             + (select count(*) from workday_reconciliations r where ${OPEN_RECONCILIATION_CONDITION}))::int pending`,
      [viewerId, organizationId],
    )
    return Number(result.rows[0]?.pending ?? 0)
  }
}
