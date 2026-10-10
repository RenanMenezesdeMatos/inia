import { describe, expect, it } from "vitest"

import type { MouthChannels } from "../lipsync/types"
import { REST_MOUTH } from "../lipsync/types"
import {
  ARTICULATION_BLENDSHAPES,
  createBlendshapeWeights,
  createFaceMixInput,
  MAX_EYE_LOOK,
  MAX_JAW_FORWARD,
  MAX_JAW_OPEN,
  MAX_MOUTH_PRESS,
  MAX_MOUTH_SHIFT,
  mixFace,
} from "./face-mixer"
import { ARKIT_BLENDSHAPES } from "./types"

function mix(mouth: Partial<MouthChannels>, tweak?: (input: ReturnType<typeof createFaceMixInput>) => void) {
  const input = createFaceMixInput()
  Object.assign(input.mouth, REST_MOUTH, mouth)
  tweak?.(input)
  return mixFace(input, createBlendshapeWeights())
}

describe("mixFace — regras da boca", () => {
  it("repouso sem expressão: todos os 52 morphs em zero", () => {
    const out = mix({})
    for (const name of ARKIT_BLENDSHAPES) expect(out[name]).toBe(0)
  })

  it("mouthClose = lipClose × jawOpen e nunca passa de jawOpen", () => {
    for (const jaw of [0, 0.05, 0.1, 0.3, 0.7, 1]) {
      for (const lipClose of [0, 0.5, 1]) {
        const out = mix({ jaw, lipClose })
        expect(out.mouthClose!).toBeLessThanOrEqual(out.jawOpen! + 1e-9)
        expect(out.mouthClose).toBeCloseTo(lipClose * out.jawOpen!, 6)
      }
    }
    // Mandíbula fechada: mouthClose zero mesmo com lábios "selados" (senão infla os lábios).
    expect(mix({ jaw: 0, lipClose: 1 }).mouthClose).toBe(0)
  })

  it("jawOpen limitado a ~0,7 e mouthPress a 0,5", () => {
    const out = mix({ jaw: 1, lipClose: 1 }, (input) => (input.lipsync = 2))
    expect(out.jawOpen).toBe(MAX_JAW_OPEN)
    expect(out.mouthPressLeft).toBe(MAX_MOUTH_PRESS)
    expect(out.mouthPressRight).toBe(MAX_MOUTH_PRESS)
  })

  it("lábios selados vencem o sorriso: sorriso, estiramento e lábios sup./inf. somem", () => {
    const smiling = (input: ReturnType<typeof createFaceMixInput>) => (input.expression.smile = 0.8)
    const open = mix({ jaw: 0.3, spread: 0.6, upperLipRaise: 0.3, lowerLipDown: 0.3 }, smiling)
    expect(open.mouthSmileLeft!).toBeGreaterThan(0.2)
    const sealed = mix({ jaw: 0.1, lipClose: 1, spread: 0.6, upperLipRaise: 0.3, lowerLipDown: 0.3 }, smiling)
    for (const name of ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight", "mouthLowerDownLeft", "mouthLowerDownRight"] as const) {
      expect(sealed[name]).toBe(0)
    }
    expect(sealed.mouthPressLeft).toBeGreaterThan(0.4)
    expect(sealed.mouthClose).toBeCloseTo(sealed.jawOpen!, 6)
    // A parte "dos olhos" do sorriso continua enquanto a boca articula.
    expect(sealed.cheekSquintLeft!).toBeGreaterThan(0.2)
  })

  it("o sorriso cede à mandíbula e ao arredondamento", () => {
    const smiling = (input: ReturnType<typeof createFaceMixInput>) => (input.expression.smile = 1)
    const closed = mix({}, smiling).mouthSmileLeft!
    const wide = mix({ jaw: 0.7 }, smiling).mouthSmileLeft!
    const rounded = mix({ jaw: 0.3, round: 0.7 }, smiling).mouthSmileLeft!
    const puckered = mix({ jaw: 0.1, pucker: 0.9 }, smiling).mouthSmileLeft!
    expect(wide).toBeLessThan(closed)
    expect(wide).toBeGreaterThan(0.4) // sorriso + mandíbula ~0,3–0,4 lê bem: cede, não some
    expect(rounded).toBeLessThan(wide)
    expect(puckered).toBeLessThan(0.25)
  })

  it("formas verificadas: FV, O, U, A, E/I", () => {
    const fv = mix({ lowerLipTuck: 0.8, upperLipRaise: 0.15, jaw: 0.1 })
    expect(fv.mouthRollLower).toBeCloseTo(0.7, 2)
    expect(fv.mouthUpperUpLeft!).toBeGreaterThan(0.15)
    expect(fv.jawOpen).toBeCloseTo(0.1, 6)
    const o = mix({ jaw: 0.48, round: 0.65 })
    expect(o.mouthFunnel!).toBeGreaterThan(0.6)
    const u = mix({ jaw: 0.12, pucker: 0.85 })
    expect(u.mouthPucker!).toBeGreaterThan(0.85)
    const a = mix({ jaw: 0.62, lowerLipDown: 0.35 })
    expect(a.mouthLowerDownLeft).toBeCloseTo(0.49, 2)
    const i = mix({ jaw: 0.12, spread: 0.6, upperLipRaise: 0.1 })
    expect(i.mouthStretchLeft).toBeCloseTo(0.51, 2)
  })

  it("tuning.lipsync escala a articulação e 0 desliga a boca", () => {
    const half = mix({ jaw: 0.6, round: 0.6 }, (input) => (input.lipsync = 0.5))
    const full = mix({ jaw: 0.6, round: 0.6 })
    expect(half.jawOpen!).toBeCloseTo(full.jawOpen! / 2, 6)
    const off = mix({ jaw: 0.6, lipClose: 1, round: 0.6, spread: 0.5 }, (input) => (input.lipsync = 0))
    for (const name of ARTICULATION_BLENDSHAPES) expect(off[name]).toBe(0)
  })

  it("tudo fica em [0, 1] mesmo com entradas fora da faixa", () => {
    const out = mix({ jaw: 5, lipClose: -1, round: 3, pucker: 2, spread: 9, lowerLipTuck: 4, upperLipRaise: 3, lowerLipDown: 2, jawForward: 5, lipCompress: 9 }, (input) => {
      input.lipsync = 7
      Object.assign(input.expression, { smile: 3, cheekSquint: 2, browInnerUp: 4, browOuterUp: 2, browDown: 3, eyeSquint: 5, eyeWide: 2, smileAsymmetry: 9, browAsymmetry: -9, mouthAsymmetry: 9 })
      input.blinkLeft = 3
      input.gazeYawDeg = 400
      input.gazePitchDeg = -400
    })
    for (const name of ARKIT_BLENDSHAPES) {
      expect(out[name]).toBeGreaterThanOrEqual(0)
      expect(out[name]).toBeLessThanOrEqual(1)
    }
  })
})

