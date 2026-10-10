import { env } from "./env.js"

/**
 * A VOZ DA INIA — uma só, porque é o mesmo agente. Vale para a conversa por voz (Gemini Live, `/realtime/sessions`) e para
 * o recado do avatar. O recado é falado pelo MESMO modelo de áudio nativo da conversa (`INIA_LIVE_MODEL`) com a mesma voz:
 * mesmo nome de voz em modelos diferentes (TTS × áudio nativo) soa diferente no timbre e no jeito — por isso o TTS ficou só
 * como plano B. Nunca deixar o Live sem voz explícita: a voz padrão dele não é documentada.
 */
export const DEFAULT_INIA_VOICE = "Kore"

/** Modelo de áudio nativo da conversa por voz — o recado usa o mesmo. */
export const INIA_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest"

export function iniaVoiceName(): string {
  return env.INIA_AVATAR_VOICE ?? DEFAULT_INIA_VOICE
}
