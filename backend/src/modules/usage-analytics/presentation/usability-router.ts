import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { recordServerUsageEvent } from "../application/record-server-event.js"
import { classifyPerson, reprocessProjections, unclassifyPerson, updateUsageSettings } from "../application/usage-settings-service.js"
import { contextQuery, peopleOptionsQuery } from "../application/query/context-query.js"
import { conversationsQuery } from "../application/query/conversations-query.js"
import { feedbacksQuery } from "../application/query/feedbacks-query.js"
import { journeysQuery } from "../application/query/journeys-query.js"
import { overviewQuery } from "../application/query/overview-query.js"
import { peopleQuery } from "../application/query/people-query.js"
import { personDetailQuery, personTimelineQuery } from "../application/query/person-query.js"
import { qualityQuery } from "../application/query/quality-query.js"
import { retentionQuery } from "../application/query/retention-query.js"
import { screensQuery } from "../application/query/screens-query.js"
import { assertAggregateCohort, buildUsabilityContext, type UsabilityContext } from "../application/query/usability-context.js"
import type { UsabilityTab } from "../application/query/usability-filters.js"
import { buildUsabilityExport, EXPORT_TABLES, type ExportTab } from "../application/query/usability-export.js"
import { workflowsQuery } from "../application/query/workflows-query.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Monitoria de usabilidade — `/api/v1/admin/usability`. Montado atrás de `usability.view` (qualquer escopo); cada rota aplica a
 * permissão granular dela e o ESCOPO do observador antes de qualquer total, lista, opção ou exportação:
 *   - agregados: `usability.view`;
 *   - pessoas identificadas, detalhe e timeline (auditados): `usability.users.view`;
 *   - exportação: `usability.export` (o recorte que a conta já pode ver);
 *   - comentários de avaliações: `usability.comments.view`;
 *   - configuração (coleta, retenção, fuso, classificação, reprocessamento): `usability.manage` na organização inteira.
 * Ler conteúdo de conversa continua exigindo `assistant_conversations.view` (a monitoria só devolve o link, quando permitido).
 */
const idParam = z.string().uuid()

