import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduledAudioChunk } from "../lipsync/types"
import { createSpeechPlayback, decodePcm16Base64 } from "./speech-playback"
import { FakeNode, fakeContextFactory } from "./testing/fake-audio-context"
import type { PlaybackTurnEvent, SpeechPlaybackOptions } from "./types"

function setup(options: SpeechPlaybackOptions = {}) {
  const { contexts, createContext } = fakeContextFactory()
  const events: PlaybackTurnEvent[] = []
  const chunks: ScheduledAudioChunk[] = []
  const playback = createSpeechPlayback({
    createContext,
    onTurnEvent: (event) => events.push(event),
    onChunkScheduled: (chunk) => chunks.push(chunk),
    ...options,
  })
  return { playback, contexts, events, chunks, createContext, ctx: () => contexts[contexts.length - 1]! }
}

/** 40 ms de PCM a 24 kHz. */
const chunk40ms = () => new Float32Array(960).fill(0.25)

afterEach(() => {
  vi.useRealTimers()
})

describe("decodePcm16Base64", () => {
  it("decodifica PCM16 little-endian em float −1..1", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40])
    const base64 = btoa(String.fromCharCode(...bytes))
    expect(Array.from(decodePcm16Base64(base64))).toEqual([0, 32767 / 32768, -1, 0.5])
  })
})

