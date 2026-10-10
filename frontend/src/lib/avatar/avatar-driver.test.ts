import { describe, expect, it, vi } from "vitest"

import { createAvatarSpeechDriver } from "./avatar-driver"
import { DEFAULT_AVATAR_TUNING } from "./animation/types"
import type { SpeechFrame, TextTimedLipsync } from "./lipsync/types"
import { createSpeechFrame } from "./lipsync/types"

/** Lip-sync temporizado falso: ativo entre start e end (+100 ms de fechamento) ou até o cancel. */
function fakeTextTimed() {
  let activeUntil = -Infinity
  const calls: string[] = []
  const textTimed: TextTimedLipsync = {
    start: (text, at) => { calls.push(`start:${text}@${at}`); activeUntil = Infinity },
    boundary: (charIndex, at) => { calls.push(`boundary:${charIndex}@${at}`) },
    end: (at) => { calls.push(`end@${at}`); activeUntil = at + 0.1 },
    cancel: (at) => { calls.push(`cancel@${at}`); activeUntil = at },
    isActive: (time) => time < activeUntil,
    sample: (time, out) => { out.speaking = true; out.mouth.jaw = 0.5; out.debugPhone = "a"; out.phraseTime = time },
  }
  return { textTimed, calls }
}

function setup(heard: number | null = 12.5) {
  const text = fakeTextTimed()
  let nowMs = 1000
  const heardTime = vi.fn(() => heard)
  const sample = vi.fn((time: number, out: SpeechFrame) => { out.speaking = true; out.mouth.jaw = 0.3; out.energy = time })
  const driver = createAvatarSpeechDriver({ playback: { heardTime }, lipsync: { sample }, textTimed: text.textTimed, now: () => nowMs })
  return { driver, text, heardTime, sample, setNow: (ms: number) => { nowMs = ms } }
}

