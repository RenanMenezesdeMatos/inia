import { randomUUID } from "node:crypto"
import type { DeliveryDecisionRecord, InteractionFeedbackStore, ItemReviewRecord, NewRun } from "../application/ports.js"
import type { WriterProvenance } from "../domain/feedback-writer-provenance.js"
import type { KnowledgeRecommendationDraft, OperationalIssueOccurrenceDraft } from "../domain/operational-issue.js"

/**
 * Store EFÊMERO (memória) com a MESMA semântica do Postgres (escopo por organização, avaliação de QA só a partir de
 * PENDING_REVIEW, disposição por item). Usado pelos testes e pela SIMULAÇÃO do QA Lab (V1.5.10): nada é gravado.
 */
export function createInMemoryInteractionFeedbackStore() {
  const runs = new Map<string, NewRun & { id: string; writerRawOutput: unknown; writerError: string | null; writerProvenance: WriterProvenance | null; completedAt: Date | null }>()
  const reviews = new Map<string, ItemReviewRecord>()
  const decisions: DeliveryDecisionRecord[] = []
  const occurrences: (OperationalIssueOccurrenceDraft & { id: string; organizationId: string; runId: string })[] = []
  const recommendations: (KnowledgeRecommendationDraft & { id: string; organizationId: string; occurrenceId: string })[] = []
  const store: InteractionFeedbackStore = {
    async createRun(run) { const id = randomUUID(); runs.set(id, { ...run, id, writerRawOutput: null, writerError: null, writerProvenance: null, completedAt: null }); return id },
    async recordWriterOutcome(runId, outcome) { const run = runs.get(runId)!; run.writerRawOutput = outcome.rawOutput; run.writerError = outcome.error; run.writerProvenance = outcome.provenance },
    async createItemReviews(list) {
      return list.map(({ initialStatus, ...review }) => { const record: ItemReviewRecord = { ...review, id: randomUUID(), reviewStatus: initialStatus, finalWording: null, reasonCategory: null, reviewerComment: null, editWarnings: [], reviewedBy: null, reviewedAt: null }; reviews.set(record.id, record); return structuredClone(record) })
    },
    async createOccurrences(context, list) { return list.map((occurrence) => { const id = randomUUID(); occurrences.push({ ...occurrence, id, organizationId: context.organizationId, runId: context.runId }); return { itemIndex: occurrence.itemIndex, id } }) },
    async createRecommendations(organizationId, list) { return list.map((recommendation) => { const id = randomUUID(); recommendations.push({ ...recommendation, id, organizationId }); return id }) },
    async getItemReview(organizationId, reviewId) { const review = reviews.get(reviewId); return review && review.organizationId === organizationId ? structuredClone(review) : null },
    async decideItemReview(organizationId, reviewId, decision) {
      const review = reviews.get(reviewId)
      if (!review || review.organizationId !== organizationId || review.reviewStatus !== "PENDING_REVIEW") return false
      Object.assign(review, { reviewStatus: decision.status, finalWording: decision.finalWording, reasonCategory: decision.reasonCategory, reviewerComment: decision.comment, editWarnings: decision.editWarnings, reviewedBy: decision.reviewedBy, reviewedAt: decision.reviewedAt })
      return true
    },
    async listItemReviews(organizationId, runId) { return [...reviews.values()].filter((review) => review.organizationId === organizationId && review.runId === runId).map((review) => structuredClone(review)) },
    async createDeliveryDecisions(list) { return list.map((decision) => { const record = { ...structuredClone(decision), id: randomUUID(), deliveredAt: null }; decisions.push(record); return structuredClone(record) }) },
    async completeRun(organizationId, runId, completedAt) { const run = runs.get(runId); if (run && run.organizationId === organizationId && !run.completedAt) run.completedAt = completedAt },
    async listDeliveryDecisions(organizationId, runId) { return decisions.filter((decision) => decision.organizationId === organizationId && decision.runId === runId).sort((a, b) => a.itemIndex - b.itemIndex).map((decision) => structuredClone(decision)) },
  }
  return { store, runs, reviews, decisions, occurrences, recommendations }
}
