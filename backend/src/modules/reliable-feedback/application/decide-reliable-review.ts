import { validateReviewDecision, type ReviewDecisionError, type ReviewDecisionInput } from "../../interaction-feedback/domain/feedback-review.js"
import { checkHumanEdit, HUMAN_EDIT_BLOCKING, type HumanEditViolation } from "../../interaction-feedback/domain/review-view.js"
import { hasPersonalData, type ArtifactDisposition } from "../domain/reliable-feedback-item.js"
import { currentDisposition } from "../domain/reliable-feedback-artifact.js"
import { effectViolations, genericWordingViolations, groundingViolations, ruleTextsOf, suggestedResponseViolationsOf, validateIndicatorWording, type GroundingViolation } from "../domain/reliable-writer.js"
import type { ReliableWording } from "../domain/reliable-feedback-item.js"
import type { SuggestedResponseViolation } from "../domain/suggested-response.js"
import type { ReliableFeedbackStore, ReliableReviewRecord } from "./ports.js"

/**
 * V1.5.12 — QA DE EXCEÇÃO do feedback confiável (mesmo contrato de decisão do QA de feedback: APPROVED_UNCHANGED |
 * APPROVED_EDITED | REJECTED, única, motivo obrigatório em edição/rejeição, texto proposto nunca sobrescrito).
 *
 * Diferença essencial para o feedback direto (V1.5.6): a decisão NÃO entrega nada. Quando nenhum item do artefato fica
 * pendente, o QA do artefato é fechado e a MESMA matrícula que espera no nó "Gerar feedback" é reativada — no próximo
 * processamento a ação devolve READY (segue para o próximo nó: Revisão humana/Output) ou REJECTED (encerra sem Output).
 * BLOCKED nunca chega aqui (não tem revisão) — QA não desbloqueia estrutura.
 *
 * Edição humana de INDICADOR: número/meta/período/tendência fora do contexto canônico é BLOQUEANTE (o dado oficial é do
 * sistema — nem o revisor o recalcula); o resto segue a regra do QA de feedback (aviso registrado).
 */
export type ReliableEditViolation = HumanEditViolation | "TARGET_COMPARISON_MISMATCH" | "TREND_WITHOUT_CANONICAL_HISTORY" | "PERIOD_MISMATCH" | GroundingViolation | "CAUSAL_CLAIM" | "PEER_CLAIM_WITHOUT_EVIDENCE" | "UNSUPPORTED_SEGMENT_LABEL" | "GENERIC_WORDING" | SuggestedResponseViolation
/**
 * V1.7.1a — o EXEMPLO DE CONDUÇÃO editado pelo QA passa pelas MESMAS guardas do redator e TODAS bloqueiam: o revisor não insere
 * prazo, canal, número, resultado ou efeito que a regra do item não sustenta, nem transforma exemplo da base em fato.
 */
const SUGGESTED_RESPONSE_BLOCKING: readonly ReliableEditViolation[] = ["SUGGESTED_RESPONSE_NOT_ALLOWED", "SUGGESTED_RESPONSE_NOT_SPEECH", "SUGGESTED_RESPONSE_PLACEHOLDER", "UNSUPPORTED_FACT", "EXAMPLE_CONTENT_AS_FACT", "PEER_CLAIM_WITHOUT_EVIDENCE", "PRIVACY_DATA", "INTERNAL_REF", "INTERNAL_JSON_LEAKAGE", "UNSUPPORTED_NUMBER", "GUARANTEED_EFFECT"]
/** V1.6.0 — orientação/relevância sem fonte é bloqueante também para o QA: a edição humana não cria orientação sem origem. */
const GROUNDING_BLOCKING: readonly ReliableEditViolation[] = ["UNGROUNDED_GUIDANCE", "UNGROUNDED_RELEVANCE"]
/** V1.6.1 — causa comportamento → indicador, pares sem evidência e rótulo de motivo também são bloqueantes para o QA. */
const INDICATOR_BLOCKING: readonly ReliableEditViolation[] = [...HUMAN_EDIT_BLOCKING, "SUGGESTED_RESPONSE_NOT_ALLOWED", "SUGGESTED_RESPONSE_NOT_SPEECH", "SUGGESTED_RESPONSE_PLACEHOLDER", "UNSUPPORTED_FACT", "EXAMPLE_CONTENT_AS_FACT", "GENERIC_WORDING", "UNSUPPORTED_NUMBER", "TARGET_COMPARISON_MISMATCH", "TREND_WITHOUT_CANONICAL_HISTORY", "PERIOD_MISMATCH", ...GROUNDING_BLOCKING, "CAUSAL_CLAIM", "PEER_CLAIM_WITHOUT_EVIDENCE", "UNSUPPORTED_SEGMENT_LABEL", "GUARANTEED_EFFECT", "UNSUPPORTED_PROCEDURE"]
/**
 * V1.7.1 — a edição humana na MONITORIA não pode inserir o que o sistema não aceitaria automaticamente: efeito garantido/causal
 * (em qualquer campo) sem a regra sustentar, número fora da evidência/regra, procedimento/norma sem regra verificada. QA não
 * desliga guardrail estrutural. Texto genérico continua aviso (o revisor pode preferir uma frase curta).
 */
