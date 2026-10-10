import { describe, expect, it, vi } from "vitest"
import type { PlaybackTurnEvent, SpeechPlayback, SpeechPlaybackListener } from "@/lib/avatar/audio/types"
import type { ScheduledAudioChunk } from "@/lib/avatar/lipsync/types"
import { pcm16FromBytes, playRecadoAudio, resampleLinear, RECADO_AUDIO_START_TIMEOUT_MS } from "./recado-audio"
import type { RecadoHandlers } from "./recado-speech"

function fakePlayback(options: { primed?: boolean } = {}) {
  const listeners: SpeechPlaybackListener[] = []
  let turn = 0
  let cursor = 0
  const chunks: ScheduledAudioChunk[] = []
  const playback = {
    context: options.primed === false ? null : ({ currentTime: 0 } as AudioContext),
    get currentTurnId() { return turn },
    get scheduledUntil() { return cursor },
    prime: vi.fn(),
    beginTurn: () => ++turn,
    enqueueBase64Pcm16: () => null,
    enqueuePcm: (pcm: Float32Array, turnId: number) => {
      const chunk = { turnId, pcm, sampleRate: 24_000, startAt: cursor, receivedAt: 0 } as ScheduledAudioChunk
      cursor += pcm.length / 24_000
      chunks.push(chunk)
      for (const listener of listeners) listener.onChunkScheduled?.(chunk)
      if (chunks.length === 1) for (const listener of listeners) listener.onTurnEvent?.({ type: "turn-started", turnId, startAt: 0 })
      return chunk
    },
    interrupt: vi.fn(() => 1.5),
    isPlaying: () => true,
    heardTime: () => null,
    setAvOffsetMs: () => {},
    tapOutput: () => () => {},
    subscribe: (listener: SpeechPlaybackListener) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1) },
    close: async () => {},
  } as unknown as SpeechPlayback
  const emit = (event: PlaybackTurnEvent) => { for (const listener of [...listeners]) listener.onTurnEvent?.(event) }
  return { playback, chunks, emit, listeners }
}
const fakeLipsync = () => ({ beginTurn: vi.fn(), pushAudio: vi.fn(), pushTranscript: vi.fn(), endOfText: vi.fn(), interrupt: vi.fn() })
const handlers = (): RecadoHandlers & { calls: string[] } => {
  const calls: string[] = []
  return { calls, onStarted: () => calls.push("started"), onCompleted: () => calls.push("completed"), onFailed: (reason) => calls.push(`failed:${reason}`), onInterrupted: () => calls.push("interrupted") }
}
const noTimers = { setTimeout: () => null, clearTimeout: () => {} }

describe("recado com a voz do Gemini (mesmo pipeline do Live)", () => {
  it("agenda todo o áudio no turno, alimenta o lip-sync com áudio + o texto EXATO e só conclui quando o áudio drena", () => {
    const { playback, chunks, emit } = fakePlayback()
    const lipsync = fakeLipsync()
    const h = handlers()
    const audio = { pcm16: new Int16Array(24_000 * 2).fill(1000), sampleRate: 24_000 }
    playRecadoAudio({ playback, lipsync }, "Oi, Marcela. Tenho um retorno.", audio, h, noTimers)
    expect(chunks.length).toBe(4)
    expect(chunks.reduce((total, chunk) => total + chunk.pcm.length, 0)).toBe(48_000)
    expect(lipsync.beginTurn).toHaveBeenCalledWith(1)
    expect(lipsync.pushAudio).toHaveBeenCalledTimes(4)
    expect(lipsync.pushTranscript).toHaveBeenCalledWith(expect.objectContaining({ turnId: 1, text: "Oi, Marcela. Tenho um retorno." }))
    expect(lipsync.endOfText).toHaveBeenCalledWith(1)
    expect(h.calls).toEqual(["started"])
    emit({ type: "turn-drained", turnId: 1, endedAt: 2 })
    expect(h.calls).toEqual(["started", "completed"])
  })
  it("parar no meio: interrompe áudio e boca, vira interrupção (nunca entrega)", () => {
    const { playback, emit } = fakePlayback()
    const lipsync = fakeLipsync()
    const h = handlers()
    const playbackHandle = playRecadoAudio({ playback, lipsync }, "Texto.", { pcm16: new Int16Array(24_000), sampleRate: 24_000 }, h, noTimers)!
    playbackHandle.stop()
    emit({ type: "turn-drained", turnId: 1, endedAt: 1 })
    expect(playback.interrupt).toHaveBeenCalled()
    expect(lipsync.interrupt).toHaveBeenCalledWith(1.5)
    expect(h.calls).toEqual(["started", "interrupted"])
  })
  it("sem AudioContext liberado no clique: falha explícita (o chamador cai para a voz do sistema)", () => {
    const h = handlers()
    expect(playRecadoAudio({ playback: fakePlayback({ primed: false }).playback, lipsync: fakeLipsync() }, "Texto.", { pcm16: new Int16Array(10), sampleRate: 24_000 }, h, noTimers)).toBeNull()
    expect(h.calls).toEqual(["failed:AUDIO_BLOCKED"])
  })
  it("sem início dentro do prazo: falha (nunca fica esperando em silêncio)", () => {
    const { playback, listeners } = fakePlayback()
    const timers: { callback: () => void; ms: number }[] = []
    const h = handlers()
    // Contexto suspenso: o áudio é agendado mas o turno nunca "começa".
    playback.enqueuePcm = (pcm: Float32Array, turnId: number) => ({ turnId, pcm, sampleRate: 24_000, startAt: 0, receivedAt: 0 }) as ScheduledAudioChunk
    playRecadoAudio({ playback, lipsync: fakeLipsync() }, "Texto.", { pcm16: new Int16Array(100), sampleRate: 24_000 }, h, { setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length }, clearTimeout: () => {} })
    expect(timers[0]!.ms).toBe(RECADO_AUDIO_START_TIMEOUT_MS)
    timers[0]!.callback()
    expect(h.calls).toEqual(["failed:AUDIO_BLOCKED"])
    expect(listeners).toHaveLength(0)
  })
  it("PCM16 little-endian e reamostragem para 24 kHz", () => {
    expect([...pcm16FromBytes(new Uint8Array([0x01, 0x00, 0xff, 0xff]).buffer)]).toEqual([1, -1])
    expect(resampleLinear(new Float32Array([0, 1, 0, 1]), 48_000, 24_000)).toHaveLength(2)
  })
})
