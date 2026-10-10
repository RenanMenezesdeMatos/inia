import { createHash } from "node:crypto"
import type { AiAdapterType } from "./ai-provider-catalog.js"

/**
 * VOZ de um modelo de síntese (Use Case SPEECH_SYNTHESIS — recado do avatar e "Ouvir com a INIA"). A voz é do PROVIDER
 * ("marin" só existe na OpenAI, "Kore" só no Gemini), por isso fica no MODELO cadastrado, não na policy: uma cadeia de fallback
 * pode ter vozes diferentes por modelo. Guardada em `ai_models.metadata.speech` — a sincronização de modelos preserva as
 * chaves que não são dela (`metadata - 'missingFromLastSync' || {discovery}`), então nenhuma migration é necessária.
 */
export type SpeechSettings = { voice: string; instructions: string | null }

/** Nome de voz do provider (ou id de voz própria): letras, números, espaço, ponto, hífen e sublinhado. */
export const SPEECH_VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/
export const SPEECH_INSTRUCTIONS_MAX_LENGTH = 1_000

/** Protocolos que a INIA sabe usar para ler um texto em voz (`AiProviderAdapter.synthesizeSpeech`). */
export const SPEECH_SYNTHESIS_ADAPTERS: readonly AiAdapterType[] = ["OPENAI_CHAT_COMPLETIONS"]

/** Lê `metadata.speech`; qualquer coisa fora do formato = sem voz (nunca uma voz inventada). */
export function speechSettingsOf(metadata: unknown): SpeechSettings | null {
  const speech = metadata && typeof metadata === "object" ? (metadata as { speech?: unknown }).speech : null
  if (!speech || typeof speech !== "object") return null
  const { voice, instructions } = speech as { voice?: unknown; instructions?: unknown }
  if (typeof voice !== "string" || !SPEECH_VOICE_PATTERN.test(voice)) return null
  return { voice, instructions: typeof instructions === "string" && instructions.trim() ? instructions.trim().slice(0, SPEECH_INSTRUCTIONS_MAX_LENGTH) : null }
}

/**
 * Identidade do áudio guardado (coluna `model` dos caches de áudio): o modelo do provider + o hash da instrução de tom. Trocar de
 * modelo ou de instrução gera áudio novo; a VOZ vai na coluna própria (`voice_name`). Nunca coincide com as identidades do
 * caminho legado (`models/gemini-…` e `fallback:<tts>`).
 */
export function speechCacheModelKey(providerModelId: string, settings: SpeechSettings): string {
  return settings.instructions ? `${providerModelId}#${createHash("sha256").update(settings.instructions).digest("hex").slice(0, 12)}` : providerModelId
}
