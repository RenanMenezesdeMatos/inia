import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ItemWording } from "../../investigation/domain/interaction-feedback-writer.js"
import type { ReviewDecisionInput } from "../domain/feedback-review.js"
import { checkHumanEdit, toKnowledgeView, toQueueItem, toReliableReviewDetail, toReviewDetail, violationMessage, type ReviewDetailView } from "../domain/review-view.js"
import { checkReliableHumanEdit, decideReliableReview } from "../../reliable-feedback/application/decide-reliable-review.js"
import type { ReliableFeedbackStore } from "../../reliable-feedback/application/ports.js"
import type { FeedbackReviewReader, QaGrantScope, QaPermission, ReviewQueueFilters, ReviewViewer, ScopedReview } from "./feedback-review-reader.js"
import { decideItemReview } from "./interaction-feedback-pipeline.js"
import { deliverFeedbackItem, type FeedbackDeliveryStore } from "./deliver-feedback.js"
import type { InteractionFeedbackStore } from "./ports.js"

/**
 * CASOS DE USO DO QA DE FEEDBACK (V1.5.4, reenquadrados na V1.5.5): acesso → fila → detalhe → checagem da edição → avaliação.
 * A avaliação mede a QUALIDADE do output da INIA; não é autorização do supervisor e nunca altera a disposição estrutural.
 * O avaliador vem SEMPRE da sessão; a autorização é do modelo geral de acesso (V1.5.7): papel QA_DE_FEEDBACK →
 * `feedback_quality_review.view` (fila/detalhe) e `.decide` (checar edição/avaliar), cada uma com o seu escopo; sem a
 * permissão = 403. Cargo nunca concede QA.
 */
/** `deliveries` presente = após uma avaliação APPROVED_*, o use case de entrega roda (V1.5.6). Ausente = só avalia. */
export type FeedbackReviewDeps = { reader: FeedbackReviewReader; store: InteractionFeedbackStore; now: () => Date; deliveries?: FeedbackDeliveryStore; /** V1.5.12 — itens do feedback confiável do Workflow (decisão retoma a matrícula). */ reliable?: ReliableFeedbackStore }

const forbidden = () => new DomainError("Você não tem permissão de QA de feedback.", "FEEDBACK_QUALITY_REVIEW_FORBIDDEN", 403)
const SCOPE_LABELS: Record<QaGrantScope["scopeType"], string> = { MY_STRUCTURE: "Sua estrutura", GROUP: "Grupo", SUBGROUP: "Subgrupo", ORGANIZATION: "Toda a organização" }

async function requirePermission(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer, permission: QaPermission) {
  const grants = await deps.reader.grantsOf(viewer, permission)
  if (grants.length === 0) throw forbidden()
  return grants
}

/** O que a conta pode no QA de feedback (derivado das permissões; sem revelar nada além dos próprios escopos). */
export async function getFeedbackQualityAccess(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer) {
  const [view, decide] = await Promise.all([deps.reader.grantsOf(viewer, "feedback_quality_review.view"), deps.reader.grantsOf(viewer, "feedback_quality_review.decide")])
  return { canReview: view.length > 0, canDecide: decide.length > 0, scopes: [...new Set(view.map((grant) => grant.scopeType))].map((scopeType) => ({ scopeType, label: SCOPE_LABELS[scopeType] })) }
}

const notFound = () => new DomainError("Revisão não encontrada ou fora do seu escopo.", "FEEDBACK_REVIEW_NOT_FOUND", 404)
const detailOf = (scoped: ScopedReview): ReviewDetailView => (scoped.origin === "WORKFLOW" ? toReliableReviewDetail(scoped.record, scoped.context, scoped.analysis ?? null) : toReviewDetail(scoped.record, scoped.context, scoped.knowledge.map(toKnowledgeView)))
const describeViolations = (codes: readonly string[]) => codes.map((code) => ({ code, message: violationMessage(code) }))

export async function listFeedbackReviews(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer, filters: ReviewQueueFilters) {
  await requirePermission(deps, viewer, "feedback_quality_review.view")
  const page = await deps.reader.listQueue(viewer, filters)
  return { items: page.rows.map((row) => toQueueItem(row.record, row.context)), total: page.total, page: filters.page, pageSize: filters.pageSize, filterOptions: page.filterOptions }
}

export async function getFeedbackReview(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer, reviewId: string): Promise<ReviewDetailView> {
  await requirePermission(deps, viewer, "feedback_quality_review.view")
  const scoped = await deps.reader.loadInScope(viewer, reviewId)
  if (!scoped) throw notFound()
  return detailOf(scoped)
}

/** Checagem da edição humana SEM gravar nada — o revisor vê bloqueios e avisos antes de decidir. */
export async function checkFeedbackReviewEdit(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer, reviewId: string, wording: ItemWording & { suggestedResponse?: string }) {
  await requirePermission(deps, viewer, "feedback_quality_review.decide")
  const scoped = await deps.reader.loadInScope(viewer, reviewId, "feedback_quality_review.decide")
  if (!scoped) throw notFound()
  const trimmed = { observed: wording.observed.trim(), whyItMatters: wording.whyItMatters.trim(), whatYouCanDo: wording.whatYouCanDo.trim() }
  // V1.7.1a — o exemplo de condução só existe no feedback confiável (Workflow).
  const example = typeof wording.suggestedResponse === "string" ? wording.suggestedResponse.trim() : ""
  const check = scoped.origin === "WORKFLOW" ? checkReliableHumanEdit({ ...trimmed, ...(example ? { suggestedResponse: example } : {}) }, scoped.record) : checkHumanEdit(trimmed, scoped.record.writerItem, scoped.record.interactionLabel)
  return { blocking: describeViolations(check.blocking), warnings: describeViolations(check.warnings) }
}

