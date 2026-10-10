import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { submitHumanReviewDecision } from "../../workflows/application/submit-human-review-decision.js"
import { humanReviewDecisionSchema } from "../../workflows/domain/graph-schema.js"
import { JUSTIFIED_ABSENCE_REASONS } from "../../people/domain/workday-classification.js"
import { resolveReconciliation } from "../../people/application/workday-reconciliation-service.js"
import { buildHumanReviewDetail, buildPendingActions, buildWorkdayReconciliationDetail, decideHumanReview, decideWorkdayReconciliation, type ResolveWorkday, type SubmitDecision } from "../application/build-pending-actions.js"
import { PgPendingActionsRepository, type PendingActionsRepository } from "../application/pending-actions-repository.js"

const reviewParamsSchema = z.object({ enrollmentId: z.string().uuid(), nodeId: z.string().min(1) })
const decisionBodySchema = z.object({ decision: humanReviewDecisionSchema })
const workdayParamsSchema = z.object({ reconciliationId: z.string().uuid() })
/** Resolução de "Produção não identificada": falta injustificada | ausência justificada (motivo) | trabalhou, dados não chegaram | corrigir planejamento. */
const workdayDecisionSchema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("UNJUSTIFIED_ABSENCE") }),
  z.object({ resolution: z.literal("JUSTIFIED_ABSENCE"), reasonCode: z.enum(JUSTIFIED_ABSENCE_REASONS) }),
  z.object({ resolution: z.literal("WORKED_DATA_MISSING") }),
  z.object({ resolution: z.literal("SCHEDULE_CORRECTED") }),
])

/**
 * Surface Pendências — GET /pending-actions (fila + histórico do viewer),
 * GET /pending-actions/human-reviews/:enrollmentId/:nodeId (detalhe com contexto) e
 * POST .../decision (aprovar/reprovar/escalar); GET /pending-actions/workday-reconciliations/:id e
 * POST .../resolve (produção não identificada: falta injustificada / ausência justificada / dados não chegaram / corrigir planejamento).
 * O viewer é sempre a sessão; nunca um id do browser.
 */
export function createPendingActionsRouter(
  database: Database,
  repository: PendingActionsRepository = new PgPendingActionsRepository(database),
  submit: SubmitDecision = (input) => submitHumanReviewDecision(database, input),
  resolveWorkday: ResolveWorkday = (input) => resolveReconciliation(database, input),
) {
  const router = Router()

  router.get("/", async (request, response) => {
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await buildPendingActions(repository, viewer) })
  })

  router.get("/human-reviews/:enrollmentId/:nodeId", async (request, response) => {
    const params = reviewParamsSchema.parse(request.params)
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await buildHumanReviewDetail(repository, viewer, params.enrollmentId, params.nodeId) })
  })

  router.post("/human-reviews/:enrollmentId/:nodeId/decision", async (request, response) => {
    const params = reviewParamsSchema.parse(request.params)
    const body = decisionBodySchema.parse(request.body)
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await decideHumanReview(repository, submit, viewer, { ...params, decision: body.decision }) })
  })

  router.get("/workday-reconciliations/:reconciliationId", async (request, response) => {
    const params = workdayParamsSchema.parse(request.params)
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await buildWorkdayReconciliationDetail(repository, viewer, params.reconciliationId) })
  })

  router.post("/workday-reconciliations/:reconciliationId/resolve", async (request, response) => {
    const params = workdayParamsSchema.parse(request.params)
    const decision = workdayDecisionSchema.parse(request.body)
    const viewer = { personId: request.user!.personId, organizationId: request.user!.organizationId }
    response.json({ data: await decideWorkdayReconciliation(repository, resolveWorkday, viewer, params.reconciliationId, decision) })
  })

  return router
}
