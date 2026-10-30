import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { listMyRatings, rateFeedback, type RatingScope } from "../application/feedback-rating-service.js"
import { feedbackRatingInputSchema } from "../domain/feedback-rating.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Avaliação do feedback pelo próprio destinatário — `/api/v1/feedback-ratings` (migration 113). A pessoa é sempre a da sessão.
 *
 *   GET  /   avaliações vigentes da pessoa (estado dos botões "Este conteúdo foi útil?")
 *   POST /   { source, value: UP } | { source, value: DOWN, reason, comment } | { source, value: NONE } → { rating }
 */
export function createFeedbackRatingsRouter(db: Database, deps: { now?: () => Date } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const scopeOf = (request: { user?: { organizationId: string; personId: string } }): RatingScope => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId })

  router.get("/", async (request, response) => {
    response.json({ data: { items: await listMyRatings(db, scopeOf(request)) } })
  })

  router.post("/", async (request, response) => {
    const input = feedbackRatingInputSchema.parse(request.body)
    response.json({ data: { rating: await rateFeedback(db, scopeOf(request), input, now()) } })
  })

  return router
}
