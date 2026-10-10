import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { listMyFeedbackDeliveries, type FeedbackDeliveryStore } from "../application/deliver-feedback.js"
import { createPostgresFeedbackDeliveryStore } from "../infrastructure/postgres-feedback-delivery-store.js"

/**
 * Feedback de atendimento entregue — Acompanhamento do PRÓPRIO colaborador (V1.5.6) — `/api/v1/feedback-deliveries`:
 *   GET  /mine                     entregas do colaborador da sessão (nunca aceita collaboratorId de fora)
 * Ciência do colaborador: só com login e senha, em /api/v1/feedback-read-confirmations (mesma função `acknowledgeFeedbackDelivery`).
 * Só é montado com INIA_INTERACTION_FEEDBACK_PIPELINE=ON (app.ts). Nada aqui entrega, notifica ou chama modelo.
 */
export function createFeedbackDeliveryRouter(database: Database, deps?: { deliveries?: FeedbackDeliveryStore; clock?: Clock }) {
  const deliveries = deps?.deliveries ?? createPostgresFeedbackDeliveryStore(database)
  const clock = deps?.clock ?? systemClock
  const resolved = { deliveries, now: () => clock.now() }
  const router = Router()
  const viewerOf = (request: { user?: { personId: string; organizationId: string } }) => ({ personId: request.user!.personId, organizationId: request.user!.organizationId })
  router.get("/mine", async (request, response) => {
    response.json({ data: await listMyFeedbackDeliveries(resolved, viewerOf(request)) })
  })
  return router
}
