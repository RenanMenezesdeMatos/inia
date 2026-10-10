import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { SUPERVISOR_PROVISIONABLE_CODES } from "../domain/schedule-exception.js"
import { JUSTIFIED_ABSENCE_REASONS, WORKDAY_CLASSIFICATIONS } from "../domain/workday-classification.js"
import { booleanParam, listParam, paginationQuerySchema, searchParam } from "../../../shared/presentation/list-query.js"
import { buildTeamCalendar, CALENDAR_ATTENTION_KINDS, cancelForTeam, classificationHistoryForTeam, classifyForTeam, DEFAULT_CALENDAR_PAGE_SIZE, exceptionAuditForTeam, provisionForTeam } from "../application/team-calendar.js"

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Filtros e paginação no mesmo formato das listagens administrativas (`?jobTitle=a&jobTitle=b`, `page`, `pageSize`).
const querySchema = paginationQuerySchema.extend({
  from: DATE,
  to: DATE,
  anchorId: z.string().uuid().optional(),
  search: searchParam,
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  jobTitle: listParam(z.string().max(200)),
  scheduleType: listParam(z.string().max(40)),
  attention: listParam(z.enum(CALENDAR_ATTENTION_KINDS)),
  scheduledToday: booleanParam,
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_CALENDAR_PAGE_SIZE),
})
const provisionSchema = z.object({ personId: z.string().uuid(), code: z.enum(SUPERVISOR_PROVISIONABLE_CODES), from: DATE, to: DATE })
const idSchema = z.object({ exceptionId: z.string().uuid() })
const classifySchema = z.object({ personId: z.string().uuid(), date: DATE, classification: z.enum(WORKDAY_CLASSIFICATIONS), reasonCode: z.enum(JUSTIFIED_ABSENCE_REASONS).nullable().optional() })
const historyParamsSchema = z.object({ personId: z.string().uuid(), date: DATE })

/**
 * `/api/v1/team-calendar` — Calendário da equipe (Supervisor+): GET (estado resolvido por colaborador ×
 * dia), POST /exceptions (provisionar day off/banco/atestado/folga extraordinária para um dia ou
 * período), DELETE /exceptions/:id (cancelar sem apagar), GET /exceptions/:id/audit (trilha),
 * POST /classifications (classificar/rever um dia DEPOIS do fato: falta injustificada, ausência justificada,
 * trabalhou — dados não chegaram) e GET /classifications/:personId/:date (histórico de revisões).
 * Autorização pelo escopo real (viewer-scope.ts); o backend é a autoridade.
 */
export function createTeamCalendarRouter(db: Database, analytics: AnalyticsReadRepository = new PgAnalyticsReadRepository(db), now: () => Date = () => new Date()) {
  const router = Router()

  router.get("/", async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query)
      response.json({
        data: await buildTeamCalendar(db, analytics, request.user!, {
          anchorId: query.anchorId ?? null,
          from: query.from,
          to: query.to,
          now: now(),
          filters: { search: query.search, teamId: query.teamId, subteamId: query.subteamId, jobTitles: query.jobTitle, scheduleTypes: query.scheduleType, attention: query.attention, scheduledToday: query.scheduledToday },
          page: query.page,
          pageSize: query.pageSize,
        }),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/exceptions", async (request, response, next) => {
    try {
      const body = provisionSchema.parse(request.body)
      response.status(201).json({ data: await provisionForTeam(db, analytics, request.user!, body) })
    } catch (error) {
      next(error)
    }
  })

  router.delete("/exceptions/:exceptionId", async (request, response, next) => {
    try {
      const { exceptionId } = idSchema.parse(request.params)
      response.json({ data: await cancelForTeam(db, analytics, request.user!, exceptionId) })
    } catch (error) {
      next(error)
    }
  })

  router.post("/classifications", async (request, response, next) => {
    try {
      const body = classifySchema.parse(request.body)
      response.status(201).json({ data: await classifyForTeam(db, analytics, request.user!, body) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/classifications/:personId/:date", async (request, response, next) => {
    try {
      const params = historyParamsSchema.parse(request.params)
      response.json({ data: await classificationHistoryForTeam(db, analytics, request.user!, params) })
    } catch (error) {
      next(error)
    }
  })

  router.get("/exceptions/:exceptionId/audit", async (request, response, next) => {
    try {
      const { exceptionId } = idSchema.parse(request.params)
      response.json({ data: await exceptionAuditForTeam(db, analytics, request.user!, exceptionId) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
