import { Router, type NextFunction, type Request, type Response } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { complianceSummary } from "../application/compliance-reader.js"
import { canSeeAnySection, canSeeSection, successContext, type SuccessSection } from "../application/context-reader.js"
import { feedbackSummary } from "../application/feedback-reader.js"
import { repliesSummary } from "../application/replies-reader.js"
import { responseTimeSummary } from "../application/response-time-reader.js"
import { routesSummary } from "../application/routes-reader.js"
import { assertSuccessPeriod, type SuccessQuery, type SuccessViewer } from "../application/success-query.js"
import { supportSummary } from "../application/support-reader.js"
import { periodBuckets, periodDays } from "../domain/success-metrics.js"

/**
 * INDICADORES DE SUCESSO DA INIA — `/api/v1/admin/inia-success` (somente leitura, agregados calculados no banco). Montado com
 * `requireAuth` ANTES do `/api/v1/admin` da governança; aqui dentro, a conta precisa de ao menos uma das permissões dos blocos e cada
 * rota confere a do seu bloco (403 sem ela). O alcance concreto de cada bloco é o da tela de origem dos dados.
 *
 *   GET /context                 blocos visíveis + opções de Grupo/Subgrupo do alcance
 *   GET /response-time | /routes | /replies | /support | /feedback | /compliance   (?from&to[&teamId][&subteamId])
 */
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data no formato AAAA-MM-DD.")
const querySchema = z
  .object({ from: localDate, to: localDate, teamId: z.string().uuid().optional(), subteamId: z.string().uuid().optional() })
  .strict()

type AccessRequest = Request & { successAccess?: AccessContext }
const forbidden = () => new DomainError("Você não tem permissão para este recurso.", "FORBIDDEN", 403)
const viewerOf = (request: Request): SuccessViewer => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId! })

export function createIniaSuccessRouter(db: Database) {
  const router = Router()
  const repository = createPostgresAccessRepository(db)
  router.use(async (request: AccessRequest, _response: Response, next: NextFunction) => {
    try {
      const user = sessionUser(request)
      if (!user.personId) return next(forbidden())
      request.successAccess = await repository.loadContext(user.organizationId, user.sub)
      return canSeeAnySection(request.successAccess) ? next() : next(forbidden())
    } catch (error) {
      return next(error)
    }
  })

  router.get("/context", async (request: AccessRequest, response) => {
    response.json({ data: await successContext(db, viewerOf(request), request.successAccess!) })
  })

  const section = <T>(name: SuccessSection, read: (db: Database, viewer: SuccessViewer, query: SuccessQuery) => Promise<T>) => {
    router.get(`/${name === "responseTime" ? "response-time" : name}`, async (request: AccessRequest, response, next) => {
      try {
        if (!canSeeSection(request.successAccess!, name)) return next(forbidden())
        const query = querySchema.parse(request.query)
        assertSuccessPeriod(query)
        const { granularity, buckets } = periodBuckets(query.from, query.to)
        response.json({ data: { period: { from: query.from, to: query.to, days: periodDays(query.from, query.to), granularity, buckets }, ...(await read(db, viewerOf(request), query)) } })
      } catch (error) {
        next(error)
      }
    })
  }
  section("responseTime", responseTimeSummary)
  section("routes", routesSummary)
  section("replies", repliesSummary)
  section("support", supportSummary)
  section("feedback", feedbackSummary)
  section("compliance", complianceSummary)
  return router
}