describe("createSpeechPlayback", () => {
  it("só cria o AudioContext no prime() e retoma o contexto suspenso", () => {
    const { playback, createContext, ctx } = setup()
    expect(playback.enqueuePcm(chunk40ms(), playback.beginTurn())).toBeNull()
    expect(createContext).not.toHaveBeenCalled()
    expect(playback.heardTime(0)).toBeNull()

    playback.prime()
    playback.prime()
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(createContext).toHaveBeenCalledWith(24000)
    expect(ctx().resume).toHaveBeenCalled()
    expect(playback.context).toBe(ctx())
  })

  it("agenda os chunks colados e avisa o lip-sync DEPOIS do start() (o horário do áudio não depende da análise)", () => {
    const { playback, chunks, ctx } = setup()
    const observed: Array<number | null> = []
    playback.subscribe({ onChunkScheduled: () => observed.push(ctx().sources.at(-1)?.startedAt ?? null) })
    playback.prime()
    ctx().currentTime = 1
    const turn = playback.beginTurn()

    const first = playback.enqueuePcm(chunk40ms(), turn)
    const second = playback.enqueueBase64Pcm16(btoa("\u0000@".repeat(960)), turn)
    // Começo de rajada: 20 ms de folga para o start() nunca cair no passado.
    expect(first?.startAt).toBeCloseTo(1.02)
    expect(second?.startAt).toBeCloseTo(1.06)
    expect(second?.pcm[0]).toBe(0.5)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toMatchObject({ turnId: turn, sampleRate: 24000, receivedAt: 1 })
    // O observador roda depois do start(): a fonte já tem o instante — e ele ainda está no futuro.
    expect(observed).toEqual([first?.startAt, second?.startAt])
    expect(ctx().sources.map((source) => source.startedAt)).toEqual([first?.startAt, second?.startAt])
    expect(playback.scheduledUntil).toBeCloseTo(1.1)

    // Buraco de rede: o próximo chunk começa "agora", não no passado.
    ctx().currentTime = 2
    expect(playback.enqueuePcm(chunk40ms(), turn)?.startAt).toBeCloseTo(2.02)
  })

  it("ignora chunk de turno que não é o corrente", () => {
    const { playback, chunks } = setup()
    playback.prime()
    const old = playback.beginTurn()
    const current = playback.beginTurn()
    expect(playback.currentTurnId).toBe(current)
    expect(playback.enqueuePcm(chunk40ms(), old)).toBeNull()
    expect(playback.enqueueBase64Pcm16(btoa("\u0000@"), old)).toBeNull()
    expect(chunks).toHaveLength(0)
  })

  it("emite turn-started no primeiro chunk e turn-drained só quando a última fonte termina", () => {
    const { playback, events, ctx } = setup()
    playback.prime()
    const turn = playback.beginTurn()
    playback.enqueuePcm(chunk40ms(), turn)
    playback.enqueuePcm(chunk40ms(), turn)
    expect(events).toEqual([{ type: "turn-started", turnId: turn, startAt: 0.02 }])
    expect(playback.isPlaying()).toBe(true)

    ctx().currentTime = 0.06
    ctx().sources[0]!.finish()
    expect(events).toHaveLength(1)
    ctx().currentTime = 0.1
    ctx().sources[1]!.finish()
    expect(events.at(-1)).toEqual({ type: "turn-drained", turnId: turn, endedAt: 0.1 })
    expect(playback.isPlaying()).toBe(false)
  })

  it("espera a latência de saída antes de dizer que o turno terminou de soar", () => {
    vi.useFakeTimers()
    const { playback, events, ctx } = setup()
    playback.prime()
    ctx().outputLatency = 0.2
    ctx().currentTime = 1
    const turn = playback.beginTurn()
    playback.enqueuePcm(chunk40ms(), turn)
    ctx().currentTime = 1.06
    ctx().sources[0]!.finish()
    expect(events.map((event) => event.type)).toEqual(["turn-started"])
    vi.advanceTimersByTime(150)
    expect(events.map((event) => event.type)).toEqual(["turn-started"])
    // Ainda "tocando": o fim já saiu do grafo, mas não chegou ao ouvinte.
    expect(playback.isPlaying()).toBe(true)
    vi.advanceTimersByTime(60)
    expect(events.at(-1)).toMatchObject({ type: "turn-drained", turnId: turn })
    expect(playback.isPlaying()).toBe(false)
  })

  it("observador que interrompe ao receber o chunk: a fonte já agendada é parada junto e o chunk não vale", () => {
    const { playback, ctx } = setup()
    playback.prime()
    ctx().currentTime = 1
    const turn = playback.beginTurn()
    playback.subscribe({ onChunkScheduled: () => void playback.interrupt() })
    expect(playback.enqueuePcm(chunk40ms(), turn)).toBeNull()
    const [source] = ctx().sources
    expect(source!.startedAt).toBeCloseTo(1.02)
    expect(source!.stoppedAt).not.toBeNull()
    expect(playback.isPlaying()).toBe(false)
  })

  it("interrompe com fade, para as fontes no fim do fade e descarta o resto do turno", () => {
    const { playback, events, ctx } = setup({ interruptFadeMs: 60 })
    playback.prime()
    const turn = playback.beginTurn()
    for (let i = 0; i < 10; i++) playback.enqueuePcm(chunk40ms(), turn)
    ctx().currentTime = 0.1

    const stoppedAt = playback.interrupt()
    expect(stoppedAt).toBeCloseTo(0.16)
    const turnGain = ctx().gains[1]!
    expect(turnGain.gain.calls.at(-1)).toEqual(["ramp", 0, stoppedAt])
    expect(ctx().sources.every((source) => source.stoppedAt === stoppedAt)).toBe(true)
    expect(events.at(-1)).toEqual({ type: "turn-interrupted", turnId: turn, stoppedAt })
    expect(playback.isPlaying()).toBe(false)
    expect(playback.scheduledUntil).toBe(stoppedAt)
    expect(playback.enqueuePcm(chunk40ms(), turn)).toBeNull()

    // As fontes terminando depois do stop não viram "turn-drained".
    for (const source of ctx().sources) source.finish()
    expect(events.filter((event) => event.type === "turn-drained")).toHaveLength(0)

    // A próxima resposta nasce com ganho próprio (cheio) e depois do fim do fade.
    const next = playback.beginTurn()
    expect(playback.enqueuePcm(chunk40ms(), next)?.startAt).toBe(stoppedAt)
    expect(ctx().gains).toHaveLength(3)
    expect(ctx().gains[2]!.gain.calls).toHaveLength(0)
  })

  it("interrupt sem áudio agendado cala na hora e sem contexto devolve null", () => {
    const { playback, ctx } = setup()
    expect(playback.interrupt()).toBeNull()
    playback.prime()
    ctx().currentTime = 3
    expect(playback.interrupt()).toBe(3)
  })

  it("relógio ouvido: currentTime − latência de saída, baseLatency como reserva e ajuste manual", () => {
    const { playback, ctx } = setup({ avOffsetMs: 30 })
    playback.prime()
    ctx().currentTime = 2
    expect(playback.heardTime(0)).toBeCloseTo(2.03)
    ctx().baseLatency = 0.01
    expect(playback.heardTime(0)).toBeCloseTo(2.02)
    ctx().outputLatency = 0.1
    expect(playback.heardTime(0)).toBeCloseTo(1.93)
    playback.setAvOffsetMs(-20)
    expect(playback.heardTime(0)).toBeCloseTo(1.88)
  })

  it("relógio ouvido: prefere getOutputTimestamp quando já tem performanceTime", () => {
    const { playback, ctx } = setup()
    playback.prime()
    const context = ctx()
    context.currentTime = 5
    context.outputLatency = 0.3
    context.outputStamp = { contextTime: 4.5, performanceTime: 0 }
    context.getOutputTimestamp = () => context.outputStamp ?? {}
    // performanceTime 0 = contexto ainda não rodou: usa a reserva.
    expect(playback.heardTime(1000)).toBeCloseTo(4.7)
    context.outputStamp = { contextTime: 4.5, performanceTime: 1000 }
    expect(playback.heardTime(1100)).toBeCloseTo(4.6)
    // Extrapolação nunca passa do grafo.
    expect(playback.heardTime(9000)).toBe(5)
  })

  it("close() fecha o contexto e nada recria contexto sem um novo prime()", async () => {
    const { playback, createContext, contexts } = setup()
    playback.prime()
    const turn = playback.beginTurn()
    playback.enqueuePcm(chunk40ms(), turn)
    await playback.close()
    expect(contexts[0]!.close).toHaveBeenCalled()
    expect(playback.context).toBeNull()
    expect(playback.currentTurnId).toBe(0)
    expect(playback.heardTime(0)).toBeNull()
    expect(playback.enqueuePcm(chunk40ms(), turn)).toBeNull()
    expect(playback.enqueuePcm(chunk40ms(), playback.beginTurn())).toBeNull()
    expect(createContext).toHaveBeenCalledTimes(1)

    playback.prime()
    expect(createContext).toHaveBeenCalledTimes(2)
    expect(playback.enqueuePcm(chunk40ms(), playback.beginTurn())).not.toBeNull()
  })

  it("tapOutput liga a saída mestre a um nó extra e devolve o desligamento", () => {
    const { playback, ctx } = setup()
    expect(playback.tapOutput({} as AudioNode)()).toBeUndefined()
    playback.prime()
    const recorder = new FakeNode()
    const untap = playback.tapOutput(recorder as unknown as AudioNode)
    const master = ctx().gains[0]!
    expect(master.outputs.has(recorder)).toBe(true)
    untap()
    expect(master.outputs.has(recorder)).toBe(false)
    expect(master.outputs.has(ctx().destination)).toBe(true)
  })

  it("subscribe devolve o cancelamento", () => {
    const { playback } = setup()
    const seen: PlaybackTurnEvent[] = []
    const unsubscribe = playback.subscribe({ onTurnEvent: (event) => seen.push(event) })
    playback.prime()
    playback.enqueuePcm(chunk40ms(), playback.beginTurn())
    unsubscribe()
    playback.enqueuePcm(chunk40ms(), playback.beginTurn())
    expect(seen).toHaveLength(1)
  })
})
