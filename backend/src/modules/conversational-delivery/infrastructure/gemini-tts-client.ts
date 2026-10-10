import { env } from "../../../config/env.js"
import { iniaVoiceName } from "../../../config/inia-voice.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"

/**
 * CLIENTE CRU do TTS do Gemini (voz do recado do avatar). Recebe o texto EXATO já validado e devolve o áudio — o modelo
 * de TTS lê o texto, não o reescreve (ao contrário de pedir ao Live para "falar isto"). Nunca é chamado direto: o `app.ts`
 * o entrega embrulhado por `createSpeechSynthesizer` (llm-gateway.ts), que aplica o orçamento e grava o uso.
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const TIMEOUT_MS = 45_000

export type SynthesizedSpeech = { pcm16: Buffer; sampleRate: number; model: string; voice: string; usage: LlmUsage | null }
export type SpeechSynthesisRequest = { text: string }

type GeminiTtsResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
}

/** "audio/L16;codec=pcm;rate=24000" → 24000 (PCM16 cru). WAV é lido pelo cabeçalho (`decodeWavPcm16`). */
export function sampleRateOf(mimeType: string | undefined): number | null {
  if (!mimeType || !/^audio\/(l16|pcm)/i.test(mimeType)) return null
  const rate = /rate=(\d+)/i.exec(mimeType)?.[1]
  return rate ? Number(rate) : 24_000
}

/**
 * WAV (RIFF) PCM 16 bits → amostras mono little-endian + taxa. Os modelos TTS mais novos devolvem `audio/wav`; os anteriores,
 * L16 cru. Estéreo vira mono pela média; qualquer outro formato é recusado (nunca toca ruído).
 */
export function decodeWavPcm16(wav: Buffer): { pcm16: Buffer; sampleRate: number } | null {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null
  let offset = 12
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === "fmt ") format = { audioFormat: wav.readUInt16LE(body), channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) }
    if (id === "data") {
      if (!format || format.audioFormat !== 1 || format.bits !== 16 || format.channels < 1) return null
      // Tamanho 0/0xFFFFFFFF (streaming) = até o fim do arquivo.
      const end = size === 0 || size === 0xffffffff || body + size > wav.length ? wav.length : body + size
      const data = wav.subarray(body, end - ((end - body) % (2 * format.channels)))
      if (format.channels === 1) return { pcm16: Buffer.from(data), sampleRate: format.sampleRate }
      const frames = data.length / (2 * format.channels)
      const mono = Buffer.alloc(frames * 2)
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0
        for (let channel = 0; channel < format.channels; channel++) sum += data.readInt16LE((frame * format.channels + channel) * 2)
        mono.writeInt16LE(Math.round(sum / format.channels), frame * 2)
      }
      return { pcm16: mono, sampleRate: format.sampleRate }
    }
    offset = body + size + (size % 2)
  }
  return null
}

export async function synthesizeSpeechWithGemini(request: SpeechSynthesisRequest): Promise<SynthesizedSpeech> {
  if (!env.GEMINI_API_KEY) throw new DomainError("Voz da INIA não está configurada neste ambiente.", "SPEECH_NOT_CONFIGURED", 503)
  const model = env.INIA_AVATAR_TTS_MODEL
  const voice = iniaVoiceName()
  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: request.text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => {
    const timeout = error instanceof Error && error.name === "TimeoutError"
    throw new DomainError("Não foi possível gerar a voz da INIA.", timeout ? "SPEECH_TIMEOUT" : "SPEECH_NETWORK_ERROR", 502)
  })
  if (!response.ok) throw new DomainError("Não foi possível gerar a voz da INIA.", "SPEECH_PROVIDER_ERROR", 502, { status: response.status, body: (await response.text()).slice(0, 500) })
  const payload = (await response.json()) as GeminiTtsResponse
  const part = payload.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data)
  const bytes = part?.inlineData?.data ? Buffer.from(part.inlineData.data, "base64") : null
  const rawRate = sampleRateOf(part?.inlineData?.mimeType)
  const audio = !bytes ? null : rawRate ? { pcm16: bytes, sampleRate: rawRate } : /^audio\/(x-)?wav/i.test(part?.inlineData?.mimeType ?? "") ? decodeWavPcm16(bytes) : null
  if (!audio || audio.pcm16.length === 0) throw new DomainError("A voz da INIA veio num formato inesperado.", "SPEECH_UNEXPECTED_RESPONSE", 502, { mimeType: part?.inlineData?.mimeType ?? null })
  const usage = payload.usageMetadata
  return {
    pcm16: audio.pcm16,
    sampleRate: audio.sampleRate,
    model,
    voice,
    usage: usage ? { promptTokens: usage.promptTokenCount ?? null, outputTokens: usage.candidatesTokenCount ?? null, totalTokens: usage.totalTokenCount ?? null, cachedInputTokens: null, reasoningTokens: null } : null,
  }
}
