import type { Rng } from "../random"
import { chance, randRange, randSign, SmoothNoise } from "../random"
import { DEG, damp } from "../tuning"
import type { BehaviorContext, BoneOffsets, StateWeights } from "./context"
import { addBoneOffset, blendByState } from "./context"
import type { GazeLayer } from "./gaze"

/**
 * Cabeça e pescoço.
 *  - Ruído de baixa frequência em yaw/pitch/roll (oitavas incomensuráveis: nunca "balança" em
 *    ciclo) com amplitude por estado; falando, cresce um pouco com a energia da voz.
 *  - Acenos na fala: uma mola (ζ < 1) segue o pulso dos ACENTOS DE FRASE (≈ 1/s — não em toda
 *    tônica, que dava um "sim" contínuo a cada palavra), com o sentido pelo TIPO do acento
 *    (`accent.ts`): queda e nuclear = aceno para baixo; subida (continuação/pergunta) = a cabeça sobe
 *    um pouco; pico = aceno menor — sai um movimento curto com leve rebote, não um degrau.
 *  - Inclinação lateral: em perguntas (a partir do meio da frase e um pouco depois dela) e ao
 *    ouvir (lado sorteado por turno, como quem presta atenção).
 *  - Ouvindo: acena quando a pessoa termina uma fala (às vezes duplo) e, raramente, durante falas
 *    longas — reação ao nível do microfone, nunca contínua.
 * O total é dividido entre pescoço (40%) e cabeça (60%), somado à parte do olhar que a cabeça assume.
 */

const NOISE_YAW: Readonly<StateWeights> = { idle: 1.6, listening: 1, thinking: 1.2, speaking: 2.2 }
const NOISE_PITCH: Readonly<StateWeights> = { idle: 1, listening: 0.7, thinking: 0.8, speaking: 1.4 }
const NOISE_ROLL: Readonly<StateWeights> = { idle: 0.8, listening: 0.5, thinking: 0.6, speaking: 1 }
const LISTEN_TILT_DEGREES = 2.2
const QUESTION_TILT_DEGREES = 3.2
/** Aceno para baixo no acento descendente/nuclear (só os acentos pulsam: pode ser visível). */
const ACCENT_NOD_DOWN_DEGREES = 2.8
/** Subida da cabeça no acento ascendente (menor: só acompanha o F0, não é um "não"). */
const ACCENT_LIFT_DEGREES = 1.6
const NECK_SHARE = 0.4
const HEAD_SHARE = 0.6
/** Mola dos acenos: ω alto (aceno curto), ζ < 1 (um rebote leve e natural). */
const NOD_OMEGA = 16
const NOD_ZETA = 0.62

type NodPulse = { at: number; amplitude: number; seconds: number }
const MAX_PULSES = 4

export class HeadMotionLayer {
  private readonly noiseYaw: SmoothNoise
  private readonly noisePitch: SmoothNoise
  private readonly noiseRoll: SmoothNoise
  private nodPosition = 0
  private nodVelocity = 0
  private tilt = 0
  private listenSide = 1
  private questionHoldUntil = -1
  private questionSide = 1
  private readonly pulses: NodPulse[] = []
  private nextListeningNodAt = 0

  constructor(rng: Rng) {
    this.noiseYaw = new SmoothNoise(rng, 0.11, 3)
    this.noisePitch = new SmoothNoise(rng, 0.13, 3)
    this.noiseRoll = new SmoothNoise(rng, 0.09, 2)
  }

  reset(): void {
    this.nodPosition = 0
    this.nodVelocity = 0
    this.tilt = 0
    this.listenSide = 1
    this.questionHoldUntil = -1
    this.pulses.length = 0
    this.nextListeningNodAt = 0
  }

