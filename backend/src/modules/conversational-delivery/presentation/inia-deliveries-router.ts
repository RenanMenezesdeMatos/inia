import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { AVATAR_DELIVERY_EVENTS, AVATAR_FAILURE_REASONS } from "../domain/avatar-delivery-lifecycle.js"
import { applyAvatarDeliveryEvent, loadRecipientInbox, markWorkflowConversationSeen, type RecipientScope } from "../application/avatar-delivery-service.js"
import { loadRecadoSpeechAudio, type RecadoSpeechSynthesizer } from "../application/recado-speech-audio.js"
import type { SpeechCacheIdentity } from "../../../shared/application/model-routing/ai-runtime.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Entregas da INIA para a PESSOA DA SESSÃO (Workflow Outputs V1): recados de voz (convite → aceite → fala) e conversas de
 * Workflow ainda não abertas. O destinatário é sempre o usuário autenticado — nunca um id do corpo; entrega de outra pessoa
 * ou de outra organização = 404.
 *
 * O servidor NUNCA toca áudio: os eventos de reprodução (`PLAYBACK_*`) são informados pelo navegador, que só começa a falar
 * no clique de aceite. "Aceitar" não é "entregar": DELIVERED só depois de PLAYING.
 */
const eventSchema = z.object({ event: z.enum(AVATAR_DELIVERY_EVENTS), failureReason: z.enum(AVATAR_FAILURE_REASONS).optional() })
const idParam = z.string().uuid()

export function createIniaDeliveriesRouter(db: Database, deps: { now?: () => Date; synthesizeSpeech?: { synthesize: RecadoSpeechSynthesizer; /** Voz + identidades aceitas no cache para a rota em vigor (policy da organização ou legado). */ accepted: () => Promise<SpeechCacheIdentity> } } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const scopeOf = (request: { user?: { organizationId: string; personId: string } }): RecipientScope => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId })

  router.get("/inbox", async (request, response) => {
    response.json({ data: await loadRecipientInbox(db, scopeOf(request)) })
  })

  router.post("/avatar/:deliveryId/events", async (request, response) => {
    const deliveryId = idParam.parse(request.params.deliveryId)
    const input = eventSchema.parse(request.body)
    const delivery = await applyAvatarDeliveryEvent(db, scopeOf(request), deliveryId, input.event, { now: now(), ...(input.failureReason ? { failureReason: input.failureReason } : {}) })
    response.json({ data: delivery })
  })

  // Voz do Gemini para o recado: PCM16 mono (sem cabeçalho), gerado uma vez e reaproveitado. Sem TTS configurado = 503 e o
  // navegador usa a voz do sistema — o avatar continua falando depois do aceite.
  router.get("/avatar/:deliveryId/audio", async (request, response) => {
    const deliveryId = idParam.parse(request.params.deliveryId)
    if (!deps.synthesizeSpeech) return void response.status(503).json({ error: { code: "SPEECH_NOT_CONFIGURED", message: "Voz da INIA não está configurada." } })
    const audio = await loadRecadoSpeechAudio(db, scopeOf(request), deliveryId, deps.synthesizeSpeech.synthesize, await deps.synthesizeSpeech.accepted())
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Cache-Control", "private, max-age=3600")
    response.setHeader("X-Audio-Format", "pcm16le")
    response.setHeader("X-Sample-Rate", String(audio.sampleRate))
    response.setHeader("X-Duration-Ms", String(audio.durationMs))
    response.setHeader("Access-Control-Expose-Headers", "X-Audio-Format, X-Sample-Rate, X-Duration-Ms")
    response.send(audio.pcm16)
  })

  router.post("/conversations/:conversationId/seen", async (request, response) => {
    const conversationId = idParam.parse(request.params.conversationId)
    response.json({ data: await markWorkflowConversationSeen(db, scopeOf(request), conversationId, now()) })
  })

  return router
}
