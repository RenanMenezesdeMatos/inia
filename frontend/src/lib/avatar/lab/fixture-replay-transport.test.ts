import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import { advanceContext, fakeContextFactory, type FakeContext } from "@/lib/avatar/audio/testing/fake-audio-context"
import { FIXTURE_DIR } from "@/lib/avatar/lipsync/__fixtures__/load-fixture"
import type { ScheduledAudioChunk, SpeechLipsyncEngine } from "@/lib/avatar/lipsync/types"
import { GeminiRealtimeTransport } from "@/lib/realtime/gemini-realtime-transport"
import { buildCaptureSteps, shiftToFastStart, wavDataBytes, type CaptureFixtureJson } from "./capture-steps"
import { FixtureReplaySocket, type ReplayClock, type ReplayScript } from "./fixture-replay-socket"
import { FIXTURE_SESSION } from "./voice-rig"

// O laboratório de ponta a ponta sem navegador: transporte de PRODUÇÃO + reprodução de produção
// (sobre um AudioContext falso com o relógio andando junto com os timers falsos) + o servidor falso
// reproduzindo capturas REAIS. Confere o que importa para o avatar: o lip-sync recebe a resposta,
// o barge-in descarta o que ainda chega da geração antiga e a próxima captura é aceita.

const clock: ReplayClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function realScript(id: string, fast = false): ReplayScript {
  const json = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${id}.json`), "utf8")) as CaptureFixtureJson
  const file = readFileSync(path.join(FIXTURE_DIR, `${id}.wav`))
  const steps = buildCaptureSteps(json, wavDataBytes(new Uint8Array(file.buffer, file.byteOffset, file.byteLength)))
  return { id, steps: fast ? shiftToFastStart(steps) : steps }
}

function recordingLipsync() {
  const chunks: ScheduledAudioChunk[] = []
  const interrupts: number[] = []
  const engine: SpeechLipsyncEngine = {
    beginTurn: () => {},
    pushAudio: (chunk) => {
      chunks.push(chunk)
    },
    pushTranscript: () => {},
    endOfText: () => {},
    interrupt: (atTime) => {
      interrupts.push(atTime)
    },
    reset: () => {},
    sample: () => {},
    debugSnapshot: () => ({ turnId: null, phones: [], frames: [], analyzedUntil: 0, alignedUntil: 0, pendingWords: 0, minLookahead: null }),
  }
  return { engine, chunks, interrupts }
}

async function labHarness(scripts: ReplayScript[]) {
  const queue = [...scripts]
  const factory = fakeContextFactory()
  const playback = createSpeechPlayback({ createContext: factory.createContext })
  const lipsync = recordingLipsync()
  const states: string[] = []
  const sockets: FixtureReplaySocket[] = []
  const transport = new GeminiRealtimeTransport(
    { onStateChange: (state) => states.push(state) },
    {
      playback,
      lipsync: lipsync.engine,
      fetchSession: async () => FIXTURE_SESSION,
      startCapture: async () => ({ context: { state: "running" } as AudioContext, stop: () => {} }),
      createSocket: (url) => {
        const socket = new FixtureReplaySocket(url, { nextScript: () => queue.shift() ?? null, clock })
        sockets.push(socket)
        return socket.asWebSocket()
      },
    },
  )
  transport.primeAudioPlayback()
  const ctx: FakeContext = factory.contexts[0]
  const startedAt = Date.now()
  // Relógio do AudioContext andando junto com os timers falsos (passos de 10 ms).
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10)
      advanceContext(ctx, (Date.now() - startedAt) / 1000)
    }
  }
  const connecting = transport.connect()
  await advance(50)
  await connecting
  return { transport, sockets, ctx, lipsync, states, advance }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("laboratório: transporte de produção + servidor falso com capturas reais", () => {
  it("responde a um turno de texto com a captura inteira e volta a 'idle' quando o áudio termina", async () => {
    const script = realScript("frase-01-apresentacao", true)
    const { transport, sockets, lipsync, states, advance } = await labHarness([script])
    expect(transport.isConnected).toBe(true)
    transport.sendText("Diga a frase 1")
    expect(sockets[0].sent.some((message) => (message.realtimeInput as Record<string, unknown> | undefined)?.text === "Diga a frase 1")).toBe(true)
    await advance(9000)
    const audioSteps = script.steps.filter((step) => step.kind === "audio")
    expect(lipsync.chunks).toHaveLength(audioSteps.length)
    expect(states).toContain("speaking")
    expect(states.at(-1)).toBe("idle")
  })

  it("barge-in no meio da fala: descarta a geração antiga em voo e aceita a próxima captura no activityEnd", async () => {
    const first = realScript("resposta-longa", true)
    const second = realScript("frase-02-proposta", true)
    const { transport, sockets, lipsync, states, advance } = await labHarness([first, second])
    transport.sendText("Explique")
    await advance(3000)
    expect(states.at(-1)).toBe("speaking")
    const firstTurn = lipsync.chunks[0].turnId
    const chunksBefore = lipsync.chunks.length
    // O servidor falso ainda tem conteúdo da resposta longa a mandar (a geração vai até ~17 s).
    expect(sockets[0].replaying).toBe("resposta-longa")

    await transport.bargeIn()
    // O do turno de texto e o do barge-in.
    expect(sockets[0].sent.filter((message) => (message.realtimeInput as Record<string, unknown> | undefined)?.activityStart)).toHaveLength(2)
    expect(lipsync.interrupts).toHaveLength(1)
    await advance(1000)
    // As 2 mensagens em voo chegaram, mas nenhum áudio da geração antiga foi agendado.
    expect(lipsync.chunks).toHaveLength(chunksBefore)
    expect(states.at(-1)).toBe("listening")

    transport.endTurn()
    await advance(8000)
    const newChunks = lipsync.chunks.slice(chunksBefore)
    expect(newChunks.length).toBe(second.steps.filter((step) => step.kind === "audio").length)
    expect(newChunks.every((chunk) => chunk.turnId !== firstTurn)).toBe(true)
    expect(states.slice(-2)).toEqual(["speaking", "idle"])
  })
})
