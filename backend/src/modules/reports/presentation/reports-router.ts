import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { gatewayAnalysisWriter } from "../application/report-analysis.js"
import { listReceivedDeliveries, loadDeliveryDetail, markDeliveryRead } from "../application/report-deliveries-reader.js"
import { createPostgresProposalStore } from "../application/report-proposals.js"
import { createPostgresReportRuntime } from "../application/report-runtime.js"
import { createReport, deleteReport, getReportDetail, listReports, loadReportAccess, openProposal, previewReport, reportOptions, retryDeliveryAnalysis, runReportNow, searchAudiencePeople, setReportStatus, updateReport, type ReportActor, type ReportServiceDeps } from "../application/report-service.js"
import { createPostgresReportStore } from "../application/report-store.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * `/api/v1/reports` — reports recorrentes. Dono e organização SEMPRE da sessão; permissões revalidadas a cada pedido no serviço
 * (líder: só para si; papel Report: público no escopo da atribuição). Entregas: só quem recebeu.
 */
const idParam = z.string().uuid()
const createSchema = z.object({ config: z.unknown(), activate: z.boolean().default(false), proposalId: z.string().uuid().nullish() })
const updateSchema = z.object({ revision: z.number().int().min(0), config: z.unknown() })
const statusSchema = z.object({ revision: z.number().int().min(0), status: z.enum(["ACTIVE", "INACTIVE"]) })
const previewSchema = z.object({ definition: z.unknown(), visualization: z.unknown().optional() })

export function createReportsRouter(db: Database, overrides: Partial<ReportServiceDeps> = {}) {
  const router = Router()
  const deps: ReportServiceDeps = {
    store: overrides.store ?? createPostgresReportStore(db),
    runtime: overrides.runtime ?? createPostgresReportRuntime(db),
    proposals: overrides.proposals ?? createPostgresProposalStore(db),
    analysisWriter: overrides.analysisWriter ?? gatewayAnalysisWriter,
    now: overrides.now ?? (() => new Date()),
  }
  const actorOf = (request: Request): ReportActor => ({ organizationId: sessionUser(request).organizationId, accountId: sessionUser(request).sub, personId: sessionUser(request).personId })

  router.get("/", async (request, response) => response.json({ data: await listReports(deps, actorOf(request)) }))
  router.get("/access", async (request, response) => {
    const access = await loadReportAccess(deps, actorOf(request))
    response.json({ data: { canUse: access.canUse, canCreateForSelf: access.canCreateForSelf, canDistribute: access.canDistribute, timeZone: access.timeZone } })
  })
  router.get("/options", async (request, response) => response.json({ data: await reportOptions(deps, actorOf(request)) }))
  router.get("/audience/people", async (request, response) => response.json({ data: await searchAudiencePeople(deps, actorOf(request), String(request.query.q ?? "")) }))
  router.post("/preview", async (request, response) => response.json({ data: await previewReport(deps, actorOf(request), previewSchema.parse(request.body ?? {})) }))
  router.get("/proposals/:proposalId", async (request, response) => response.json({ data: await openProposal(deps, actorOf(request), idParam.parse(request.params.proposalId)) }))
  router.get("/received", async (request, response) => {
    const actor = actorOf(request)
    const reportId = typeof request.query.reportId === "string" ? idParam.parse(request.query.reportId) : null
    response.json({ data: await listReceivedDeliveries(db, { organizationId: actor.organizationId, personId: actor.personId, reportId, limit: Number(request.query.limit ?? 50) || 50 }) })
  })
  router.get("/deliveries/:deliveryId", async (request, response) => {
    const actor = actorOf(request)
    response.json({ data: await loadDeliveryDetail(db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, deliveryId: idParam.parse(request.params.deliveryId) }) })
  })
  router.post("/deliveries/:deliveryId/read", async (request, response) => {
    const actor = actorOf(request)
    await markDeliveryRead(db, { organizationId: actor.organizationId, personId: actor.personId, deliveryId: idParam.parse(request.params.deliveryId) })
    response.status(204).end()
  })
  router.post("/deliveries/:deliveryId/analysis/retry", async (request, response) => response.json({ data: await retryDeliveryAnalysis(deps, actorOf(request), idParam.parse(request.params.deliveryId)) }))
  router.post("/", async (request, response) => response.status(201).json({ data: await createReport(deps, actorOf(request), createSchema.parse(request.body ?? {})) }))
  router.get("/:reportId", async (request, response) => response.json({ data: await getReportDetail(deps, actorOf(request), idParam.parse(request.params.reportId)) }))
  router.put("/:reportId", async (request, response) => response.json({ data: await updateReport(deps, actorOf(request), idParam.parse(request.params.reportId), updateSchema.parse(request.body ?? {})) }))
  router.post("/:reportId/status", async (request, response) => response.json({ data: await setReportStatus(deps, actorOf(request), idParam.parse(request.params.reportId), statusSchema.parse(request.body ?? {})) }))
  router.post("/:reportId/run", async (request, response) => response.status(202).json({ data: await runReportNow(deps, actorOf(request), idParam.parse(request.params.reportId)) }))
  router.delete("/:reportId", async (request, response) => {
    await deleteReport(deps, actorOf(request), idParam.parse(request.params.reportId))
    response.status(204).end()
  })
  return router
}
