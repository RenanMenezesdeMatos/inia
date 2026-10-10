import { buildFeedbackWriterInput, resolveFeedbackWording, type ItemWording } from "../../investigation/domain/interaction-feedback-writer.js"
import { checkHumanEdit, type HumanEditViolation } from "../domain/review-view.js"
import { COLLABORATOR_SECTIONS, INTERACTION_FEEDBACK_CONTRACT, type InteractionFeedbackV1 } from "../../investigation/domain/interaction-feedback.js"
import { validateReviewDecision, type ReviewDecisionError, type ReviewDecisionInput, type ReviewStatus } from "../domain/feedback-review.js"
import { decideItemDelivery, deliveryStateOf, summarizeRunDelivery, type FeedbackDeliveryDecision, type FeedbackDeliveryPolicy, type FeedbackDisposition, type RunDeliverySummary } from "../domain/feedback-delivery-policy.js"
import { buildOperationalAnalytics } from "../domain/operational-issue.js"
import { FeedbackWriterError, type WriterProvenance } from "../domain/feedback-writer-provenance.js"
import type { DeliveryDecisionRecord, FeedbackWriterPort, InteractionFeedbackStore, ItemReviewRecord, RunContext } from "./ports.js"

/**
 * V1.5.0 — CONTROLLED FEEDBACK INTEGRATION (interno; nada é entregue ao colaborador). V1.5.5 separa GERAÇÃO de QA:
 *
 *   InteractionFeedback V1 (compositor + readiness + privacidade + bloqueio procedimental — tudo como já está)
 *     → OperationalIssueOccurrence + KnowledgeRecommendation (estrutura, independentes do redator)
 *     → FeedbackWriterInput (só itens entregáveis) → redator (port) → validadores + fallback inteiro por item
 *     → DECISÃO DE ENTREGA por item (política injetada, determinística): AUTO_DELIVER | HOLD_FOR_QA | BLOCKED
 *     → redação persistida (HOLD_FOR_QA = selecionado para QA; AUTO_DELIVER = não selecionado) + disposição de TODO item
 *     → gate de entrega `deliveryStateOf` (a entrega real — Output/Acompanhamento/notificação — NÃO está ligada nesta versão).
 * Atrás de INIA_INTERACTION_FEEDBACK_PIPELINE (OFF por padrão): com OFF nada é lido, escrito ou chamado.
 */
export const INTERACTION_FEEDBACK_PIPELINE_VERSION = "INTERACTION_FEEDBACK_PIPELINE_V1_5_5" as const
export const WRITER_REJECTED_FALLBACK_USED = "WRITER_REJECTED_FALLBACK_USED" as const

export type PipelineDeps = { enabled: boolean; writer: FeedbackWriterPort; store: InteractionFeedbackStore; now: () => Date; deliveryPolicy: FeedbackDeliveryPolicy }
type RecordedCommon = { runId: string; decisions: DeliveryDecisionRecord[]; delivery: RunDeliverySummary; occurrences: number; recommendations: number }
export type PipelineResult =
  | { status: "SKIPPED_FLAG_OFF" }
  | ({ status: "RECORDED_WITHOUT_WRITER"; reason: string } & RecordedCommon)
  | ({ status: "RECORDED"; reviews: ItemReviewRecord[]; fallbacks: number; writerError: string | null } & RecordedCommon)

const slotOf = (raw: unknown, slot: string): unknown => {
  const items = (raw as { items?: unknown } | null)?.items
  return Array.isArray(items) ? items.find((entry) => entry && typeof entry === "object" && (entry as { slot?: unknown }).slot === slot) ?? null : null
}
const collaboratorItemIndexes = (feedback: InteractionFeedbackV1) => feedback.items.flatMap((item, index) => (COLLABORATOR_SECTIONS.includes(item.section) ? [index] : []))