describe("createAvatarSpeechDriver", () => {
  it("amostra o lip-sync do áudio no instante ouvido quando o quadro APARECER (um intervalo de quadro depois)", () => {
    const { driver, heardTime, sample } = setup(12.5)
    const out = createSpeechFrame()
    driver.sampleSpeech(out, 5000)
    expect(heardTime).toHaveBeenLastCalledWith(5000)
    // Sem histórico: 60 Hz presumido.
    expect(sample.mock.lastCall?.[0]).toBeCloseTo(12.5 + 1 / 60, 6)
    expect(out.mouth.jaw).toBe(0.3)
    // A 120 Hz a antecipação converge para ~8,3 ms.
    for (let frame = 1; frame <= 120; frame++) driver.sampleSpeech(out, 5000 + frame * (1000 / 120))
    expect(sample.mock.lastCall?.[0]).toBeCloseTo(12.5 + 1 / 120, 3)
  })

  it("sem relógio de áudio (sem contexto) a boca fica em repouso", () => {
    const { driver, sample } = setup(null)
    const out = createSpeechFrame()
    out.speaking = true
    out.mouth.jaw = 0.8
    out.debugPhone = "a"
    driver.sampleSpeech(out, 5000)
    expect(sample).not.toHaveBeenCalled()
    expect(out.speaking).toBe(false)
    expect(out.mouth.jaw).toBe(0)
    expect(out.debugPhone).toBeNull()
  })

  it("durante a despedida usa o lip-sync por texto no relógio performance.now()/1000 e depois volta ao áudio", () => {
    const { driver, text, sample, setNow } = setup(12.5)
    const farewell = driver.startFarewell("Até já!")
    expect(text.calls).toEqual(["start:Até já!@1"])
    setNow(1300)
    farewell.boundary(4)
    expect(text.calls.at(-1)).toBe("boundary:4@1.3")

    const out = createSpeechFrame()
    driver.sampleSpeech(out, 1400)
    expect(out.debugPhone).toBe("a")
    expect(out.phraseTime).toBeCloseTo(1.4)
    expect(sample).not.toHaveBeenCalled()

    setNow(2000)
    farewell.end()
    driver.sampleSpeech(out, 2050)
    expect(sample).not.toHaveBeenCalled()
    driver.sampleSpeech(out, 2200)
    // Volta ao áudio (12,5 s ouvidos) + a antecipação de um quadro.
    expect(sample.mock.lastCall?.[0]).toBeGreaterThan(12.5)
    expect(sample.mock.lastCall?.[0]).toBeLessThan(12.5 + 0.035)
  })

  it("cancelar a despedida devolve a boca ao áudio e handles antigos não mexem na despedida nova", () => {
    const { driver, text, sample } = setup(12.5)
    const first = driver.startFarewell("Tchau")
    const second = driver.startFarewell("Até já!")
    first.cancel()
    first.end()
    expect(text.calls.filter((call) => call.startsWith("cancel") || call.startsWith("end"))).toEqual([])
    second.cancel()
    driver.sampleSpeech(createSpeechFrame(), 1000)
    expect(sample).toHaveBeenCalled()
  })

  it("fila de dicas: drena uma vez, colapsa o nível do microfone e é limitada", () => {
    const { driver } = setup()
    expect(driver.drainCues()).toHaveLength(0)
    expect(driver.drainCues()).toBe(driver.drainCues())
    driver.pushCue({ type: "turn-started" })
    driver.pushCue({ type: "user-level", level: 0.2 })
    driver.pushCue({ type: "user-level", level: 0.6 })
    driver.pushCue({ type: "assistant-text", text: "Parabéns!" })
    expect(driver.drainCues()).toEqual([
      { type: "turn-started" },
      { type: "user-level", level: 0.6 },
      { type: "assistant-text", text: "Parabéns!" },
    ])
    expect(driver.drainCues()).toHaveLength(0)

    for (let i = 0; i < 100; i++) driver.pushCue({ type: "assistant-text", text: String(i) })
    const drained = driver.drainCues()
    expect(drained.length).toBeLessThanOrEqual(32)
    expect(drained.at(-1)).toEqual({ type: "assistant-text", text: "99" })
  })

  it("estado e ajustes: mutáveis no mesmo objeto, limitados a 0..2", () => {
    const { driver } = setup()
    const tuning = driver.tuning
    expect(tuning).toEqual(DEFAULT_AVATAR_TUNING)
    expect(tuning).not.toBe(DEFAULT_AVATAR_TUNING)
    driver.setTuning({ smile: 1.5, gaze: 9, blinkRate: -1, breathing: Number.NaN })
    expect(driver.tuning).toBe(tuning)
    expect(tuning).toMatchObject({ smile: 1.5, gaze: 2, blinkRate: 0, breathing: 1 })

    expect(driver.state).toBe("idle")
    driver.setState("speaking")
    expect(driver.state).toBe("speaking")
  })

  it("dispose cancela a despedida e esvazia as dicas, mas o objeto continua utilizável", () => {
    const { driver, text, sample } = setup(12.5)
    driver.setState("speaking")
    driver.startFarewell("Até já!")
    driver.pushCue({ type: "turn-ended" })
    driver.dispose()
    expect(text.calls.at(-1)).toBe("cancel@1")
    expect(driver.state).toBe("idle")
    expect(driver.drainCues()).toHaveLength(0)
    driver.sampleSpeech(createSpeechFrame(), 1000)
    expect(sample).toHaveBeenCalled()
    driver.pushCue({ type: "turn-started" })
    expect(driver.drainCues()).toHaveLength(1)
  })
})

describe("dicas de texto no instante ouvido", () => {
  it("segura o texto até o áudio correspondente soar e descarta o de uma resposta cortada", () => {
    let heard = 10
    let playing = true
    const playback = { heardTime: () => heard, scheduledUntil: 14, isPlaying: () => playing }
    const scheduleUntil = (value: number) => { playback.scheduledUntil = value }
    const driver = createAvatarSpeechDriver({ playback, lipsync: { sample: () => {} } })
    driver.pushCue({ type: "assistant-text", text: "parabéns pela meta" })
    expect(driver.drainCues()).toEqual([])
    heard = 13.7
    expect(driver.drainCues()).toEqual([{ type: "assistant-text", text: "parabéns pela meta" }])
    // Resposta cortada: o texto "do futuro" nunca soa.
    scheduleUntil(18)
    driver.pushCue({ type: "assistant-text", text: "que bom" })
    playing = false
    expect(driver.drainCues()).toEqual([])
    playing = true
    heard = 20
    expect(driver.drainCues()).toEqual([])
  })
})