export function createUsabilityRouter(db: Database, options: { now?: () => Date } = {}) {
  const router = Router()
  const now = () => options.now?.() ?? new Date()
  const contextOf = (request: Request, tab: UsabilityTab, query: Record<string, unknown> = request.query as Record<string, unknown>) =>
    buildUsabilityContext(db, { access: request.access!, personId: sessionUser(request).personId, tab, query, now: now() })
  // Números (e a exportação deles): para quem só vê agregados, só com o recorte de 5 pessoas ou mais (achado C18 da 4ª auditoria).
  const metricsOf = async (request: Request, tab: UsabilityTab, query?: Record<string, unknown>) => {
    const ctx = await contextOf(request, tab, query)
    await assertAggregateCohort(db, ctx)
    return ctx
  }
  const manageActor = (request: Request, ctx: UsabilityContext) => {
    if (!ctx.can.manage) throw new DomainError("Configurar a monitoria exige permissão de gestão na organização inteira.", "FORBIDDEN", 403)
    return { organizationId: ctx.organizationId, personId: sessionUser(request).personId, accountId: sessionUser(request).sub }
  }

  router.get("/context", async (request, response) => response.json({ data: await contextQuery(db, await contextOf(request, "overview")) }))
  router.get("/overview", async (request, response) => response.json({ data: await overviewQuery(db, await metricsOf(request, "overview")) }))
  router.get("/users", async (request, response) => {
    const ctx = await metricsOf(request, "people")
    const [people, retention] = await Promise.all([peopleQuery(db, ctx), retentionQuery(db, ctx)])
    response.json({ data: { ...people, retention } })
  })
  router.get("/users/options", async (request, response) => {
    const search = z.string().trim().min(2).max(80).parse(request.query.search)
    const ctx = await contextOf(request, "people", {})
    response.json({ data: await peopleOptionsQuery(db, ctx, search) })
  })
  router.get("/users/:personId", async (request, response) => {
    response.json({ data: await personDetailQuery(db, await contextOf(request, "person"), idParam.parse(request.params.personId)) })
  })
  router.get("/users/:personId/timeline", async (request, response) => {
    response.json({ data: await personTimelineQuery(db, await contextOf(request, "person"), idParam.parse(request.params.personId)) })
  })
  router.get("/screens", async (request, response) => response.json({ data: await screensQuery(db, await metricsOf(request, "screens")) }))
  router.get("/feedbacks", async (request, response) => response.json({ data: await feedbacksQuery(db, await metricsOf(request, "feedbacks")) }))
  router.get("/conversations", async (request, response) => response.json({ data: await conversationsQuery(db, await metricsOf(request, "conversations")) }))
  router.get("/workflows", async (request, response) => response.json({ data: await workflowsQuery(db, await metricsOf(request, "workflows")) }))
  router.get("/journeys", async (request, response) => response.json({ data: await journeysQuery(db, await metricsOf(request, "journeys")) }))
  router.get("/data-quality", async (request, response) => response.json({ data: await qualityQuery(db, await contextOf(request, "quality")) }))

  router.get("/export.csv", async (request, response) => {
    const { tab, table, ...query } = request.query as Record<string, unknown>
    const exportTab = z.enum(Object.keys(EXPORT_TABLES) as [ExportTab, ...ExportTab[]]).parse(tab)
    const ctx = exportTab === "quality" ? await contextOf(request, "quality", query) : await metricsOf(request, exportTab, query)
    if (!ctx.can.export) throw new DomainError("Você não tem permissão para exportar.", "USABILITY_EXPORT_FORBIDDEN", 403)
    try {
      const result = await buildUsabilityExport(db, ctx, exportTab, z.string().max(40).parse(table))
      await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'USABILITY_EXPORT', 'USABILITY', $1, $3)`, [
        ctx.organizationId,
        sessionUser(request).personId,
        JSON.stringify({ tab: exportTab, table, rows: result.rows, period: { from: ctx.period.fromDate, to: ctx.period.toDate }, filters: query }),
      ])
      await recordServerUsageEvent(db, { organizationId: ctx.organizationId, name: "usability.export", accountId: sessionUser(request).sub, actorPersonId: sessionUser(request).personId, properties: { stage: "COMPLETED", tab: `${exportTab}:${String(table)}`, rows: result.rows } })
      response.setHeader("content-type", "text/csv; charset=utf-8")
      response.setHeader("content-disposition", `attachment; filename="${result.filename}"`)
      response.setHeader("cache-control", "no-store")
      response.send(result.csv)
    } catch (error) {
      await recordServerUsageEvent(db, { organizationId: ctx.organizationId, name: "usability.export", accountId: sessionUser(request).sub, actorPersonId: sessionUser(request).personId, properties: { stage: "FAILED", tab: `${exportTab}:${String(table).slice(0, 20)}`, rows: null } })
      throw error
    }
  })

  router.put("/settings", async (request, response) => {
    const ctx = await contextOf(request, "quality", {})
    response.json({ data: await updateUsageSettings(db, manageActor(request, ctx), request.body, now()) })
  })
  router.post("/classifications", async (request, response) => {
    const ctx = await contextOf(request, "quality", {})
    await classifyPerson(db, manageActor(request, ctx), request.body, now())
    response.status(204).send()
  })
  router.delete("/classifications/:personId", async (request, response) => {
    const ctx = await contextOf(request, "quality", {})
    const reason = z.object({ reason: z.string().trim().min(3).max(300) }).parse(request.body ?? {}).reason
    await unclassifyPerson(db, manageActor(request, ctx), idParam.parse(request.params.personId), reason, now())
    response.status(204).send()
  })
  router.post("/reprocess", async (request, response) => {
    const ctx = await contextOf(request, "quality", {})
    response.json({ data: await reprocessProjections(db, manageActor(request, ctx), request.body, now()) })
  })
  return router
}
