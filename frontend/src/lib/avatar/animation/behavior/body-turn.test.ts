import { describe, expect, it } from "vitest"

import { DEG } from "../tuning"
import { BodyTurnLayer } from "./body-turn"
import type { BehaviorContext, BoneOffsets } from "./context"
import { createBoneOffsets, resetBoneOffsets } from "./context"

const DT = 1 / 60

function step(layer: BodyTurnLayer, target: number, bones: BoneOffsets, reducedMotion = false): void {
  resetBoneOffsets(bones)
  layer.update({ dt: DT } as BehaviorContext, target, bones, reducedMotion)
}

/** Giro do tronco inteiro (quadril + coluna) e da cabeça inteira (pescoço + cabeça), em graus. */
const trunk = (bones: BoneOffsets) => (bones.Hips.y + bones.Spine.y + bones.Spine1.y + bones.Spine2.y) / DEG
const head = (bones: BoneOffsets) => (bones.Neck.y + bones.Head.y) / DEG

describe("BodyTurnLayer — virar para a pessoa", () => {
  it("começa voltada para onde deve (sem girar ao montar)", () => {
    const layer = new BodyTurnLayer()
    const bones = createBoneOffsets()
    step(layer, -24, bones)
    expect(trunk(bones) + head(bones)).toBeCloseTo(-24, 5)
    expect(layer.eyeYaw).toBeCloseTo(0, 5)
  })

  it("olhos primeiro, cabeça logo atrás, corpo depois — e em ~1,5 s tudo chega, com os olhos de volta ao centro", () => {
    const layer = new BodyTurnLayer()
    const bones = createBoneOffsets()
    step(layer, 0, bones)
    step(layer, -24, bones)
    // No primeiro quadro da virada quem já foi é o olhar; o corpo mal começou.
    expect(layer.eyeYaw).toBeLessThan(-20)
    expect(Math.abs(trunk(bones))).toBeLessThan(0.5)
    for (let frame = 0; frame < 12; frame++) step(layer, -24, bones)
    // ~0,2 s: a cabeça já virou bem mais que o tronco.
    expect(head(bones)).toBeLessThan(-8)
    expect(Math.abs(head(bones))).toBeGreaterThan(Math.abs(trunk(bones)))
    for (let frame = 0; frame < 78; frame++) step(layer, -24, bones)
    // ~1,5 s: o tronco assumiu a maior parte, a cabeça o resto, os olhos voltaram ao centro.
    expect(trunk(bones)).toBeCloseTo(-24 * 0.78, 0)
    expect(trunk(bones) + head(bones)).toBeCloseTo(-24, 0)
    expect(Math.abs(layer.eyeYaw)).toBeLessThan(0.5)
  })

  it("nunca passa do ponto nem dá um estalo de um quadro para o outro", () => {
    const layer = new BodyTurnLayer()
    const bones = createBoneOffsets()
    step(layer, 0, bones)
    let previousTrunk = 0
    let previousHead = 0
    for (let frame = 0; frame < 180; frame++) {
      step(layer, -24, bones)
      expect(trunk(bones)).toBeGreaterThanOrEqual(-24 * 0.78 - 0.05)
      expect(Math.abs(trunk(bones) - previousTrunk)).toBeLessThan(1)
      expect(Math.abs(head(bones) - previousHead)).toBeLessThan(2.5)
      previousTrunk = trunk(bones)
      previousHead = head(bones)
    }
  })

  it("volta pelo mesmo caminho quando a tela pede a outra direção", () => {
    const layer = new BodyTurnLayer()
    const bones = createBoneOffsets()
    step(layer, -24, bones)
    step(layer, 0, bones)
    expect(layer.eyeYaw).toBeGreaterThan(20)
    for (let frame = 0; frame < 90; frame++) step(layer, 0, bones)
    expect(Math.abs(trunk(bones))).toBeLessThan(0.5)
    expect(Math.abs(head(bones))).toBeLessThan(0.5)
  })

  it("movimento reduzido: muda de direção sem animação", () => {
    const layer = new BodyTurnLayer()
    const bones = createBoneOffsets()
    step(layer, 0, bones, true)
    step(layer, -24, bones, true)
    expect(trunk(bones) + head(bones)).toBeCloseTo(-24, 5)
    expect(layer.eyeYaw).toBeCloseTo(0, 5)
  })
})