export async function runInteractionFeedbackPipeline(deps: PipelineDeps, feedback: InteractionFeedbackV1, context: RunContext): Promise<PipelineResult> {
  if (!deps.enabled) return { status: "SKIPPED_FLAG_OFF" }
  const createdAt = deps.now()
  const prepared = buildFeedbackWriterInput(feedback)
  const runId = await deps.store.createRun({
    ...context, pipelineVersion: INTERACTION_FEEDBACK_PIPELINE_VERSION, contractVersion: INTERACTION_FEEDBACK_CONTRACT, status: feedback.status, deliveryState: feedback.delivery.state,
    writerInvoked: prepared.invoke, writerSkippedReason: prepared.invoke ? null : prepared.reason, feedbackSnapshot: feedback, writerInput: prepared.invoke ? prepared.input : null, createdAt,
  })

  // Analytics estrutural SEMPRE (inclusive procedimental bloqueado e evidência insuficiente) — nunca depende do redator.
  const analytics = buildOperationalAnalytics(feedback)
  const occurrenceIds = await deps.store.createOccurrences({ ...context, runId, pipelineVersion: INTERACTION_FEEDBACK_PIPELINE_VERSION, createdAt }, analytics.occurrences)
  const recommendations = analytics.recommendations.map((recommendation) => ({ ...recommendation, occurrenceId: occurrenceIds.find((entry) => entry.itemIndex === recommendation.itemIndex)!.id }))
  await deps.store.createRecommendations(context.organizationId, recommendations, createdAt)
  const common = { runId, occurrences: occurrenceIds.length, recommendations: recommendations.length }
  const decisionRow = (itemIndex: number, decision: FeedbackDeliveryDecision, itemReviewId: string | null) => {
    const item = feedback.items[itemIndex]!
    return { organizationId: context.organizationId, runId, itemIndex, section: item.section as "STRENGTH" | "OPPORTUNITY", findingKind: item.interpretation.kind, decision, itemReviewId, createdAt }
  }

  if (!prepared.invoke) {
    // Sem redator: todo item de colaborador que existir é estruturalmente BLOCKED (a disposição fica gravada mesmo assim).
    const decisions = await deps.store.createDeliveryDecisions(collaboratorItemIndexes(feedback).map((index) => decisionRow(index, decideItemDelivery(feedback.items[index]!, feedback, null, deps.deliveryPolicy), null)))
    await deps.store.completeRun(context.organizationId, runId, deps.now())
    return { status: "RECORDED_WITHOUT_WRITER", reason: prepared.reason, decisions, delivery: summarizeRunDelivery(feedback.status, decisions.map((entry) => entry.decision)), ...common }
  }

  // Redator: uma chamada, zero retry. Falha = sem texto → fallback inteiro de cada item (e o item perde a autonomia).
  let rawOutput: unknown = null
  let writerError: string | null = null
  let provenance: WriterProvenance | null = null
  try {
    const written = await deps.writer.write(prepared.input)
    rawOutput = written.rawOutput
    provenance = written.provenance ?? null
  } catch (error) {
    writerError = error instanceof Error ? error.name : "WRITER_ERROR"
    provenance = error instanceof FeedbackWriterError ? error.provenance : null
  }
  await deps.store.recordWriterOutcome(runId, { rawOutput, error: writerError, provenance })
  const resolutions = resolveFeedbackWording(prepared.input, rawOutput)

  // Decisão de entrega de CADA item de colaborador (com o resultado do redator quando o item foi escrito).
  const planned = collaboratorItemIndexes(feedback).map((itemIndex) => {
    const audit = prepared.audit.slots.find((entry) => entry.itemIndex === itemIndex) ?? null
    const writerItem = audit ? prepared.input.items.find((entry) => entry.slot === audit.slot)! : null
    const resolution = audit ? resolutions.find((entry) => entry.slot === audit.slot)! : null
    const outcome = resolution ? { invoked: true, writerError, source: resolution.source, violations: resolution.violations, wording: resolution.wording, claimModes: { effect: prepared.input.effectClaimMode, action: writerItem!.actionClaimMode } } : null
    return { itemIndex, writerItem, resolution, decision: decideItemDelivery(feedback.items[itemIndex]!, feedback, outcome, deps.deliveryPolicy) }
  })
  const withWording = planned.filter((entry) => entry.decision.structural === "STRUCTURALLY_DELIVERABLE" && entry.writerItem && entry.resolution)
  const reviews = await deps.store.createItemReviews(withWording.map(({ itemIndex, writerItem, resolution, decision }) => ({
    organizationId: context.organizationId, runId, slot: writerItem!.slot, itemIndex, section: writerItem!.section, findingKind: writerItem!.interpretation.kind, guidanceSource: writerItem!.guidance.source,
    writerItem: writerItem!, interactionLabel: prepared.input.interactionLabel, wordingSource: resolution!.source, writerViolations: resolution!.violations, writerOriginal: slotOf(rawOutput, writerItem!.slot),
    proposedWording: resolution!.wording,
    reviewRequiredBy: decision.disposition === "HOLD_FOR_QA" ? [decision.policyVersion, ...decision.reasons, ...(resolution!.source === "FALLBACK" ? [WRITER_REJECTED_FALLBACK_USED] : [])] : [],
    initialStatus: decision.disposition === "HOLD_FOR_QA" ? "PENDING_REVIEW" as const : "NOT_SELECTED_FOR_QA" as const,
    createdAt,
  })))
  const reviewIdOf = (itemIndex: number) => reviews.find((review) => review.itemIndex === itemIndex)?.id ?? null
  const decisions = await deps.store.createDeliveryDecisions(planned.map(({ itemIndex, decision }) => decisionRow(itemIndex, decision, decision.structural === "BLOCKED" ? null : reviewIdOf(itemIndex))))
  await deps.store.completeRun(context.organizationId, runId, deps.now())
  return { status: "RECORDED", reviews, decisions, delivery: summarizeRunDelivery(feedback.status, decisions.map((entry) => entry.decision)), fallbacks: reviews.filter((review) => review.wordingSource === "FALLBACK").length, writerError, ...common }
}

