import type { GeminiServerMessage } from "@/lib/realtime/gemini-live-protocol"

/**
 * Captura real do Gemini Live (`gemini-live/<id>.json` + `.wav`) de volta nas MENSAGENS do
 * servidor, na ordem e no instante em que chegaram — o áudio de cada chunk volta a ser PCM16 em
 * base64 (o WAV é a concatenação dos chunks; `audioBytes` diz onde cortar). Sem Node nem DOM: serve
 * ao laboratório no navegador e aos testes (`testing/live-capture.ts`).
 */

export type CaptureFixtureEvent =
  | { t: number; audioBytes: number; mime: string }
  | { t: number; transcript: string }
  | { t: number; turnComplete: true }
  | { t: number; generationComplete: true }

export type CaptureFixtureJson = {
  id: string
  prompt: string
  transcript: string
  sampleRate: number
  events: CaptureFixtureEvent[]
}

export type CaptureStep = {
  /** ms desde o envio do pedido. */
  t: number
  message: GeminiServerMessage
  kind: "audio" | "transcript" | "generationComplete" | "turnComplete"
  /** Tamanho do chunk em amostras (só áudio). */
  samples?: number
}

/** Bytes do bloco `data` de um WAV (procura o bloco em vez de assumir 44 bytes de cabeçalho). */
export function wavDataBytes(wav: Uint8Array): Uint8Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const ascii = (at: number) => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3])
  if (wav.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw new Error("não é um WAV (RIFF/WAVE)")
  let offset = 12
  while (offset + 8 <= wav.length) {
    const size = view.getUint32(offset + 4, true)
    if (ascii(offset) === "data") {
      if (offset + 8 + size > wav.length) throw new Error("WAV truncado: bloco data maior que o arquivo")
      return wav.subarray(offset + 8, offset + 8 + size)
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error("WAV sem bloco data")
}

/** Base64 de bytes quaisquer (em blocos: `fromCharCode` com milhares de argumentos estoura a pilha). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * Fatia o PCM pelos `audioBytes` dos eventos. Falha se sobrar ou faltar áudio: uma captura
 * incoerente nunca vira reprodução "quase certa" (o lip-sync seria avaliado sobre áudio errado).
 */
export function sliceAudioChunks(events: readonly CaptureFixtureEvent[], pcm: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = []
  let offset = 0
  for (const event of events) {
    if (!("audioBytes" in event)) continue
    if (event.audioBytes % 2 !== 0) throw new Error(`chunk com número ímpar de bytes (${event.audioBytes}) — PCM16 exige pares`)
    if (offset + event.audioBytes > pcm.length) throw new Error(`faltam ${offset + event.audioBytes - pcm.length} bytes de áudio no WAV`)
    chunks.push(pcm.subarray(offset, offset + event.audioBytes))
    offset += event.audioBytes
  }
  if (offset !== pcm.length) throw new Error(`${pcm.length - offset} bytes de áudio sem chunk`)
  return chunks
}

/** As mensagens do servidor da captura, com as formas exatas do Live (`serverContent.*`). */
export function buildCaptureSteps(fixture: Pick<CaptureFixtureJson, "events">, pcm: Uint8Array): CaptureStep[] {
  const chunks = sliceAudioChunks(fixture.events, pcm)
  let chunkIndex = 0
  return fixture.events.map((event): CaptureStep => {
    if ("audioBytes" in event) {
      const bytes = chunks[chunkIndex++]
      return {
        t: event.t,
        kind: "audio",
        samples: bytes.length / 2,
        message: { serverContent: { modelTurn: { parts: [{ inlineData: { data: bytesToBase64(bytes), mimeType: event.mime } }] } } },
      }
    }
    if ("transcript" in event) return { t: event.t, kind: "transcript", message: { serverContent: { outputTranscription: { text: event.transcript } } } }
    if ("generationComplete" in event) return { t: event.t, kind: "generationComplete", message: { serverContent: { generationComplete: true } } }
    return { t: event.t, kind: "turnComplete", message: { serverContent: { turnComplete: true } } }
  })
}

/**
 * "Sem espera inicial": desloca TODOS os eventos para o primeiro áudio chegar em `firstAudioAtMs`
 * (a latência do modelo some; a cadência relativa — folga de lookahead, transcrição adiantada —
 * fica intacta). Eventos que cairiam antes de 0 ficam em 0, na mesma ordem.
 */
export function shiftToFastStart(steps: readonly CaptureStep[], firstAudioAtMs = 150): CaptureStep[] {
  const firstAudio = steps.find((step) => step.kind === "audio")
  if (!firstAudio) return steps.slice()
  const shift = firstAudio.t - firstAudioAtMs
  return steps.map((step) => ({ ...step, t: Math.max(0, step.t - shift) }))
}
