import { apiGet, apiPost } from "@/lib/api/api-client"
import { pcm16FromBytes } from "@/lib/avatar/recado/recado-audio"
import {
  feedbackApplicationListSchema,
  feedbackApplicationSchema,
  feedbackInviteResponseSchema,
  startedFeedbackApplicationSchema,
  type FeedbackApplication,
  type FeedbackApplicationDetail,
  type FeedbackInvite,
  type FeedbackInviteEvent,
  type FeedbackPresentationEvent,
  type FeedbackSourceRef,
} from "@/schemas/feedback-applications/feedback-application.schema"

/** Aplicação de feedback conversacional — sempre da pessoa da sessão (o backend resolve e autoriza a fonte). */
const BASE = "/api/v1/feedback-applications"
const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

export async function fetchFeedbackApplications(): Promise<FeedbackApplication[]> {
  return feedbackApplicationListSchema.parse(await apiGet<unknown>(BASE)).items
}

export async function fetchFeedbackInvite(): Promise<FeedbackInvite | null> {
  return feedbackInviteResponseSchema.parse(await apiGet<unknown>(`${BASE}/invite`)).invite
}

export async function postFeedbackInviteEvent(source: FeedbackSourceRef, event: FeedbackInviteEvent): Promise<void> {
  await apiPost<unknown>(`${BASE}/invite/events`, { source, event })
}

/** Iniciar OU retomar (idempotente: sempre a mesma aplicação da fonte). `created` = esta chamada iniciou. */
export async function startOrResumeFeedbackApplication(source: FeedbackSourceRef): Promise<{ application: FeedbackApplicationDetail; created: boolean }> {
  return startedFeedbackApplicationSchema.parse(await apiPost<unknown>(BASE, { source }))
}

export async function markFeedbackApplicationOpened(applicationId: string): Promise<FeedbackApplication> {
  return feedbackApplicationSchema.parse(await apiPost<unknown>(`${BASE}/${applicationId}/opened`))
}

export async function postFeedbackPresentationEvent(applicationId: string, event: FeedbackPresentationEvent): Promise<void> {
  await apiPost<unknown>(`${BASE}/${applicationId}/presentation-events`, { event })
}

/** "Sair por agora" — a aplicação continua em andamento. */
export async function pauseFeedbackApplication(applicationId: string): Promise<FeedbackApplication> {
  return feedbackApplicationSchema.parse(await apiPost<unknown>(`${BASE}/${applicationId}/pause`))
}

/** Primeira geração da voz leva ~25 s para ~20 s de fala (voz da conversa conferida contra o texto). */
const PRESENTATION_AUDIO_TIMEOUT_MS = 100_000

/** Voz da apresentação (gerada uma vez no backend). Falha = o chamador usa a voz do sistema. */
export async function fetchFeedbackPresentationAudio(applicationId: string, signal?: AbortSignal): Promise<{ pcm16: Int16Array; sampleRate: number }> {
  const timeout = AbortSignal.timeout(PRESENTATION_AUDIO_TIMEOUT_MS)
  const response = await fetch(`${API_URL}${BASE}/${applicationId}/audio`, { credentials: "include", cache: "no-store", signal: signal ? (typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal) : timeout })
  if (!response.ok) throw new Error(`Voz da INIA indisponível (${response.status}).`)
  const sampleRate = Number(response.headers.get("X-Sample-Rate"))
  if (response.headers.get("X-Audio-Format") !== "pcm16le" || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Formato de voz inesperado.")
  return { pcm16: pcm16FromBytes(await response.arrayBuffer()), sampleRate }
}
