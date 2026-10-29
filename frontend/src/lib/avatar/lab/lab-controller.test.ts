import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { advanceContext, fakeContextFactory } from "@/lib/avatar/audio/testing/fake-audio-context"
import { FIXTURE_DIR } from "@/lib/avatar/lipsync/__fixtures__/load-fixture"
import { createSpeechFrame } from "@/lib/avatar/lipsync/types"
import { FixtureStore } from "./fixture-store"
import { AvatarLabController } from "./lab-controller"
import type { ReplayClock } from "./fixture-replay-socket"

// O controlador do laboratório com os motores de produção de verdade (transporte, reprodução,
// lip-sync, driver) sobre um AudioContext falso e timers falsos; as capturas vêm do disco pela mesma
// URL que a rota de desenvolvimento serve.

const clock: ReplayClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const diskFetch = (async (input: RequestInfo | URL) => {
  const name = String(input).split("/").pop() ?? ""
  const bytes = readFileSync(path.join(FIXTURE_DIR, name))
  return new Response(new Uint8Array(bytes), { status: 200 })
}) as typeof fetch

function setup() {
  const factory = fakeContextFactory()
  const controller = new AvatarLabController({ store: new FixtureStore(diskFetch), createContext: factory.createContext, replayClock: clock })
  const startedAt = Date.now()
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10)
      for (const context of factory.contexts) advanceContext(context, (Date.now() - startedAt) / 1000)
    }
  }
  const logText = () => controller.getSnapshot().log.map((entry) => entry.text)
  return { controller, factory, advance, logText }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("AvatarLabController", () => {
  it("Play fala a captura escolhida pelo motor de produção e o avatar lê a boca pelo driver estável", async () => {
    const { controller, advance, logText } = setup()
    const driver = controller.driver
    controller.setTiming("fast")
    controller.selectFixture("frase-05-labiais")
    controller.play()
    await advance(1500)
    expect(controller.getSnapshot().state).toBe("speaking")
    expect(controller.getSnapshot().assistantText.length).toBeGreaterThan(0)
    expect(logText().some((text) => text.includes("reproduzindo frase-05-labiais (texto)"))).toBe(true)
    // O driver do avatar (proxy) lê a fala no instante ouvido.
    let opened = 0
    for (let i = 0; i < 40; i++) {
      await advance(50)
      const frame = createSpeechFrame()
      driver.sampleSpeech(frame, performance.now())
      opened = Math.max(opened, frame.mouth.jaw)
    }
    expect(opened).toBeGreaterThan(0.05)
    expect(controller.driver).toBe(driver)
    await advance(8000)
    expect(controller.getSnapshot().state).toBe("idle")
    controller.dispose()
  })

  it("sequência: frase → barge-in → próxima frase, e termina ocioso", async () => {
    const { controller, advance, logText } = setup()
    controller.setTiming("fast")
    controller.runSequence("frase-01-apresentacao", "frase-03-escolha", { interruptAtMs: 800, record: false })
    expect(controller.getSnapshot().sequenceRunning).toBe(true)
    await advance(20000)
    const log = logText()
    expect(log.some((text) => text.startsWith("barge-in em"))).toBe(true)
    expect(log.some((text) => text.includes("em voo, depois interrupted + turnComplete"))).toBe(true)
    expect(log.some((text) => text.includes("reproduzindo frase-03-escolha (activityEnd)"))).toBe(true)
    expect(log).toContain("sequência concluída")
    const snapshot = controller.getSnapshot()
    expect(snapshot.sequenceRunning).toBe(false)
    expect(snapshot.state).toBe("idle")
    const sent = controller.rig.socket?.sent.map((message) => Object.keys((message.realtimeInput as object | undefined) ?? message)[0])
    expect(sent).toEqual(["setup", "activityStart", "text", "activityEnd", "activityStart", "activityEnd"])
    controller.dispose()
  })

  it("sobreposição de estado só vale fora da fala; parar a sequência cancela o resto", async () => {
    const { controller, advance, logText } = setup()
    controller.setOverride("thinking")
    expect(controller.driver.state).toBe("thinking")
    expect(controller.getSnapshot().overrideState).toBe("thinking")
    controller.setTiming("fast")
    controller.runSequence("frase-02-proposta", "frase-04-amanha", { interruptAtMs: 500, record: false })
    // Play/sequência voltam ao automático.
    expect(controller.driver.state).toBe("idle")
    await advance(400)
    expect(controller.getSnapshot().state).toBe("speaking")
    controller.stopSequence()
    await advance(50)
    expect(controller.getSnapshot().sequenceRunning).toBe(false)
    controller.setOverride("listening")
    expect(controller.driver.state).toBe("speaking")
    controller.cancelResponse()
    await advance(2000)
    expect(controller.getSnapshot().state).toBe("idle")
    expect(controller.driver.state).toBe("listening")
    // A interrupção programada da sequência nunca aconteceu.
    expect(logText().some((text) => text.startsWith("barge-in em"))).toBe(false)
    controller.dispose()
  })
})
