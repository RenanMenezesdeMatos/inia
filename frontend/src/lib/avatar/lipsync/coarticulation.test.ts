import { describe, expect, it } from "vitest"

import { ARTICULATION, MAX_JAW } from "./articulation"
import { createMouthTimeline } from "./coarticulation"
import type { AlignedPhone, MouthChannels, PhoneSymbol } from "./types"
import { REST_MOUTH } from "./types"

/** Sequência de fones colados a partir de `t0`: [símbolo, duração em ms, tônica?]. */
function phones(spec: Array<[PhoneSymbol, number, boolean?]>, t0 = 10): AlignedPhone[] {
  let t = t0
  return spec.map(([phone, ms, stressed]) => {
    const start = t
    t += ms / 1000
    const vowel = !["_", "p", "b", "m", "s", "z", "t", "d", "n", "l", "r", "f", "v", "k", "g"].includes(phone)
    return { phone, start, end: t, stressed: stressed ?? false, nucleus: vowel && phone !== "_", wordIndex: 0, source: "aligned", loudness: 0.6 }
  })
}

function sampleAt(list: AlignedPhone[], t: number): MouthChannels {
  const out = { ...REST_MOUTH }
  createMouthTimeline(list).sample(t, out)
  return out
}

const center = (phone: AlignedPhone) => (phone.start + phone.end) / 2

