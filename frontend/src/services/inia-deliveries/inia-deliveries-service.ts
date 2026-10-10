import { apiGet, apiPost } from "@/lib/api/api-client"
import { pcm16FromBytes } from "@/lib/avatar/recado/recado-audio"
import { avatarDeliverySchema, iniaInboxSchema, type AvatarDelivery, type AvatarDeliveryEvent, type AvatarFailureReason, type IniaInbox } from "@/schemas/inia-deliveries/inia-deliveries.schema"

/** Entregas da INIA para a pessoa da sessão (Workflow Outputs V1): recados de voz e conversas de Workflow ainda não abertas. */
const BASE = "/api/v1/inia-deliveries"

export async function fetchIniaInbox(): Promise<IniaInbox> {
  return iniaInboxSchema.parse(await apiGet<unknown>(`${BASE}/inbox`))
}

/** Registra um evento do recado de voz. O áudio NUNCA começa aqui: só o navegador fala, no clique de aceite. */
export async function postAvatarDeliveryEvent(deliveryId: string, event: AvatarDeliveryEvent, failureReason?: AvatarFailureReason): Promise<AvatarDelivery> {
  return avatarDeliverySchema.parse(await apiPost<unknown>(`${BASE}/avatar/${deliveryId}/events`, { event, ...(failureReason ? { failureReason } : {}) }))
}

export async function markWorkflowConversationSeen(conversationId: string): Promise<{ seen: boolean }> {
  return apiPost<{ seen: boolean }>(`${BASE}/conversations/${conversationId}/seen`)
}

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
/**
 * O backend pode estar gerando na hora (primeira vez): a voz da conversa leva ~25 s para um recado de ~20 s (e, se não bater
 * com o texto, ainda há a leitura do TTS). O pedido começa quando o convite aparece, então quase sempre já está pronto no clique.
 */
const RECADO_AUDIO_TIMEOUT_MS = 100_000

/** Voz do Gemini para o recado (TTS do texto exato, gerado uma vez no backend). Falha = o chamador usa a voz do sistema. */
export async function fetchRecadoAudio(deliveryId: string): Promise<{ pcm16: Int16Array; sampleRate: number }> {
  const response = await fetch(`${API_URL}${BASE}/avatar/${deliveryId}/audio`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(RECADO_AUDIO_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Voz da INIA indisponível (${response.status}).`)
  const sampleRate = Number(response.headers.get("X-Sample-Rate"))
  if (response.headers.get("X-Audio-Format") !== "pcm16le" || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Formato de voz inesperado.")
  return { pcm16: pcm16FromBytes(await response.arrayBuffer()), sampleRate }
}
