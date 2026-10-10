import { verifySpokenText, type SpokenTextFidelity } from "../domain/spoken-text-fidelity.js"
import type { RecadoSpeechSynthesizer } from "./recado-speech-audio.js"

/**
 * A VOZ DO RECADO: primeiro a MESMA voz da conversa (modelo de áudio nativo), conferida palavra a palavra contra o texto exato
 * (`verifySpokenText`); se a fala não bater ou o provedor falhar, a leitura do TTS (que não reescreve). O áudio guardado diz
 * de onde veio: o modelo nativo, ou `fallback:<modelo do TTS>` — assim o cache aceita os dois e um plano B nunca é refeito a
 * cada pedido, enquanto o áudio antigo (TTS de antes desta regra) é gerado de novo com a voz da conversa.
 */
export const RECADO_FALLBACK_PREFIX = "fallback:"

type Audio = { pcm16: Buffer; sampleRate: number; model: string; voice: string }
export type RecadoVoiceDeps = {
  speakLikeConversation: (request: { text: string }) => Promise<Audio & { transcript: string }>
  readWithTts: (request: { text: string }) => Promise<Audio>
  onFallback?: (info: { reason: "FIDELITY" | "PROVIDER"; fidelity: SpokenTextFidelity | null; errorCode: string | null }) => void
}

export function acceptedRecadoModels(conversationModel: string, ttsModel: string): string[] {
  return [conversationModel, `${RECADO_FALLBACK_PREFIX}${ttsModel}`]
}

export function createRecadoVoice(deps: RecadoVoiceDeps): RecadoSpeechSynthesizer {
  return async ({ text }) => {
    try {
      const spoken = await deps.speakLikeConversation({ text })
      const fidelity = verifySpokenText(text, spoken.transcript)
      if (fidelity.ok) return { pcm16: spoken.pcm16, sampleRate: spoken.sampleRate, model: spoken.model, voice: spoken.voice }
      deps.onFallback?.({ reason: "FIDELITY", fidelity, errorCode: null })
    } catch (error) {
      deps.onFallback?.({ reason: "PROVIDER", fidelity: null, errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN" })
    }
    const read = await deps.readWithTts({ text })
    return { ...read, model: `${RECADO_FALLBACK_PREFIX}${read.model}` }
  }
}
