import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, paginationQuerySchema, searchParam } from "../../../shared/presentation/list-query.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../application/analytics-read-repository.js"
import { buildAnalyticsContext } from "../application/build-analytics-context.js"
import { buildEmployeeDashboard } from "../application/build-employee-dashboard.js"
import { buildFollowUpFeed } from "../application/build-follow-up-feed.js"
import { buildIndicatorMembers } from "../application/build-indicator-members.js"
import { buildStructureBreakdown, buildStructureDashboard } from "../application/build-structure-dashboard.js"
import { buildTeamMembersPage, buildTeamOverview } from "../application/build-team-overview.js"
import { loadViewerScope, resolveDefaultSubject, type ViewerScope } from "../application/viewer-scope.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ANALYTICS_SUBJECT_KINDS, buildAnalyticsSubject, isStructureSubject, type AnalyticsSubject } from "../domain/analytics-subject.js"
import { isGroupingDimension } from "../domain/hierarchy-levels.js"
import { DEFAULT_OPERATIONAL_COMPARISON, isOperationalComparison, type OperationalComparison } from "../domain/operational-comparison.js"
import { parseReferencePeriod } from "../domain/reference-period.js"
import { resolveOfficialClosure, type OfficialClosureContext } from "../../indicators/application/official-closure.js"
import { clampToClosedReferencePeriod } from "../../indicators/domain/official-closure-policy.js"
import { decodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"

const followUpQuerySchema = z.object({
  ack: z.enum(["all", "pending"]).default("all"),
  /** Cursor devolvido pela página anterior (`nextCursor`); ausente = primeira página. */
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

const subjectQuerySchema = z.object({
  subjectKind: z.enum(ANALYTICS_SUBJECT_KINDS as [string, ...string[]]).optional(),
  subjectId: z.string().uuid().optional(),
})

/** Sujeito da query (opcional) ou o padrão do viewer. `subjectKind`/`subjectId` nunca são confiados:
 * quem valida contra o escopo é `resolveSubject`, dentro de cada builder. */
function subjectFrom(request: Request, scope: ViewerScope): AnalyticsSubject {
  const query = subjectQuerySchema.parse(request.query)
  if (query.subjectKind && query.subjectId) return buildAnalyticsSubject(query.subjectKind, query.subjectId)
  const fallback = resolveDefaultSubject(scope)
  if (!fallback) throw new DomainError("Seu perfil não possui estrutura vinculada.", "NO_STRUCTURE", 404)
  return fallback.subject
}

/** Competência da query — sempre limitada ao último fechamento possível (guard central do
 * fechamento oficial, official-closure-policy.ts): sem `period` = último mês fechado; pedir o mês
 * corrente devolve o último fechado, nunca o mês corrente como se fosse fechamento. */
function periodFrom(request: Request, closure: OfficialClosureContext): string {
  const requested = request.query.period === undefined ? closure.lastClosedPeriod : parseReferencePeriod(request.query.period)
  return clampToClosedReferencePeriod(requested, closure.now, closure.timeZone)
}

/** Comparação do acompanhamento operacional (query `comparison`) — ausente = últimos 7 dias × 7 anteriores. */
function comparisonFrom(request: Request): OperationalComparison {
  const requested = request.query.comparison
  if (requested === undefined) return DEFAULT_OPERATIONAL_COMPARISON
  if (!isOperationalComparison(requested)) throw new DomainError("Comparação operacional inválida.", "INVALID_COMPARISON", 400)
  return requested
}

function requireStructure(subject: AnalyticsSubject) {
  if (!isStructureSubject(subject)) throw new DomainError("Esta visão só existe para estruturas.", "STRUCTURE_REQUIRED", 400)
  return subject
}

const sortSchema = z.object({ order: z.enum(["asc", "desc"]).default("desc") })

export function createAnalyticsRouter(db: Database, repository: AnalyticsReadRepository = new PgAnalyticsReadRepository(db), now: () => Date = () => new Date()) {
  const router = Router()

  router.get("/context", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const query = subjectQuerySchema.parse(request.query)
      const subject = query.subjectKind && query.subjectId ? buildAnalyticsSubject(query.subjectKind, query.subjectId) : null
      const closure = await resolveOfficialClosure(db, scope.organizationId, now())
      response.json({ data: await buildAnalyticsContext(repository, scope, subject, closure.lastClosedPeriod) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/indicators", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = subjectFrom(request, scope)
      const closure = await resolveOfficialClosure(db, scope.organizationId, now())
      const period = periodFrom(request, closure)
      const comparison = comparisonFrom(request)
      const data = subject.kind === "EMPLOYEE" ? await buildEmployeeDashboard(repository, scope, subject, period, closure.now, comparison) : await buildStructureDashboard(repository, scope, subject, period, closure.now, comparison)
      response.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get("/indicators/breakdown", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = requireStructure(subjectFrom(request, scope))
      const groupBy = request.query.groupBy
      if (!isGroupingDimension(groupBy)) throw new DomainError("Agrupamento inválido.", "INVALID_GROUPING", 400)
      response.json({ data: await buildStructureBreakdown(repository, scope, subject, periodFrom(request, await resolveOfficialClosure(db, scope.organizationId, now())), groupBy) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/indicators/:code/members", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = requireStructure(subjectFrom(request, scope))
      const query = paginationQuerySchema.merge(sortSchema).extend({ search: searchParam, sort: z.enum(["achievement", "name", "delta"]).default("achievement") }).parse(request.query)
      response.json({ data: await buildIndicatorMembers(repository, scope, subject, periodFrom(request, await resolveOfficialClosure(db, scope.organizationId, now())), request.params.code!, query) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/team", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = requireStructure(subjectFrom(request, scope))
      response.json({ data: await buildTeamOverview(repository, scope, subject, periodFrom(request, await resolveOfficialClosure(db, scope.organizationId, now()))) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/team/members", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = requireStructure(subjectFrom(request, scope))
      const query = paginationQuerySchema
        .merge(sortSchema)
        .extend({
          search: searchParam,
          teamId: z.string().uuid().optional(),
          subteamId: z.string().uuid().optional(),
          situation: z.enum(["NO_DATA", "BELOW_REFERENCE", "IMPROVING", "WITHIN_REFERENCE"]).optional(),
          attentionIndicatorCode: z.string().max(60).optional(),
          pendingOnly: z.preprocess((value) => value === "true", z.boolean()).optional(),
          directOnly: z.preprocess((value) => value === "true", z.boolean()).optional(),
          sort: z.enum(["name", "achievement", "prv", "delta", "situation"]).default("situation"),
          order: z.enum(["asc", "desc"]).default("asc"),
        })
        .parse(request.query)
      response.json({ data: await buildTeamMembersPage(repository, scope, subject, periodFrom(request, await resolveOfficialClosure(db, scope.organizationId, now())), query) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/follow-ups", async (request, response, next) => {
    try {
      const scope = await loadViewerScope(repository, request.user!)
      const subject = subjectFrom(request, scope)
      const query = followUpQuerySchema.parse(request.query)
      const before = decodeFollowUpCursor(query.cursor)
      if (query.cursor && !before) throw new DomainError("Cursor de paginação inválido.", "INVALID_CURSOR", 400)
      response.json({ data: await buildFollowUpFeed(repository, scope, subject, { limit: query.limit, before, unacknowledgedOnly: query.ack === "pending" }) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