  update(ctx: BehaviorContext, gaze: GazeLayer, bones: BoneOffsets): void {
    const { dt, time, weights, speech, accent, events, tuning, rng } = ctx
    const motion = tuning.headMotion

    // --- Ruído -----------------------------------------------------------------------------
    const energyBoost = 0.7 + 0.6 * speech.energy * weights.speaking + 0.3 * (1 - weights.speaking)
    const yaw = this.noiseYaw.sample(time) * blendByState(weights, NOISE_YAW) * energyBoost
    const pitch = this.noisePitch.sample(time) * blendByState(weights, NOISE_PITCH) * energyBoost
    const roll = this.noiseRoll.sample(time) * blendByState(weights, NOISE_ROLL)

    // --- Acenos ------------------------------------------------------------------------------
    if (events.stateEntered === "listening") {
      this.listenSide = randSign(rng)
      this.nextListeningNodAt = time + randRange(rng, 2.5, 4)
    }
    if (events.userBurstEnded && ctx.state === "listening" && chance(rng, 0.55)) {
      const amplitude = randRange(rng, 1.4, 2.2)
      this.addPulse(time, amplitude, 0.34)
      if (chance(rng, 0.45)) this.addPulse(time + 0.42, amplitude * 0.7, 0.3)
    }
    if (ctx.state === "listening" && ctx.userLevel > 0.12 && time >= this.nextListeningNodAt) {
      if (chance(rng, 0.35)) this.addPulse(time, randRange(rng, 0.8, 1.3), 0.4)
      this.nextListeningNodAt = time + randRange(rng, 3, 6)
    }
    let pulseTarget = 0
    for (let index = this.pulses.length - 1; index >= 0; index--) {
      const pulse = this.pulses[index]!
      const t = (time - pulse.at) / pulse.seconds
      if (t >= 1) {
        this.pulses.splice(index, 1)
        continue
      }
      if (t > 0) pulseTarget += pulse.amplitude * Math.sin(Math.PI * t) ** 2
    }
    // + = cabeça para baixo.
    const emphasisTarget = (accent.down * ACCENT_NOD_DOWN_DEGREES - accent.up * ACCENT_LIFT_DEGREES + speech.energy * 0.5) * weights.speaking
    const nodTarget = emphasisTarget + pulseTarget
    // Mola de 2ª ordem (semi-implícita; passos pequenos p/ estabilidade com dt irregular).
    let remaining = dt
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / 120)
      const acceleration = NOD_OMEGA * NOD_OMEGA * (nodTarget - this.nodPosition) - 2 * NOD_ZETA * NOD_OMEGA * this.nodVelocity
      this.nodVelocity += acceleration * step
      this.nodPosition += this.nodVelocity * step
      remaining -= step
    }

    // --- Inclinação lateral ----------------------------------------------------------------------
    if (events.phraseEnded && events.endedPhraseWasQuestion) this.questionHoldUntil = time + 0.8
    if (events.phraseStarted && speech.question) this.questionSide = randSign(rng)
    const asking = (speech.question && speech.speaking && speech.phraseTime > 0.5) || time < this.questionHoldUntil
    const tiltTarget = weights.listening * this.listenSide * LISTEN_TILT_DEGREES + (asking ? weights.speaking * this.questionSide * QUESTION_TILT_DEGREES : 0)
    this.tilt = damp(this.tilt, tiltTarget, 0.6, dt)

    // --- Composição --------------------------------------------------------------------------
    // Olhar para cima (+pitch do olhar) = cabeça para trás (−X).
    const totalPitch = (pitch + this.nodPosition) * motion - gaze.headPitch
    const totalYaw = yaw * motion + gaze.headYaw
    const totalRoll = (roll + this.tilt) * motion
    addBoneOffset(bones, "Neck", totalPitch * NECK_SHARE * DEG, totalYaw * NECK_SHARE * DEG, totalRoll * NECK_SHARE * DEG)
    addBoneOffset(bones, "Head", totalPitch * HEAD_SHARE * DEG, totalYaw * HEAD_SHARE * DEG, totalRoll * HEAD_SHARE * DEG)
  }

  private addPulse(at: number, amplitude: number, seconds: number): void {
    if (this.pulses.length >= MAX_PULSES) return
    this.pulses.push({ at, amplitude, seconds })
  }
}
