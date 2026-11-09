import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { submitHumanReviewDecision } from "../../application/submit-human-review-decision.js"
import { dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../../shared/presentation/list-query.js"
import { getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import { humanReviewDecisionSchema } from "../../domain/graph-schema.js"
import { NOT_FOUND, canManageWorkflow, fetchScopedRow } from "./shared.js"
import { sessionUser } from "../../../auth/presentation/session-user.js"
import { confirmWorkflowRetry, previewWorkflowRetry } from "../../application/workflow-retry.js"
import { signalWorkflowWork } from "../../application/workflow-work-signal.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"

/** A execução precisa ser deste Workflow (o alcance foi conferido pelo Workflow). */
async function assertEnrollmentOfWorkflow(db: Database, workflowId: string, enrollmentId: string): Promise<void> {
  const found = await db.query(`select 1 from workflow_enrollments where id = $1 and workflow_id = $2`, [enrollmentId, workflowId])
  if (!found.rows[0]) throw new DomainError("Execução não encontrada.", "WORKFLOW_ENROLLMENT_NOT_FOUND", 404)
}

const submitHumanReviewDecisionSchema = z.object({ nodeId: z.string().min(1), decision: humanReviewDecisionSchema })

const listEnrollmentsSchema = z.object({
  search: searchParam,
  status: listParam(z.enum(["active", "waiting", "completed", "failed", "dead", "blocked"])),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const ENROLLMENT_SELECT = `
  select
    we.id, we.current_node_id "currentNodeId", we.status, we.next_eval_at "nextEvalAt",
    we.created_at "createdAt", we.updated_at "updatedAt",
    -- PEN-073/074: bloqueio por agente inativo, versão do Workflow usada e o vínculo original ↔ novas tentativas.
    we.version_id "versionId", (select count(*)::int from workflow_versions v2 where v2.workflow_id = we.workflow_id and v2.created_at <= (select v.created_at from workflow_versions v where v.id = we.version_id)) "versionNumber",
    we.blocked_at "blockedAt", we.blocked_node_id "blockedNodeId", we.blocked_reason "blockedReason", we.blocked_details "blockedDetails",
    we.retry_of_enrollment_id "retryOfEnrollmentId", we.retry_requested_by_name "retryRequestedByName", we.retry_requested_at "retryRequestedAt",
    we.retry_confirmation -> 'agents' "retryAgents",
    coalesce((select json_agg(json_build_object('id', r.id, 'status', r.status, 'requestedAt', r.retry_requested_at, 'requestedByName', r.retry_requested_by_name) order by r.created_at)
                from workflow_enrollments r where r.retry_of_enrollment_id = we.id), '[]') "retries",
    coalesce((select json_agg(json_build_object('nodeId', ev.node_id, 'agentRunId', ar.id, 'agentId', ar.agent_id, 'agentName', a.name, 'agentActive', a.active, 'agentVersionNumber', av.version_number, 'status', ar.status) order by ar.created_at)
                from workflow_enrollment_events ev join agent_runs ar on ar.id = ev.agent_run_id join agents_all a on a.id = ar.agent_id left join agent_versions av on av.id = ar.agent_version_id
               where ev.enrollment_id = we.id), '[]') "agentRuns",
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
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
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

  /**
   * Nova tentativa de execução bloqueada (PEN-073 a PEN-075): a prévia mostra versão, agentes, destinos e aprovações que serão
   * usados; a confirmação manda a impressão digital do que foi visto e o servidor confere tudo de novo. Mesma permissão do
   * "Executar agora" (`workflows.manage` no alcance do Workflow).
   */
  router.get("/:id/enrollments/:enrollmentId/retry", async (request, response) => {
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    await assertEnrollmentOfWorkflow(db, request.params.id!, request.params.enrollmentId!)
    response.json({ data: await previewWorkflowRetry(db, sessionUser(request).organizationId, request.params.enrollmentId!) })
  })

  router.post("/:id/enrollments/:enrollmentId/retry", async (request, response) => {
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    await assertEnrollmentOfWorkflow(db, request.params.id!, request.params.enrollmentId!)
    const input = z.object({ fingerprint: z.string().min(8) }).parse(request.body)
    const created = await confirmWorkflowRetry(db, sessionUser(request).organizationId, request.params.enrollmentId!, input, { personId: request.user?.personId ?? null, name: request.user?.name ?? "Sistema" })
    signalWorkflowWork()
    response.status(201).json({ data: created })
  })

  /**
   * "Ver histórico desta execução" (PEN-071): só as execuções de agente ligadas a ESTA execução do Workflow — com o agente
   * identificado (inclusive inativo) e a versão usada — para quem pode consultar o Workflow; nunca o cadastro, outras execuções
   * do agente nem o histórico de alterações dele.
   */
  router.get("/:id/enrollments/:enrollmentId/agent-records", async (request, response) => {
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    await assertEnrollmentOfWorkflow(db, request.params.id!, request.params.enrollmentId!)
    const rows = await db.query(
      `select ar.id, ar.agent_id "agentId", a.name "agentName", a.active "agentActive", ar.status, ar.source, ar.created_at "createdAt", ar.completed_at "completedAt",
              ar.output_text "outputText", ar.error_message "errorMessage", av.version_number "agentVersionNumber", ev.node_id "nodeId"
         from workflow_enrollment_events ev join agent_runs ar on ar.id = ev.agent_run_id join agents_all a on a.id = ar.agent_id left join agent_versions av on av.id = ar.agent_version_id
        where ev.enrollment_id = $1 and ar.organization_id = $2
        order by ar.created_at`,
      [request.params.enrollmentId, sessionUser(request).organizationId],
    )
    response.json({ data: rows.rows })
  })

  // Decisão humana de um node Human Review (aprovar/reprovar/escalar) — o motor nunca chama
  // isso sozinho, nem bloqueia esperando: o enrollment fica em "waiting" (ver node-handlers.ts)
  // até esta rota gravar a decisão e reagendar o próximo tick.
  router.post("/:id/enrollments/:enrollmentId/decision", async (request, response) => {
    const input = submitHumanReviewDecisionSchema.parse(request.body)
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    // Gravação compartilhada com a Surface Pendências do revisor (submit-human-review-decision.ts).
    await submitHumanReviewDecision(db, { enrollmentId: request.params.enrollmentId!, workflowId: request.params.id!, nodeId: input.nodeId, decision: input.decision, reviewerId: sessionUser(request).personId })
    response.status(204).send()
  })
}
