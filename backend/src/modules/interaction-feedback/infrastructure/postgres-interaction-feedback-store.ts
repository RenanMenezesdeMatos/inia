import type { Database } from "../../../infrastructure/database/pool.js"
import type { ItemWording, WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"
import type { DeliveryDecisionRecord, InteractionFeedbackStore, ItemReviewRecord } from "../application/ports.js"
import type { ReviewReasonCategory, ReviewStatus } from "../domain/feedback-review.js"

type Queryable = Pick<Database, "query">
type ReviewRow = {
  id: string; organization_id: string; run_id: string; slot: string; item_index: number; section: "STRENGTH" | "OPPORTUNITY"; finding_kind: string; guidance_source: string
  writer_item: WriterItem; interaction_label: string; wording_source: "WRITER" | "FALLBACK"; writer_violations: string[]; writer_original: unknown; proposed_wording: ItemWording
  review_required_by: string[]; review_status: ReviewStatus; final_wording: ItemWording | null; reason_category: ReviewReasonCategory | null; reviewer_comment: string | null
  edit_warnings: string[]; reviewed_by: string | null; reviewed_at: Date | null; created_at: Date
}
const toRecord = (row: ReviewRow): ItemReviewRecord => ({
  id: row.id, organizationId: row.organization_id, runId: row.run_id, slot: row.slot, itemIndex: row.item_index, section: row.section, findingKind: row.finding_kind, guidanceSource: row.guidance_source,
  writerItem: row.writer_item, interactionLabel: row.interaction_label, wordingSource: row.wording_source, writerViolations: row.writer_violations as ItemReviewRecord["writerViolations"], writerOriginal: row.writer_original,
  proposedWording: row.proposed_wording, reviewRequiredBy: row.review_required_by, reviewStatus: row.review_status, finalWording: row.final_wording, reasonCategory: row.reason_category,
  reviewerComment: row.reviewer_comment, editWarnings: row.edit_warnings, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, createdAt: row.created_at,
})
type DecisionRow = {
  id: string; organization_id: string; run_id: string; item_index: number; section: "STRENGTH" | "OPPORTUNITY"; finding_kind: string; structural_state: "STRUCTURALLY_DELIVERABLE" | "BLOCKED"
  disposition: "AUTO_DELIVER" | "HOLD_FOR_QA" | "BLOCKED"; reasons: string[]; policy_version: string; autonomy_eligible: boolean | null; autonomy_blockers: string[]; item_review_id: string | null; delivered_at: Date | null; created_at: Date
}
const toDecision = (row: DecisionRow): DeliveryDecisionRecord => ({
  id: row.id, organizationId: row.organization_id, runId: row.run_id, itemIndex: row.item_index, section: row.section, findingKind: row.finding_kind, itemReviewId: row.item_review_id, deliveredAt: row.delivered_at, createdAt: row.created_at,
  decision: { disposition: row.disposition, structural: row.structural_state, reasons: row.reasons as DeliveryDecisionRecord["decision"]["reasons"], policyVersion: row.policy_version, autonomyEligible: row.autonomy_eligible, autonomyBlockers: row.autonomy_blockers as DeliveryDecisionRecord["decision"]["autonomyBlockers"] },
})
const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value))

