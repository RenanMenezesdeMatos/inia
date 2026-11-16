import { Router, type Request } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { supportAbandonment } from "../application/abandonment-service.js"
import { supportDemand } from "../application/demand-service.js"
import { operationHistory } from "../application/operation-history.js"
import { anjosNow, queueWaiting, listRequests, listUnavailableAttempts, presenceTimeline, requestDetail } from "../application/coordination-service.js"
import { supportFunnel } from "../application/metrics-service.js"
import type { Viewer } from "../application/request-service.js"
import { transferAttendance, transferCandidates } from "../application/transfer-service.js"
import { anjosNowQuerySchema, attemptsQuerySchema, demandQuerySchema, historyQuerySchema, idParamSchema, panelListQuerySchema, panelQuerySchema, timelineQuerySchema, transferSchema } from "./schemas.js"

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
  // Transferência pela coordenação (migration 190): os Anjos do Grupo/Subgrupo do pedido, com quem pode receber agora, e o comando.
  router.get("/requests/:id/transfer-candidates", async (request, response) => {
    response.json({ data: await transferCandidates(db, viewerOf(request), idParamSchema.parse(request.params.id)) })
  })
  router.post("/requests/:id/transfer", async (request, response) => {
    const body = transferSchema.parse(request.body)
    const target = body.toAnjoPersonId ? { kind: "ANJO" as const, anjoPersonId: body.toAnjoPersonId } : { kind: "QUEUE" as const }
    response.json({ data: await transferAttendance(db, viewerOf(request), idParamSchema.parse(request.params.id), { target, reason: body.reason }) })
  })
  router.get("/unavailable-attempts", async (request, response) => {
    response.json({ data: await listUnavailableAttempts(db, viewerOf(request), attemptsQuerySchema.parse(request.query)) })
  })
  // Situação AGORA (não depende do período do painel).
  router.get("/anjos/now", async (request, response) => {
    response.json({ data: await anjosNow(db, viewerOf(request), anjosNowQuerySchema.parse(request.query)) })
  })
  // Abandonos na espera e no atendimento: o dia de hoje na Monitoria Online, o período em Indicadores.
  router.get("/abandonment", async (request, response) => {
    response.json({ data: await supportAbandonment(db, viewerOf(request), panelQuerySchema.parse(request.query)) })
  })
  // Acionamentos do período (aba Indicadores): curva por hora, espera, quem mais aciona, produtivos e fila.
  router.get("/demand", async (request, response) => {
    response.json({ data: await supportDemand(db, viewerOf(request), demandQuerySchema.parse(request.query)) })
  })
  // Histórico da operação (migration 191): jornada e indicadores por Anjo, consolidado e números da operação.
  router.get("/history", async (request, response) => {
    response.json({ data: await operationHistory(db, viewerOf(request), historyQuerySchema.parse(request.query), "COORDINATION") })
  })
  // Quem está na fila agora e há quanto tempo (clicar no indicador de fila da "Operação agora").
  router.get("/queue", async (request, response) => {
    response.json({ data: { items: await queueWaiting(db, viewerOf(request), anjosNowQuerySchema.parse(request.query)) } })
  })
  router.get("/anjos/:personId/presence", async (request, response) => {
    response.json({ data: await presenceTimeline(db, viewerOf(request), idParamSchema.parse(request.params.personId), timelineQuerySchema.parse(request.query)) })
  })
  return router
}
