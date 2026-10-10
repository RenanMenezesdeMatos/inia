import type { SpeechPlayback } from "@/lib/avatar/audio/types"
import type { SpeechLipsyncEngine } from "@/lib/avatar/lipsync/types"
import type { RecadoHandlers, RecadoPlayback } from "./recado-speech"

/**
 * FALA DO RECADO COM A VOZ DO GEMINI. O áudio vem pronto do backend (TTS do texto EXATO da entrega) e toca pelo MESMO
 * caminho da resposta do Gemini Live: `SpeechPlayback` (relógio do áudio ouvido) + motor de lip-sync (texto + áudio). O
 * avatar não sabe de onde veio a fala — a boca segue o áudio de verdade.
 *
 * O AudioContext precisa ter sido liberado DENTRO do clique (`playback.prime()`); o áudio pode chegar depois disso.
 * Início = primeiro trecho agendado; conclusão = todo o áudio do turno tocado (drenou); nada disso é inferido de tempo.
 */
export type RecadoAudio = { pcm16: Int16Array; sampleRate: number }

/** Trechos de ~0,5 s: o lip-sync analisa o áudio na chegada, como faz com o Live. */
const CHUNK_SECONDS = 0.5
export const RECADO_AUDIO_START_TIMEOUT_MS = 5_000

export function pcm16ToFloat32(pcm16: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(pcm16.length)
  for (let i = 0; i < pcm16.length; i++) out[i] = pcm16[i]! / 0x8000
  return out
}

/** Taxa da reprodução (a mesma do Live). O TTS do Gemini devolve 24 kHz; outra taxa é reamostrada (linear) para não
 * tocar acelerada/lenta. */
export const PLAYBACK_SAMPLE_RATE = 24_000
export function resampleLinear(samples: Float32Array<ArrayBuffer>, from: number, to: number): Float32Array<ArrayBuffer> {
  if (from === to || samples.length === 0) return samples
  const length = Math.max(1, Math.round((samples.length * to) / from))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = (i * from) / to
    const index = Math.floor(position)
    const next = Math.min(samples.length - 1, index + 1)
    const fraction = position - index
    out[i] = samples[Math.min(index, samples.length - 1)]! * (1 - fraction) + samples[next]! * fraction
  }
  return out
}

/** Bytes PCM16 little-endian (resposta do backend) → Int16Array (independe da ordem de bytes da máquina). */
export function pcm16FromBytes(buffer: ArrayBuffer): Int16Array {
  const view = new DataView(buffer)
  const out = new Int16Array(buffer.byteLength >> 1)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

export function playRecadoAudio(
  voice: { playback: SpeechPlayback; lipsync: Pick<SpeechLipsyncEngine, "beginTurn" | "pushAudio" | "pushTranscript" | "endOfText" | "interrupt"> },
  text: string,
  audio: RecadoAudio,
  handlers: RecadoHandlers,
  timers: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void } = { setTimeout: (callback, ms) => window.setTimeout(callback, ms), clearTimeout: (handle) => window.clearTimeout(handle as number) },
): RecadoPlayback | null {
  const { playback, lipsync } = voice
  if (!playback.context || audio.pcm16.length === 0) {
    handlers.onFailed(playback.context ? "UNKNOWN" : "AUDIO_BLOCKED")
    return null
  }
  let started = false
  let finished = false
  let watchdog: unknown = null
  const turnId = playback.beginTurn()
  lipsync.beginTurn(turnId)
  const finish = () => {
    finished = true
    timers.clearTimeout(watchdog)
    unsubscribe()
  }
  const unsubscribe = playback.subscribe({
    onChunkScheduled: (chunk) => {
      if (finished || chunk.turnId !== turnId) return
      lipsync.pushAudio(chunk)
    },
    onTurnEvent: (event) => {
      if (finished || event.turnId !== turnId) return
      if (event.type === "turn-started" && !started) {
        started = true
        timers.clearTimeout(watchdog)
        handlers.onStarted()
      } else if (event.type === "turn-drained" && started) {
        finish()
        handlers.onCompleted()
      }
    },
  })
  watchdog = timers.setTimeout(() => {
    if (started || finished) return
    finish()
    const at = playback.interrupt()
    lipsync.interrupt(at ?? 0)
    handlers.onFailed("AUDIO_BLOCKED")
  }, RECADO_AUDIO_START_TIMEOUT_MS)

  const samples = resampleLinear(pcm16ToFloat32(audio.pcm16), audio.sampleRate, PLAYBACK_SAMPLE_RATE)
  const step = Math.max(1, Math.round(PLAYBACK_SAMPLE_RATE * CHUNK_SECONDS))
  for (let offset = 0; offset < samples.length && !finished; offset += step) {
    const scheduled = playback.enqueuePcm(samples.subarray(offset, Math.min(samples.length, offset + step)), turnId)
    if (!scheduled) {
      if (offset === 0) {
        finish()
        handlers.onFailed("AUDIO_BLOCKED")
        return null
      }
      break
    }
    // O texto inteiro do recado entra depois do primeiro trecho (como a transcrição do Live), ancorado no áudio já agendado.
    if (offset === 0) lipsync.pushTranscript({ turnId, text, receivedAt: playback.context.currentTime, audioScheduledUntil: playback.scheduledUntil })
  }
  lipsync.endOfText(turnId)

  return {
    stop() {
      if (finished) return
      finish()
      const at = playback.interrupt()
      lipsync.interrupt(at ?? playback.heardTime() ?? 0)
      handlers.onInterrupted()
    },
  }
}
