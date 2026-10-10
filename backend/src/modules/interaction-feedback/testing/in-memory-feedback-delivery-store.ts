import { randomUUID } from "node:crypto"
import type { DeliveryRecord, FeedbackDeliveryStore } from "../application/deliver-feedback.js"
import type { createInMemoryInteractionFeedbackStore } from "./in-memory-interaction-feedback-store.js"

/**
 * Entregas em memória com a MESMA semântica do Postgres: gravação condicional ao estado avaliado, UMA entrega por item
 * (a checagem e a gravação acontecem sem `await` no meio — equivale ao unique do banco), decisão marcada como entregue
 * junto, leitura só do próprio colaborador. `failNextRecord` simula uma falha técnica ao gravar (nada fica marcado).
 */
export function createInMemoryFeedbackDeliveryStore(memory: ReturnType<typeof createInMemoryInteractionFeedbackStore>) {
  const deliveries: DeliveryRecord[] = []
  const control = { failNextRecord: false, recordAttempts: 0 }
  const decisionOf = (itemReviewId: string) => memory.decisions.find((entry) => entry.itemReviewId === itemReviewId)
  const store: FeedbackDeliveryStore = {
    async loadCandidate(organizationId, itemReviewId) {
      const review = memory.reviews.get(itemReviewId)
      const decision = decisionOf(itemReviewId)
      const run = review ? memory.runs.get(review.runId) : undefined
      if (!review || !decision || !run || review.organizationId !== organizationId) return null
      return { organizationId, itemReviewId, decisionId: decision.id, runId: review.runId, collaboratorId: run.collaboratorId, structural: decision.decision.structural, disposition: decision.decision.disposition, policyVersion: decision.decision.policyVersion, qaStatus: review.reviewStatus, proposedOrigin: review.wordingSource, proposedWording: structuredClone(review.proposedWording), finalWording: structuredClone(review.finalWording), deliveredAt: decision.deliveredAt }
    },
    async recordDelivery(delivery) {
      control.recordAttempts += 1
      if (control.failNextRecord) { control.failNextRecord = false; throw new Error("falha simulada ao gravar a entrega") }
      const review = memory.reviews.get(delivery.itemReviewId)
      const decision = decisionOf(delivery.itemReviewId)
      const run = review ? memory.runs.get(review.runId) : undefined
      if (!review || !decision || !run || review.organizationId !== delivery.organizationId) return null
      if (review.reviewStatus !== delivery.qaStatus || decision.decision.disposition !== delivery.expectedDisposition || decision.decision.structural !== "STRUCTURALLY_DELIVERABLE" || decision.deliveredAt) return null
      if (deliveries.some((entry) => entry.itemReviewId === delivery.itemReviewId)) return null
      const record: DeliveryRecord = { id: randomUUID(), organizationId: delivery.organizationId, collaboratorId: run.collaboratorId, runId: review.runId, itemReviewId: review.id, deliveryDecisionId: decision.id, deliveryMode: delivery.deliveryMode, wordingSource: delivery.wordingSource, proposedOrigin: review.wordingSource, qaStatus: delivery.qaStatus, policyVersion: decision.decision.policyVersion, wordingSha256: delivery.wordingSha256, deliveredAt: delivery.deliveredAt, acknowledgedAt: null }
      deliveries.push(record)
      decision.deliveredAt = delivery.deliveredAt
      return structuredClone(record)
    },
    async findByItemReview(organizationId, itemReviewId) {
      const found = deliveries.find((entry) => entry.organizationId === organizationId && entry.itemReviewId === itemReviewId)
      return found ? structuredClone(found) : null
    },
    async listReadyCandidates(limit) {
      return memory.decisions
        .filter((decision) => {
          const review = decision.itemReviewId ? memory.reviews.get(decision.itemReviewId) : undefined
          if (!review || decision.deliveredAt || decision.decision.structural !== "STRUCTURALLY_DELIVERABLE") return false
          if (review.reviewStatus === "APPROVED_UNCHANGED" || review.reviewStatus === "APPROVED_EDITED") return true
          return decision.decision.disposition === "AUTO_DELIVER" && review.reviewStatus === "NOT_SELECTED_FOR_QA" && review.wordingSource === "WRITER"
        })
        .slice(0, limit)
        .map((decision) => ({ organizationId: decision.organizationId, itemReviewId: decision.itemReviewId! }))
    },
    async listForCollaborator(organizationId, collaboratorId) {
      return deliveries
        .filter((entry) => entry.organizationId === organizationId && entry.collaboratorId === collaboratorId)
        .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())
        .map((entry) => {
          const review = memory.reviews.get(entry.itemReviewId)!
          const run = memory.runs.get(entry.runId)!
          return { delivery: structuredClone(entry), section: review.section, wording: structuredClone(entry.wordingSource === "HUMAN_EDITED" && review.finalWording ? review.finalWording : review.proposedWording), writerItem: structuredClone(review.writerItem), interactionLabel: review.interactionLabel, occurredAt: run.occurredAt }
        })
    },
    async acknowledge(organizationId, deliveryId, collaboratorId, at) {
      const found = deliveries.find((entry) => entry.organizationId === organizationId && entry.id === deliveryId && entry.collaboratorId === collaboratorId)
      if (!found) return null
      found.acknowledgedAt ??= at.getTime() < found.deliveredAt.getTime() ? found.deliveredAt : at
      return structuredClone(found)
    },
  }
  return { store, deliveries, control }
}
