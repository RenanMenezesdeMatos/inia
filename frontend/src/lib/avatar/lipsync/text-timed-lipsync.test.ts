import { describe, expect, it } from "vitest"

import { createTextTimedLipsync } from "./text-timed-lipsync"
import { createSpeechFrame } from "./types"

const FAREWELL = "Até já! Chame quando precisar de mim."

function framesBetween(from: number, to: number, run: (t: number) => void) {
  for (let t = from; t <= to; t += 0.005) run(t)
}

describe("lip-sync temporizado por texto (speechSynthesis)", () => {
  it("fala a frase inteira pelas prioris e volta ao repouso depois do end()", () => {
    const lipsync = createTextTimedLipsync()
    lipsync.start(FAREWELL, 10, 0.98)
    const frame = createSpeechFrame()
    let maxJaw = 0
    let closed = 0
    framesBetween(10, 12.5, (t) => {
      lipsync.sample(t, frame)
      maxJaw = Math.max(maxJaw, frame.mouth.jaw)
      if (frame.mouth.lipClose > 0.85) closed++
    })
    expect(maxJaw).toBeGreaterThan(0.3)
    // "Chame" e "mim" têm /m/: os lábios selam em algum momento.
    expect(closed).toBeGreaterThan(0)
    lipsync.end(12.6)
    lipsync.sample(12.6 + 0.15, frame)
    expect(frame.mouth.jaw).toBeLessThan(0.02)
    expect(frame.speaking).toBe(false)
    expect(lipsync.isActive(13)).toBe(false)
  })

  it("re-ancora cada palavra no evento de fronteira real", () => {
    const lipsync = createTextTimedLipsync()
    lipsync.start(FAREWELL, 0)
    const frame = createSpeechFrame()
    // "Chame" começa no caractere 8; o navegador avisou bem depois da priori.
    lipsync.boundary(FAREWELL.indexOf("Chame"), 1.5)
    lipsync.sample(1.2, frame)
    // Entre o fim de "Até já!" e 1,5 s: silêncio (a boca descansa esperando a palavra).
    expect(frame.mouth.jaw).toBeLessThan(0.1)
    lipsync.sample(1.5 + 0.03, frame)
    expect(frame.debugPhone).toBe("S")
    expect(frame.speaking).toBe(true)
  })

  it("cancel() fecha a boca rápido e nada vaza depois", () => {
    const lipsync = createTextTimedLipsync()
    lipsync.start(FAREWELL, 0)
    lipsync.cancel(0.4)
    const frame = createSpeechFrame()
    lipsync.sample(0.4 + 0.13, frame)
    expect(frame.mouth.jaw).toBe(0)
    expect(frame.speaking).toBe(false)
    lipsync.boundary(FAREWELL.indexOf("Chame"), 0.6)
    lipsync.sample(0.65, frame)
    expect(frame.speaking).toBe(false)
  })

  it("ênfase só no acento nuclear (última tônica antes de cada pausa), não em toda tônica", () => {
    const lipsync = createTextTimedLipsync()
    lipsync.start(FAREWELL, 0)
    const frame = createSpeechFrame()
    let pulses = 0
    let previous = 0
    let rising = false
    framesBetween(0, 3, (t) => {
      lipsync.sample(t, frame)
      if (frame.emphasis > previous) rising = true
      else if (rising && frame.emphasis < previous && previous > 0.3) {
        pulses++
        rising = false
      }
      previous = frame.emphasis
    })
    // "Até JÁ! Chame quando precisar de MIM." — duas frases, dois acentos (havia um por tônica: 5).
    expect(pulses).toBe(2)
  })

  it("sem F0, o acento nuclear vem do texto: declarativo = queda (aceno para baixo), pergunta = subida", () => {
    const directions = (text: string) => {
      const lipsync = createTextTimedLipsync()
      lipsync.start(text, 0)
      const frame = createSpeechFrame()
      const seen = new Set<number>()
      framesBetween(0, 3, (t) => {
        lipsync.sample(t, frame)
        if (frame.emphasis > 0.3) {
          expect(frame.accentNuclear).toBe(true)
          seen.add(frame.accentDirection)
        } else if (frame.emphasis === 0) {
          expect(frame.accentDirection).toBe(0)
          expect(frame.accentNuclear).toBe(false)
        }
      })
      return [...seen]
    }
    expect(directions(FAREWELL)).toEqual([-1])
    expect(directions("Vamos juntos?")).toEqual([1])
  })

  it("uma segunda despedida mexe a boca de novo (não herda o fade da primeira)", () => {
    const lipsync = createTextTimedLipsync()
    const frame = createSpeechFrame()
    lipsync.start(FAREWELL, 100)
    lipsync.end(102.5)
    lipsync.start(FAREWELL, 200)
    let maxJaw = 0
    framesBetween(200, 202, (t) => {
      lipsync.sample(t, frame)
      maxJaw = Math.max(maxJaw, frame.mouth.jaw)
    })
    expect(maxJaw).toBeGreaterThan(0.3)
  })
})
