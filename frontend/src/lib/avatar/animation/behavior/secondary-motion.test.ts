import { describe, expect, it } from "vitest"

import { createSpeechFrame, type SpeechFrame } from "../../lipsync/types"
import { BehaviorController } from "../behavior-controller"
import type { AvatarConversationState, AvatarDriver, ConversationCue } from "../types"
import { DEFAULT_AVATAR_TUNING } from "../types"

const DEG = Math.PI / 180

function driver(state: AvatarConversationState, speech?: (out: SpeechFrame, t: number) => void): AvatarDriver & { t: number } {
  const cues: ConversationCue[] = []
  return {
    t: 0,
    state,
    tuning: { ...DEFAULT_AVATAR_TUNING },
    sampleSpeech(out) {
      Object.assign(out, createSpeechFrame())
      speech?.(out, this.t)
    },
    drainCues: () => cues.splice(0),
  }
}

function run(controller: BehaviorController, source: AvatarDriver & { t: number }, seconds: number, visit: (frame: ReturnType<BehaviorController["update"]>, t: number) => void): void {
  const dt = 1 / 60
  for (let i = 0; i < seconds * 60; i++) {
    source.t = i * dt
    visit(controller.update(source, dt, source.t * 1000), source.t)
  }
}

describe("perfil de movimento", () => {
  it("clássico é o padrão e não escreve no osso do cabelo nem muda nenhum quadro", () => {
    const base = new BehaviorController()
    const explicit = new BehaviorController({ motionProfile: "classic" })
    const a = driver("idle")
    const b = driver("idle")
    const frames: string[] = []
    run(base, a, 20, (frame) => frames.push(JSON.stringify([frame.bones, frame.blendshapes])))
    let index = 0
    run(explicit, b, 20, (frame) => {
      expect(JSON.stringify([frame.bones, frame.blendshapes])).toBe(frames[index++])
      expect(frame.hair).toEqual({ x: 0, y: 0, z: 0 })
    })
    expect(base.motionProfile).toBe("classic")
  })

  it("natural: o cabelo atrasa em relação à cabeça, acomoda e nunca passa do limite", () => {
    const controller = new BehaviorController({ motionProfile: "natural" })
    const source = driver("speaking", (out, t) => {
      out.speaking = true
      out.energy = 0.6
      // acentos de frase a cada ~1,2 s: a cabeça acena, o cabelo vem atrás
      out.emphasis = Math.max(0, Math.sin((t % 1.2) / 0.25 * Math.PI)) * (t % 1.2 < 0.25 ? 1 : 0)
      out.accentDirection = -1
    })
    let maxHair = 0
    let moved = 0
    run(controller, source, 20, (frame) => {
      const hair = Math.hypot(frame.hair.x, frame.hair.y, frame.hair.z) / DEG
      maxHair = Math.max(maxHair, hair)
      if (hair > 0.05) moved++
    })
    expect(maxHair).toBeGreaterThan(0.3)
    expect(maxHair).toBeLessThanOrEqual(4.5 * Math.sqrt(3) + 1e-6)
    expect(moved).toBeGreaterThan(100)
  })

  it("natural: parada, o corpo nunca congela e nada treme (passo por quadro pequeno)", () => {
    const controller = new BehaviorController({ motionProfile: "natural" })
    const source = driver("idle")
    let previous: Record<string, { x: number; y: number; z: number }> | null = null
    let maxStep = 0
    let hipsRange = [Infinity, -Infinity]
    run(controller, source, 40, (frame) => {
      if (previous) {
        for (const [name, offset] of Object.entries(frame.bones)) {
          const before = previous[name]!
          maxStep = Math.max(maxStep, Math.hypot(offset.x - before.x, offset.y - before.y, offset.z - before.z) / DEG)
        }
      }
      previous = JSON.parse(JSON.stringify(frame.bones))
      hipsRange = [Math.min(hipsRange[0]!, frame.bones.Hips.z), Math.max(hipsRange[1]!, frame.bones.Hips.z)]
    })
    // nenhum osso anda mais de 0,5° num quadro de 60 fps (sem tranco/tremor)
    expect(maxStep).toBeLessThan(0.5)
    expect((hipsRange[1]! - hipsRange[0]!) / DEG).toBeGreaterThan(0.1)
  })

  it("natural: piscadas variam de duração e algumas são parciais; clássico pisca sempre igual", () => {
    const depths = (profile: "classic" | "natural") => {
      const controller = new BehaviorController({ motionProfile: profile })
      const source = driver("idle")
      const peaks: number[] = []
      let peak = 0
      run(controller, source, 240, (frame) => {
        const value = frame.blendshapes.eyeBlinkLeft ?? 0
        if (value > peak) peak = value
        else if (value < 0.02 && peak > 0.1) {
          peaks.push(Math.round(peak * 100) / 100)
          peak = 0
        }
      })
      return peaks
    }
    const natural = depths("natural")
    expect(natural.length).toBeGreaterThan(30)
    expect(natural.some((p) => p < 0.82)).toBe(true)
    expect(natural.filter((p) => p >= 0.82).length).toBeGreaterThan(natural.length * 0.7)
    expect(depths("classic").every((p) => p >= 0.82)).toBe(true)
  })

  it("trocar de perfil no meio não dá tranco: o movimento secundário começa do zero", () => {
    const controller = new BehaviorController()
    const source = driver("idle")
    let last = { x: 0, y: 0, z: 0 }
    run(controller, source, 5, (frame) => (last = { ...frame.bones.Spine2 }))
    controller.setMotionProfile("natural")
    const frame = controller.update(source, 1 / 60, 5000)
    expect(Math.hypot(frame.bones.Spine2.x - last.x, frame.bones.Spine2.y - last.y, frame.bones.Spine2.z - last.z) / DEG).toBeLessThan(0.3)
    expect(Math.hypot(frame.hair.x, frame.hair.y, frame.hair.z) / DEG).toBeLessThan(0.2)
  })
})
