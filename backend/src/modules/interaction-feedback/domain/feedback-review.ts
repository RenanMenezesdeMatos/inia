import type { ItemWording } from "../../investigation/domain/interaction-feedback-writer.js"

/**
 * QA DE QUALIDADE DO FEEDBACK (V1.5.0 → reenquadrado na V1.5.5).
 *
 * A avaliação humana mede a qualidade do OUTPUT da INIA — não é autorização administrativa do feedback pelo supervisor e
 * não é requisito intrínseco do feedback. Quem vai para QA é decidido pela política de entrega (`feedback-delivery-policy.ts`:
 * AUTO_DELIVER | HOLD_FOR_QA | BLOCKED); no piloto, 100% dos itens entregáveis são selecionados (HOLD_FOR_QA).
 *
 *   PENDING_REVIEW       → selecionado para QA, ainda não avaliado (NÃO significa "inseguro para entregar");
 *   APPROVED_UNCHANGED   → QA aprovou o texto como está;
 *   APPROVED_EDITED      → QA aprovou com uma versão humana (original e proposto preservados);
 *   REJECTED             → QA rejeitou (nunca entregue);
 *   NOT_SELECTED_FOR_QA  → a política não selecionou o item (AUTO_DELIVER) — não há avaliação a fazer.
 */
export const REVIEW_STATUSES = ["PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED", "NOT_SELECTED_FOR_QA"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
export type ReviewDecision = "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED"

/** Motivos estruturados (pequeno e extensível; comentário livre à parte). */
export const REVIEW_REASON_CATEGORIES = ["FACTUAL_OVERCLAIM", "UNSUPPORTED_EFFECT", "UNSUPPORTED_PROCEDURE", "TOO_GENERIC", "NOT_ACTIONABLE", "TONE", "PRIVACY", "WRONG_FOCUS", "OTHER"] as const
export type ReviewReasonCategory = (typeof REVIEW_REASON_CATEGORIES)[number]
export const REVIEWER_COMMENT_MAX = 2000

/** Resultado de QA que aprova o texto (o gate de entrega completo está em `deliveryStateOf`, que também olha a disposição). */
export function isApprovedQaStatus(status: ReviewStatus): status is "APPROVED_UNCHANGED" | "APPROVED_EDITED" {
  return status === "APPROVED_UNCHANGED" || status === "APPROVED_EDITED"
}

export type ReviewDecisionInput = { decision: ReviewDecision; finalWording?: (ItemWording & { suggestedResponse?: string }) | null | undefined; reasonCategory?: ReviewReasonCategory | null | undefined; comment?: string | null | undefined }
export type ReviewDecisionError = "REVIEW_ALREADY_DECIDED" | "NOT_SELECTED_FOR_QA" | "UNKNOWN_DECISION" | "FINAL_WORDING_NOT_ALLOWED" | "FINAL_WORDING_REQUIRED" | "FINAL_WORDING_UNCHANGED" | "FINAL_WORDING_EMPTY" | "REASON_REQUIRED" | "UNKNOWN_REASON" | "COMMENT_TOO_LONG"

/** V1.7.1a — o feedback confiável tem um 4º campo opcional (exemplo de condução); os outros fluxos nunca o trazem. */
type ReviewWording = ItemWording & { suggestedResponse?: string }
const trimmed = (wording: ReviewWording): ReviewWording => ({ observed: wording.observed.trim(), whyItMatters: wording.whyItMatters.trim(), whatYouCanDo: wording.whatYouCanDo.trim(), ...(typeof wording.suggestedResponse === "string" && wording.suggestedResponse.trim().length > 0 ? { suggestedResponse: wording.suggestedResponse.trim() } : {}) })
const sameWording = (a: ReviewWording, b: ReviewWording) => a.observed === b.observed && a.whyItMatters === b.whyItMatters && a.whatYouCanDo === b.whatYouCanDo && (a.suggestedResponse ?? "") === (b.suggestedResponse ?? "")

/**
 * Regras da decisão (puras). O texto original do redator e o proposto nunca são sobrescritos: a versão humana é SEPARADA.
 *   APPROVED_UNCHANGED → sem texto novo; motivo opcional.
 *   APPROVED_EDITED    → texto final obrigatório, diferente do proposto, sem campo vazio; motivo da edição obrigatório.
 *   REJECTED           → sem texto novo; motivo obrigatório; nunca entregável.
 * Só um item PENDING_REVIEW (selecionado para QA) pode ser avaliado (decisão é única). A avaliação nunca muda a disposição
 * estrutural do item: BLOCKED continua BLOCKED (nem chega aqui) e REJECTED só impede a entrega.
 */
export function validateReviewDecision(current: ReviewStatus, proposed: ReviewWording, input: ReviewDecisionInput, options: { optionalGuidance?: boolean } = {}): { ok: true; finalWording: ReviewWording | null } | { ok: false; error: ReviewDecisionError } {
  if (current === "NOT_SELECTED_FOR_QA") return { ok: false, error: "NOT_SELECTED_FOR_QA" }
  if (current !== "PENDING_REVIEW") return { ok: false, error: "REVIEW_ALREADY_DECIDED" }
  if (!(["APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED"] as string[]).includes(input.decision)) return { ok: false, error: "UNKNOWN_DECISION" }
  if (input.reasonCategory && !(REVIEW_REASON_CATEGORIES as readonly string[]).includes(input.reasonCategory)) return { ok: false, error: "UNKNOWN_REASON" }
  if (input.comment && input.comment.length > REVIEWER_COMMENT_MAX) return { ok: false, error: "COMMENT_TOO_LONG" }
  if (input.decision !== "APPROVED_EDITED" && input.finalWording) return { ok: false, error: "FINAL_WORDING_NOT_ALLOWED" }
  if (input.decision === "REJECTED" && !input.reasonCategory) return { ok: false, error: "REASON_REQUIRED" }
  if (input.decision === "APPROVED_EDITED") {
    if (!input.finalWording) return { ok: false, error: "FINAL_WORDING_REQUIRED" }
    const final = trimmed(input.finalWording)
    // V1.6.0: no feedback confiável relevância e orientação são OPCIONAIS (vazio = sem fundamento) — só o fato é obrigatório.
    if (!final.observed || (!options.optionalGuidance && (!final.whyItMatters || !final.whatYouCanDo))) return { ok: false, error: "FINAL_WORDING_EMPTY" }
    if (sameWording(final, trimmed(proposed))) return { ok: false, error: "FINAL_WORDING_UNCHANGED" }
    if (!input.reasonCategory) return { ok: false, error: "REASON_REQUIRED" }
    return { ok: true, finalWording: final }
  }
  return { ok: true, finalWording: null }
}
