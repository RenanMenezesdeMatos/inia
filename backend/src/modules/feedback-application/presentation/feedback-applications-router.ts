import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { SpeechCacheIdentity } from "../../../shared/application/model-routing/ai-runtime.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { FEEDBACK_SOURCE_KINDS, INVITE_EVENTS, PRESENTATION_EVENTS } from "../domain/feedback-application.js"
import {
  getApplication,
  listApplications,
  loadApplicationSpeechAudio,
  loadCurrentInvite,
  markApplicationOpened,
  pauseApplication,
  recordInviteEvent,
  recordPresentationEvent,
  startOrResumeApplication,
  type ApplicationScope,
  type SpeechSynthesizer,
} from "../application/feedback-application-service.js"

/**
 * Aplicação de feedback conversacional — `/api/v1/feedback-applications`, sempre do PRÓPRIO destinatário (a pessoa da sessão;
 * nunca um id de pessoa no corpo). Feedback/aplicação de outra pessoa ou organização = 404.
 *
 *   GET  /                          estado de cada aplicação (botões do Acompanhamento)
 *   GET  /invite                    o convite da vez (no máximo um) — nunca inicia áudio
 *   POST /invite/events             OFFER | ACCEPT | READ | SNOOZE (idempotente; decisão encerra o convite)
 *   POST /                          iniciar OU retomar a aplicação da fonte (idempotente: sempre a mesma)
 *   GET  /:id                       detalhe (roteiro, CONTEÚDO do registro aplicado, limitações, conversa complementar ativa)
 *   POST /:id/opened                aberta na tela (onde parou)
 *   POST /:id/presentation-events   STARTED | COMPLETED | INTERRUPTED | FAILED (fatos do áudio; nunca concluem)
 *   POST /:id/pause                 "Sair por agora" (continua em andamento)
 *   (concluir = confirmar ciência com login e senha, em /api/v1/feedback-read-confirmations — conclui a aplicação em andamento)
 *   GET  /:id/audio                 voz da apresentação (PCM16; 503 sem voz configurada → o navegador usa a voz do sistema)
 */
const sourceSchema = z.object({ kind: z.enum(FEEDBACK_SOURCE_KINDS), id: z.string().uuid() })
const idParam = z.string().uuid()

export function createFeedbackApplicationsRouter(db: Database, deps: { now?: () => Date; synthesizeSpeech?: { synthesize: SpeechSynthesizer; /** Voz + identidades aceitas no cache para a rota em vigor (policy da organização ou legado). */ accepted: () => Promise<SpeechCacheIdentity> } } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const scopeOf = (request: { user?: { organizationId: string; personId: string } }): ApplicationScope => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })

  router.get("/", async (request, response) => {
    response.json({ data: { items: await listApplications(db, scopeOf(request)) } })
  })

  router.get("/invite", async (request, response) => {
    response.json({ data: { invite: await loadCurrentInvite(db, scopeOf(request), now()) } })
  })

  router.post("/invite/events", async (request, response) => {
    const input = z.object({ source: sourceSchema, event: z.enum(INVITE_EVENTS) }).parse(request.body)
    response.json({ data: await recordInviteEvent(db, scopeOf(request), input.source, input.event, now()) })
  })

  router.post("/", async (request, response) => {
    const input = z.object({ source: sourceSchema }).parse(request.body)
    const result = await startOrResumeApplication(db, scopeOf(request), input.source, now())
    response.status(result.created ? 201 : 200).json({ data: result })
  })

  router.get("/:applicationId", async (request, response) => {
    response.json({ data: await getApplication(db, scopeOf(request), idParam.parse(request.params.applicationId)) })
  })

  router.post("/:applicationId/opened", async (request, response) => {
    response.json({ data: await markApplicationOpened(db, scopeOf(request), idParam.parse(request.params.applicationId), now()) })
  })

  router.post("/:applicationId/presentation-events", async (request, response) => {
    const input = z.object({ event: z.enum(PRESENTATION_EVENTS) }).parse(request.body)
    response.json({ data: await recordPresentationEvent(db, scopeOf(request), idParam.parse(request.params.applicationId), input.event, now()) })
  })

  router.post("/:applicationId/pause", async (request, response) => {
    response.json({ data: await pauseApplication(db, scopeOf(request), idParam.parse(request.params.applicationId), now()) })
  })

  router.get("/:applicationId/audio", async (request, response) => {
    const applicationId = idParam.parse(request.params.applicationId)
    if (!deps.synthesizeSpeech) throw new DomainError("Voz da INIA não está configurada.", "SPEECH_NOT_CONFIGURED", 503)
    const audio = await loadApplicationSpeechAudio(db, scopeOf(request), applicationId, deps.synthesizeSpeech.synthesize, await deps.synthesizeSpeech.accepted())
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Cache-Control", "private, max-age=3600")
    response.setHeader("X-Audio-Format", "pcm16le")
    response.setHeader("X-Sample-Rate", String(audio.sampleRate))
    response.setHeader("X-Duration-Ms", String(audio.durationMs))
    response.setHeader("Access-Control-Expose-Headers", "X-Audio-Format, X-Sample-Rate, X-Duration-Ms")
    response.send(audio.pcm16)
  })

  return router
}
