import { describe, expect, it } from "vitest"

import type { SpeechFrame } from "../lipsync/types"
import { REST_MOUTH } from "../lipsync/types"
import { BLINK_INTERVAL_MAX, BLINK_SECONDS } from "./behavior/blink"
import { BehaviorController } from "./behavior-controller"
import { ARTICULATION_BLENDSHAPES } from "./face-mixer"
import type { GestureId } from "./gesture-catalog"
import { GESTURES } from "./gesture-catalog"
import type { AvatarConversationState, AvatarDriver, AvatarTuning, ConversationCue } from "./types"
import { DEFAULT_AVATAR_TUNING, PROCEDURAL_BONES } from "./types"

const FPS = 60
const DT = 1 / FPS

/** Driver de teste: estado e fala roteirizados no tempo da simulação. */
class ScriptedDriver implements AvatarDriver {
  state: AvatarConversationState = "idle"
  tuning: AvatarTuning = { ...DEFAULT_AVATAR_TUNING }
  /**
   * Fala: frases de `phrase` s separadas por pausas de `pause` s (só em "speaking"). Acentos: pulsos
   * periódicos com direção `accentDirection` (padrão 0 = pico) e, se `nuclearAt`, um acento nuclear
   * nesse instante da frase (direção `nuclearDirection`, padrão −1 = queda).
   */
  speech: { phrase: number; pause: number; energy: number; question: boolean; accentDirection?: number; nuclearAt?: number; nuclearDirection?: number } | null = null
  cues: ConversationCue[] = []
  time = 0

  sampleSpeech(out: SpeechFrame): void {
    Object.assign(out.mouth, REST_MOUTH)
    out.speaking = false
    out.energy = 0
    out.emphasis = 0
    out.accentDirection = 0
    out.accentNuclear = false
    out.phraseTime = 0
    out.question = false
    if (!this.speech || this.state !== "speaking") return
    const cycle = this.speech.phrase + this.speech.pause
    const t = this.time % cycle
    if (t >= this.speech.phrase) return
    out.speaking = true
    out.phraseTime = t
    out.energy = this.speech.energy
    out.emphasis = Math.max(0, Math.sin(t * 9)) ** 8
    out.accentDirection = out.emphasis > 0 ? (this.speech.accentDirection ?? 0) : 0
    if (this.speech.nuclearAt !== undefined) {
      const x = (t - this.speech.nuclearAt) / 0.07
      const nuclear = Math.exp(-x * x)
      if (nuclear > out.emphasis) {
        out.emphasis = nuclear
        out.accentDirection = this.speech.nuclearDirection ?? -1
        out.accentNuclear = true
      }
    }
    out.question = this.speech.question
    out.mouth.jaw = 0.3 + 0.2 * Math.sin(t * 20)
    out.mouth.spread = 0.3
  }

  drainCues(): ConversationCue[] {
    const cues = this.cues
    this.cues = []
    return cues
  }
}

function run(controller: BehaviorController, driver: ScriptedDriver, seconds: number, onFrame?: (frame: ReturnType<BehaviorController["update"]>) => void): void {
  const frames = Math.round(seconds * FPS)
  for (let index = 0; index < frames; index++) {
    driver.time += DT
    const frame = controller.update(driver, DT, driver.time * 1000)
    onFrame?.(frame)
  }
}

