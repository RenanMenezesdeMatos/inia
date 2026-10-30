import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { checkFeedbackReviewEdit, decideFeedbackReview, getFeedbackQualityAccess, getFeedbackReview, listFeedbackReviews, type FeedbackReviewDeps } from "../application/feedback-review-service.js"
import { REVIEW_REASON_CATEGORIES, REVIEWER_COMMENT_MAX } from "../domain/feedback-review.js"
import { WORDING_MAX_CHARS } from "../domain/review-view.js"
import { createPostgresFeedbackReviewReader } from "../infrastructure/postgres-feedback-review-reader.js"
import { createPostgresInteractionFeedbackStore } from "../infrastructure/postgres-interaction-feedback-store.js"
import { createPostgresFeedbackDeliveryStore } from "../infrastructure/postgres-feedback-delivery-store.js"
import { createPostgresReliableFeedbackStore } from "../../reliable-feedback/infrastructure/postgres-reliable-feedback-store.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const listQuerySchema = z.object({
  status: z.enum(["PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED", "ALL"]).default("PENDING_REVIEW"),
  search: z.string().trim().max(100).optional(),
  collaboratorId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  section: z.enum(["STRENGTH", "OPPORTUNITY"]).optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
const paramsSchema = z.object({ reviewId: z.string().uuid() })
const wordingText = z.string().max(WORDING_MAX_CHARS)
/** V1.7.1a — `suggestedResponse` (exemplo de condução) só tem efeito no feedback confiável; no feedback direto é descartado. */
const wordingSchema = z
  .object({ observed: wordingText, whyItMatters: wordingText, whatYouCanDo: wordingText, suggestedResponse: wordingText.optional() })
  .strict()
  .transform(({ suggestedResponse, ...rest }) => (suggestedResponse === undefined ? rest : { ...rest, suggestedResponse }))
const decisionSchema = z.object({
  decision: z.enum(["APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED"]),
  finalWording: wordingSchema.nullable().optional(),
  reasonCategory: z.enum(REVIEW_REASON_CATEGORIES).nullable().optional(),
  comment: z.string().max(REVIEWER_COMMENT_MAX).nullable().optional(),
}).strict()

/**
 * QA de feedback (QA Lab › Feedbacks; V1.5.4 → V1.5.5) — `/api/v1/feedback-quality-reviews`:
 *   GET  /access                capability FEEDBACK_QUALITY_REVIEW do avaliador (e os escopos dele)
 *   GET  /                      fila de itens SELECIONADOS para QA, escopada (paginação + filtros)
 *   GET  /:reviewId             detalhe para o avaliador (projeção segura)
 *   POST /:reviewId/edit-check  bloqueios × avisos de um texto editado (não grava)
 *   POST /:reviewId/decision    APPROVED_UNCHANGED | APPROVED_EDITED | REJECTED (avaliação única; 409 se já avaliada)
 * Só é montado com INIA_INTERACTION_FEEDBACK_PIPELINE=ON (app.ts); com OFF a rota cai no 404 genérico. O avaliador é sempre
 * a sessão; sem a capability = 403. Uma avaliação APPROVED_* aciona o use case de ENTREGA ao Acompanhamento (V1.5.6); nada
 * aqui chama o redator nem notifica.
 */
export function createFeedbackReviewRouter(database: Database, deps?: Partial<FeedbackReviewDeps> & { clock?: Clock }) {
  const clock = deps?.clock ?? systemClock
  const resolved: FeedbackReviewDeps = { reader: deps?.reader ?? createPostgresFeedbackReviewReader(database), store: deps?.store ?? createPostgresInteractionFeedbackStore(database), now: deps?.now ?? (() => clock.now()), deliveries: deps && "deliveries" in deps ? deps.deliveries : createPostgresFeedbackDeliveryStore(database), reliable: deps && "reliable" in deps ? deps.reliable : createPostgresReliableFeedbackStore(database) }
  const router = Router()
  const viewerOf = (request: { user?: { personId: string; organizationId: string } }) => ({ personId: sessionUser(request).personId, organizationId: sessionUser(request).organizationId })

  router.get("/access", async (request, response) => {
    response.json({ data: await getFeedbackQualityAccess(resolved, viewerOf(request)) })
  })
  router.get("/", async (request, response) => {
    response.json({ data: await listFeedbackReviews(resolved, viewerOf(request), listQuerySchema.parse(request.query)) })
  })
  router.get("/:reviewId", async (request, response) => {
    response.json({ data: await getFeedbackReview(resolved, viewerOf(request), paramsSchema.parse(request.params).reviewId) })
  })
  router.post("/:reviewId/edit-check", async (request, response) => {
    const { reviewId } = paramsSchema.parse(request.params)
    response.json({ data: await checkFeedbackReviewEdit(resolved, viewerOf(request), reviewId, wordingSchema.parse(request.body)) })
  })
  router.post("/:reviewId/decision", async (request, response) => {
    const { reviewId } = paramsSchema.parse(request.params)
    const body = decisionSchema.parse(request.body)
    response.json({ data: await decideFeedbackReview(resolved, viewerOf(request), reviewId, { decision: body.decision, finalWording: body.finalWording ?? null, reasonCategory: body.reasonCategory ?? null, comment: body.comment ?? null }) })
  })
  return router
}
