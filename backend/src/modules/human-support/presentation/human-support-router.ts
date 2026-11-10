import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { classificationInputSchema } from "../domain/classification.js"
import { evaluationInputSchema } from "../domain/evaluation.js"
import { classifyAttendance } from "../application/classification-service.js"
import { evaluateAttendance } from "../application/evaluation-service.js"
import { anjoAttendanceHistory, myRequests } from "../application/history-service.js"
import { acknowledgeMessages, signalTyping } from "../application/conversation-marks.js"
import { listMessages, sendMessage } from "../application/message-service.js"
import { cancelRequest, closeRequest, createRequest, previewRequest, type Viewer } from "../application/request-service.js"
import { operatorRequestView } from "../application/request-views.js"
import { changePresence, isAnjo, loadAnjoView, loadState } from "../application/state-service.js"
import type { WaiterRegistry } from "../application/waiters.js"
import { closeSchema, createRequestSchema, idParamSchema, listQuerySchema, messagesQuerySchema, presenceSchema, receiptsSchema, sendMessageSchema, sourceSchema, stateQuerySchema, typingSchema } from "./schemas.js"

/**
 * ROTAS DO OPERADOR E DO ANJO (`/api/v1/human-support`, montadas com `requireAuth`; design_draft.md seção 16). Dono e organização
 * sempre da sessão. A chamada de estado é GET e não renova a sessão (só o `lease_until` do Anjo e a presença do operador no pedido).
 * As rotas do Anjo exigem `human_support.attend` (o papel), conferido aqui pela atribuição — nunca pelo cargo.
 */
export type HumanSupportRouterDeps = {
  /** Registro das chamadas longas deste processo (ausente = a chamada de estado responde na hora, sem esperar). */
  waiters?: WaiterRegistry | null
  /** Limites por conta (pedido: prévia e criação; mensagens; presença). Ausente = sem limite (testes). */
  requestsLimiter?: RequestHandler
  messagesLimiter?: RequestHandler
  presenceLimiter?: RequestHandler
  /** "Digitando" e recibos de entregue/lido (a tela manda vários por minuto enquanto a conversa anda). */
  marksLimiter?: RequestHandler
}

const pass: RequestHandler = (_request, _response, next) => next()
const viewerOf = (request: Request): Viewer => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })

export function createHumanSupportRouter(db: Database, deps: HumanSupportRouterDeps = {}) {
  const router = Router()
  const requestsLimiter = deps.requestsLimiter ?? pass
  const messagesLimiter = deps.messagesLimiter ?? pass
  const presenceLimiter = deps.presenceLimiter ?? pass
  const marksLimiter = deps.marksLimiter ?? pass
  const requireAttend: RequestHandler = (request: Request, response: Response, next: NextFunction) => {
    isAnjo(db, viewerOf(request)).then(
      (allowed) => (allowed ? next() : response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para este recurso." } })),
      next,
    )
  }

  router.get("/me/state", async (request, response) => {
    const query = stateQuerySchema.parse(request.query)
    const viewer = viewerOf(request)
    const anjo = query.workspace === "anjo" && (await isAnjo(db, viewer))
    const options = { workspace: anjo ? ("anjo" as const) : ("none" as const), anjo }
    const waiters = deps.waiters ?? null
    // No dreno do processo (desligamento): responde na hora e o navegador reconecta em outra instância.
    if (waiters?.draining) return void response.json({ data: { ...(await loadState(db, viewer, options)), reconnect: true } })
    let state = await loadState(db, viewer, options)
    if (waiters && query.wait > 0 && query.since !== undefined && query.since === state.version) {
      const controller = new AbortController()
      response.on("close", () => {
        if (!response.writableFinished) controller.abort()
      })
      const outcome = await waiters.wait({ organizationId: viewer.organizationId, personId: viewer.personId, since: state.version, timeoutMs: query.wait * 1000, signal: controller.signal })
      if (outcome === "CANCELLED") return
      state = await loadState(db, viewer, options)
      if (outcome === "DRAINING") return void response.json({ data: { ...state, reconnect: true } })
    }
    response.json({ data: state })
  })

  router.post("/requests/preview", requestsLimiter, async (request, response) => {
    response.json({ data: await previewRequest(db, viewerOf(request), sourceSchema.parse(request.body ?? {})) })
  })

  router.post("/requests", requestsLimiter, async (request, response) => {
    const result = await createRequest(db, viewerOf(request), createRequestSchema.parse(request.body))
    response.status(result.created ? 201 : 200).json({ data: { request: result.request } })
  })

  router.post("/requests/:id/cancel", async (request, response) => {
    response.json({ data: { request: await cancelRequest(db, viewerOf(request), idParamSchema.parse(request.params.id)) } })
  })

  router.post("/requests/:id/close", async (request, response) => {
    const viewer = viewerOf(request)
    const body = closeSchema.parse(request.body ?? {})
    const result = await closeRequest(db, viewer, idParamSchema.parse(request.params.id), { cause: body.cause, viewerIsAnjo: await isAnjo(db, viewer) })
    // O operador recebe a visão dele; o Anjo, a visão atualizada da área dele.
    if (result.actor === "OPERATOR") return void response.json({ data: { request: await operatorRequestView(db, result.request) } })
    response.json({ data: { anjo: await loadAnjoView(db, viewer) } })
  })

  router.get("/requests/:id/messages", async (request, response) => {
    const viewer = viewerOf(request)
    const query = messagesQuerySchema.parse(request.query)
    response.json({ data: await listMessages(db, viewer, idParamSchema.parse(request.params.id), { ...query, viewerIsAnjo: await isAnjo(db, viewer) }) })
  })

  router.post("/requests/:id/messages", messagesLimiter, async (request, response) => {
    const viewer = viewerOf(request)
    const body = sendMessageSchema.parse(request.body)
    const result = await sendMessage(db, viewer, idParamSchema.parse(request.params.id), { ...body, viewerIsAnjo: await isAnjo(db, viewer) })
    response.status(result.created ? 201 : 200).json({ data: { message: result.message } })
  })

  router.post("/requests/:id/typing", marksLimiter, async (request, response) => {
    const viewer = viewerOf(request)
    const body = typingSchema.parse(request.body)
    await signalTyping(db, viewer, idParamSchema.parse(request.params.id), { typing: body.typing, viewerIsAnjo: await isAnjo(db, viewer) })
    response.status(204).end()
  })

  router.post("/requests/:id/receipts", marksLimiter, async (request, response) => {
    const viewer = viewerOf(request)
    const body = receiptsSchema.parse(request.body)
    response.json({ data: { receipts: await acknowledgeMessages(db, viewer, idParamSchema.parse(request.params.id), { ...body, viewerIsAnjo: await isAnjo(db, viewer) }) } })
  })

  router.put("/attendances/:id/evaluation", async (request, response) => {
    response.json({ data: { current: await evaluateAttendance(db, viewerOf(request), idParamSchema.parse(request.params.id), evaluationInputSchema.parse(request.body)) } })
  })

  router.get("/me/requests", async (request, response) => {
    response.json({ data: await myRequests(db, viewerOf(request), listQuerySchema.parse(request.query)) })
  })

  router.put("/anjo/presence", requireAttend, presenceLimiter, async (request, response) => {
    response.json({ data: { anjo: await changePresence(db, viewerOf(request), presenceSchema.parse(request.body)) } })
  })

  router.get("/anjo/attendances", requireAttend, async (request, response) => {
    response.json({ data: await anjoAttendanceHistory(db, viewerOf(request), listQuerySchema.parse(request.query)) })
  })

  router.post("/attendances/:id/classification", requireAttend, async (request, response) => {
    const classification = await classifyAttendance(db, viewerOf(request), idParamSchema.parse(request.params.id), classificationInputSchema.parse(request.body))
    response.status(201).json({ data: { classification } })
  })

  return router
}
