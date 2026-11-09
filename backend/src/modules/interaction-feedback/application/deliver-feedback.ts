import { DomainError } from "../../../shared/domain/domain-error.js"
import { evaluateFeedbackDelivery, wordingSha256, type DeliveredWordingSource, type DeliveryCandidate, type DeliveryIneligibility, type DeliveryMode } from "../domain/feedback-delivery-eligibility.js"
import type { ItemWording, WriterItem } from "../../investigation/domain/interaction-feedback-writer.js"
import { toCollaboratorFeedbackView } from "../domain/collaborator-feedback-view.js"

/**
 * V1.5.6 — ENTREGA DO FEEDBACK DE INTERAÇÃO AO ACOMPANHAMENTO.
 *
 *   avaliação de QA (ou a própria política, no caso AUTO_DELIVER)
 *     → evaluateFeedbackDelivery (domínio, puro)
 *     → deliverFeedbackItem (este use case) → UM registro em interaction_feedback_deliveries
 *
 * Exatamente uma vez: a unicidade é do BANCO (unique por item) e a gravação é UMA instrução condicional (só grava se o
 * estado ainda é o avaliado e ainda não foi entregue). Retry, duplo clique, jobs concorrentes ou duas instâncias → uma só
 * entrega; quem chega depois recebe ALREADY_DELIVERED. Falha técnica = nada marcado como entregue, a decisão de QA fica
 * intacta e o próximo `deliverReadyFeedbackItems` tenta de novo (idempotente). Nenhum texto é gerado ou reconstruído:
 * nenhuma chamada de modelo acontece aqui.
 */
export type DeliveryRecord = {
  id: string
  organizationId: string
  collaboratorId: string
  runId: string
  itemReviewId: string
  deliveryDecisionId: string
  deliveryMode: DeliveryMode
  wordingSource: DeliveredWordingSource
  proposedOrigin: "WRITER" | "FALLBACK"
  qaStatus: "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "NOT_SELECTED_FOR_QA"
  policyVersion: string
  wordingSha256: string
  deliveredAt: Date
  acknowledgedAt: Date | null
}
export type NewDelivery = Omit<DeliveryRecord, "id" | "collaboratorId" | "runId" | "deliveryDecisionId" | "proposedOrigin" | "policyVersion" | "acknowledgedAt"> & { expectedDisposition: DeliveryCandidate["disposition"] }

/** O que o Acompanhamento do colaborador precisa de uma entrega (texto da origem imutável + contexto da interação). */
export type DeliveredFeedbackRow = { delivery: DeliveryRecord; section: "STRENGTH" | "OPPORTUNITY"; wording: ItemWording; writerItem: WriterItem; interactionLabel: string; occurredAt: Date | null }

export interface FeedbackDeliveryStore {
  loadCandidate(organizationId: string, itemReviewId: string): Promise<DeliveryCandidate | null>
  /** Grava a entrega SE o item ainda está no estado avaliado e sem entrega (atômico); null = não gravou (já entregue ou estado mudou). */
  recordDelivery(delivery: NewDelivery): Promise<DeliveryRecord | null>
  findByItemReview(organizationId: string, itemReviewId: string): Promise<DeliveryRecord | null>
  /** Itens prontos para entrega e ainda não entregues (entre todas as organizações) — o varredor/worker. */
  listReadyCandidates(limit: number): Promise<{ organizationId: string; itemReviewId: string }[]>
  listForCollaborator(organizationId: string, collaboratorId: string): Promise<DeliveredFeedbackRow[]>
  /** Ciência do PRÓPRIO colaborador (idempotente); null = não existe/não é dele. */
  acknowledge(organizationId: string, deliveryId: string, collaboratorId: string, at: Date): Promise<DeliveryRecord | null>
}

export type DeliveryDeps = { deliveries: FeedbackDeliveryStore; now: () => Date }
export type DeliveryOutcome =
  | { status: "DELIVERED"; delivery: DeliveryRecord }
  | { status: "ALREADY_DELIVERED"; delivery: DeliveryRecord }
  | { status: "NOT_ELIGIBLE"; reason: Exclude<DeliveryIneligibility, "ALREADY_DELIVERED"> | "NOT_FOUND" }

