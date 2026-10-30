import { describe, expect, it } from "vitest"

import { advanceContext, fakeContextFactory } from "../audio/testing/fake-audio-context"
import { createSpeechPlayback } from "../audio/speech-playback"
import { AvClapper, CLAP_PERIOD_SECONDS, FLASH_SECONDS, createClickPcm, flashActive } from "./av-clapper"

describe("teste de claque", () => {
  it("clique com ataque imediato e silêncio no resto do período", () => {
    const pcm = createClickPcm(24000)
    expect(pcm.length).toBe(24000)
    expect(Math.abs(pcm[0]!) + Math.abs(pcm[1]!) + Math.abs(pcm[2]!)).toBeGreaterThan(0.1)
    expect(pcm.slice(400).every((x) => x === 0)).toBe(true)
  })

  it("flash só durante FLASH_SECONDS depois de cada clique", () => {
    const clicks = [1, 2, 3]
    expect(flashActive(0.99, clicks)).toBe(false)
    expect(flashActive(1, clicks)).toBe(true)
    expect(flashActive(1 + FLASH_SECONDS - 1e-6, clicks)).toBe(true)
    expect(flashActive(1 + FLASH_SECONDS, clicks)).toBe(false)
    expect(flashActive(2.01, clicks)).toBe(true)
  })

  it("agenda cliques colados de 1 s na reprodução da INIA e pisca no instante ouvido do quadro que vai aparecer", () => {
    const { createContext, current } = fakeContextFactory()
    const playback = createSpeechPlayback({ createContext, avOffsetMs: 0 })
    const clapper = new AvClapper(playback)
    clapper.start(5)
    const clicks = clapper.state.clicks
    expect(clicks).toHaveLength(5)
    for (let k = 1; k < clicks.length; k++) expect(clicks[k]! - clicks[k - 1]!).toBeCloseTo(CLAP_PERIOD_SECONDS, 6)
    // Relógio do contexto em 1 quadro antes do 1º clique: o flash já acende (a imagem sai no próximo vsync).
    const context = current()
    advanceContext(context, clicks[0]! - 0.01)
    expect(clapper.frame(1000)).toBe(true)
    advanceContext(context, clicks[0]! + FLASH_SECONDS + 0.02)
    expect(clapper.frame(1000 + 1000 / 60)).toBe(false)
  })
})