describe("mixFace — morphs da fala (compressão, mandíbula à frente, assimetria)", () => {
  it("compressão labial só com o selo: rola os lábios, sobe o queixo, um mínimo de bochecha", () => {
    const open = mix({ jaw: 0.4, lipCompress: 1 })
    for (const name of ["mouthRollUpper", "mouthShrugLower", "cheekPuff"] as const) expect(open[name]).toBe(0)
    const p = mix({ jaw: 0.1, lipClose: 1, lipCompress: 1 })
    const m = mix({ jaw: 0.1, lipClose: 1, lipCompress: 0.4 })
    expect(p.mouthRollUpper!).toBeGreaterThan(m.mouthRollUpper!)
    expect(p.mouthRollUpper!).toBeLessThanOrEqual(0.3)
    expect(p.mouthShrugLower!).toBeGreaterThan(0.15)
    expect(p.cheekPuff!).toBeGreaterThan(0)
    expect(p.cheekPuff!).toBeLessThanOrEqual(0.15)
    // O selo continua vencendo: pressão no teto e nada de sorriso/estiramento.
    expect(p.mouthPressLeft).toBe(MAX_MOUTH_PRESS)
  })

  it("lábio sob os dentes (f/v) e compressão disputam o mesmo morph sem somar", () => {
    const fv = mix({ lowerLipTuck: 0.8, jaw: 0.1 })
    const both = mix({ lowerLipTuck: 0.8, jaw: 0.1, lipClose: 1, lipCompress: 1 })
    expect(both.mouthRollLower).toBeCloseTo(fv.mouthRollLower!, 6)
  })

  it("jawForward segue o canal e fica num teto discreto", () => {
    expect(mix({ jaw: 0.08, jawForward: 0.5 }).jawForward!).toBeGreaterThan(0.2)
    expect(mix({ jawForward: 1 }, (input) => (input.lipsync = 2)).jawForward).toBe(MAX_JAW_FORWARD)
  })

  it("micro-assimetria: zero com a boca parada, cresce com a articulação, do lado pedido", () => {
    const asymmetric = (input: ReturnType<typeof createFaceMixInput>) => (input.expression.mouthAsymmetry = 1)
    const still = mix({}, asymmetric)
    expect(still.mouthLeft).toBe(0)
    expect(still.mouthRight).toBe(0)
    const speaking = mix({ jaw: 0.5 }, asymmetric)
    expect(speaking.mouthLeft!).toBeGreaterThan(0)
    expect(speaking.mouthLeft!).toBeLessThanOrEqual(MAX_MOUTH_SHIFT)
    expect(speaking.mouthRight).toBe(0)
    const other = mix({ jaw: 0.5 }, (input) => (input.expression.mouthAsymmetry = -0.5))
    expect(other.mouthRight!).toBeGreaterThan(0)
    expect(other.mouthLeft).toBe(0)
  })

  it("tongueOut nunca é escrito (o modelo não tem geometria de língua)", () => {
    const out = mix({ jaw: 0.7, lipCompress: 1, jawForward: 1, round: 1, pucker: 1, spread: 1 }, (input) => {
      input.expression.mouthAsymmetry = 1
      input.lipsync = 2
    })
    expect(out.tongueOut).toBe(0)
  })
})

