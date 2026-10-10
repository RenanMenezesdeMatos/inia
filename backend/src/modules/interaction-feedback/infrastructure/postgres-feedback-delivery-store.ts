import type { Database } from "../../../infrastructure/database/pool.js"
import type { DeliveredFeedbackRow, DeliveryRecord, FeedbackDeliveryStore } from "../application/deliver-feedback.js"
import type { DeliveryCandidate } from "../domain/feedback-delivery-eligibility.js"
import type { ItemWording, WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"

type Queryable = Pick<Database, "query">
type DeliveryRow = {
  id: string; organization_id: string; collaborator_id: string; run_id: string; item_review_id: string; delivery_decision_id: string; delivery_mode: DeliveryRecord["deliveryMode"]; wording_source: DeliveryRecord["wordingSource"]
  proposed_origin: DeliveryRecord["proposedOrigin"]; qa_status: DeliveryRecord["qaStatus"]; policy_version: string; wording_sha256: string; delivered_at: Date; acknowledged_at: Date | null
}
const toRecord = (row: DeliveryRow): DeliveryRecord => ({
  id: row.id, organizationId: row.organization_id, collaboratorId: row.collaborator_id, runId: row.run_id, itemReviewId: row.item_review_id, deliveryDecisionId: row.delivery_decision_id, deliveryMode: row.delivery_mode,
  wordingSource: row.wording_source, proposedOrigin: row.proposed_origin, qaStatus: row.qa_status, policyVersion: row.policy_version, wordingSha256: row.wording_sha256, deliveredAt: row.delivered_at, acknowledgedAt: row.acknowledged_at,
})
const CANDIDATE_FROM = `from interaction_feedback_item_reviews r
  join interaction_feedback_delivery_decisions d on d.item_review_id = r.id and d.organization_id = r.organization_id
  join interaction_feedback_runs run on run.id = r.run_id and run.organization_id = r.organization_id`
/** Pronto para entrega (a mesma matriz do domínio, para achar candidatos; a decisão final é sempre `evaluateFeedbackDelivery`). */
const READY_WHERE = `d.delivered_at is null and d.structural_state = 'STRUCTURALLY_DELIVERABLE' and (
  (d.disposition in ('HOLD_FOR_QA', 'AUTO_DELIVER') and r.review_status in ('APPROVED_UNCHANGED', 'APPROVED_EDITED'))
  or (d.disposition = 'AUTO_DELIVER' and r.review_status = 'NOT_SELECTED_FOR_QA' and r.wording_source = 'WRITER')
) and not exists (select 1 from interaction_feedback_deliveries x where x.item_review_id = r.id)`

/** Entregas do feedback de interação (migration 080). Toda leitura/escrita filtra a organização. */
export function createPostgresFeedbackDeliveryStore(db: Queryable): FeedbackDeliveryStore {
  return {
    async loadCandidate(organizationId, itemReviewId) {
      const result = await db.query<{ item_review_id: string; decision_id: string; run_id: string; collaborator_id: string; structural_state: DeliveryCandidate["structural"]; disposition: DeliveryCandidate["disposition"]; policy_version: string; review_status: DeliveryCandidate["qaStatus"]; wording_source: "WRITER" | "FALLBACK"; proposed_wording: ItemWording; final_wording: ItemWording | null; delivered_at: Date | null }>(
        `select r.id item_review_id, d.id decision_id, r.run_id, run.collaborator_id, d.structural_state, d.disposition, d.policy_version, r.review_status, r.wording_source, r.proposed_wording, r.final_wording, d.delivered_at
         ${CANDIDATE_FROM} where r.organization_id = $1 and r.id = $2`,
        [organizationId, itemReviewId],
      )
      const row = result.rows[0]
      if (!row) return null
      return { organizationId, itemReviewId: row.item_review_id, decisionId: row.decision_id, runId: row.run_id, collaboratorId: row.collaborator_id, structural: row.structural_state, disposition: row.disposition, policyVersion: row.policy_version, qaStatus: row.review_status, proposedOrigin: row.wording_source, proposedWording: row.proposed_wording, finalWording: row.final_wording, deliveredAt: row.delivered_at }
    },

    async recordDelivery(delivery) {
      // UMA instrução: grava a entrega SÓ se o item ainda está exatamente no estado avaliado e sem entrega, e marca a decisão
      // como entregue junto. Concorrência: a segunda gravação esbarra no unique (item/decisão) e não grava nada.
      const result = await db.query<DeliveryRow>(
        `with ins as (
           insert into interaction_feedback_deliveries (organization_id, collaborator_id, run_id, item_review_id, delivery_decision_id, delivery_mode, wording_source, proposed_origin, qa_status, policy_version, wording_sha256, delivered_at, created_at)
           select r.organization_id, run.collaborator_id, r.run_id, r.id, d.id, $3, $4, r.wording_source, r.review_status, d.policy_version, $5, $6, $6
           ${CANDIDATE_FROM}
           where r.organization_id = $1 and r.id = $2 and r.review_status = $7 and d.disposition = $8 and d.structural_state = 'STRUCTURALLY_DELIVERABLE' and d.delivered_at is null
           on conflict do nothing
           returning *
         ), mark as (
           update interaction_feedback_delivery_decisions d set delivered_at = ins.delivered_at from ins where d.id = ins.delivery_decision_id returning d.id
         )
         select ins.* from ins where exists (select 1 from mark)`,
        [delivery.organizationId, delivery.itemReviewId, delivery.deliveryMode, delivery.wordingSource, delivery.wordingSha256, delivery.deliveredAt, delivery.qaStatus, delivery.expectedDisposition],
      )
      return result.rows[0] ? toRecord(result.rows[0]) : null
    },

    async findByItemReview(organizationId, itemReviewId) {
      const result = await db.query<DeliveryRow>(`select * from interaction_feedback_deliveries where organization_id = $1 and item_review_id = $2`, [organizationId, itemReviewId])
      return result.rows[0] ? toRecord(result.rows[0]) : null
    },

    async listReadyCandidates(limit) {
      const result = await db.query<{ organization_id: string; id: string }>(`select r.organization_id, r.id ${CANDIDATE_FROM} where ${READY_WHERE} order by r.reviewed_at nulls last, r.created_at limit $1`, [limit])
      return result.rows.map((row) => ({ organizationId: row.organization_id, itemReviewId: row.id }))
    },

    async listForCollaborator(organizationId, collaboratorId) {
      const result = await db.query<DeliveryRow & { section: "STRENGTH" | "OPPORTUNITY"; proposed_wording: ItemWording; final_wording: ItemWording | null; writer_item: WriterItem; interaction_label: string; occurred_at: Date | null }>(
        `select x.*, r.section, r.proposed_wording, r.final_wording, r.writer_item, r.interaction_label, run.occurred_at
         from interaction_feedback_deliveries x
         join interaction_feedback_item_reviews r on r.id = x.item_review_id and r.organization_id = x.organization_id
         join interaction_feedback_runs run on run.id = x.run_id and run.organization_id = x.organization_id
         where x.organization_id = $1 and x.collaborator_id = $2
         order by x.delivered_at desc, r.item_index`,
        [organizationId, collaboratorId],
      )
      // O texto entregue vem da ORIGEM imutável, pela versão registrada na entrega (proposto × final humano).
      return result.rows.map((row): DeliveredFeedbackRow => ({ delivery: toRecord(row), section: row.section, wording: row.wording_source === "HUMAN_EDITED" && row.final_wording ? row.final_wording : row.proposed_wording, writerItem: row.writer_item, interactionLabel: row.interaction_label, occurredAt: row.occurred_at }))
    },

    async acknowledge(organizationId, deliveryId, collaboratorId, at) {
      const result = await db.query<DeliveryRow>(
        `update interaction_feedback_deliveries set acknowledged_at = coalesce(acknowledged_at, greatest($4::timestamptz, delivered_at))
         where organization_id = $1 and id = $2 and collaborator_id = $3 returning *`,
        [organizationId, deliveryId, collaboratorId, at],
      )
      return result.rows[0] ? toRecord(result.rows[0]) : null
    },
  }
}
