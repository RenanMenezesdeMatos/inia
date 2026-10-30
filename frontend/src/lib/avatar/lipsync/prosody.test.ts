import { describe, expect, it } from "vitest"

import { AudioFeatureExtractor } from "./audio-features"
import { accentShapeOf, MAX_DEVIATION_SEMITONES, ProsodyTracker } from "./prosody"

const RATE = 24000

/** Trem de pulsos glotais filtrado (rico em harmônicos, como voz) com F0 variando por `f0(t)`. */
function voice(seconds: number, f0: (t: number) => number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * RATE))
  let phase = 0
  let y1 = 0
  let y2 = 0
  for (let n = 0; n < pcm.length; n++) {
    const t = n / RATE
    phase += f0(t) / RATE
    let pulse = 0
    if (phase >= 1) {
      phase -= 1
      pulse = 1
    }
    // Ressonância em ~700 Hz (formante) para o sinal não ser um trem de impulsos puro.
    const w = (2 * Math.PI * 700) / RATE
    const r = 0.97
    const y = pulse + 2 * r * Math.cos(w) * y1 - r * r * y2
    y2 = y1
    y1 = y
    pcm[n] = 0.05 * y
  }
  return pcm
}

function analyze(pcm: Float32Array): { extractor: AudioFeatureExtractor; prosody: ProsodyTracker } {
  const extractor = new AudioFeatureExtractor()
  const prosody = new ProsodyTracker(extractor.store)
  // Em chunks de 40 ms, como o Live entrega.
  const chunk = Math.round(0.04 * RATE)
  for (let start = 0; start < pcm.length; start += chunk) {
    extractor.push(pcm.subarray(start, Math.min(pcm.length, start + chunk)), 5 + start / RATE, RATE)
    prosody.update()
  }
  extractor.flush()
  prosody.update()
  return { extractor, prosody }
}

describe("F0 e proeminência tonal", () => {
  it.each([120, 180, 240, 320])("F0 de %i Hz medido a ±3%% (sem erro de oitava)", (hz) => {
    const { extractor } = analyze(voice(0.6, () => hz))
    const store = extractor.store
    const values: number[] = []
    for (let f = 5; f < store.count - 5; f++) if (store.f0Hz[f]! > 0) values.push(store.f0Hz[f]!)
    expect(values.length).toBeGreaterThan(30)
    values.sort((a, b) => a - b)
    const median = values[Math.floor(values.length / 2)]!
    expect(Math.abs(median / hz - 1)).toBeLessThan(0.03)
    // Nenhum quadro na oitava de baixo ou de cima.
    expect(values.filter((value) => Math.abs(12 * Math.log2(value / hz)) > 6)).toEqual([])
  })

  it("silêncio não tem F0", () => {
    const { extractor } = analyze(new Float32Array(Math.round(0.3 * RATE)))
    expect(Array.from(extractor.store.f0Hz.subarray(0, extractor.store.count)).every((value) => value === 0)).toBe(true)
  })

  it("subida de 6 semitons numa sílaba vira proeminência ≈ 6; tom plano, ≈ 0", () => {
    // 0–1 s em 200 Hz; 1,0–1,15 s sobe 6 semitons e volta; resto plano.
    const contour = (t: number) => (t >= 1 && t < 1.15 ? 200 * Math.pow(2, (6 / 12) * Math.sin((Math.PI * (t - 1)) / 0.15)) : 200)
    const { prosody } = analyze(voice(2.2, contour))
    const accent = prosody.prominence(5 + 1.02, 5 + 1.12)
    const flat = prosody.prominence(5 + 1.7, 5 + 1.8)
    expect(accent).toBeGreaterThan(4)
    expect(accent).toBeLessThan(8)
    expect(flat).toBeLessThan(1)
  })

  it("quadros longe demais da mediana da voz (crepitância/oitava) ficam fora", () => {
    const { extractor, prosody } = analyze(voice(1.2, (t) => (t < 1 ? 220 : 70)))
    const store = extractor.store
    const late = store.lowerBound(5 + 1.1)
    expect(Number.isNaN(prosody.relativeAt(late)) || Math.abs(prosody.relativeAt(late)) <= MAX_DEVIATION_SEMITONES).toBe(true)
    expect(prosody.relativeAt(store.lowerBound(5 + 0.5))).toBeCloseTo(0, 0)
  })

  describe("direção do acento (subida / queda / pico)", () => {
    // Tônica em 1,00–1,15 s; a janela vai de 60 ms antes do ataque a 150 ms depois da vogal.
    const st = (semitones: number) => 200 * Math.pow(2, semitones / 12)
    const ramp = (t: number, from: number, to: number) => Math.max(0, Math.min(1, (t - from) / (to - from)))
    const directionOf = (contour: (t: number) => number) => analyze(voice(2.2, contour)).prosody.direction(5 + 1, 5 + 1.15)

    it("subida (L+H*: baixo no ataque, pico na pós-tônica) → perto de +1", () => {
      const direction = directionOf((t) => st(6 * ramp(t, 1, 1.25)))
      expect(direction).toBeGreaterThan(0.7)
      expect(accentShapeOf(direction)).toBe("rise")
    })

    it("queda (H+L*: alto no ataque, cai na tônica — o nuclear declarativo) → perto de −1", () => {
      const direction = directionOf((t) => st(6 * (1 - ramp(t, 1, 1.15))))
      expect(direction).toBeLessThan(-0.7)
      expect(accentShapeOf(direction)).toBe("fall")
    })

    it("pico (sobe e volta dentro da janela) e tom plano → perto de 0", () => {
      const peak = directionOf((t) => st(t < 1.075 ? 6 * ramp(t, 1, 1.075) : 6 * (1 - ramp(t, 1.075, 1.15))))
      expect(Math.abs(peak)).toBeLessThan(0.35)
      expect(accentShapeOf(peak)).toBe("peak")
      expect(Math.abs(directionOf(() => 200))).toBeLessThan(0.2)
    })

    it("a mesma subida pequena (2 st) não vira subida cheia: faixa mínima de 3 st no denominador", () => {
      const small = directionOf((t) => st(2 * ramp(t, 1, 1.25)))
      expect(small).toBeGreaterThan(0.3)
      expect(small).toBeLessThan(0.8)
    })

    it("sem F0 na janela → 0 (o acento fica neutro, nunca chuta uma direção)", () => {
      const pcm = voice(2.2, () => 200)
      pcm.fill(0, Math.round(0.9 * RATE), Math.round(1.4 * RATE))
      expect(analyze(pcm).prosody.direction(5 + 1, 5 + 1.15)).toBe(0)
    })
  })
})
