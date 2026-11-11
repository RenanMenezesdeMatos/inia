import type { Rng } from "../random"
import { SmoothNoise } from "../random"
import { clamp, damp, DEG } from "../tuning"
import type { BoneOffset } from "../types"
import type { BehaviorContext, BoneOffsets } from "./context"
import { addBoneOffset } from "./context"

/**
 * Movimento secundário — só no perfil "natural" (modelo v02; o perfil clássico nunca passa por aqui).
 *
 * As outras camadas decidem O QUE a INIA faz (olhar, acenos, respiração, postura). Esta cuida de como o
 * resto do corpo REAGE a isso, que é o que faltava para ela não parecer um busto com a cabeça solta:
 *  - tronco: o alto da coluna acompanha uma fração do giro/inclinação da cabeça, com atraso (ninguém
 *    vira só o pescoço); nada é devolvido à cabeça — a fração é pequena e o olhar compensa sozinho;
 *  - ombros: sobem um mínimo com a energia da voz e com o acento de frase (quem fala "empurra" o ar);
 *  - braços: pêndulo amortecido atrás do tronco — chegam depois e acomodam com um rebote curto;
 *  - cabelo: o osso de balanço (`hair_02_ph`, que no v02 carrega até 50 % do peso das pontas; sai em `hair`)
 *    segue a cabeça por uma mola subamortecida: as pontas atrasam e acomodam;
 *  - parada: deriva lentíssima do quadril (ruído, sem ciclo) para ela nunca ficar 100 % imóvel.
 * Nada aqui é sorteado por evento: tudo é consequência do movimento que já existe, então não cria
 * gestos novos nem "mexe por mexer". Amplitudes em graus, escaladas por `tuning.headMotion`
 * (movimento reduzido encolhe tudo junto).
 */

const TRUNK_YAW_SHARE = 0.16
const TRUNK_PITCH_SHARE = 0.1
const TRUNK_ROLL_SHARE = 0.12
const TRUNK_TAU = 0.45
const SHOULDER_ENERGY_DEGREES = 0.3
const SHOULDER_ACCENT_DEGREES = 0.55
const SHOULDER_TAU_UP = 0.12
const SHOULDER_TAU_DOWN = 0.4
/** Pêndulo dos braços: ω baixo (pesados), ζ < 1 (um rebote). */
const ARM_OMEGA = 6.5
const ARM_ZETA = 0.5
const ARM_GAIN = 0.9
const ARM_LIMIT_DEGREES = 1.6
/** Mola do cabelo: mais rápida e mais solta que os braços. */
const HAIR_OMEGA = 11
const HAIR_ZETA = 0.34
const HAIR_GAIN = 1.15
const HAIR_LIMIT_DEGREES = 4.5
const DRIFT_ROLL_DEGREES = 0.28
const DRIFT_YAW_DEGREES = 0.4

/** Seguidor de 2ª ordem (semi-implícito, passos ≤ 1/120 s): `position` persegue o alvo com atraso e rebote. */
class Follower {
  position = 0
  velocity = 0
  constructor(private readonly omega: number, private readonly zeta: number) {}

  reset(): void {
    this.position = 0
    this.velocity = 0
  }

  step(target: number, dt: number): number {
    let remaining = dt
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 1 / 120)
      const acceleration = this.omega * this.omega * (target - this.position) - 2 * this.zeta * this.omega * this.velocity
      this.velocity += acceleration * h
      this.position += this.velocity * h
      remaining -= h
    }
    return this.position
  }
}

export class SecondaryMotionLayer {
  private readonly driftRoll: SmoothNoise
  private readonly driftYaw: SmoothNoise
  private trunkYaw = 0
  private trunkPitch = 0
  private trunkRoll = 0
  private shoulders = 0
  private readonly armYaw = new Follower(ARM_OMEGA, ARM_ZETA)
  private readonly armRoll = new Follower(ARM_OMEGA, ARM_ZETA)
  private readonly hairPitch = new Follower(HAIR_OMEGA, HAIR_ZETA)
  private readonly hairYaw = new Follower(HAIR_OMEGA, HAIR_ZETA)
  private readonly hairRoll = new Follower(HAIR_OMEGA, HAIR_ZETA)
  private started = false
  /** Diagnóstico/testes: último desvio do cabelo em relação à cabeça (graus). */
  hairLagDegrees = 0

  /** `rng` próprio (derivado da semente): a sequência das outras camadas não muda com o perfil. */
  constructor(rng: Rng) {
    this.driftRoll = new SmoothNoise(rng, 0.045, 2)
    this.driftYaw = new SmoothNoise(rng, 0.037, 2)
  }

