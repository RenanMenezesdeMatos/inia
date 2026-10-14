import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { CONTINUITY_DECISIONS } from "../domain/intervention-state.js"
import { loadAccess, canSeeInterventionsOf } from "../application/intervention-access.js"
import * as interventions from "../application/intervention-service.js"
import { generateReportNarrative, type NarrativeWriter } from "../application/report-narrative.js"
import { applyAiDraft, draftInterventionWithAi } from "../application/ai-draft.js"

/**
 * Experiência do líder — `/api/v1/interventions` (sessão obrigatória; organização e viewer sempre da sessão). Cada rota confere
 * a relação do viewer com a intervenção (responsável, aprovador, cadeia de gestão ou permissão com escopo); fora dela = 404.
 */
const revision = z.object({ expectedRevision: z.number().int().optional() })

export function createInterventionRouter(db: Database, deps: { writer?: NarrativeWriter } = {}) {
  const router = Router()
  const viewerOf = async (request: Request): Promise<interventions.Viewer> => ({ organizationId: request.user!.organizationId, personId: request.user!.personId, access: await loadAccess(db, request.user!.organizationId, request.user!.sub) })
  const id = (request: Request) => String(request.params.interventionId)

  router.get("/pending", async (request, response) => response.json({ data: await interventions.listPendingInterventions(db, await viewerOf(request)) }))
  // Catálogo de competências para o treinamento (configuração da organização — nenhum dado de colaborador).
  router.get("/competencies", async (request, response) => response.json({ data: await interventions.listTrainingCompetencies(db, request.user!.organizationId) }))
  router.get("/cases/:caseId", async (request, response) => response.json({ data: await interventions.listCaseInterventions(db, await viewerOf(request), String(request.params.caseId)) }))
  router.get("/people/:personId", async (request, response) => response.json({ data: await interventions.listPersonInterventions(db, await viewerOf(request), String(request.params.personId)) }))
  router.post("/", async (request, response) => response.status(201).json({ data: await interventions.openManualIntervention(db, await viewerOf(request), request.body) }))

  router.get("/reports/:reportId", async (request, response) => {
    const viewer = await viewerOf(request)
    const report = await interventions.loadReport(db, viewer.organizationId, String(request.params.reportId))
    if (!report || !(await canSeeInterventionsOf(db, viewer.access, report.structured.subject.personId))) throw new DomainError("Relatório não encontrado.", "INTERVENTION_REPORT_NOT_FOUND", 404)
    response.json({ data: report })
  })
  /** Nova tentativa da narrativa — nunca reabre nem duplica intervenções (o relatório estruturado já existe). */
  router.post("/reports/:reportId/narrative", async (request, response) => {
    const viewer = await viewerOf(request)
    const report = await interventions.loadReport(db, viewer.organizationId, String(request.params.reportId))
    if (!report || !(await canSeeInterventionsOf(db, viewer.access, report.structured.subject.personId))) throw new DomainError("Relatório não encontrado.", "INTERVENTION_REPORT_NOT_FOUND", 404)
    await generateReportNarrative(db, { organizationId: viewer.organizationId, reportId: report.id, requestedBy: viewer.personId }, deps.writer)
    response.json({ data: await interventions.loadReport(db, viewer.organizationId, report.id) })
  })

  router.get("/:interventionId", async (request, response) => response.json({ data: await interventions.getInterventionDetail(db, await viewerOf(request), id(request)) }))
  router.get("/:interventionId/forward-targets", async (request, response) => {
    const viewer = await viewerOf(request)
    const detail = await interventions.getInterventionDetail(db, viewer, id(request))
    const chain = await db.query<{ id: string; name: string; role: string }>(
      `with recursive up as (select p.reports_to_id id, 1 depth from people p where p.id = $1 union all select x.reports_to_id, up.depth + 1 from people x join up on x.id = up.id where x.reports_to_id is not null and up.depth < 12)
       select p.id, p.name, p.role from up join people p on p.id = up.id where p.active and p.organization_id = $2 order by up.depth`,
      [detail.person.id, viewer.organizationId],
    )
    response.json({ data: chain.rows.filter((person) => person.id !== detail.responsible.id) })
  })
  router.post("/:interventionId/accept", async (request, response) => {
    const body = revision.extend({ justification: z.string().trim().max(3000).optional() }).parse(request.body ?? {})
    response.json({ data: await interventions.acceptIntervention(db, await viewerOf(request), id(request), body) })
  })
  router.post("/:interventionId/approve", async (request, response) => {
    const body = revision.extend({ note: z.string().trim().max(2000).optional() }).parse(request.body ?? {})
    response.json({ data: await interventions.approveIntervention(db, await viewerOf(request), id(request), body) })
  })
  router.post("/:interventionId/return", async (request, response) => {
    const body = revision.extend({ reason: z.string() }).parse(request.body ?? {})
    response.json({ data: await interventions.returnIntervention(db, await viewerOf(request), id(request), body) })
  })
  router.post("/:interventionId/decide", async (request, response) => {
    const body = revision.extend({ decision: z.enum(CONTINUITY_DECISIONS), justification: z.string() }).parse(request.body ?? {})
    response.json({ data: await interventions.decideContinuity(db, await viewerOf(request), id(request), body) })
  })
  router.post("/:interventionId/complete", async (request, response) => response.json({ data: await interventions.completeIntervention(db, await viewerOf(request), id(request), request.body ?? {}) }))
  router.post("/:interventionId/cancel", async (request, response) => {
    const body = revision.extend({ reason: z.string() }).parse(request.body ?? {})
    response.json({ data: await interventions.cancelIntervention(db, await viewerOf(request), id(request), body) })
  })
  router.post("/:interventionId/forward", async (request, response) => {
    const body = revision.extend({ toPersonId: z.string(), reason: z.string() }).parse(request.body ?? {})
    response.json({ data: await interventions.forwardIntervention(db, await viewerOf(request), id(request), body) })
  })
  router.put("/:interventionId/plan", async (request, response) => response.json({ data: await interventions.updateInterventionPlan(db, await viewerOf(request), id(request), request.body) }))
  router.post("/:interventionId/competency", async (request, response) => response.json({ data: await interventions.applyTrainingCompetency(db, await viewerOf(request), id(request), request.body) }))
  router.post("/:interventionId/items", async (request, response) => response.json({ data: await interventions.addInterventionItem(db, await viewerOf(request), id(request), request.body) }))
  router.patch("/:interventionId/items/:itemId", async (request, response) => response.json({ data: await interventions.updateInterventionItem(db, await viewerOf(request), id(request), String(request.params.itemId), request.body) }))
  router.post("/:interventionId/evidence", async (request, response) => response.json({ data: await interventions.addInterventionEvidence(db, await viewerOf(request), id(request), request.body) }))
  /** Rascunho de treinamento/plano pela IA — só com diagnóstico sustentado; vai para `ai_draft` até o responsável aplicar. */
  router.post("/:interventionId/ai-draft", async (request, response) => response.json({ data: await draftInterventionWithAi(db, await viewerOf(request), id(request), deps.writer) }))
  router.post("/:interventionId/ai-draft/apply", async (request, response) => {
    const body = revision.parse(request.body ?? {})
    response.json({ data: await applyAiDraft(db, await viewerOf(request), id(request), body.expectedRevision) })
  })

  return router
}