export async function deliverFeedbackItem(deps: DeliveryDeps, input: { organizationId: string; itemReviewId: string }): Promise<DeliveryOutcome> {
  const candidate = await deps.deliveries.loadCandidate(input.organizationId, input.itemReviewId)
  if (!candidate) return { status: "NOT_ELIGIBLE", reason: "NOT_FOUND" }
  const verdict = evaluateFeedbackDelivery(candidate)
  if (!verdict.eligible) {
    if (verdict.reason === "ALREADY_DELIVERED") {
      const existing = await deps.deliveries.findByItemReview(input.organizationId, input.itemReviewId)
      if (existing) return { status: "ALREADY_DELIVERED", delivery: existing }
    }
    return { status: "NOT_ELIGIBLE", reason: verdict.reason === "ALREADY_DELIVERED" ? "NOT_FOUND" : verdict.reason }
  }
  const recorded = await deps.deliveries.recordDelivery({
    organizationId: input.organizationId, itemReviewId: input.itemReviewId, deliveryMode: verdict.mode, wordingSource: verdict.wordingSource, qaStatus: verdict.qaStatus,
    wordingSha256: wordingSha256(verdict.wording), deliveredAt: deps.now(), expectedDisposition: candidate.disposition,
  })
  if (recorded) return { status: "DELIVERED", delivery: recorded }
  // Outra execução entregou antes (ou o estado mudou entre a leitura e a gravação): a verdade é a do banco.
  const existing = await deps.deliveries.findByItemReview(input.organizationId, input.itemReviewId)
  if (existing) return { status: "ALREADY_DELIVERED", delivery: existing }
  const again = await deps.deliveries.loadCandidate(input.organizationId, input.itemReviewId)
  const reason = again ? evaluateFeedbackDelivery(again) : null
  return { status: "NOT_ELIGIBLE", reason: reason && !reason.eligible && reason.reason !== "ALREADY_DELIVERED" ? reason.reason : "NOT_FOUND" }
}

/**
 * VARREDOR (forma do futuro worker de AUTO_DELIVER e o retry de falhas técnicas): entrega tudo o que está pronto e ainda
 * não foi entregue. Idempotente — rodar duas vezes, ou em duas instâncias, não duplica nada. Uma falha num item não
 * impede os outros.
 */
export async function deliverReadyFeedbackItems(deps: DeliveryDeps, options: { limit?: number } = {}): Promise<{ delivered: number; alreadyDelivered: number; failed: number }> {
  const ready = await deps.deliveries.listReadyCandidates(options.limit ?? 100)
  const summary = { delivered: 0, alreadyDelivered: 0, failed: 0 }
  for (const entry of ready) {
    try {
      const outcome = await deliverFeedbackItem(deps, entry)
      if (outcome.status === "DELIVERED") summary.delivered += 1
      else if (outcome.status === "ALREADY_DELIVERED") summary.alreadyDelivered += 1
    } catch (error) {
      // Nada foi marcado como entregue e a próxima rodada tenta de novo; o motivo fica no log (antes só a contagem existia).
      console.error(`[interaction-feedback] entrega pelo varredor falhou (organização ${entry.organizationId}, item ${entry.itemReviewId}); será refeita na próxima rodada`, error)
      summary.failed += 1
    }
  }
  return summary
}

export async function acknowledgeFeedbackDelivery(deps: DeliveryDeps, viewer: { organizationId: string; personId: string }, deliveryId: string) {
  const acknowledged = await deps.deliveries.acknowledge(viewer.organizationId, deliveryId, viewer.personId, deps.now())
  if (!acknowledged) throw new DomainError("Feedback não encontrado.", "FEEDBACK_DELIVERY_NOT_FOUND", 404)
  return { id: acknowledged.id, acknowledgedAt: acknowledged.acknowledgedAt!.toISOString() }
}

/** Acompanhamento do PRÓPRIO colaborador: só as entregas dele, na organização da sessão (nunca um collaboratorId do cliente). */
export async function listMyFeedbackDeliveries(deps: Pick<DeliveryDeps, "deliveries">, viewer: { organizationId: string; personId: string }) {
  const rows = await deps.deliveries.listForCollaborator(viewer.organizationId, viewer.personId)
  return rows.map((row) => toCollaboratorFeedbackView({ deliveryId: row.delivery.id, section: row.section, wording: row.wording, writerItem: row.writerItem, interactionLabel: row.interactionLabel, occurredAt: row.occurredAt, deliveredAt: row.delivery.deliveredAt, acknowledgedAt: row.delivery.acknowledgedAt }))
}
