import type { RecadoPhase } from "../inia-recado-invite"
import type { RecadoFailureReason } from "@/lib/avatar/recado/recado-speech"
import type { AvatarDelivery } from "@/schemas/inia-deliveries/inia-deliveries.schema"

export const RECADO_FAILURE_TEXT: Record<RecadoFailureReason, string> = {
  SPEECH_UNAVAILABLE: "Este navegador não tem voz disponível — leia o recado abaixo.",
  NO_VOICE: "Não há voz em português neste navegador — leia o recado abaixo.",
  AUDIO_BLOCKED: "O navegador não liberou o áudio. Tente de novo ou leia o recado abaixo.",
  SPEECH_ERROR: "A voz foi interrompida por um erro. Tente de novo ou leia o recado abaixo.",
  UNKNOWN: "Tente de novo ou leia o recado abaixo.",
}

/** Áudio (voz do Gemini) de um recado — gerado uma vez no backend; aqui fica em cache pela sessão da página. */
export const recadoAudioKey = (deliveryId: string) => ["inia-deliveries", "recado-audio", deliveryId] as const

/** Estado do convite a partir do que o backend guardou (sem sessão de fala nesta tela). */
export function phaseOfStatus(status: AvatarDelivery["status"]): RecadoPhase {
  if (status === "SNOOZED") return "snoozed"
  if (status === "FAILED") return "failed"
  if (status === "INTERRUPTED") return "interrupted"
  return "offer"
}
