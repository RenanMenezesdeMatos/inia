import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { getManageableScopes, type ManageableScopes } from "../../../auth/application/manageable-scopes.js"
import { listManualRunCollaborators, listManualRunInteractions, listManualRunMeasurements, listManualRuns, loadManualRun, loadManualRunTarget, manualRunBlockers, requestManualRun, type CollaboratorScopeCheck } from "../../application/manual-run.js"
import { NOT_FOUND, canManageWorkflow, fetchScopedRow, type WorkflowRouterOptions } from "./shared.js"


/** Gatilho Manual — "Executar agora". Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowManualRunRoutes(router: Router, db: Database, options: WorkflowRouterOptions): void {

  // ---------------------------------------------------------------------------------------
  // Gatilho MANUAL — "Executar agora" (manual-run.ts). Mesma permissão/escopo de quem edita o Workflow
  // (`workflows.manage` no escopo dele) + o colaborador precisa estar no escopo de quem dispara E ser elegível pelo
  // Workflow. Cria só a matrícula normal do motor; nada é entregue por fora do fluxo.
  // ---------------------------------------------------------------------------------------

  /** Quem dispara vê só as pessoas do próprio escopo de gestão (Organização → todos; Grupo → o Grupo e seus Subgrupos). */
  function collaboratorScopeCheck(scopes: ManageableScopes): CollaboratorScopeCheck {
    return (person) =>
      scopes.unrestricted ||
      scopes.allTeams ||
      (person.subteamId !== null && scopes.subteamIds.has(person.subteamId)) ||
      (person.teamId !== null && scopes.teamIds.has(person.teamId))
  }

  async function manualRunAccess(request: import("express").Request) {
    const organizationId = request.user!.organizationId
    const workflowId = String(request.params.id)
    const current = await fetchScopedRow(db, organizationId, workflowId)
    if (!current) return null
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return null
    const target = await loadManualRunTarget(db, organizationId, workflowId)
    return target ? { target, canAccess: collaboratorScopeCheck(scopes) } : null
  }

  router.get("/:id/manual-run", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const { target } = access
    response.json({
      data: {
        workflowId: target.id,
        workflowName: target.name,
        context: target.trigger?.context ?? null,
        indicator: target.trigger?.indicatorCode ? { code: target.trigger.indicatorCode, name: target.indicatorName, unit: target.indicatorUnit } : null,
        published: target.versionId !== null,
        active: target.active,
        blockers: manualRunBlockers(target),
        recentRuns: target.trigger ? await listManualRuns(db, organizationId, target.id) : [],
      },
    })
  })

  router.get("/:id/manual-run/collaborators", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const input = z.object({ search: z.string().trim().max(120).optional() }).parse(request.query)
    response.json({ data: await listManualRunCollaborators(db, organizationId, access.target, access.canAccess, { search: input.search }) })
  })

  router.get("/:id/manual-run/interactions", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const input = z.object({ collaboratorId: z.string().uuid(), search: z.string().trim().max(120).optional() }).parse(request.query)
    response.json({ data: await listManualRunInteractions(db, organizationId, access.target, input.collaboratorId, access.canAccess, { search: input.search }) })
  })

  router.get("/:id/manual-run/measurements", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const input = z.object({ collaboratorId: z.string().uuid() }).parse(request.query)
    response.json({ data: await listManualRunMeasurements(db, organizationId, access.target, input.collaboratorId, access.canAccess) })
  })

  router.post("/:id/manual-runs", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const input = z
      .object({
        collaboratorId: z.string().uuid(),
        interactionId: z.string().uuid().nullable().optional(),
        indicatorMeasurementId: z.string().uuid().nullable().optional(),
        idempotencyKey: z.string().trim().min(8).max(120),
      })
      .parse(request.body)
    const result = await requestManualRun(
      db,
      { organizationId, workflowId: request.params.id!, requestedBy: request.user!.personId, collaboratorId: input.collaboratorId, interactionId: input.interactionId ?? null, indicatorMeasurementId: input.indicatorMeasurementId ?? null, idempotencyKey: input.idempotencyKey },
      access.canAccess,
    )
    // Só o disparo NOVO acorda o worker do motor (reivindica na hora, sem esperar a varredura); o reenvio não faz nada.
    if (result.created) options.onManualRunCreated(result.enrollmentId)
    const run = await loadManualRun(db, organizationId, request.params.id!, result.runId)
    response.status(result.created ? 201 : 200).json({ data: { created: result.created, run } })
  })

  router.get("/:id/manual-runs/:runId", async (request, response) => {
    const organizationId = request.user!.organizationId
    const access = await manualRunAccess(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const run = await loadManualRun(db, organizationId, request.params.id!, request.params.runId!)
    if (!run) return response.status(404).json({ error: { code: "WORKFLOW_MANUAL_RUN_NOT_FOUND", message: "Execução manual não encontrada." } })
    response.json({ data: run })
  })
}
