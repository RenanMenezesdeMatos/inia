import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GeminiServerMessage } from "@/lib/realtime/gemini-live-protocol"
import type { CaptureStep } from "./capture-steps"
import { FixtureReplaySocket, type FixtureReplayEvent, type ReplayClock, type ReplayScript } from "./fixture-replay-socket"

// Relógio dos timers falsos do Vitest (Date.now também é falso) — o agendamento do servidor falso é
// conferido ao milissegundo, sem esperar tempo de verdade.
const clock: ReplayClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const audio = (t: number, tag: string): CaptureStep => ({
  t,
  kind: "audio",
  samples: 960,
  message: { serverContent: { modelTurn: { parts: [{ inlineData: { data: tag, mimeType: "audio/pcm;rate=24000" } }] } } },
})
const text = (t: number, value: string): CaptureStep => ({ t, kind: "transcript", message: { serverContent: { outputTranscription: { text: value } } } })
const generationComplete = (t: number): CaptureStep => ({ t, kind: "generationComplete", message: { serverContent: { generationComplete: true } } })
const turnComplete = (t: number): CaptureStep => ({ t, kind: "turnComplete", message: { serverContent: { turnComplete: true } } })

const SCRIPT_A: ReplayScript = {
  id: "a",
  steps: [text(100, "Olá"), audio(120, "a1"), audio(200, "a2"), text(220, " tudo"), audio(400, "a3"), audio(600, "a4"), generationComplete(700), turnComplete(900)],
}
const SCRIPT_B: ReplayScript = { id: "b", steps: [audio(50, "b1"), generationComplete(60), turnComplete(80)] }

type Received = { at: number; message: Record<string, unknown> }

function harness(scripts: ReplayScript[]) {
  const queue = [...scripts]
  const events: FixtureReplayEvent[] = []
  const socket = new FixtureReplaySocket("wss://lab", { nextScript: () => queue.shift() ?? null, clock, onEvent: (event) => events.push(event) })
  const received: Received[] = []
  const start = Date.now()
  socket.addEventListener("message", (event) => {
    received.push({ at: Date.now() - start, message: JSON.parse((event as MessageEvent).data as string) as Record<string, unknown> })
  })
  return { socket, received, events, start }
}

/** Rótulo curto de cada mensagem do servidor, para comparar sequências. */
function label(message: Record<string, unknown>): string {
  if ("setupComplete" in message) return "setupComplete"
  const content = (message as GeminiServerMessage).serverContent ?? {}
  const data = content.modelTurn?.parts?.[0]?.inlineData?.data
  if (data) return `audio:${data}`
  if (content.outputTranscription) return `text:${content.outputTranscription.text}`
  return Object.keys(content)[0]
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("FixtureReplaySocket — sessão", () => {
  it("abre sozinho e responde ao setup com setupComplete", async () => {
    const { socket, received } = harness([])
    const opened = vi.fn()
    socket.addEventListener("open", opened)
    expect(socket.readyState).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).toHaveBeenCalledOnce()
    socket.send(JSON.stringify({ setup: { model: "x" } }))
    await vi.advanceTimersByTimeAsync(19)
    expect(received).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(received.map((entry) => label(entry.message))).toEqual(["setupComplete"])
  })

  it("ignora o áudio do microfone e não o acumula no diagnóstico", async () => {
    const { socket, received } = harness([SCRIPT_A])
    await vi.advanceTimersByTimeAsync(0)
    socket.send(JSON.stringify({ realtimeInput: { audio: { data: "AAAA", mimeType: "audio/pcm;rate=16000" } } }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(received).toHaveLength(0)
    expect(socket.sent).toHaveLength(0)
  })
})

async function openAndSetUp(socket: FixtureReplaySocket, received: Received[]) {
  await vi.advanceTimersByTimeAsync(0)
  socket.send(JSON.stringify({ setup: {} }))
  await vi.advanceTimersByTimeAsync(20)
  received.length = 0
}

const TEXT_TURN = JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "oi" }] }], turnComplete: true } })
const ACTIVITY_START = JSON.stringify({ realtimeInput: { activityStart: {} } })
const ACTIVITY_END = JSON.stringify({ realtimeInput: { activityEnd: {} } })

