import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { reactivateWaitingEnrollment } from "../../workflows/application/reactivate-enrollment.js"

/**
 * RETENÇÕES ANTIGAS DE QA (caminho anterior: `reliable_feedback_artifacts` em HOLD_FOR_QA com itens aguardando avaliação).
 * O motor novo não depende de aprovação humana; uma retenção antiga nunca é tratada como aprovada. Duas saídas explícitas, com
 * motivo, idempotentes e auditadas:
 *
 * - `REPROCESS`: o artefato antigo é SUBSTITUÍDO (superseded_at + motivo; os itens pendentes saem da fila de QA) e a matrícula
 *   que esperava no nó "Gerar feedback" é reativada — o nó roda de novo pelo motor (análise → mensagem ou abstenção).
 * - `CLOSE`: o artefato é substituído e a matrícula que esperava é ENCERRADA (concluída sem entrega), com o motivo no evento.
 *
 * Nada é apagado: artefato, itens, decisões já tomadas e eventos continuam no histórico. Artefato de matrícula que já saiu do
 * nó (ou sem matrícula) só é substituído. Revisão humana EXPLÍCITA do grafo (nó "Revisão humana") não é tocada aqui.
 */
export type LegacyHold = {
  artifactId: string
  organizationId: string
  enrollmentId: string | null
  nodeId: string
  workflowName: string | null
  collaboratorName: string | null
  domain: string
  label: string | null
  createdAt: string
  pendingItems: number
  decidedItems: number
  enrollmentStatus: string | null
  waitingAtNode: boolean
}

export type LegacyHoldResolution = { artifactId: string; superseded: boolean; enrollment: "REACTIVATED" | "CLOSED" | "NOT_WAITING" | "NONE" }

export async function findLegacyHolds(db: Pick<Database, "query">, organizationId: string | null = null): Promise<LegacyHold[]> {
  const rows = await db.query<{ id: string; organization_id: string; enrollment_id: string | null; node_id: string; workflow_name: string | null; collaborator_name: string | null; domain: string; label: string | null; created_at: Date; pending: number; decided: number; enrollment_status: string | null; current_node_id: string | null }>(
    `select a.id, a.organization_id, a.enrollment_id, a.node_id, w.name workflow_name, p.name collaborator_name, a.domain, a.artifact ->> 'label' label, a.created_at,
            (count(*) filter (where r.review_status = 'PENDING_REVIEW'))::int pending, (count(*) filter (where r.review_status <> 'PENDING_REVIEW'))::int decided,
            e.status enrollment_status, e.current_node_id
       from reliable_feedback_artifacts a
       join reliable_feedback_item_reviews r on r.artifact_id = a.id and r.organization_id = a.organization_id
       left join workflow_enrollments e on e.id = a.enrollment_id
       left join workflows w on w.id = e.workflow_id
       left join people p on p.id = a.collaborator_id
      where a.status = 'COMPLETED' and a.disposition = 'HOLD_FOR_QA' and a.qa_resolved_at is null and a.superseded_at is null
        and ($1::uuid is null or a.organization_id = $1)
      group by a.id, w.name, p.name, e.status, e.current_node_id
     having count(*) filter (where r.review_status = 'PENDING_REVIEW') > 0
      order by a.created_at, a.id`,
    [organizationId],
  )
  return rows.rows.map((row) => ({
    artifactId: row.id, organizationId: row.organization_id, enrollmentId: row.enrollment_id, nodeId: row.node_id, workflowName: row.workflow_name, collaboratorName: row.collaborator_name, domain: row.domain, label: row.label,
    createdAt: row.created_at.toISOString(), pendingItems: row.pending, decidedItems: row.decided, enrollmentStatus: row.enrollment_status, waitingAtNode: row.enrollment_status === "waiting" && row.current_node_id === row.node_id,
  }))
}

/** Aplica UMA saída a uma retenção (transação própria; repetir não muda nada). */
export async function resolveLegacyHold(db: Database, input: { organizationId: string; artifactId: string; mode: "REPROCESS" | "CLOSE"; reason: string; actorId?: string | null; now?: Date }): Promise<LegacyHoldResolution> {
  const reason = input.reason.trim()
  if (!reason) throw new Error("Informe o motivo do encerramento/reprocessamento.")
  const now = input.now ?? new Date()
  return inTransaction(db, async (client) => {
    const superseded = await client.query<{ enrollment_id: string | null; node_id: string }>(
      `update reliable_feedback_artifacts set superseded_at = $3, superseded_reason = $4, updated_at = $3
        where organization_id = $1 and id = $2 and superseded_at is null and qa_resolved_at is null and disposition = 'HOLD_FOR_QA'
        returning enrollment_id, node_id`,
      [input.organizationId, input.artifactId, now, `${input.mode}: ${reason}`],
    )
    const row = superseded.rows[0]
    if (!row) return { artifactId: input.artifactId, superseded: false, enrollment: "NONE" }
    let enrollment: LegacyHoldResolution["enrollment"] = "NONE"
    if (row.enrollment_id) {
      if (input.mode === "REPROCESS") {
        enrollment = (await reactivateWaitingEnrollment(client, { organizationId: input.organizationId, enrollmentId: row.enrollment_id, nodeId: row.node_id, reason: "legacy_hold_reprocess", payload: { artifactId: input.artifactId, reason } })) ? "REACTIVATED" : "NOT_WAITING"
      } else {
        const closed = await client.query(
          `update workflow_enrollments set status = 'completed', claimed_until = null, revision = revision + 1, updated_at = $4
            where id = $1 and organization_id = $2 and status = 'waiting' and current_node_id = $3`,
          [row.enrollment_id, input.organizationId, row.node_id, now],
        )
        enrollment = (closed.rowCount ?? 0) > 0 ? "CLOSED" : "NOT_WAITING"
        if (enrollment === "CLOSED") {
          await client.query(
            `insert into workflow_enrollment_events(enrollment_id, node_id, event_type, payload, idempotency_key) values ($1, $2, 'legacy_hold_closed', $3, $4)
             on conflict (enrollment_id, idempotency_key) do nothing`,
            [row.enrollment_id, row.node_id, JSON.stringify({ artifactId: input.artifactId, reason, delivered: false }), `${row.node_id}:legacy_hold_closed`],
          )
        }
      }
    }
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'reliable_feedback_artifact', $4, $5)`,
      [input.organizationId, input.actorId ?? null, input.mode === "REPROCESS" ? "LEGACY_FEEDBACK_HOLD_REPROCESSED" : "LEGACY_FEEDBACK_HOLD_CLOSED", input.artifactId, JSON.stringify({ reason, enrollmentId: row.enrollment_id, enrollment })],
    )
    return { artifactId: input.artifactId, superseded: true, enrollment }
  })
}