describe("BehaviorController", () => {
  it("é determinístico: mesma semente + mesmas entradas = mesmos quadros", () => {
    const record = () => {
      const controller = new BehaviorController({ seed: 7 })
      const driver = new ScriptedDriver()
      driver.speech = { phrase: 2.2, pause: 0.4, energy: 0.6, question: false }
      const values: number[] = []
      for (const state of ["idle", "listening", "thinking", "speaking"] as const) {
        driver.state = state
        run(controller, driver, 6, (frame) => values.push(frame.bones.Head.x, frame.bones.Neck.y, frame.blendshapes.eyeBlinkLeft ?? 0, frame.blendshapes.mouthSmileLeft ?? 0))
      }
      return values
    }
    expect(record()).toEqual(record())
  })

  it("sem fala ouvida a boca não se mexe (parada, ouvindo, pensando e até em 'speaking' sem áudio)", () => {
    const controller = new BehaviorController()
    const driver = new ScriptedDriver()
    for (const state of ["idle", "listening", "thinking", "speaking"] as const) {
      driver.state = state
      run(controller, driver, 8, (frame) => {
        for (const name of ARTICULATION_BLENDSHAPES) expect(frame.blendshapes[name], `${state} ${name}`).toBe(0)
      })
    }
  })

  it("com fala ouvida a boca articula", () => {
    const controller = new BehaviorController()
    const driver = new ScriptedDriver()
    driver.state = "speaking"
    driver.speech = { phrase: 2, pause: 0.5, energy: 0.6, question: false }
    let maxJaw = 0
    run(controller, driver, 3, (frame) => (maxJaw = Math.max(maxJaw, frame.blendshapes.jawOpen ?? 0)))
    expect(maxJaw).toBeGreaterThan(0.3)
  })

  it("piscadas a cada 2–6 s (às vezes duplas), ~170 ms cada; blinkRate 0 desliga", () => {
    const controller = new BehaviorController({ seed: 3 })
    controller.debug.blink.recordHistory = true
    const driver = new ScriptedDriver()
    let closedFrames = 0
    run(controller, driver, 180, (frame) => {
      if ((frame.blendshapes.eyeBlinkLeft ?? 0) > 0.5) closedFrames++
    })
    const starts = controller.debug.blink.history
    expect(starts.length).toBeGreaterThan(180 / 6)
    expect(starts.length).toBeLessThan(180 / 1.5)
    for (let index = 1; index < starts.length; index++) {
      const gap = starts[index]! - starts[index - 1]!
      expect(gap).toBeGreaterThan(BLINK_SECONDS + 0.07)
      expect(gap).toBeLessThanOrEqual(BLINK_SECONDS + BLINK_INTERVAL_MAX + 2 * DT)
    }
    // Olho "fechado" (> 0,5) por ~4–6 quadros por piscada.
    expect(closedFrames / starts.length).toBeGreaterThan(2)
    expect(closedFrames / starts.length).toBeLessThan(8)

    const noBlink = new BehaviorController({ seed: 3 })
    const still = new ScriptedDriver()
    still.tuning.blinkRate = 0
    // Só sobra a pálpebra acompanhando o olhar para baixo (poucos %), nunca uma piscada.
    run(noBlink, still, 30, (frame) => {
      expect(noBlink.debug.blink.value).toBe(0)
      expect(frame.blendshapes.eyeBlinkLeft!).toBeLessThan(0.05)
    })
  })

  it("gestos: só falando, espaçados, nunca o mesmo tipo duas vezes seguidas", () => {
    const controller = new BehaviorController({ seed: 11 })
    const driver = new ScriptedDriver()
    driver.state = "speaking"
    driver.speech = { phrase: 2.4, pause: 0.5, energy: 0.6, question: false }
    const plays: Array<{ id: GestureId; at: number }> = []
    run(controller, driver, 400, (frame) => {
      if (frame.gesture?.type === "play") plays.push({ id: frame.gesture.id, at: driver.time })
    })
    expect(plays.length).toBeGreaterThan(8)
    for (let index = 1; index < plays.length; index++) {
      const previous = plays[index - 1]!
      const current = plays[index]!
      expect(GESTURES[current.id].kind, `${previous.id} → ${current.id}`).not.toBe(GESTURES[previous.id].kind)
      expect(current.at - previous.at).toBeGreaterThanOrEqual(GESTURES[previous.id].seconds + 6 - 1e-6)
    }
    expect(plays.every((play) => !GESTURES[play.id].listening)).toBe(true)
  })

  it("gestureIntensity 0 desliga os gestos; ouvindo/pensando/parada nunca gesticula como fala", () => {
    const off = new BehaviorController({ seed: 11 })
    const driver = new ScriptedDriver()
    driver.state = "speaking"
    driver.speech = { phrase: 2.4, pause: 0.5, energy: 0.6, question: false }
    driver.tuning.gestureIntensity = 0
    run(off, driver, 200, (frame) => expect(frame.gesture).toBeNull())

    const calm = new BehaviorController({ seed: 5 })
    const other = new ScriptedDriver()
    for (const state of ["idle", "thinking", "listening"] as const) {
      other.state = state
      run(calm, other, 120, (frame) => {
        if (frame.gesture?.type === "play") expect(frame.gesture.id).toBe("listenShift")
        if (frame.gesture?.type === "play") expect(state).toBe("listening")
      })
    }
  })

  it("gesto pedido pela tela (momento de atenção): toca uma vez mesmo parada e sem fala; nunca ouvindo; intensidade 0 desliga", () => {
    const controller = new BehaviorController({ seed: 3 })
    const driver = new ScriptedDriver()
    run(controller, driver, 3)
    driver.cues.push({ type: "gesture", id: "explainLeft" })
    const plays: GestureId[] = []
    run(controller, driver, 6, (frame) => { if (frame.gesture?.type === "play") plays.push(frame.gesture.id) })
    expect(plays).toEqual(["explainLeft"])

    const listening = new ScriptedDriver()
    listening.state = "listening"
    const quiet = new BehaviorController({ seed: 3 })
    run(quiet, listening, 1)
    listening.cues.push({ type: "gesture", id: "explainLeft" })
    run(quiet, listening, 1, (frame) => { if (frame.gesture?.type === "play") expect(frame.gesture.id).not.toBe("explainLeft") })

    const off = new ScriptedDriver()
    off.tuning.gestureIntensity = 0
    const offController = new BehaviorController({ seed: 3 })
    off.cues.push({ type: "gesture", id: "explainLeft" })
    run(offController, off, 2, (frame) => expect(frame.gesture).toBeNull())
  })

  it("troca de estado é suave: nenhum osso salta mais que ~0,6° por quadro, nem sorriso/sobrancelhas", () => {
    const controller = new BehaviorController({ seed: 21 })
    const driver = new ScriptedDriver()
    const previousBones = new Map<string, number>()
    const previousFace = new Map<string, number>()
    const smooth = ["mouthSmileLeft", "mouthSmileRight", "browInnerUp", "browOuterUpLeft", "browDownLeft", "cheekSquintLeft", "eyeWideLeft"] as const
    let maxBoneStep = 0
    let maxFaceStep = 0
    let first = true
    for (const state of ["idle", "listening", "thinking", "speaking", "idle", "thinking", "listening", "idle"] as const) {
      driver.state = state
      run(controller, driver, 3.5, (frame) => {
        for (const name of PROCEDURAL_BONES) {
          for (const axis of ["x", "y", "z"] as const) {
            const key = `${name}.${axis}`
            const value = frame.bones[name][axis]
            if (!first) maxBoneStep = Math.max(maxBoneStep, Math.abs(value - previousBones.get(key)!))
            previousBones.set(key, value)
          }
        }
        for (const name of smooth) {
          const value = frame.blendshapes[name] ?? 0
          if (!first) maxFaceStep = Math.max(maxFaceStep, Math.abs(value - previousFace.get(name)!))
          previousFace.set(name, value)
        }
        first = false
      })
    }
    expect(maxBoneStep).toBeLessThan((0.6 * Math.PI) / 180)
    expect(maxFaceStep).toBeLessThan(0.03)
  })

  it("sorriso: morno parado, mais leve falando, com picos que decaem (nunca fixo a resposta toda)", () => {
    const controller = new BehaviorController({ seed: 2 })
    const driver = new ScriptedDriver()
    let idleSmile = 0
    run(controller, driver, 4, (frame) => (idleSmile = frame.blendshapes.mouthSmileLeft ?? 0))
    expect(idleSmile).toBeGreaterThan(0.15)

    driver.state = "speaking"
    driver.speech = { phrase: 2.4, pause: 0.5, energy: 0.6, question: false }
    driver.cues.push({ type: "turn-started" }, { type: "assistant-text", text: "Olá! Que bom falar com você." })
    const smiles: number[] = []
    run(controller, driver, 12, (frame) => smiles.push(frame.blendshapes.mouthSmileLeft ?? 0))
    const peak = Math.max(...smiles.slice(0, 180))
    const late = smiles.slice(-60)
    expect(peak).toBeGreaterThan(Math.max(...late) + 0.05)
    expect(Math.min(...late)).toBeLessThan(idleSmile)
  })

  it("acento de frase pelo tipo: queda acena para BAIXO, subida LEVANTA a cabeça e ergue a sobrancelha", () => {
    const record = (accentDirection: number | null) => {
      const controller = new BehaviorController({ seed: 9 })
      const driver = new ScriptedDriver()
      driver.state = "speaking"
      driver.speech = { phrase: 6, pause: 0.5, energy: 0.6, question: false, accentDirection: accentDirection ?? 0 }
      if (accentDirection === null) driver.sampleSpeech = (out) => {
        ScriptedDriver.prototype.sampleSpeech.call(driver, out)
        out.emphasis = 0
        out.accentDirection = 0
      }
      const pitch: number[] = []
      const brow: number[] = []
      run(controller, driver, 6, (frame) => {
        pitch.push((frame.bones.Head.x + frame.bones.Neck.x) / (Math.PI / 180))
        brow.push(frame.blendshapes.browOuterUpLeft ?? 0)
      })
      return { pitch, brow }
    }
    const none = record(null)
    const fall = record(-1)
    const rise = record(1)
    const delta = (a: number[]) => a.map((value, index) => value - none.pitch[index]!)
    const browDelta = (a: number[]) => a.map((value, index) => value - none.brow[index]!)
    // + = para baixo. Aceno de 2,8° × pulso, subida de 1,6° × pulso (a mola não chega ao alvo de um pulso curto).
    expect(Math.max(...delta(fall.pitch))).toBeGreaterThan(1.5)
    expect(Math.min(...delta(fall.pitch))).toBeGreaterThan(-0.6)
    expect(Math.min(...delta(rise.pitch))).toBeLessThan(-1)
    expect(Math.max(...delta(rise.pitch))).toBeLessThan(0.4)
    expect(Math.max(...browDelta(rise.brow))).toBeGreaterThan(0.15)
    expect(Math.max(...browDelta(fall.brow))).toBeLessThan(0.06)
  })

  it("piscada procura o fim da frase (depois do acento nuclear) sem mudar a taxa; desligável", () => {
    const phrase = 2.2
    const pause = 0.5
    const cycle = phrase + pause
    const measure = (prosodicBlinks: boolean) => {
      const controller = new BehaviorController({ seed: 17, prosodicBlinks })
      controller.debug.blink.recordHistory = true
      const driver = new ScriptedDriver()
      driver.state = "speaking"
      driver.speech = { phrase, pause, energy: 0.6, question: false, accentDirection: 0.6, nuclearAt: phrase - 0.18 }
      const seconds = 600
      run(controller, driver, seconds)
      const starts = controller.debug.blink.history
      // Fronteira = início da pausa; janela de −0,3 a +0,4 s.
      const near = starts.filter((at) => {
        const inCycle = at % cycle
        return inCycle >= phrase - 0.3 && inCycle <= phrase + 0.4
      }).length
      return { perMinute: (60 * starts.length) / seconds, near: near / starts.length }
    }
    const chance = 0.7 / cycle
    const prosodic = measure(true)
    const random = measure(false)
    expect(Math.abs(prosodic.perMinute / random.perMinute - 1)).toBeLessThanOrEqual(0.2)
    expect(random.near).toBeLessThan(1.5 * chance)
    expect(prosodic.near).toBeGreaterThan(2 * chance)
    expect(prosodic.near).toBeGreaterThan(random.near + 0.2)
  })
})
