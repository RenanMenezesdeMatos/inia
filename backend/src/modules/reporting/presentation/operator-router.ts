import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fetchOperatorFeedbacks, fetchOperatorIndicators, fetchOperatorProfile } from "../application/fetch-operator-overview.js"

export function createOperatorRouter(db: Database) {
  const router = Router()

  router.get("/overview", async (request, response) => {
    const operatorId = request.user!.personId
    const [profile, indicators, feedbacks] = await Promise.all([
      fetchOperatorProfile(db, request.user!.organizationId, operatorId),
      fetchOperatorIndicators(db, operatorId),
      // O colaborador só vê feedback PUBLICADO (rascunho/em revisão nunca chega ao Acompanhamento dele — achado U-F10).
      fetchOperatorFeedbacks(db, request.user!.organizationId, operatorId, { personId: request.user!.personId }, { publishedOnly: true }),
    ])
    if (!profile) return response.status(404).json({ error: { code: "OPERATOR_NOT_FOUND", message: "Colaborador não encontrado." } })
    return response.json({ data: { profile, indicators, feedbacks } })
  })

  return router
}