describe("FixtureReplaySocket — reprodução", () => {
  it("responde a um turno de texto com a captura nos instantes relativos gravados", async () => {
    const { socket, received, events, start } = harness([SCRIPT_A])
    await openAndSetUp(socket, received)
    const sentAt = Date.now() - start
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(1000)
    expect(received.map((entry) => label(entry.message))).toEqual(["text:Olá", "audio:a1", "audio:a2", "text: tudo", "audio:a3", "audio:a4", "generationComplete", "turnComplete"])
    // Instantes desde o envio do turno = os `t` da captura.
    expect(received.map((entry) => entry.at - sentAt)).toEqual([100, 120, 200, 220, 400, 600, 700, 900])
    expect(events.filter((event) => event.type !== "setup").map((event) => event.type)).toEqual(["replay-started", "replay-finished"])
  })

  it("activityEnd (fim da fala do usuário) também dispara a resposta", async () => {
    const { socket, received, events } = harness([SCRIPT_B])
    await openAndSetUp(socket, received)
    socket.send(ACTIVITY_START)
    socket.send(ACTIVITY_END)
    await vi.advanceTimersByTimeAsync(100)
    expect(received.map((entry) => label(entry.message))).toEqual(["audio:b1", "generationComplete", "turnComplete"])
    expect(events).toContainEqual({ type: "replay-started", scriptId: "b", trigger: "activityEnd" })
  })

  it("turno de texto do transporte (activityStart → text → activityEnd) dispara a resposta como texto", async () => {
    const { socket, received, events } = harness([SCRIPT_B])
    await openAndSetUp(socket, received)
    socket.send(ACTIVITY_START)
    socket.send(JSON.stringify({ realtimeInput: { text: "oi" } }))
    socket.send(ACTIVITY_END)
    await vi.advanceTimersByTimeAsync(100)
    expect(received.map((entry) => label(entry.message))).toEqual(["audio:b1", "generationComplete", "turnComplete"])
    expect(events).toContainEqual({ type: "replay-started", scriptId: "b", trigger: "text" })
  })

  it("sem script: fecha o turno com turnComplete (o transporte não fica preso em 'pensando')", async () => {
    const { socket, received, events } = harness([])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(10)
    expect(received.map((entry) => label(entry.message))).toEqual(["turnComplete"])
    expect(events).toContainEqual({ type: "no-script", trigger: "text" })
  })

  it("fechar cancela tudo o que ainda ia chegar", async () => {
    const { socket, received } = harness([SCRIPT_A])
    await openAndSetUp(socket, received)
    const closed = vi.fn()
    socket.addEventListener("close", closed)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(150)
    socket.close()
    socket.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(received.map((entry) => label(entry.message))).toEqual(["text:Olá", "audio:a1"])
    expect(closed).toHaveBeenCalledOnce()
    expect(socket.readyState).toBe(3)
  })
})

describe("FixtureReplaySocket — barge-in (activityStart no meio da resposta)", () => {
  it("ainda entrega 2 mensagens em voo em ~150 ms e depois interrupted + turnComplete em 190 ms; o resto some", async () => {
    const { socket, received, events, start } = harness([SCRIPT_A])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(150)
    expect(received.map((entry) => label(entry.message))).toEqual(["text:Olá", "audio:a1"])
    const bargeAt = Date.now() - start
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(5000)
    const after = received.slice(2).map((entry) => [entry.at - bargeAt, label(entry.message)])
    expect(after).toEqual([
      [50, "audio:a2"],
      [100, "text: tudo"],
      [190, "interrupted"],
      [190, "turnComplete"],
    ])
    expect(events).toContainEqual({ type: "barge-in", scriptId: "a", inFlight: 2, serverInterrupt: true })
  })

  it("o próximo activityEnd reproduz o PRÓXIMO script", async () => {
    const { socket, received } = harness([SCRIPT_A, SCRIPT_B])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(150)
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(800)
    received.length = 0
    socket.send(ACTIVITY_END)
    await vi.advanceTimersByTimeAsync(200)
    expect(received.map((entry) => label(entry.message))).toEqual(["audio:b1", "generationComplete", "turnComplete"])
  })

  it("activityEnd antes do interrupted: o servidor fecha a geração antiga ANTES de responder", async () => {
    const { socket, received } = harness([SCRIPT_A, SCRIPT_B])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(150)
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(60)
    socket.send(ACTIVITY_END)
    await vi.advanceTimersByTimeAsync(2000)
    expect(received.slice(2).map((entry) => label(entry.message))).toEqual([
      "audio:a2",
      "text: tudo",
      "interrupted",
      "turnComplete",
      "audio:b1",
      "generationComplete",
      "turnComplete",
    ])
  })

  it("depois do generationComplete não há nada em voo, mas o turno aberto ainda é interrompido", async () => {
    const { socket, received, events } = harness([SCRIPT_A])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(750)
    received.length = 0
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(1000)
    expect(received.map((entry) => label(entry.message))).toEqual(["interrupted", "turnComplete"])
    expect(events).toContainEqual({ type: "barge-in", scriptId: "a", inFlight: 0, serverInterrupt: true })
  })

  it("com a resposta já encerrada (turnComplete) o activityStart não gera mensagem nenhuma", async () => {
    const { socket, received, events } = harness([SCRIPT_B])
    await openAndSetUp(socket, received)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(500)
    received.length = 0
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(1000)
    expect(received).toHaveLength(0)
    expect(events).toContainEqual({ type: "barge-in", scriptId: null, inFlight: 0, serverInterrupt: false })
  })

  it("respeita a configuração (1 mensagem em voo, interrupted em 250 ms)", async () => {
    const queue = [SCRIPT_A]
    const socket = new FixtureReplaySocket("wss://lab", { nextScript: () => queue.shift() ?? null, clock, bargeIn: { inFlightMessages: 1, inFlightWindowMs: 100, interruptAfterMs: 250 } })
    const names: Array<[number, string]> = []
    let bargeAt = 0
    socket.addEventListener("message", (event) => {
      names.push([Date.now() - bargeAt, label(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>)])
    })
    await vi.advanceTimersByTimeAsync(0)
    socket.send(TEXT_TURN)
    await vi.advanceTimersByTimeAsync(150)
    names.length = 0
    bargeAt = Date.now()
    socket.send(ACTIVITY_START)
    await vi.advanceTimersByTimeAsync(1000)
    expect(names).toEqual([
      [50, "audio:a2"],
      [250, "interrupted"],
      [250, "turnComplete"],
    ])
  })
})
