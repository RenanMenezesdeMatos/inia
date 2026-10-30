import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { getContestation, listContestations, reviewContestation, type Reviewer } from "../application/contestation-review-service.js"
import { contestationReviewInputSchema, FEEDBACK_DISLIKE_REASONS } from "../domain/feedback-rating.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const listQuerySchema = z
  .object({
    status: z.enum(["PENDING", "ANSWERED"]).optional(),
    reason: z.enum(FEEDBACK_DISLIKE_REASONS).optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

/**
 * Contestações de feedback — `/api/v1/admin/feedback-contestations` (montado atrás de `feedback_contestations.review`). O
 * recorte (quem aparece) é sempre o escopo das atribuições de quem revisa, lido do banco a cada request.
 *
 *   GET  /                 fila (sem resposta primeiro) + contagem das que esperam resposta
 *   GET  /:id              detalhe com o conteúdo do feedback contestado
 *   POST /:id/review       { decision, response } → responde (uma vez)
 */
export function createFeedbackContestationsRouter(db: Database, deps: { now?: () => Date } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const reviewerOf = (request: { user?: { organizationId: string; personId: string } }): Reviewer => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId })
  const id = (value: unknown) => z.string().uuid().parse(value)

  router.get("/", async (request, response) => {
    response.json({ data: await listContestations(db, reviewerOf(request), listQuerySchema.parse(request.query)) })
  })

  router.get("/:id", async (request, response) => {
    response.json({ data: await getContestation(db, reviewerOf(request), id(request.params.id)) })
  })

  router.post("/:id/review", async (request, response) => {
    const input = contestationReviewInputSchema.parse(request.body)
    response.json({ data: await reviewContestation(db, reviewerOf(request), id(request.params.id), input, now()) })
  })

  return router
}
