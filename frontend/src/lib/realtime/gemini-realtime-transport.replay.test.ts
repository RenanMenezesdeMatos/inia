import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import { advanceContext, fakeContextFactory, type FakeContext } from "@/lib/avatar/audio/testing/fake-audio-context"
import type { ScheduledAudioChunk, SpeechLipsyncEngine, TranscriptFragment } from "@/lib/avatar/lipsync/types"
import { GeminiRealtimeTransport } from "./gemini-realtime-transport"
import { FakeLiveSocket } from "./testing/fake-live-socket"
import { loadLiveCapture, type LiveCaptureStep } from "./testing/live-capture"

// Tráfego REAL do Gemini Live (capturas de 2026-09-24) passando pelo transporte + a reprodução de
// verdade (sobre um AudioContext falso com relógio controlado): o que o lip-sync recebe, quando o
// estado muda e o que acontece num barge-in no meio de uma resposta longa.

/** Folga da reprodução no primeiro chunk de cada rajada (speech-playback.ts). */
const BURST_LEAD = 0.02
const SAMPLE_RATE = 24000
/** Relógio do AudioContext no envio do pedido (t = 0 da captura). */
const REQUEST_AT = 5

// setImmediate (Node): roda depois de esvaziar as microtarefas da fila de mensagens, sem o piso de
// ~1 ms do setTimeout — são ~1.400 mensagens na resposta longa.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function recordingLipsync() {
  const calls: string[] = []
  const chunks: ScheduledAudioChunk[] = []
  const transcripts: TranscriptFragment[] = []
  const interrupts: number[] = []
  const engine: SpeechLipsyncEngine = {
    beginTurn: (turnId) => { calls.push(`begin:${turnId}`) },
    pushAudio: (chunk) => { chunks.push(chunk); calls.push(`audio:${chunk.turnId}`) },
    pushTranscript: (fragment) => { transcripts.push(fragment); calls.push(`text:${fragment.turnId}`) },
    endOfText: (turnId) => { calls.push(`end:${turnId}`) },
    interrupt: (atTime) => { interrupts.push(atTime); calls.push("interrupt") },
    reset: () => { calls.push("reset") },
    sample: () => {},
    debugSnapshot: () => ({ turnId: null, phones: [], frames: [], analyzedUntil: 0, alignedUntil: 0, pendingWords: 0, minLookahead: null }),
  }
  return { engine, calls, chunks, transcripts, interrupts }
}

async function connectedHarness() {
  const factory = fakeContextFactory()
  const playback = createSpeechPlayback({ createContext: factory.createContext })
  const lipsync = recordingLipsync()
  const states: string[] = []
  const output: string[] = []
  const onTurnComplete = vi.fn()
  const sockets: FakeLiveSocket[] = []
  const transport = new GeminiRealtimeTransport(
    { onStateChange: (state) => { states.push(state) }, onOutputTranscript: (text) => { output.push(text) }, onTurnComplete },
    {
      playback,
      lipsync: lipsync.engine,
      createSocket: (url) => {
        const socket = new FakeLiveSocket(url)
        sockets.push(socket)
        return socket.asWebSocket()
      },
      fetchSession: async () => ({ wsUrl: "wss://live.test", model: "models/gemini-2.5-flash-native-audio-latest", expiresAt: "" }),
      startCapture: async () => ({ context: { state: "running" } as AudioContext, stop: () => {} }),
    },
  )
  // O clique: o AudioContext nasce aqui, nunca dentro do callback da WebSocket.
  transport.primeAudioPlayback()
  const ctx: FakeContext = factory.contexts[0]
  const connecting = transport.connect()
  await tick()
  sockets[0].open()
  sockets[0].receive({ setupComplete: {} })
  await connecting
  return { transport, socket: sockets[0], ctx, lipsync, states, output, onTurnComplete }
}

/** Entrega as mensagens da captura no instante (relógio do contexto) em que chegaram. */
async function replay(socket: FakeLiveSocket, ctx: FakeContext, steps: LiveCaptureStep[], requestAt = REQUEST_AT) {
  for (const step of steps) {
    advanceContext(ctx, requestAt + step.t / 1000)
    socket.receive(step.message)
    await tick()
  }
}

const endOf = (chunk: ScheduledAudioChunk) => chunk.startAt + chunk.pcm.length / chunk.sampleRate

