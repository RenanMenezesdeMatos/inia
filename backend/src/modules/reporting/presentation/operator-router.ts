import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { decodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { fetchOperatorFeedbackPage, fetchOperatorIndicators, fetchOperatorProfile, OPERATOR_FEED_MAX_PAGE_SIZE } from "../application/fetch-operator-overview.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const feedbackPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(OPERATOR_FEED_MAX_PAGE_SIZE).optional(),
})

export function createOperatorRouter(db: Database) {
  const router = Router()

  // Acompanhamento do colaborador: perfil + último período de cada indicador + PRIMEIRA página do feed (o resto vem por
  // /feedbacks, pelo cursor). O colaborador só vê feedback PUBLICADO (rascunho/em revisão nunca chega ao Acompanhamento dele — achado U-F10).
  router.get("/overview", async (request, response) => {
    const { organizationId, personId: operatorId } = sessionUser(request)
    const [profile, indicators, feedbacks] = await Promise.all([
      fetchOperatorProfile(db, organizationId, operatorId),
      fetchOperatorIndicators(db, organizationId, operatorId),
      fetchOperatorFeedbackPage(db, organizationId, operatorId, { personId: operatorId }, { publishedOnly: true }),
    ])
    if (!profile) return response.status(404).json({ error: { code: "OPERATOR_NOT_FOUND", message: "Colaborador não encontrado." } })
    return response.json({ data: { profile, indicators, feedbacks: feedbacks.items, feedbacksNextCursor: feedbacks.nextCursor } })
  })

  // "Carregar mais" do Acompanhamento: a página seguinte ao cursor devolvido pela anterior (sempre do PRÓPRIO colaborador).
  router.get("/feedbacks", async (request, response) => {
    const query = feedbackPageQuerySchema.parse(request.query)
    const before = decodeFollowUpCursor(query.cursor)
    if (query.cursor && !before) throw new DomainError("Cursor de paginação inválido.", "INVALID_CURSOR", 400)
    const { organizationId, personId: operatorId } = sessionUser(request)
    const page = await fetchOperatorFeedbackPage(db, organizationId, operatorId, { personId: operatorId }, { publishedOnly: true, limit: query.limit, before })
    return response.json({ data: page })
  })

  return router
}
