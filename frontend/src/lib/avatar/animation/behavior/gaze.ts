import { chance, randRange, randSign } from "../random"
import { damp } from "../tuning"
import type { BlinkLayer } from "./blink"
import type { BehaviorContext } from "./context"

/**
 * Olhar: quase sempre na câmera (a câmera É a pessoa com quem a INIA conversa), com:
 *  - microssacadas (0,5–2,2 s, < 1°) — olho parado de verdade parece de vidro;
 *  - "pensando": olha para cima/de lado por ~1 s e volta (e repete, de vez em quando, se continuar
 *    pensando) — o gesto clássico de buscar a resposta;
 *  - falando: às vezes desvia rápido no começo de uma frase (quem fala desvia; quem ouve fixa);
 *  - parada: desvios pequenos e ocasionais; ouvindo: atenção quase fixa.
 * O olho salta rápido (sacada, τ ≈ 30 ms) e a cabeça acompanha uma fração do desvio, devagar;
 * o olho então contra-gira para manter o alvo (reflexo vestíbulo-ocular). Tudo em graus
 * (+yaw = para a esquerda dela, +pitch = para cima); o `FaceMixer` converte em morphs pequenos.
 */

const SACCADE_TAU = 0.03
const HEAD_FOLLOW_TAU = 0.4
/** Fração do desvio que a cabeça assume (o resto fica no olho). */
const HEAD_FOLLOW_FRACTION = 0.35
/** Troca de alvo acima disso "merece" uma piscada de oportunidade. */
const BIG_SHIFT_DEGREES = 4

type Glance = { yaw: number; pitch: number; until: number }

export class GazeLayer {
  private glance: Glance = { yaw: 0, pitch: 0, until: -1 }
  private nextGlanceAt = 3
  private nextMicroAt = 0.6
  private microYaw = 0
  private microPitch = 0
  private headYawDeg = 0
  private headPitchDeg = 0
  private wasGlancing = false
  /** Saída: ângulo dos olhos relativo à cabeça (graus). */
  eyeYaw = 0
  eyePitch = 0
  /** Saída: parte do olhar que a cabeça assume (graus). */
  headYaw = 0
  headPitch = 0

  reset(): void {
    this.glance = { yaw: 0, pitch: 0, until: -1 }
    this.nextGlanceAt = 3
    this.nextMicroAt = 0.6
    this.microYaw = 0
    this.microPitch = 0
    this.headYawDeg = 0
    this.headPitchDeg = 0
    this.wasGlancing = false
    this.eyeYaw = 0
    this.eyePitch = 0
    this.headYaw = 0
    this.headPitch = 0
  }

  update(ctx: BehaviorContext, blink: BlinkLayer): void {
    const { rng, time, events, state, tuning } = ctx
    const amount = tuning.gaze

    // --- Desvios (glances) -------------------------------------------------------------------
    if (events.stateEntered === "thinking") {
      // Buscar a resposta: para cima e de lado, ~1 s.
      this.startGlance(ctx, blink, randSign(rng) * randRange(rng, 9, 14), randRange(rng, 7, 12), randRange(rng, 0.8, 1.3))
      this.nextGlanceAt = time + randRange(rng, 2.5, 4.5)
    } else if (events.stateEntered !== null) {
      // Trocou de estado: volta para a pessoa.
      this.glance.until = -1
      this.nextGlanceAt = time + randRange(rng, 2, 5)
    }

    if (state === "speaking" && events.phraseStarted && !this.glancing(time) && chance(rng, Math.min(0.6, 0.35 * amount))) {
      this.startGlance(ctx, blink, randSign(rng) * randRange(rng, 5, 9), randRange(rng, -3, 3), randRange(rng, 0.45, 0.9))
    } else if (time >= this.nextGlanceAt && !this.glancing(time)) {
      if (state === "thinking") {
        this.startGlance(ctx, blink, randSign(rng) * randRange(rng, 6, 12), randRange(rng, 4, 10), randRange(rng, 0.7, 1.2))
        this.nextGlanceAt = time + randRange(rng, 2.5, 4.5)
      } else if (state === "idle") {
        this.startGlance(ctx, blink, randSign(rng) * randRange(rng, 3, 7), randRange(rng, -4, 3), randRange(rng, 0.6, 1.5))
        this.nextGlanceAt = time + randRange(rng, 4, 9)
      } else if (state === "listening") {
        this.startGlance(ctx, blink, randSign(rng) * randRange(rng, 2, 4), randRange(rng, -2, 1), randRange(rng, 0.4, 0.8))
        this.nextGlanceAt = time + randRange(rng, 8, 14)
      } else {
        this.nextGlanceAt = time + randRange(rng, 3, 6)
      }
    }

    // --- Microssacadas ----------------------------------------------------------------------
    if (time >= this.nextMicroAt) {
      this.microYaw = randRange(rng, -0.8, 0.8)
      this.microPitch = randRange(rng, -0.5, 0.5)
      this.nextMicroAt = time + randRange(rng, 0.5, 2.2)
    }

    const glancing = this.glancing(time)
    // Voltar de um desvio grande também é uma troca de olhar (e pede piscada, às vezes).
    if (this.wasGlancing && !glancing && Math.hypot(this.glance.yaw, this.glance.pitch) * amount > BIG_SHIFT_DEGREES) {
      blink.opportunistic(ctx, 0.3)
    }
    this.wasGlancing = glancing
    const targetYaw = ((glancing ? this.glance.yaw : 0) + this.microYaw) * amount
    const targetPitch = ((glancing ? this.glance.pitch : 0) + this.microPitch) * amount

    // Cabeça acompanha devagar uma fração; o olho cobre o resto (e contra-gira quando a cabeça chega).
    const follow = HEAD_FOLLOW_FRACTION * Math.min(1.5, tuning.headMotion)
    this.headYawDeg = damp(this.headYawDeg, targetYaw * follow, HEAD_FOLLOW_TAU, ctx.dt)
    this.headPitchDeg = damp(this.headPitchDeg, targetPitch * follow, HEAD_FOLLOW_TAU, ctx.dt)
    this.eyeYaw = damp(this.eyeYaw, targetYaw - this.headYawDeg, SACCADE_TAU, ctx.dt)
    this.eyePitch = damp(this.eyePitch, targetPitch - this.headPitchDeg, SACCADE_TAU, ctx.dt)
    this.headYaw = this.headYawDeg
    this.headPitch = this.headPitchDeg
  }

  private glancing(time: number): boolean {
    return time < this.glance.until
  }

  private startGlance(ctx: BehaviorContext, blink: BlinkLayer, yaw: number, pitch: number, seconds: number): void {
    const shift = Math.hypot(yaw - (this.glancing(ctx.time) ? this.glance.yaw : 0), pitch - (this.glancing(ctx.time) ? this.glance.pitch : 0))
    this.glance.yaw = yaw
    this.glance.pitch = pitch
    this.glance.until = ctx.time + seconds
    if (shift * ctx.tuning.gaze > BIG_SHIFT_DEGREES) blink.opportunistic(ctx, 0.4)
  }
}
