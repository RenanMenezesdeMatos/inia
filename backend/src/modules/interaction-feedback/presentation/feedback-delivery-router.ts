import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { listMyFeedbackDeliveries, type FeedbackDeliveryStore } from "../application/deliver-feedback.js"
import { createPostgresFeedbackDeliveryStore } from "../infrastructure/postgres-feedback-delivery-store.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { loadFeedbackEvaluations, type EvaluationReader } from "../../feedback-rating/application/feedback-evaluation-reader.js"
import { EMPTY_EVALUATION, type FeedbackEvaluationView } from "../../feedback-rating/domain/feedback-rating.js"
import { sourceKey, type FeedbackSourceRef } from "../../feedback-application/domain/feedback-application.js"

export type EvaluationsLoader = (reader: EvaluationReader, sources: FeedbackSourceRef[]) => Promise<Map<string, FeedbackEvaluationView>>

/**
 * Feedback de atendimento entregue — Acompanhamento do PRÓPRIO colaborador (V1.5.6) — `/api/v1/feedback-deliveries`:
 *   GET  /mine                     entregas do colaborador da sessão (nunca aceita collaboratorId de fora)
 * Ciência do colaborador: só com login e senha, em /api/v1/feedback-read-confirmations (mesma função `acknowledgeFeedbackDelivery`).
 * Cada entrega vem com `evaluation` (a escolha registrada na ciência e a contestação antiga, migration 186) — só da pessoa da sessão.
 * Só é montado com INIA_INTERACTION_FEEDBACK_PIPELINE=ON (app.ts). Nada aqui entrega, notifica ou chama modelo.
 */
export function createFeedbackDeliveryRouter(database: Database, deps?: { deliveries?: FeedbackDeliveryStore; clock?: Clock; evaluations?: EvaluationsLoader }) {
  const deliveries = deps?.deliveries ?? createPostgresFeedbackDeliveryStore(database)
  const evaluations: EvaluationsLoader = deps?.evaluations ?? ((reader, sources) => loadFeedbackEvaluations(database, reader, sources))
  const clock = deps?.clock ?? systemClock
  const resolved = { deliveries, now: () => clock.now() }
  const router = Router()
  const viewerOf = (request: { user?: { personId: string; organizationId: string } }) => ({ personId: sessionUser(request).personId, organizationId: sessionUser(request).organizationId })
  router.get("/mine", async (request, response) => {
    const viewer = viewerOf(request)
    const items = await listMyFeedbackDeliveries(resolved, viewer)
    const sources = items.map((item) => ({ kind: "INTERACTION_FEEDBACK_DELIVERY" as const, id: item.id }))
    const evaluationOf = await evaluations(viewer, sources)
    response.json({ data: items.map((item, index) => ({ ...item, evaluation: evaluationOf.get(sourceKey(sources[index]!)) ?? EMPTY_EVALUATION })) })
  })
  return router
}
