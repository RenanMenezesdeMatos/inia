import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { submitHumanReviewDecision } from "../../application/submit-human-review-decision.js"
import { dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../../shared/presentation/list-query.js"
import { getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import { humanReviewDecisionSchema } from "../../domain/graph-schema.js"
import { NOT_FOUND, canManageWorkflow, fetchScopedRow } from "./shared.js"

const submitHumanReviewDecisionSchema = z.object({ nodeId: z.string().min(1), decision: humanReviewDecisionSchema })

const listEnrollmentsSchema = z.object({
  search: searchParam,
  status: listParam(z.enum(["active", "waiting", "completed", "failed", "dead"])),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const ENROLLMENT_SELECT = `
  select
    we.id, we.current_node_id "currentNodeId", we.status, we.next_eval_at "nextEvalAt",
    we.created_at "createdAt", we.updated_at "updatedAt",
    -- Origem MANUAL (quem executou, para quem): identificável mesmo com interação/medição associada.
    (select json_build_object('id', mr.id, 'requestedAt', mr.requested_at, 'requestedByName', rb.name, 'collaboratorName', c.name, 'context', mr.context)
       from workflow_manual_runs mr join people rb on rb.id = mr.requested_by join people c on c.id = mr.collaborator_id
      where mr.id = we.manual_run_id) "manualRun",
    coalesce((
      select json_agg(json_build_object('nodeId', e.node_id, 'eventType', e.event_type, 'payload', e.payload, 'createdAt', e.created_at) order by e.created_at)
      from workflow_enrollment_events e where e.enrollment_id = we.id
    ), '[]') "events"
  from workflow_enrollments we
  where we.workflow_id = $1
`

/** Execuções (matrículas) e a decisão da Revisão humana pela rota admin. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowEnrollmentRoutes(router: Router, db: Database): void {

  router.get("/:id/enrollments", async (request, response) => {
    const current = await fetchScopedRow(db, request.user!.organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const input = listEnrollmentsSchema.parse(request.query)
    const filter = new SqlFilter([request.params.id])
      .search(input.search, ['q."currentNodeId"'])
      .in("q.status", input.status)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    // Sem paginação mantém o teto antigo de 50 execuções mais recentes.
    const data = await respondList(db, { ...request.query, page: request.query.page ?? "1", pageSize: request.query.pageSize ?? "50" }, {
      select: ENROLLMENT_SELECT,
      filter,
      orderBy: 'q."createdAt" desc, q.id',
    })
    response.json({ data })
  })

  // Decisão humana de um node Human Review (aprovar/reprovar/escalar) — o motor nunca chama
  // isso sozinho, nem bloqueia esperando: o enrollment fica em "waiting" (ver node-handlers.ts)
  // até esta rota gravar a decisão e reagendar o próximo tick.
  router.post("/:id/enrollments/:enrollmentId/decision", async (request, response) => {
    const input = submitHumanReviewDecisionSchema.parse(request.body)
    const current = await fetchScopedRow(db, request.user!.organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    // Gravação compartilhada com a Surface Pendências do revisor (submit-human-review-decision.ts).
    await submitHumanReviewDecision(db, { enrollmentId: request.params.enrollmentId!, workflowId: request.params.id!, nodeId: input.nodeId, decision: input.decision, reviewerId: request.user!.personId })
    response.status(204).send()
  })
}
