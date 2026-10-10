import { chance, randRange } from "../random"
import type { BehaviorContext } from "./context"

/**
 * Piscadas: intervalo aleatório (2–6 s com `blinkRate = 1`), às vezes dupla, ~170 ms cada
 * (fecha rápido, abre mais devagar — a pálpebra desce pela gravidade e sobe pelo músculo).
 * Também pisca "de oportunidade" em trocas grandes de olhar e no começo de frases — é assim que
 * as pessoas piscam, e isso esconde o salto do olho.
 *
 * Falando, a piscada procura o FIM DA FRASE (`atPhraseBoundary`: logo depois do acento nuclear e no
 * início da pausa longa) — quem fala pisca nas fronteiras prosódicas, não no meio da palavra. Não
 * acrescenta piscadas: ADIANTA a que já viria em até `PULL_HORIZON_SECONDS`, e o que sobrou do
 * intervalo passa para o seguinte (sem passar de `BLINK_INTERVAL_MAX`: nada de olhar parado), então a
 * taxa fica a do relógio aleatório.
 */

const CLOSE_SECONDS = 0.055
const HOLD_SECONDS = 0.025
const OPEN_SECONDS = 0.09
export const BLINK_SECONDS = CLOSE_SECONDS + HOLD_SECONDS + OPEN_SECONDS
export const BLINK_INTERVAL_MIN = 2
export const BLINK_INTERVAL_MAX = 6
const DOUBLE_BLINK_CHANCE = 0.15
/** Nenhuma piscada de oportunidade logo depois de outra. */
const MIN_GAP_SECONDS = 0.8
/** Fim de frase adianta a piscada agendada que viria em até isto (s, com `blinkRate = 1`). */
export const PULL_HORIZON_SECONDS = 2.5

export class BlinkLayer {
  private nextBlinkAt = 1.5
  private blinkStartedAt = -1
  private lastBlinkAt = -Infinity
  private doubleQueued = false
  /** Sobra do intervalo adiantado por um fim de frase, somada ao próximo intervalo. */
  private carry = 0
  /** 0..1 (1 = fechado). */
  value = 0
  /** Instantes de início de cada piscada (só para testes; limitado). */
  readonly history: number[] = []
  recordHistory = false

  reset(): void {
    this.nextBlinkAt = 1.5
    this.blinkStartedAt = -1
    this.lastBlinkAt = -Infinity
    this.doubleQueued = false
    this.carry = 0
    this.value = 0
    this.history.length = 0
  }

  /** Pisca agora com `probability` se não piscou há pouco (troca de olhar, começo de frase). */
  opportunistic(ctx: BehaviorContext, probability: number): void {
    if (ctx.tuning.blinkRate <= 0.01 || this.blinkStartedAt >= 0) return
    if (ctx.time - this.lastBlinkAt < MIN_GAP_SECONDS) return
    if (chance(ctx.rng, probability)) this.start(ctx)
  }

  /**
   * Fronteira de frase: a piscada agendada, se cair em até `PULL_HORIZON_SECONDS`, passa para
   * `delaySeconds` daqui. Não pisca de novo logo depois de outra nem desfaz a segunda de uma dupla.
   */
  atPhraseBoundary(ctx: BehaviorContext, delaySeconds: number): void {
    const rate = ctx.tuning.blinkRate
    if (rate <= 0.01 || this.blinkStartedAt >= 0 || this.doubleQueued) return
    const at = ctx.time + delaySeconds
    const due = this.nextBlinkAt - at
    if (due <= 0 || due > PULL_HORIZON_SECONDS / rate) return
    if (at - this.lastBlinkAt < MIN_GAP_SECONDS) return
    this.carry = due
    this.nextBlinkAt = at
  }

  update(ctx: BehaviorContext): number {
    const rate = ctx.tuning.blinkRate
    if (rate <= 0.01) {
      this.blinkStartedAt = -1
      this.value = 0
      return 0
    }
    if (this.blinkStartedAt < 0 && ctx.time >= this.nextBlinkAt) this.start(ctx)
    if (this.blinkStartedAt < 0) {
      this.value = 0
      return 0
    }
    const t = ctx.time - this.blinkStartedAt
    if (t < CLOSE_SECONDS) {
      const x = t / CLOSE_SECONDS
      this.value = x * x
    } else if (t < CLOSE_SECONDS + HOLD_SECONDS) {
      this.value = 1
    } else if (t < BLINK_SECONDS) {
      const x = (t - CLOSE_SECONDS - HOLD_SECONDS) / OPEN_SECONDS
      this.value = 1 - (1 - (1 - x) * (1 - x))
    } else {
      this.value = 0
      this.blinkStartedAt = -1
      this.scheduleNext(ctx)
    }
    return this.value
  }

  private start(ctx: BehaviorContext): void {
    this.blinkStartedAt = ctx.time
    this.lastBlinkAt = ctx.time
    if (this.recordHistory && this.history.length < 4096) this.history.push(ctx.time)
  }

  private scheduleNext(ctx: BehaviorContext): void {
    const rate = Math.max(0.05, ctx.tuning.blinkRate)
    if (!this.doubleQueued && chance(ctx.rng, DOUBLE_BLINK_CHANCE)) {
      this.doubleQueued = true
      this.nextBlinkAt = ctx.time + randRange(ctx.rng, 0.08, 0.18)
      return
    }
    this.doubleQueued = false
    this.nextBlinkAt = ctx.time + Math.min(BLINK_INTERVAL_MAX, randRange(ctx.rng, BLINK_INTERVAL_MIN, BLINK_INTERVAL_MAX) + this.carry * rate) / rate
    this.carry = 0
  }
}
