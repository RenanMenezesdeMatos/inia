import { describe, expect, it } from "vitest"

import { createSpeechFrame } from "../../lipsync/types"
import { createAccentResponse, writeAccentResponse } from "./accent"

function responseTo(emphasis: number, accentDirection: number, accentNuclear: boolean) {
  const speech = createSpeechFrame()
  Object.assign(speech, { emphasis, accentDirection, accentNuclear })
  const out = createAccentResponse()
  writeAccentResponse(speech, out)
  return out
}

describe("resposta ao tipo do acento de frase", () => {
  it("queda: só aceno para baixo, sobrancelha mínima", () => {
    const fall = responseTo(1, -0.9, false)
    expect(fall.down).toBeCloseTo(1, 5)
    expect(fall.up).toBe(0)
    expect(fall.brow).toBeLessThan(0.2)
  })

  it("subida: cabeça sobe e sobrancelha ergue — nunca aceno para baixo", () => {
    const rise = responseTo(1, 0.9, false)
    expect(rise.up).toBeCloseTo(1, 5)
    expect(rise.down).toBe(0)
    expect(rise.brow).toBeCloseTo(1, 5)
  })

  it("pico: batida intermediária (aceno e sobrancelha parciais)", () => {
    const peak = responseTo(1, 0, false)
    expect(peak.down).toBeGreaterThan(0.4)
    expect(peak.down).toBeLessThan(0.8)
    expect(peak.up).toBe(0)
    expect(peak.brow).toBeGreaterThan(0.4)
    expect(peak.brow).toBeLessThan(0.8)
  })

  it("nuclear: pico ou nível no fim da frase vira aceno para baixo cheio; o nuclear que sobe (continuação/pergunta) continua subindo", () => {
    expect(responseTo(1, 0, true).down).toBeCloseTo(1, 5)
    expect(responseTo(1, -0.2, true).up).toBe(0)
    const rising = responseTo(1, 0.8, true)
    expect(rising.up).toBeCloseTo(1, 5)
    expect(rising.down).toBe(0)
  })

  it("escala com o pulso e é contínua na direção (nada salta entre tipos)", () => {
    expect(responseTo(0.5, -0.9, false).down).toBeCloseTo(0.5, 5)
    expect(responseTo(0, 0.9, false)).toEqual({ down: 0, up: 0, brow: 0 })
    let previous = responseTo(1, -1, false)
    for (let d = -1; d <= 1.0001; d += 0.01) {
      const current = responseTo(1, d, false)
      expect(Math.abs(current.down - previous.down)).toBeLessThan(0.05)
      expect(Math.abs(current.up - previous.up)).toBeLessThan(0.05)
      expect(Math.abs(current.brow - previous.brow)).toBeLessThan(0.05)
      previous = current
    }
  })
})