/** Vazamento interno, JSON/refs, citação adulterada e dado pessoal bloqueiam a edição humana (`checkHumanEdit`); o resto vira aviso. */
export type DecideReviewResult = { ok: true; review: ItemReviewRecord } | { ok: false; error: ReviewDecisionError | "REVIEW_NOT_FOUND" | "EDIT_VIOLATES_CONTRACT"; violations?: HumanEditViolation[] }

export async function decideItemReview(deps: { store: InteractionFeedbackStore; now: () => Date }, input: ReviewDecisionInput & { organizationId: string; reviewId: string; reviewerId: string }): Promise<DecideReviewResult> {
  const current = await deps.store.getItemReview(input.organizationId, input.reviewId)
  if (!current) return { ok: false, error: "REVIEW_NOT_FOUND" }
  const verdict = validateReviewDecision(current.reviewStatus, current.proposedWording, input)
  if (!verdict.ok) return { ok: false, error: verdict.error }
  let editWarnings: HumanEditViolation[] = []
  if (verdict.finalWording) {
    const check = checkHumanEdit(verdict.finalWording, current.writerItem, current.interactionLabel)
    if (check.blocking.length > 0) return { ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: check.blocking }
    editWarnings = check.warnings
  }
  const written = await deps.store.decideItemReview(input.organizationId, input.reviewId, { status: input.decision, finalWording: verdict.finalWording, reasonCategory: input.reasonCategory ?? null, comment: input.comment?.trim() || null, editWarnings, reviewedBy: input.reviewerId, reviewedAt: deps.now() })
  if (!written) return { ok: false, error: "REVIEW_ALREADY_DECIDED" }
  return { ok: true, review: (await deps.store.getItemReview(input.organizationId, input.reviewId))! }
}

/**
 * GATE DE ENTREGA (preparado; nenhuma superfície o consome nesta versão): disposição × QA × entrega real, pela regra única
 * `deliveryStateOf`. BLOCKED nunca sai; HOLD_FOR_QA só depois de APPROVED_* (com o texto final humano quando editado);
 * AUTO_DELIVER sai sem QA. REJECTED nunca sai.
 */
export async function deliverableItems(store: InteractionFeedbackStore, organizationId: string, runId: string): Promise<{ reviewId: string; slot: string; section: string; wording: ItemWording; disposition: FeedbackDisposition; qaStatus: ReviewStatus }[]> {
  const [reviews, decisions] = await Promise.all([store.listItemReviews(organizationId, runId), store.listDeliveryDecisions(organizationId, runId)])
  return reviews.flatMap((review) => {
    const decision = decisions.find((entry) => entry.itemReviewId === review.id)
    if (!decision || deliveryStateOf(decision.decision.disposition, review.reviewStatus, decision.deliveredAt) !== "READY_FOR_DELIVERY") return []
    return [{ reviewId: review.id, slot: review.slot, section: review.section, wording: review.finalWording ?? review.proposedWording, disposition: decision.decision.disposition, qaStatus: review.reviewStatus }]
  })
}

/**
 * Visão mínima de um item selecionado para QA (a tela usa `review-view.ts`): rótulo, tipo, significado seguro, evidência EXIBÍVEL, fonte da orientação e o texto
 * proposto (e se é o fallback). Nunca: raw, provenance, handles, prompt, dados de par, violações internas detalhadas.
 */
export function reviewerView(review: ItemReviewRecord) {
  return {
    reviewId: review.id,
    interactionLabel: review.interactionLabel,
    section: review.section,
    safeMeaning: review.writerItem.interpretation.safeMeaning,
    guidanceSource: review.writerItem.guidance.source,
    evidence: review.writerItem.evidence.map((entry) => ({ speaker: entry.speaker, text: entry.text, truncated: entry.truncated })),
    evidenceWithheld: review.writerItem.evidenceWithheld,
    proposedWording: review.proposedWording,
    proposedIsFallback: review.wordingSource === "FALLBACK",
    status: review.reviewStatus,
  }
}

export type { RunContext }