const MONITORING_BLOCKING: readonly ReliableEditViolation[] = [...HUMAN_EDIT_BLOCKING, ...GROUNDING_BLOCKING, "GUARANTEED_EFFECT", "UNSUPPORTED_NUMBER", "UNSUPPORTED_PROCEDURE", "PROCEDURAL_CONCLUSION_WITHOUT_KB", ...SUGGESTED_RESPONSE_BLOCKING]

export function checkReliableHumanEdit(wording: ReliableWording, review: Pick<ReliableReviewRecord, "reviewItem" | "subjectLabel">): { blocking: ReliableEditViolation[]; warnings: ReliableEditViolation[] } {
  if (review.reviewItem.domain === "MONITORING") {
    const writerItem = review.reviewItem.writerItem
    const base = checkHumanEdit(wording, writerItem, review.subjectLabel)
    // Revisões gravadas antes da V1.6.0 não têm `grounding`: valem as regras de sempre (nada retroativo).
    const grounding = writerItem.grounding ? groundingViolations(wording, { grounding: writerItem.grounding, hasKnowledge: writerItem.guidance.knowledge !== null }) : []
    // O exemplo de condução é checado À PARTE (é fala proposta, não afirmação): o genérico dele bloqueia; o dos outros campos avisa.
    const example = suggestedResponseViolationsOf(wording, writerItem) as ReliableEditViolation[]
    const all = [...new Set<ReliableEditViolation>([...base.blocking, ...base.warnings, ...grounding, ...effectViolations(wording, ruleTextsOf(writerItem)), ...genericWordingViolations(wording, writerItem)])]
    return { blocking: [...new Set([...all.filter((code) => MONITORING_BLOCKING.includes(code)), ...example])], warnings: all.filter((code) => !MONITORING_BLOCKING.includes(code)) }
  }
  const violations: ReliableEditViolation[] = [...validateIndicatorWording(wording, review.reviewItem.writerItem, review.reviewItem.canonical)]
  if ([wording.observed, wording.whyItMatters, wording.whatYouCanDo, wording.suggestedResponse ?? ""].some(hasPersonalData)) violations.push("PRIVACY_DATA")
  const unique = [...new Set(violations)]
  return { blocking: unique.filter((code) => INDICATOR_BLOCKING.includes(code)), warnings: unique.filter((code) => !INDICATOR_BLOCKING.includes(code)) }
}

export type DecideReliableReviewResult =
  | { ok: true; review: ReliableReviewRecord; resolution: { disposition: ArtifactDisposition; reactivated: boolean } | null }
  | { ok: false; error: ReviewDecisionError | "REVIEW_NOT_FOUND" | "EDIT_VIOLATES_CONTRACT"; violations?: ReliableEditViolation[] }

export async function decideReliableReview(deps: { store: ReliableFeedbackStore; now: () => Date }, input: ReviewDecisionInput & { organizationId: string; reviewId: string; reviewerId: string }): Promise<DecideReliableReviewResult> {
  const current = await deps.store.getReview(input.organizationId, input.reviewId)
  if (!current) return { ok: false, error: "REVIEW_NOT_FOUND" }
  const verdict = validateReviewDecision(current.reviewStatus, current.proposedWording, input, { optionalGuidance: true })
  if (!verdict.ok) return { ok: false, error: verdict.error }
  let warnings: ReliableEditViolation[] = []
  if (verdict.finalWording) {
    const check = checkReliableHumanEdit(verdict.finalWording, current)
    if (check.blocking.length > 0) return { ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: check.blocking }
    warnings = check.warnings
  }
  const written = await deps.store.decideReview(
    input.organizationId,
    input.reviewId,
    { status: input.decision, finalWording: verdict.finalWording, reasonCategory: input.reasonCategory ?? null, comment: input.comment?.trim() || null, editWarnings: warnings, reviewedBy: input.reviewerId, reviewedAt: deps.now() },
    (artifact, reviews) => currentDisposition(artifact, reviews.map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus, finalWording: review.finalWording }))),
  )
  if (!written.written) return { ok: false, error: "REVIEW_ALREADY_DECIDED" }
  return { ok: true, review: (await deps.store.getReview(input.organizationId, input.reviewId))!, resolution: written.resolution }
}