beforeEach(() => {
  for (const method of ["info", "debug", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

describe("GeminiRealtimeTransport + SpeechPlayback — capturas reais do Gemini Live", () => {
  it.each([
    "frase-01-apresentacao",
    "frase-02-proposta",
    "frase-03-escolha",
    "frase-04-amanha",
    "frase-05-labiais",
    "resposta-longa",
  ])("%s: chunks colados, texto ancorado no áudio agendado e idle só quando o áudio drena", async (id) => {
    const capture = loadLiveCapture(id)
    const h = await connectedHarness()
    await h.transport.startTurn()
    h.transport.endTurn()
    await replay(h.socket, h.ctx, capture.steps)

    // O lip-sync recebeu tudo, na ordem, num turno só; o texto fechou no generationComplete.
    const audioSteps = capture.steps.filter((step) => step.kind === "audio")
    expect(h.lipsync.calls.filter((call) => call.startsWith("begin"))).toEqual(["begin:1"])
    expect(h.lipsync.calls.at(-1)).toBe("end:1")
    expect(h.lipsync.chunks.map((chunk) => chunk.pcm.length)).toEqual(audioSteps.map((step) => step.samples))
    // Começo de rajada: 20 ms de folga (a análise do lip-sync roda antes do start()).
    expect(h.lipsync.chunks[0].startAt).toBeCloseTo(REQUEST_AT + audioSteps[0].t / 1000 + BURST_LEAD, 9)
    for (let i = 1; i < h.lipsync.chunks.length; i++) {
      // O Live gera mais rápido que o tempo real: nunca há buraco entre chunks.
      expect(h.lipsync.chunks[i].startAt).toBeCloseTo(endOf(h.lipsync.chunks[i - 1]), 9)
    }
    // Folga entre a chegada e o início de cada chunk depois do primeiro: o lip-sync tem tempo de
    // analisar/alinhar antes de soar (na resposta longa passa de 30 s).
    const lookaheads = h.lipsync.chunks.slice(1).map((chunk) => chunk.startAt - chunk.receivedAt)
    expect(Math.min(...lookaheads)).toBeGreaterThan(0.5)
    expect(Math.max(...lookaheads)).toBeGreaterThan(id === "resposta-longa" ? 30 : 0.9)

    // Cada fragmento de texto leva a chegada e o fim do áudio já agendado naquele instante.
    let scheduledUntil = 0
    let textIndex = 0
    for (const step of capture.steps) {
      const at = REQUEST_AT + step.t / 1000
      if (step.kind === "audio") scheduledUntil = (scheduledUntil > at ? scheduledUntil : at + BURST_LEAD) + (step.samples ?? 0) / SAMPLE_RATE
      if (step.kind !== "transcript") continue
      const fragment = h.lipsync.transcripts[textIndex++]
      expect(fragment.turnId).toBe(1)
      expect(fragment.receivedAt).toBeCloseTo(at, 9)
      expect(fragment.audioScheduledUntil).toBeCloseTo(scheduledUntil, 9)
    }
    expect(h.lipsync.transcripts.map((fragment) => fragment.text).join("")).toBe(capture.transcript)
    expect(h.output.join("")).toBe(capture.transcript)

    // turnComplete já chegou (texto consolidado), mas ainda há áudio agendado: continua falando.
    expect(h.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(h.states).toEqual(["idle", "listening", "thinking", "speaking"])
    const audioEnd = endOf(h.lipsync.chunks[h.lipsync.chunks.length - 1])
    advanceContext(h.ctx, audioEnd - 0.001)
    expect(h.states.at(-1)).toBe("speaking")
    advanceContext(h.ctx, audioEnd + 0.001)
    expect(h.states).toEqual(["idle", "listening", "thinking", "speaking", "idle"])
  })

  it("barge-in no meio da resposta longa: cala com fade, descarta o resto da geração antiga e aceita a nova", async () => {
    const capture = loadLiveCapture("resposta-longa")
    const h = await connectedHarness()
    await h.transport.startTurn()
    h.transport.endTurn()
    const cut = capture.steps.findIndex((step) => step.t >= 12000)
    await replay(h.socket, h.ctx, capture.steps.slice(0, cut))
    const saidBefore = h.output.join("")
    const chunksBefore = h.lipsync.chunks.length
    const sourcesBefore = h.ctx.sources.length

    const bargeAt = REQUEST_AT + 12.0
    advanceContext(h.ctx, bargeAt)
    await h.transport.bargeIn()
    const stoppedAt = bargeAt + 0.06
    expect(h.lipsync.interrupts).toHaveLength(1)
    expect(h.lipsync.interrupts[0]).toBeCloseTo(stoppedAt, 9)
    const pending = h.ctx.sources.filter((source) => !source.ended)
    expect(pending.length).toBeGreaterThan(0)
    for (const source of pending) expect(source.stoppedAt).toBeCloseTo(stoppedAt, 9)
    expect(h.ctx.gains[1].gain.calls).toContainEqual(["ramp", 0, stoppedAt])
    expect(h.socket.sent.at(-1)).toEqual({ realtimeInput: { activityStart: {} } })
    expect(h.states.at(-1)).toBe("listening")
    expect(h.onTurnComplete).toHaveBeenCalledTimes(1)

    // ~190 ms de geração antiga ainda chegam, depois interrupted + turnComplete (trace ao vivo).
    await replay(h.socket, h.ctx, capture.steps.slice(cut, cut + 12))
    h.socket.receive({ serverContent: { interrupted: true } })
    h.socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(h.lipsync.chunks).toHaveLength(chunksBefore)
    expect(h.ctx.sources).toHaveLength(sourcesBefore)
    expect(h.output.join("")).toBe(saidBefore)
    expect(h.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(h.states.at(-1)).toBe("listening")

    // A resposta ao turno novo é aceita inteira, num turno de áudio novo.
    h.transport.endTurn()
    const next = loadLiveCapture("frase-01-apresentacao")
    const nextRequestAt = h.ctx.currentTime + 0.2
    await replay(h.socket, h.ctx, next.steps, nextRequestAt)
    const newChunks = h.lipsync.chunks.slice(chunksBefore)
    expect(h.lipsync.calls).toContain("begin:2")
    expect(newChunks.every((chunk) => chunk.turnId === 2)).toBe(true)
    expect(newChunks[0].startAt).toBeCloseTo(nextRequestAt + next.steps.find((step) => step.kind === "audio")!.t / 1000 + BURST_LEAD, 9)
    expect(h.output.join("")).toBe(saidBefore + next.transcript)
    advanceContext(h.ctx, endOf(newChunks[newChunks.length - 1]) + 0.001)
    expect(h.states.slice(-3)).toEqual(["thinking", "speaking", "idle"])
    expect(h.onTurnComplete).toHaveBeenCalledTimes(2)
  })
})
