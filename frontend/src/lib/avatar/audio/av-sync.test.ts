// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { AV_OFFSET_LIMIT_MS, FramePresentationEstimator, readAvOffsetMs, resetAvOffsetForTests, setAvOffsetMs } from "./av-sync"
import { createSpeechPlayback } from "./speech-playback"
import { fakeContextFactory } from "./testing/fake-audio-context"

describe("sincronia por aparelho", () => {
  afterEach(() => resetAvOffsetForTests())

  it("guarda o ajuste deste navegador, limitado a ±300 ms, e a reprodução sem ajuste fixo segue ele", () => {
    expect(readAvOffsetMs()).toBe(0)
    const { createContext } = fakeContextFactory()
    const playback = createSpeechPlayback({ createContext })
    playback.prime()
    const before = playback.heardTime(0)!
    setAvOffsetMs(-120)
    expect(readAvOffsetMs()).toBe(-120)
    expect(window.localStorage.getItem("inia.avatar.avOffsetMs")).toBe("-120")
    expect(playback.heardTime(0)! - before).toBeCloseTo(-0.12, 6)
    setAvOffsetMs(10_000)
    expect(readAvOffsetMs()).toBe(AV_OFFSET_LIMIT_MS)
    setAvOffsetMs(0)
    expect(window.localStorage.getItem("inia.avatar.avOffsetMs")).toBeNull()
  })

  it("o ajuste fixo (laboratório) vence o do aparelho", () => {
    setAvOffsetMs(-120)
    const { createContext } = fakeContextFactory()
    const playback = createSpeechPlayback({ createContext, avOffsetMs: 50 })
    playback.prime()
    const fixed = playback.heardTime(0)!
    setAvOffsetMs(200)
    expect(playback.heardTime(0)).toBe(fixed)
  })
})

describe("latência de apresentação", () => {
  it("um intervalo de quadro: 16,7 ms a 60 Hz, 8,3 ms a 120 Hz; pausa da aba não conta; teto de 34 ms", () => {
    const estimator = new FramePresentationEstimator()
    expect(estimator.observe(0)).toBeCloseTo(16.7, 1)
    for (let k = 1; k <= 200; k++) estimator.observe(k * (1000 / 120))
    expect(estimator.leadMs).toBeCloseTo(8.3, 1)
    estimator.observe(200 * (1000 / 120) + 5000)
    expect(estimator.leadMs).toBeCloseTo(8.3, 1)
    let t = 100_000
    for (let k = 0; k < 200; k++) estimator.observe((t += 60))
    expect(estimator.leadMs).toBe(34)
  })
})
