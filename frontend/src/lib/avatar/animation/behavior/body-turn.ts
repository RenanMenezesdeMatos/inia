import { DEG, damp } from "../tuning"
import type { BehaviorContext, BoneOffsets } from "./context"
import { addBoneOffset } from "./context"

/**
 * Virar para alguém: a INIA muda para onde está voltada (ex.: no palco do feedback, do cartão que ela apresenta para a pessoa
 * com quem fala) como uma pessoa faz — os OLHOS chegam primeiro (sacada), a CABEÇA vem logo atrás e o CORPO acompanha devagar;
 * quando o corpo chega, a cabeça e os olhos voltam ao centro. Nada gira de uma vez, como um boneco num pedestal.
 *
 * Entrada: `targetDeg` = para onde ela deve ficar voltada, em graus (+ = para a esquerda dela; o mesmo referencial dos ossos e
 * do olhar). Em repouso o tronco assume a maior parte e a cabeça o resto (gente nunca encara alguém só com o pescoço).
 * Movimento reduzido: muda de lado sem animação.
 */

/** Parte do giro que fica no tronco (quadril + coluna); o resto é da cabeça/pescoço. */
const BODY_SHARE = 0.78
/** Mola do tronco, criticamente amortecida: ~1 s até chegar, sem passar do ponto. */
const BODY_OMEGA = 5.2
/** A cabeça vai na frente do corpo — rápida, mas nunca um estalo. */
const HEAD_TAU = 0.2
/** Quanto a cabeça pode adiantar além do repouso enquanto o corpo não chega (graus). */
const HEAD_LEAD_LIMIT = 14
/** Distribuição do giro do tronco pela coluna (soma 1): o quadril gira menos que os ombros. */
const TRUNK = { Hips: 0.42, Spine: 0.2, Spine1: 0.16, Spine2: 0.22 } as const
const NECK_SHARE = 0.4
const HEAD_SHARE = 0.6

export class BodyTurnLayer {
  private started = false
  private body = 0
  private bodyVelocity = 0
  private head = 0
  /** Saída: o que os olhos ainda precisam girar (graus) para olhar na direção pedida. */
  eyeYaw = 0

  reset(): void {
    this.started = false
    this.body = 0
    this.bodyVelocity = 0
    this.head = 0
    this.eyeYaw = 0
  }

  update(ctx: BehaviorContext, targetDeg: number, bones: BoneOffsets, reducedMotion: boolean): void {
    const target = Number.isFinite(targetDeg) ? targetDeg : 0
    const bodyTarget = target * BODY_SHARE
    if (!this.started || reducedMotion) {
      // Primeiro quadro (ela já aparece voltada para onde deve) ou movimento reduzido: sem giro animado.
      this.started = true
      this.body = bodyTarget
      this.bodyVelocity = 0
      this.head = target - bodyTarget
    } else {
      let remaining = ctx.dt
      while (remaining > 1e-6) {
        const step = Math.min(remaining, 1 / 120)
        const acceleration = BODY_OMEGA * BODY_OMEGA * (bodyTarget - this.body) - 2 * BODY_OMEGA * this.bodyVelocity
        this.bodyVelocity += acceleration * step
        this.body += this.bodyVelocity * step
        remaining -= step
      }
      const rest = target - bodyTarget
      const lead = clampAround(target - this.body, rest, HEAD_LEAD_LIMIT)
      this.head = damp(this.head, lead, HEAD_TAU, ctx.dt)
    }
    // Os olhos cobrem o que falta (o FaceMixer limita o quanto o olho gira; a cabeça e o corpo fazem o resto).
    this.eyeYaw = target - this.body - this.head

    if (Math.abs(this.body) > 1e-4) {
      for (const [bone, share] of Object.entries(TRUNK) as Array<[keyof typeof TRUNK, number]>) addBoneOffset(bones, bone, 0, this.body * share * DEG, 0)
    }
    if (Math.abs(this.head) > 1e-4) {
      addBoneOffset(bones, "Neck", 0, this.head * NECK_SHARE * DEG, 0)
      addBoneOffset(bones, "Head", 0, this.head * HEAD_SHARE * DEG, 0)
    }
  }
}

function clampAround(value: number, center: number, limit: number): number {
  return Math.min(center + limit, Math.max(center - limit, value))
}
