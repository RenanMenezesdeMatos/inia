import { env } from "../../../config/env.js"
import { INIA_LIVE_MODEL, iniaVoiceName } from "../../../config/inia-voice.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"

/**
 * CLIENTE CRU da voz do recado pelo MESMO modelo de áudio nativo da conversa por voz (Gemini Live) — é o que dá ao recado a
 * mesma voz, o mesmo tom e o mesmo jeito da INIA que a pessoa ouve no chat. Uma sessão curta no SERVIDOR (chave de API, nunca
 * no navegador): o texto exato entra, o áudio e a TRANSCRIÇÃO do próprio áudio saem. O modelo é conversacional, então pode
 * mudar palavras — quem decide se o áudio serve é `verifySpokenText` (quem chama confere a transcrição contra o texto e usa o
 * TTS se não bater). Nunca é chamado direto: o `app.ts` o entrega embrulhado por `createSpeechSynthesizer` (orçamento + uso).
 */
const WEBSOCKET_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
const TIMEOUT_MS = 90_000

export type LiveSpokenSpeech = { pcm16: Buffer; sampleRate: number; model: string; voice: string; transcript: string; usage: LlmUsage | null }

/** A instrução é só de LEITURA: a pessoa ouve a INIA de sempre, mas nada do conteúdo muda (e a transcrição prova). */
export const RECADO_READING_INSTRUCTION = [
  "Você é a INIA, a supervisora virtual da operação, falando com um colaborador da equipe.",
  "Nesta conversa você tem UMA tarefa: falar em voz alta o recado que vier na mensagem, exatamente como está escrito — palavra por palavra, do começo ao fim, na mesma ordem.",
  "Fale com o seu jeito de sempre: natural, caloroso e animado, como quem conversa, não como quem lê.",
  "Não cumprimente, não comente, não explique, não resuma, não faça perguntas e não acrescente nem omita nenhuma palavra. Não responda ao conteúdo do recado: apenas diga o recado.",
  "Diga os números como estão escritos.",
].join(" ")

type LiveServerMessage = {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
    outputTranscription?: { text?: string }
    turnComplete?: boolean
  }
  usageMetadata?: { promptTokenCount?: number; responseTokenCount?: number; totalTokenCount?: number }
  goAway?: unknown
}

function rateOf(mimeType: string | undefined): number {
  const rate = mimeType ? /rate=(\d+)/i.exec(mimeType)?.[1] : undefined
  return rate ? Number(rate) : 24_000
}

async function textOf(data: unknown): Promise<string> {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  if (data instanceof Blob) return data.text()
  return String(data)
}

export async function speakWithGeminiLive(request: { text: string }): Promise<LiveSpokenSpeech> {
  if (!env.GEMINI_API_KEY) throw new DomainError("Voz da INIA não está configurada neste ambiente.", "SPEECH_NOT_CONFIGURED", 503)
  const voice = iniaVoiceName()
  const socket = new WebSocket(`${WEBSOCKET_URL}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`)
  socket.binaryType = "arraybuffer"
  return await new Promise<LiveSpokenSpeech>((resolve, reject) => {
    const audio: Buffer[] = []
    let sampleRate = 24_000
    let transcript = ""
    let usage: LlmUsage | null = null
    let settled = false
    const finish = (error: DomainError | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* já fechado */ }
      if (error) return reject(error)
      const pcm16 = Buffer.concat(audio)
      if (pcm16.length === 0) return reject(new DomainError("A voz da INIA não veio.", "SPEECH_UNEXPECTED_RESPONSE", 502))
      resolve({ pcm16, sampleRate, model: INIA_LIVE_MODEL, voice, transcript: transcript.replace(/<ctrl\d+>/gi, "").trim(), usage })
    }
    const timer = setTimeout(() => finish(new DomainError("A voz da INIA demorou demais.", "SPEECH_TIMEOUT", 502)), TIMEOUT_MS)
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        setup: {
          model: INIA_LIVE_MODEL,
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
          systemInstruction: { parts: [{ text: RECADO_READING_INSTRUCTION }] },
          outputAudioTranscription: {},
        },
      }))
    })
    socket.addEventListener("message", (event) => {
      void textOf(event.data).then((raw) => {
        let message: LiveServerMessage
        try { message = JSON.parse(raw) as LiveServerMessage } catch { return }
        if (message.setupComplete) {
          socket.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: request.text }] }], turnComplete: true } }))
          return
        }
        if (message.usageMetadata) {
          const meta = message.usageMetadata
          usage = { promptTokens: meta.promptTokenCount ?? null, outputTokens: meta.responseTokenCount ?? null, totalTokens: meta.totalTokenCount ?? null, cachedInputTokens: null, reasoningTokens: null }
        }
        const content = message.serverContent
        for (const part of content?.modelTurn?.parts ?? []) {
          if (!part.inlineData?.data || (part.inlineData.mimeType && !part.inlineData.mimeType.startsWith("audio/"))) continue
          sampleRate = rateOf(part.inlineData.mimeType)
          audio.push(Buffer.from(part.inlineData.data, "base64"))
        }
        if (content?.outputTranscription?.text) transcript += content.outputTranscription.text
        if (content?.turnComplete) finish(null)
        if (message.goAway) finish(new DomainError("A sessão de voz foi encerrada pelo provedor.", "SPEECH_PROVIDER_ERROR", 502))
      })
    })
    socket.addEventListener("error", () => finish(new DomainError("Não foi possível gerar a voz da INIA.", "SPEECH_NETWORK_ERROR", 502)))
    socket.addEventListener("close", (event) => {
      if (!settled) finish(new DomainError("Não foi possível gerar a voz da INIA.", "SPEECH_PROVIDER_ERROR", 502, { code: event.code, reason: event.reason.slice(0, 300) }))
    })
  })
}