  /** Chamar DEPOIS de respiração, postura, virada e cabeça: lê o que elas escreveram em `bones`. */
  update(ctx: BehaviorContext, bones: BoneOffsets, hair: BoneOffset): void {
    const { dt, time, weights, speech, tuning } = ctx
    const motion = tuning.headMotion

    // --- Parada: deriva lenta do quadril (a coluna devolve parte, como na postura) -----------------
    const still = weights.idle + 0.6 * weights.listening + 0.5 * weights.thinking + 0.35 * weights.speaking
    const driftRoll = this.driftRoll.sample(time) * DRIFT_ROLL_DEGREES * still * motion
    const driftYaw = this.driftYaw.sample(time) * DRIFT_YAW_DEGREES * still * motion
    addBoneOffset(bones, "Hips", 0, driftYaw * DEG, driftRoll * DEG)
    addBoneOffset(bones, "Spine", 0, -driftYaw * 0.5 * DEG, -driftRoll * 0.6 * DEG)

    // --- Tronco acompanha a cabeça, atrasado -----------------------------------------------------
    const headPitch = (bones.Neck.x + bones.Head.x) / DEG
    const headYaw = (bones.Neck.y + bones.Head.y) / DEG
    const headRoll = (bones.Neck.z + bones.Head.z) / DEG
    this.trunkYaw = damp(this.trunkYaw, headYaw * TRUNK_YAW_SHARE, TRUNK_TAU, dt)
    this.trunkPitch = damp(this.trunkPitch, headPitch * TRUNK_PITCH_SHARE, TRUNK_TAU, dt)
    this.trunkRoll = damp(this.trunkRoll, headRoll * TRUNK_ROLL_SHARE, TRUNK_TAU, dt)
    addBoneOffset(bones, "Spine1", this.trunkPitch * 0.4 * DEG, this.trunkYaw * 0.4 * DEG, this.trunkRoll * 0.4 * DEG)
    addBoneOffset(bones, "Spine2", this.trunkPitch * 0.6 * DEG, this.trunkYaw * 0.6 * DEG, this.trunkRoll * 0.6 * DEG)

    // --- Ombros na fala ---------------------------------------------------------------------------
    const shoulderTarget = weights.speaking * (speech.energy * SHOULDER_ENERGY_DEGREES + speech.emphasis * SHOULDER_ACCENT_DEGREES) * motion
    this.shoulders = damp(this.shoulders, shoulderTarget, shoulderTarget > this.shoulders ? SHOULDER_TAU_UP : SHOULDER_TAU_DOWN, dt)
    addBoneOffset(bones, "LeftShoulder", 0, 0, this.shoulders * DEG)
    addBoneOffset(bones, "RightShoulder", 0, 0, -this.shoulders * DEG)

    // --- Orientação total do tronco e da cabeça (graus) --------------------------------------------
    const trunkYawTotal = (bones.Hips.y + bones.Spine.y + bones.Spine1.y + bones.Spine2.y) / DEG
    const trunkRollTotal = (bones.Hips.z + bones.Spine.z + bones.Spine1.z + bones.Spine2.z) / DEG
    const trunkPitchTotal = (bones.Hips.x + bones.Spine.x + bones.Spine1.x + bones.Spine2.x) / DEG
    const headYawTotal = trunkYawTotal + headYaw
    const headRollTotal = trunkRollTotal + headRoll
    const headPitchTotal = trunkPitchTotal + headPitch
    if (!this.started) {
      // Primeiro quadro: nada "chega atrasado" de uma pose que nunca existiu.
      this.started = true
      this.armYaw.position = trunkYawTotal
      this.armRoll.position = trunkRollTotal
      this.hairPitch.position = headPitchTotal
      this.hairYaw.position = headYawTotal
      this.hairRoll.position = headRollTotal
    }

    // --- Braços: pêndulo atrás do tronco ----------------------------------------------------------
    const armYawLag = clamp((this.armYaw.step(trunkYawTotal, dt) - trunkYawTotal) * ARM_GAIN, -ARM_LIMIT_DEGREES, ARM_LIMIT_DEGREES)
    const armRollLag = clamp((this.armRoll.step(trunkRollTotal, dt) - trunkRollTotal) * ARM_GAIN, -ARM_LIMIT_DEGREES, ARM_LIMIT_DEGREES)
    // Tronco gira para a esquerda dela → o braço esquerdo fica para a frente, o direito para trás (e vice-versa).
    addBoneOffset(bones, "LeftArm", armYawLag * DEG, 0, armRollLag * DEG)
    addBoneOffset(bones, "RightArm", -armYawLag * DEG, 0, armRollLag * DEG)
    addBoneOffset(bones, "LeftForeArm", armYawLag * 0.5 * DEG, 0, 0)
    addBoneOffset(bones, "RightForeArm", -armYawLag * 0.5 * DEG, 0, 0)

    // --- Cabelo: atrasa e acomoda -------------------------------------------------------------------
    const hairPitch = clamp((this.hairPitch.step(headPitchTotal, dt) - headPitchTotal) * HAIR_GAIN, -HAIR_LIMIT_DEGREES, HAIR_LIMIT_DEGREES)
    const hairYaw = clamp((this.hairYaw.step(headYawTotal, dt) - headYawTotal) * HAIR_GAIN, -HAIR_LIMIT_DEGREES, HAIR_LIMIT_DEGREES)
    const hairRoll = clamp((this.hairRoll.step(headRollTotal, dt) - headRollTotal) * HAIR_GAIN, -HAIR_LIMIT_DEGREES, HAIR_LIMIT_DEGREES)
    this.hairLagDegrees = Math.hypot(hairPitch, hairYaw, hairRoll)
    hair.x = hairPitch * DEG
    hair.y = hairYaw * DEG
    hair.z = hairRoll * DEG
  }
}
