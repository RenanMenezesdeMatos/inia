import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { HumanReviewDecision } from "../domain/graph-schema.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"

export type SubmitHumanReviewDecisionInput = {
  enrollmentId: string
  /** Quando informado, a execução precisa pertencer a este workflow (caminho admin). */
  workflowId?: string
  nodeId: string
  decision: HumanReviewDecision
  reviewerId: string
}

export type SubmitHumanReviewDecisionResult = { enrollmentId: string; nodeId: string; decision: HumanReviewDecision; decidedAt: string }

/**
 * ÚNICO ponto que grava uma decisão humana (aprovar/reprovar/escalar) num node Human Review —
 * usado tanto pela rota admin do editor (workflow-router.ts) quanto pela Surface Pendências do
 * revisor (pending-actions). O motor nunca decide sozinho: a execução fica em `waiting` até
 * aqui, e retoma porque `status = 'active'` + `next_eval_at = now()` põem o enrollment de volta
 * no próximo tick, onde node-handlers.ts lê `node_outputs[nodeId].decision` e segue a aresta.
 *
 * Idempotência/concorrência: o update é condicionado à `revision` lida (optimistic lock) — dois
 * cliques ou duas abas nunca gravam duas vezes; a segunda tentativa cai em 409
 * (ENROLLMENT_NOT_AWAITING_DECISION, porque a execução já saiu de `waiting`) ou em
 * ENROLLMENT_CONCURRENT_UPDATE. O evento em workflow_enrollment_events tem chave de idempotência.
 */
export async function submitHumanReviewDecision(db: Database, input: SubmitHumanReviewDecisionInput): Promise<SubmitHumanReviewDecisionResult> {
  const columns = "id, status, current_node_id, revision, interaction_id, indicator_measurement_id, scheduled_subject_id"
  const enrollmentResult = input.workflowId
    ? await db.query<EnrollmentRow>(`select ${columns} from workflow_enrollments where id = $1 and workflow_id = $2`, [input.enrollmentId, input.workflowId])
    : await db.query<EnrollmentRow>(`select ${columns} from workflow_enrollments where id = $1`, [input.enrollmentId])
  const enrollment = enrollmentResult.rows[0]
  if (!enrollment) throw new DomainError("Execução não encontrada.", "ENROLLMENT_NOT_FOUND", 404)
  if (enrollment.status !== "waiting" || enrollment.current_node_id !== input.nodeId) {
    throw new DomainError("Esta execução não está aguardando decisão neste nó.", "ENROLLMENT_NOT_AWAITING_DECISION", 409)
  }
  // Separação de funções: ninguém decide a revisão do resultado sobre si mesmo — pela tela de Pendências ou pela de administração
  // (achado C16 da 4ª auditoria).
  const subjectId = await resolveEnrollmentOperatorId({ db, enrollment: { interactionId: enrollment.interaction_id ?? null, indicatorMeasurementId: enrollment.indicator_measurement_id ?? null, scheduledSubjectId: enrollment.scheduled_subject_id ?? null } })
  if (subjectId && subjectId === input.reviewerId) {
    throw new DomainError("Ninguém decide a revisão do próprio resultado.", "HUMAN_REVIEW_SELF_DECISION", 403)
  }

  const decidedAt = new Date().toISOString()
  const decisionPayload = JSON.stringify({ decision: input.decision, reviewerId: input.reviewerId, decidedAt })
  const updated = await db.query(
    `update workflow_enrollments
     set node_outputs = jsonb_set(node_outputs, array[$1], $2::jsonb, true),
         status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now()
     where id = $3 and revision = $4`,
    [input.nodeId, decisionPayload, enrollment.id, enrollment.revision],
  )
  if (updated.rowCount === 0) {
    throw new DomainError("A execução mudou de estado enquanto a decisão era enviada — tente novamente.", "ENROLLMENT_CONCURRENT_UPDATE", 409)
  }
  await db.query(
    `insert into workflow_enrollment_events(enrollment_id, node_id, event_type, payload, idempotency_key)
     values ($1,$2,'human_review_decision_submitted',$3,$4)
     on conflict (enrollment_id, idempotency_key) do nothing`,
    [enrollment.id, input.nodeId, decisionPayload, `${input.nodeId}:decision:${enrollment.revision}`],
  )
  return { enrollmentId: enrollment.id, nodeId: input.nodeId, decision: input.decision, decidedAt }
}

type EnrollmentRow = { id: string; status: string; current_node_id: string; revision: number; interaction_id?: string | null; indicator_measurement_id?: string | null; scheduled_subject_id?: string | null }