describe("linha do tempo da boca: metas por fone + trajetória com limite de velocidade", () => {
  it("vogal longa chega à meta e a segura num platô; a sibilante entre vogais fecha bem (≤ 30% da vogal)", () => {
    const list = phones([["_", 200], ["s", 90], ["a", 220, true], ["s", 90], ["a", 220], ["_", 300]])
    const timeline = createMouthTimeline(list)
    const out = { ...REST_MOUTH }
    const a = list[2]!
    // Meta do "a" (com a escala de loudness/tônica), mantida em boa parte do intervalo.
    timeline.sample(center(a), out)
    const plateau = out.jaw
    expect(plateau).toBeGreaterThan(0.5)
    timeline.sample(a.start + 0.05, out)
    expect(out.jaw).toBeGreaterThan(0.9 * plateau)
    // A vogal tônica pede 0,66 e o [s] 0,08: em 90 ms o limite de velocidade faz os dois cederem um
    // pouco (undershoot proposital) — a sibilante ainda fecha a boca a menos de 1/3 da vogal.
    timeline.sample(center(list[3]!), out)
    expect(out.jaw).toBeLessThanOrEqual(0.3 * plateau)
    expect(out.jaw).toBeGreaterThanOrEqual(ARTICULATION.s.target.jaw ?? 0)
  })

  it("undershoot pela taxa: a mesma sílaba abre menos quando é curta (fala rápida)", () => {
    const peak = (vowelMs: number, consonantMs: number) => {
      const list = phones([["_", 200], ["s", consonantMs], ["a", vowelMs], ["s", consonantMs], ["_", 200]])
      return sampleAt(list, center(list[2]!)).jaw
    }
    const slow = peak(200, 90)
    const fast = peak(45, 45)
    expect(fast).toBeLessThan(0.8 * slow)
    expect(fast).toBeGreaterThan(0.15)
  })

  it("nunca passa de 9/s na mandíbula, mesmo alternando extremos depressa", () => {
    const spec: Array<[PhoneSymbol, number]> = [["_", 150]]
    for (let k = 0; k < 12; k++) spec.push(["s", 35 + (k % 3) * 10], ["a", 40 + (k % 4) * 15])
    spec.push(["_", 200])
    const list = phones(spec)
    const timeline = createMouthTimeline(list)
    const out = { ...REST_MOUTH }
    let previous = -1
    let maxVelocity = 0
    for (let t = list[0]!.start; t <= list[list.length - 1]!.end; t += 0.002) {
      timeline.sample(t, out)
      if (previous >= 0) maxVelocity = Math.max(maxVelocity, Math.abs(out.jaw - previous) / 0.002)
      previous = out.jaw
      expect(out.jaw).toBeGreaterThanOrEqual(0)
      expect(out.jaw).toBeLessThanOrEqual(MAX_JAW)
    }
    expect(maxVelocity).toBeLessThanOrEqual(9 * 1.02)
  })

  it("tepe é transparente para a mandíbula (não 'mastiga' entre duas vogais abertas)", () => {
    const list = phones([["_", 200], ["p", 70], ["a", 120, true], ["r", 30], ["a", 120], ["_", 200]])
    const tap = sampleAt(list, center(list[3]!)).jaw
    const vowel = sampleAt(list, center(list[2]!)).jaw
    expect(tap).toBeGreaterThan(0.8 * vowel)
  })

  it("vogal não arredondada desarredonda: o 'u' vizinho não vaza bico no 'a'/'i'", () => {
    // Pior caso: "u" logo antes e logo depois (o arredondamento antecipatório do "u" final é real,
    // mas a vogal não arredondada segura o canal). Nas capturas reais a média fica ≤ 0,08.
    const list = phones([["_", 200], ["d", 60], ["u", 90], ["d", 60], ["a", 110, true], ["d", 60], ["i", 90], ["d", 60], ["u", 90], ["_", 200]])
    for (const vowel of [list[4]!, list[6]!]) {
      const out = sampleAt(list, center(vowel))
      expect(Math.max(out.round, out.pucker)).toBeLessThanOrEqual(0.12)
    }
    const u = sampleAt(list, center(list[2]!))
    expect(u.pucker).toBeGreaterThan(0.6)
  })

  it("pausa longa: a boca descansa no miolo e a fala ainda termina aberta", () => {
    const list = phones([["_", 150], ["m", 60], ["a", 160, true], ["_", 500], ["s", 90], ["a", 150], ["_", 300]])
    const pause = list[3]!
    for (let t = pause.start + 0.12; t <= pause.end - 0.12; t += 0.01) expect(sampleAt(list, t).jaw).toBeLessThan(0.02)
    expect(sampleAt(list, list[2]!.end - 0.02).jaw).toBeGreaterThan(0.4)
  })

  it("bilabial: selo e compressão no miolo; [p] comprime mais que [m]", () => {
    const list = phones([["_", 150], ["a", 120], ["p", 80], ["a", 120], ["m", 80], ["a", 120], ["_", 200]])
    const p = sampleAt(list, center(list[2]!))
    const m = sampleAt(list, center(list[4]!))
    expect(p.lipClose).toBeGreaterThan(0.95)
    expect(m.lipClose).toBeGreaterThan(0.95)
    expect(p.lipCompress).toBeGreaterThan(m.lipCompress)
    // Fora do selo o canal pode antecipar (o mixer só comprime com os lábios selados).
    expect(sampleAt(list, center(list[1]!)).lipCompress).toBeLessThan(0.5 * p.lipCompress)
  })

  it("sibilante projeta a mandíbula; a vogal vizinha volta", () => {
    const list = phones([["_", 150], ["a", 140], ["s", 100], ["a", 140], ["_", 200]])
    expect(sampleAt(list, center(list[2]!)).jawForward).toBeGreaterThan(0.25)
    expect(sampleAt(list, center(list[1]!)).jawForward).toBeLessThan(0.1)
  })

  it("contínua: sem saltos entre amostras próximas e repouso antes/depois", () => {
    const list = phones([["_", 100], ["v", 70], ["o", 90, true], ["s", 80], ["e", 110], ["_", 200]])
    const timeline = createMouthTimeline(list)
    const out = { ...REST_MOUTH }
    timeline.sample(list[0]!.start - 0.5, out)
    expect(out).toEqual(REST_MOUTH)
    let previous: MouthChannels | null = null
    for (let t = list[0]!.start - 0.2; t <= list[list.length - 1]!.end + 0.2; t += 0.001) {
      timeline.sample(t, out)
      if (previous) for (const key of Object.keys(out) as Array<keyof MouthChannels>) {
        // Selo/lábio sob os dentes podem fechar em ~20 ms; o resto muda devagar.
        const limit = key === "lipClose" || key === "lowerLipTuck" || key === "lipCompress" ? 0.08 : 0.02
        expect(Math.abs(out[key] - previous[key])).toBeLessThanOrEqual(limit)
      }
      previous = { ...out }
    }
    timeline.sample(list[list.length - 1]!.end + 0.3, out)
    expect(out.jaw).toBe(0)
  })

  it("metas são recalculadas só perto do que muda (truncate + append = mesmo resultado que do zero)", () => {
    const list = phones([["_", 150], ["p", 70], ["a", 120, true], ["s", 80], ["o", 100], ["d", 60], ["i", 90], ["_", 200]])
    const incremental = createMouthTimeline(list.slice(0, 5))
    const probe = { ...REST_MOUTH }
    incremental.sample(center(list[2]!), probe)
    incremental.truncate(4)
    for (const phone of list.slice(4)) incremental.append(phone)
    const fresh = createMouthTimeline(list)
    const a = { ...REST_MOUTH }
    const b = { ...REST_MOUTH }
    for (let t = list[0]!.start; t <= list[list.length - 1]!.end; t += 0.007) {
      incremental.sample(t, a)
      fresh.sample(t, b)
      expect(a).toEqual(b)
    }
  })
})
