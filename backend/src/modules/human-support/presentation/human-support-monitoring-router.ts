import { Router, type Request } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { anjosActivity, anjosNow, listRequests, listUnavailableAttempts, presenceTimeline, requestDetail } from "../application/coordination-service.js"
import { supportFunnel } from "../application/metrics-service.js"
import type { Viewer } from "../application/request-service.js"
import { anjosNowQuerySchema, attemptsQuerySchema, idParamSchema, panelListQuerySchema, panelQuerySchema, timelineQuerySchema } from "./schemas.js"

/**
 * PAINEL DO APOIO (`/api/v1/admin/human-support-monitoring`, montado com `human_support.coordinate` — Coordenador de Anjos e
 * Administrador geral; D7). O recorte concreto de cada registro é decidido no serviço, pelo escopo da atribuição de quem lê.
 */
const viewerOf = (request: Request): Viewer => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })

export function createHumanSupportMonitoringRouter(db: Database) {
  const router = Router()
  router.get("/metrics", async (request, response) => {
    response.json({ data: await supportFunnel(db, viewerOf(request), panelQuerySchema.parse(request.query)) })
  })
  router.get("/requests", async (request, response) => {
    response.json({ data: await listRequests(db, viewerOf(request), panelListQuerySchema.parse(request.query)) })
  })
  router.get("/requests/:id", async (request, response) => {
    response.json({ data: await requestDetail(db, viewerOf(request), idParamSchema.parse(request.params.id)) })
  })
  router.get("/unavailable-attempts", async (request, response) => {
    response.json({ data: await listUnavailableAttempts(db, viewerOf(request), attemptsQuerySchema.parse(request.query)) })
  })
  router.get("/anjos", async (request, response) => {
    response.json({ data: await anjosActivity(db, viewerOf(request), panelQuerySchema.parse(request.query)) })
  })
  // Situação AGORA (não depende do período do painel).
  router.get("/anjos/now", async (request, response) => {
    response.json({ data: await anjosNow(db, viewerOf(request), anjosNowQuerySchema.parse(request.query)) })
  })
  router.get("/anjos/:personId/presence", async (request, response) => {
    response.json({ data: await presenceTimeline(db, viewerOf(request), idParamSchema.parse(request.params.personId), timelineQuerySchema.parse(request.query)) })
  })
  return router
}
