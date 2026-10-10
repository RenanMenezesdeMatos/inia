import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * V1.7.1g — AUDITORIA DAS DECISÕES DE QA DE FEEDBACK (somente leitura, sem efeito).
 *
 * Reconstrói, para uma janela de tempo, quem decidiu o quê em cada item do QA (feedback confiável do Workflow e feedback direto
 * de atendimento), com a correlação que o banco guarda hoje: a revisão (autor + horário), o artefato/execução, o evento
 * `reliable_feedback_qa_resolved` que a decisão grava na MESMA transação e qualquer linha de `audit_logs` do autor na janela.
 *
 * O relatório diz explicitamente o que NÃO existe (`gaps`): a decisão de QA não grava `audit_logs`, nem sessão, request id,
 * endpoint, user agent ou origem (UI × API). Nada aqui corrige, reverte ou decide — é leitura.
 */
export const QA_DECISION_AUDIT_VERSION = "QA_DECISION_AUDIT_V1" as const

export type QaDecisionAuditGap = "NO_AUDIT_LOG" | "NO_SESSION_ID" | "NO_REQUEST_ID" | "NO_ENDPOINT" | "NO_CLIENT_ORIGIN"

export type QaDecisionRow = {
  origin: "WORKFLOW" | "INTERACTION"
  reviewId: string
  artifactId: string
  itemIndex: number
  decision: string
  reviewedAt: Date
  reviewerId: string | null
  reviewerName: string | null
  reasonCategory: string | null
  hasComment: boolean
  edited: boolean
  enrollmentId: string | null
  workflowName: string | null
  /** Evento de execução gravado junto com a decisão que fechou o artefato (null = a decisão não fechou o artefato). */
  resolvedEventAt: Date | null
  auditLogCount: number
}

export type QaDecisionAuditReport = {
  version: typeof QA_DECISION_AUDIT_VERSION
  window: { from: string; to: string }
  decisions: (QaDecisionRow & { gaps: QaDecisionAuditGap[] })[]
  totals: { decisions: number; byDecision: Record<string, number>; byReviewer: Record<string, number>; artifactsClosed: number }
  /** Sinal de ação humana explícita (não prova): rejeição exige motivo escolhido; edição exige texto novo. */
  explicitHumanSignals: string[]
  gaps: QaDecisionAuditGap[]
}

/** Lacunas fixas da infraestrutura atual (a decisão não grava sessão/request/endpoint/origem em lugar nenhum). */
const INFRASTRUCTURE_GAPS: QaDecisionAuditGap[] = ["NO_SESSION_ID", "NO_REQUEST_ID", "NO_ENDPOINT", "NO_CLIENT_ORIGIN"]

export function summarizeQaDecisionAudit(rows: readonly QaDecisionRow[], window: { from: string; to: string }): QaDecisionAuditReport {
  const decisions = [...rows].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime()).map((row) => ({ ...row, gaps: [...(row.auditLogCount === 0 ? ["NO_AUDIT_LOG" as const] : []), ...INFRASTRUCTURE_GAPS] }))
  const count = (key: (row: QaDecisionRow) => string) => decisions.reduce<Record<string, number>>((acc, row) => ({ ...acc, [key(row)]: (acc[key(row)] ?? 0) + 1 }), {})
  const signals = [
    ...decisions.filter((row) => row.decision === "REJECTED" && row.reasonCategory).map((row) => `REJECTED_WITH_REASON:${row.reviewId}`),
    ...decisions.filter((row) => row.edited).map((row) => `EDITED_TEXT:${row.reviewId}`),
  ]
  return {
    version: QA_DECISION_AUDIT_VERSION,
    window,
    decisions,
    totals: { decisions: decisions.length, byDecision: count((row) => row.decision), byReviewer: count((row) => row.reviewerName ?? row.reviewerId ?? "desconhecido"), artifactsClosed: decisions.filter((row) => row.resolvedEventAt !== null).length },
    explicitHumanSignals: signals,
    gaps: [...new Set(decisions.flatMap((row) => row.gaps))],
  }
}

/** Leitura (SELECT apenas) das decisões de QA da organização na janela. */
export async function loadQaDecisionAudit(db: Database, input: { organizationId: string; from: Date; to: Date }): Promise<QaDecisionAuditReport> {
  const result = await db.query<{ origin: "WORKFLOW" | "INTERACTION"; review_id: string; artifact_id: string; item_index: number; decision: string; reviewed_at: Date; reviewer_id: string | null; reviewer_name: string | null; reason_category: string | null; has_comment: boolean; edited: boolean; enrollment_id: string | null; workflow_name: string | null; resolved_event_at: Date | null; audit_log_count: string }>(
    `with decisions as (
       select 'WORKFLOW'::text origin, r.id review_id, r.artifact_id, r.item_index, r.review_status decision, r.reviewed_at, r.reviewed_by reviewer_id,
              r.reason_category, coalesce(length(r.reviewer_comment), 0) > 0 has_comment, r.final_wording is not null edited, a.enrollment_id, w.name workflow_name
       from reliable_feedback_item_reviews r
       join reliable_feedback_artifacts a on a.id = r.artifact_id
       left join workflows w on w.id = a.workflow_id
       where r.organization_id = $1 and r.reviewed_at between $2 and $3
       union all
       select 'INTERACTION', r.id, r.run_id, r.item_index, r.review_status, r.reviewed_at, r.reviewed_by,
              r.reason_category, coalesce(length(r.reviewer_comment), 0) > 0, r.final_wording is not null, null, null
       from interaction_feedback_item_reviews r
       where r.organization_id = $1 and r.reviewed_at between $2 and $3
     )
     select d.*, p.name reviewer_name,
            (select min(e.created_at) from workflow_enrollment_events e
              where e.enrollment_id = d.enrollment_id and e.event_type = 'reliable_feedback_qa_resolved'
                and e.payload->>'artifactId' = d.artifact_id::text and abs(extract(epoch from (e.created_at - d.reviewed_at))) < 1) resolved_event_at,
            (select count(*) from audit_logs l where l.organization_id = $1 and l.actor_id = d.reviewer_id
                and l.created_at between d.reviewed_at - interval '2 seconds' and d.reviewed_at + interval '2 seconds') audit_log_count
     from decisions d left join people p on p.id = d.reviewer_id
     order by d.reviewed_at`,
    [input.organizationId, input.from, input.to],
  )
  const rows: QaDecisionRow[] = result.rows.map((row) => ({
    origin: row.origin, reviewId: row.review_id, artifactId: row.artifact_id, itemIndex: row.item_index, decision: row.decision, reviewedAt: new Date(row.reviewed_at),
    reviewerId: row.reviewer_id, reviewerName: row.reviewer_name, reasonCategory: row.reason_category, hasComment: row.has_comment, edited: row.edited,
    enrollmentId: row.enrollment_id, workflowName: row.workflow_name, resolvedEventAt: row.resolved_event_at ? new Date(row.resolved_event_at) : null, auditLogCount: Number(row.audit_log_count),
  }))
  return summarizeQaDecisionAudit(rows, { from: input.from.toISOString(), to: input.to.toISOString() })
}