describe("mixFace — olhos", () => {
  it("piscada + squint ≤ 1 por olho; arregalar some com a piscada", () => {
    const out = mix({}, (input) => {
      input.expression.eyeSquint = 0.9
      input.expression.smile = 1
      input.expression.eyeWide = 0.8
      input.blinkLeft = 0.7
      input.blinkRight = 0.2
    })
    expect(out.eyeBlinkLeft! + out.eyeSquintLeft!).toBeLessThanOrEqual(1 + 1e-9)
    expect(out.eyeBlinkRight! + out.eyeSquintRight!).toBeLessThanOrEqual(1 + 1e-9)
    expect(out.eyeWideLeft!).toBeLessThan(out.eyeWideRight!)
  })

  it("olhar em graus vira eyeLook* pequenos, espelhados entre os olhos", () => {
    const left = mix({}, (input) => (input.gazeYawDeg = 5.4))
    expect(left.eyeLookOutLeft).toBeCloseTo(0.2, 6)
    expect(left.eyeLookInRight).toBeCloseTo(0.2, 6)
    expect(left.eyeLookInLeft).toBe(0)
    const right = mix({}, (input) => (input.gazeYawDeg = -5.4))
    expect(right.eyeLookInLeft).toBeCloseTo(0.2, 6)
    expect(right.eyeLookOutRight).toBeCloseTo(0.2, 6)
    const far = mix({}, (input) => (input.gazePitchDeg = 90))
    expect(far.eyeLookUpLeft).toBe(MAX_EYE_LOOK)
  })

  it("olhar para baixo abaixa um pouco a pálpebra", () => {
    const down = mix({}, (input) => (input.gazePitchDeg = -8))
    expect(down.eyeLookDownLeft!).toBeGreaterThan(0)
    expect(down.eyeBlinkLeft!).toBeGreaterThan(0)
    expect(down.eyeBlinkLeft!).toBeLessThan(0.15)
  })
})
