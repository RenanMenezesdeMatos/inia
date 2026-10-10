import { createHash } from "node:crypto"
import type { ItemWording } from "../../investigation/domain/interaction-feedback-writer.js"
import type { FeedbackDisposition, StructuralDeliverability } from "./feedback-delivery-policy.js"
import type { ReviewStatus } from "./feedback-review.js"

/**
 * V1.5.6 — ELEGIBILIDADE DE ENTREGA (pura, determinística) em cima da FeedbackDeliveryDecision (V1.5.5).
 *
 * Quatro dimensões que nunca viram um enum só: estrutura (`structural`) × disposição da política (`disposition`) × resultado
 * de QA (`qaStatus`) × entrega real (`deliveredAt`). A matriz:
 *
 *   BLOCKED                              → nunca entrega (QA nem chega a ter o item);
 *   HOLD_FOR_QA + PENDING_REVIEW         → não entrega (aguardando QA);
 *   HOLD_FOR_QA + APPROVED_UNCHANGED     → entrega o texto PROPOSTO;
 *   HOLD_FOR_QA + APPROVED_EDITED        → entrega o texto FINAL do QA;
 *   HOLD_FOR_QA / AUTO_DELIVER + REJECTED → nunca entrega;
 *   AUTO_DELIVER + NOT_SELECTED_FOR_QA   → entrega o proposto SEM QA — nunca um fallback (a política já o impede; aqui é
 *                                          defesa em profundidade: autonomia só com texto validado do redator).
 *
 * Não existe `if (!humanApproved)`: o piloto não entrega antes do QA porque a POLÍTICA (FEEDBACK_DELIVERY_POLICY_PILOT_V1)
 * põe tudo em HOLD_FOR_QA. O texto entregue é sempre um texto JÁ persistido (proposto ou final) — nunca reconstruído, nunca
 * gerado de novo.
 */
export type DeliveryMode = "QA_APPROVED" | "AUTONOMOUS"
export type DeliveredWordingSource = "PROPOSED" | "HUMAN_EDITED"
export type DeliveryIneligibility = "BLOCKED" | "AWAITING_QA" | "QA_REJECTED" | "ALREADY_DELIVERED" | "AUTONOMOUS_FALLBACK_NOT_ALLOWED" | "FINAL_WORDING_MISSING"

export type DeliveryCandidate = {
  organizationId: string
  itemReviewId: string
  decisionId: string
  runId: string
  collaboratorId: string
  structural: StructuralDeliverability
  disposition: FeedbackDisposition
  policyVersion: string
  qaStatus: ReviewStatus
  /** Origem do texto proposto: WRITER ou FALLBACK determinístico (auditoria; nunca exibida ao colaborador). */
  proposedOrigin: "WRITER" | "FALLBACK"
  proposedWording: ItemWording
  finalWording: ItemWording | null
  deliveredAt: Date | null
}

export type DeliveryEligibility =
  | { eligible: true; mode: DeliveryMode; wordingSource: DeliveredWordingSource; wording: ItemWording; qaStatus: "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "NOT_SELECTED_FOR_QA" }
  | { eligible: false; reason: DeliveryIneligibility }

export function evaluateFeedbackDelivery(candidate: DeliveryCandidate): DeliveryEligibility {
  if (candidate.structural === "BLOCKED" || candidate.disposition === "BLOCKED") return { eligible: false, reason: "BLOCKED" }
  if (candidate.deliveredAt) return { eligible: false, reason: "ALREADY_DELIVERED" }
  switch (candidate.qaStatus) {
    case "REJECTED":
      return { eligible: false, reason: "QA_REJECTED" }
    case "PENDING_REVIEW":
      return { eligible: false, reason: "AWAITING_QA" }
    case "APPROVED_UNCHANGED":
      // QA aprovou explicitamente — inclusive um fallback: ele pode sair, com a origem registrada.
      return { eligible: true, mode: "QA_APPROVED", wordingSource: "PROPOSED", wording: candidate.proposedWording, qaStatus: "APPROVED_UNCHANGED" }
    case "APPROVED_EDITED":
      return candidate.finalWording ? { eligible: true, mode: "QA_APPROVED", wordingSource: "HUMAN_EDITED", wording: candidate.finalWording, qaStatus: "APPROVED_EDITED" } : { eligible: false, reason: "FINAL_WORDING_MISSING" }
    case "NOT_SELECTED_FOR_QA":
      // Só a política pode dispensar QA (AUTO_DELIVER). HOLD_FOR_QA sem avaliação nunca sai.
      if (candidate.disposition !== "AUTO_DELIVER") return { eligible: false, reason: "AWAITING_QA" }
      if (candidate.proposedOrigin !== "WRITER") return { eligible: false, reason: "AUTONOMOUS_FALLBACK_NOT_ALLOWED" }
      return { eligible: true, mode: "AUTONOMOUS", wordingSource: "PROPOSED", wording: candidate.proposedWording, qaStatus: "NOT_SELECTED_FOR_QA" }
  }
}

/** Hash do texto entregue (auditoria: prova qual versão saiu sem duplicar o texto na entrega). */
export function wordingSha256(wording: ItemWording): string {
  return createHash("sha256").update(JSON.stringify([wording.observed, wording.whyItMatters, wording.whatYouCanDo])).digest("hex")
}