const DECISION_ERROR_MESSAGES: Record<string, string> = {
  REASON_REQUIRED: "Escolha um motivo para esta decisão.",
  UNKNOWN_REASON: "Motivo inválido.",
  FINAL_WORDING_REQUIRED: "Informe o texto editado.",
  FINAL_WORDING_EMPTY: "Preencha os campos obrigatórios do texto editado.",
  FINAL_WORDING_UNCHANGED: "O texto editado é igual ao proposto — use Aprovar.",
  FINAL_WORDING_NOT_ALLOWED: "Texto editado só é aceito em \"Aprovar com edição\".",
  COMMENT_TOO_LONG: "O comentário passou do limite de caracteres.",
  UNKNOWN_DECISION: "Decisão inválida.",
}

/**
 * Avaliação ÚNICA e concorrente-segura: a gravação só acontece se o item ainda estiver PENDING_REVIEW (update condicional no
 * store). Quem chega depois recebe 409 com o estado ATUAL (quem decidiu, quando, o quê) — nunca sobrescreve em silêncio.
 */
export async function decideFeedbackReview(deps: FeedbackReviewDeps, viewer: ReviewViewer, reviewId: string, input: ReviewDecisionInput): Promise<ReviewDetailView> {
  await requirePermission(deps, viewer, "feedback_quality_review.decide")
  const scoped = await deps.reader.loadInScope(viewer, reviewId, "feedback_quality_review.decide")
  if (!scoped) throw notFound()
  if (scoped.origin === "WORKFLOW") {
    // V1.5.12: avaliar um item do feedback confiável NÃO entrega — fecha o QA do artefato e retoma a MESMA matrícula (na
    // mesma transação da avaliação); é o Workflow (Revisão humana/Output) que segue dali.
    if (!deps.reliable) throw notFound()
    const reliable = await decideReliableReview({ store: deps.reliable, now: deps.now }, { ...input, organizationId: viewer.organizationId, reviewId, reviewerId: viewer.personId })
    if (reliable.ok) return detailOf((await deps.reader.loadInScope(viewer, reviewId)) ?? scoped)
    return throwDecisionError(deps, viewer, reviewId, reliable.error, reliable.violations ?? [])
  }
  // O feedback direto de atendimento não tem exemplo de condução: o campo nunca é gravado nele.
  const finalWording = input.finalWording ? { observed: input.finalWording.observed, whyItMatters: input.finalWording.whyItMatters, whatYouCanDo: input.finalWording.whatYouCanDo } : input.finalWording
  const result = await decideItemReview({ store: deps.store, now: deps.now }, { ...input, finalWording, organizationId: viewer.organizationId, reviewId, reviewerId: viewer.personId })
  if (result.ok) {
    // Avaliar ≠ entregar: a entrega é um use case próprio que decide pela disposição × resultado de QA (a rejeição nunca
    // entrega). Falha técnica aqui NÃO desfaz a avaliação (já gravada): o item fica "pronto para entrega" e o varredor
    // idempotente tenta de novo.
    if (deps.deliveries) await deliverFeedbackItem({ deliveries: deps.deliveries, now: deps.now }, { organizationId: viewer.organizationId, itemReviewId: reviewId }).catch((error: unknown) => {
      console.error("[interaction-feedback] entrega após QA falhou; será refeita pelo varredor", error instanceof Error ? error.message : error)
    })
    const fresh = await deps.reader.loadInScope(viewer, reviewId)
    return detailOf(fresh ?? scoped)
  }
  return throwDecisionError(deps, viewer, reviewId, result.error, result.violations ?? [])
}

async function throwDecisionError(deps: Pick<FeedbackReviewDeps, "reader">, viewer: ReviewViewer, reviewId: string, error: string, violations: readonly string[]): Promise<never> {
  if (error === "REVIEW_ALREADY_DECIDED") {
    const current = await deps.reader.loadInScope(viewer, reviewId)
    throw new DomainError("Este feedback já foi avaliado por outra pessoa ou em outra aba.", "FEEDBACK_REVIEW_ALREADY_DECIDED", 409, { current: current ? detailOf(current) : null })
  }
  if (error === "REVIEW_NOT_FOUND" || error === "NOT_SELECTED_FOR_QA") throw notFound()
  if (error === "EDIT_VIOLATES_CONTRACT") throw new DomainError("O texto editado tem um problema que impede a aprovação.", "FEEDBACK_REVIEW_EDIT_BLOCKED", 422, { violations: describeViolations(violations) })
  throw new DomainError(DECISION_ERROR_MESSAGES[error] ?? "Decisão inválida.", "FEEDBACK_REVIEW_INVALID_DECISION", 422, { reason: error })
}