/** Persistência Postgres do pipeline (migrations 077–079). Toda consulta filtra `organization_id`; a decisão só grava sobre PENDING_REVIEW. */
export function createPostgresInteractionFeedbackStore(db: Queryable): InteractionFeedbackStore {
  return {
    async createRun(run) {
      const result = await db.query<{ id: string }>(
        `insert into interaction_feedback_runs (organization_id, collaborator_id, team_id, interaction_id, pipeline_version, contract_version, status, delivery_state, writer_invoked, writer_skipped_reason, feedback_snapshot, writer_input, occurred_at, created_at, generation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15) returning id`,
        [run.organizationId, run.collaboratorId, run.teamId, run.interactionId, run.pipelineVersion, run.contractVersion, run.status, run.deliveryState, run.writerInvoked, run.writerSkippedReason, json(run.feedbackSnapshot), json(run.writerInput), run.occurredAt, run.createdAt, run.generationId ?? null],
      )
      return result.rows[0]!.id
    },
    async recordWriterOutcome(runId, outcome) {
      await db.query(`update interaction_feedback_runs set writer_raw_output = $2::jsonb, writer_error = $3, writer_provenance = $4::jsonb where id = $1`, [runId, json(outcome.rawOutput), outcome.error, json(outcome.provenance)])
    },
    async createItemReviews(list) {
      const records: ItemReviewRecord[] = []
      for (const review of list) {
        const result = await db.query<ReviewRow>(
          `insert into interaction_feedback_item_reviews (organization_id, run_id, slot, item_index, section, finding_kind, guidance_source, writer_item, interaction_label, wording_source, writer_violations, writer_original, proposed_wording, review_required_by, review_status, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16) returning *`,
          [review.organizationId, review.runId, review.slot, review.itemIndex, review.section, review.findingKind, review.guidanceSource, json(review.writerItem), review.interactionLabel, review.wordingSource, review.writerViolations, json(review.writerOriginal), json(review.proposedWording), review.reviewRequiredBy, review.initialStatus, review.createdAt],
        )
        records.push(toRecord(result.rows[0]!))
      }
      return records
    },
    async createOccurrences(context, list) {
      const ids: { itemIndex: number; id: string }[] = []
      for (const occurrence of list) {
        const result = await db.query<{ id: string }>(
          `insert into operational_issue_occurrences (organization_id, run_id, collaborator_id, team_id, interaction_id, finding_kind, issue_category, structural_polarity, ownership, scope, evidence_refs, finding_refs, delivery_status, occurred_at, pipeline_version, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16) returning id`,
          [context.organizationId, context.runId, context.collaboratorId, context.teamId, context.interactionId, occurrence.findingKind, occurrence.issueCategory, occurrence.structuralPolarity, occurrence.ownership, occurrence.scope, json(occurrence.evidenceRefs), occurrence.findingRefs, occurrence.deliveryStatus, context.occurredAt, context.pipelineVersion, context.createdAt],
        )
        ids.push({ itemIndex: occurrence.itemIndex, id: result.rows[0]!.id })
      }
      return ids
    },
    async createRecommendations(organizationId, list, createdAt) {
      const ids: string[] = []
      for (const recommendation of list) {
        const result = await db.query<{ id: string }>(
          `insert into knowledge_recommendations (organization_id, operational_issue_occurrence_id, knowledge_base_id, document_id, document_title, rule_ref, href, recommendation_reason, recommendation_type, delivery_status, review_status, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [organizationId, recommendation.occurrenceId, recommendation.knowledgeBaseId, recommendation.documentId, recommendation.documentTitle, recommendation.ruleRef, recommendation.href, recommendation.recommendationReason, recommendation.recommendationType, recommendation.deliveryStatus, recommendation.reviewStatus, createdAt],
        )
        ids.push(result.rows[0]!.id)
      }
      return ids
    },
    async getItemReview(organizationId, reviewId) {
      const result = await db.query<ReviewRow>(`select * from interaction_feedback_item_reviews where organization_id = $1 and id = $2`, [organizationId, reviewId])
      return result.rows[0] ? toRecord(result.rows[0]) : null
    },
    async decideItemReview(organizationId, reviewId, decision) {
      const result = await db.query(
        `update interaction_feedback_item_reviews set review_status = $3, final_wording = $4::jsonb, reason_category = $5, reviewer_comment = $6, edit_warnings = $7, reviewed_by = $8, reviewed_at = $9
         where organization_id = $1 and id = $2 and review_status = 'PENDING_REVIEW'`,
        [organizationId, reviewId, decision.status, json(decision.finalWording), decision.reasonCategory, decision.comment, decision.editWarnings, decision.reviewedBy, decision.reviewedAt],
      )
      return (result.rowCount ?? 0) === 1
    },
    async listItemReviews(organizationId, runId) {
      const result = await db.query<ReviewRow>(`select * from interaction_feedback_item_reviews where organization_id = $1 and run_id = $2 order by item_index`, [organizationId, runId])
      return result.rows.map(toRecord)
    },
    async createDeliveryDecisions(list) {
      if (list.length === 0) return []
      // UMA instrução (V1.5.10): ou todas as decisões do run existem, ou nenhuma — o varredor nunca vê um run pela metade.
      const columns = 13
      const values = list.map((_, row) => `(${Array.from({ length: columns }, (_, column) => `$${row * columns + column + 1}`).join(",")})`).join(",")
      const params = list.flatMap((entry) => [entry.organizationId, entry.runId, entry.itemIndex, entry.section, entry.findingKind, entry.decision.structural, entry.decision.disposition, entry.decision.reasons, entry.decision.policyVersion, entry.decision.autonomyEligible, entry.decision.autonomyBlockers, entry.itemReviewId, entry.createdAt])
      const result = await db.query<DecisionRow>(
        `insert into interaction_feedback_delivery_decisions (organization_id, run_id, item_index, section, finding_kind, structural_state, disposition, reasons, policy_version, autonomy_eligible, autonomy_blockers, item_review_id, created_at)
         values ${values} returning *`,
        params,
      )
      return result.rows.map(toDecision).sort((a, b) => a.itemIndex - b.itemIndex)
    },
    async completeRun(organizationId, runId, completedAt) {
      await db.query(`update interaction_feedback_runs set completed_at = $3 where organization_id = $1 and id = $2 and completed_at is null`, [organizationId, runId, completedAt])
    },
    async listDeliveryDecisions(organizationId, runId) {
      const result = await db.query<DecisionRow>(`select * from interaction_feedback_delivery_decisions where organization_id = $1 and run_id = $2 order by item_index`, [organizationId, runId])
      return result.rows.map(toDecision)
    },
  }
}
