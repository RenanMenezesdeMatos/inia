import { randRange } from "../random"
import { DEG, damp, easeInOutSine } from "../tuning"
import type { BehaviorContext, BoneOffsets, StateWeights } from "./context"
import { addBoneOffset, blendByState } from "./context"

/**
 * Respiração: peito sobe (coluna estende um pouco, ombros sobem) ao inspirar.
 *
 * Duas fontes misturadas pelo peso de "speaking":
 *  - ciclo autônomo (fora da fala): período SORTEADO a cada ciclo (3,5–5 s parada), inspiração
 *    ~40% do ciclo — nunca um seno fixo, que o olho percebe como máquina;
 *  - fala: quem fala inspira nas PAUSAS (rápido, antes da próxima frase) e expira devagar
 *    enquanto fala. Por isso a inspiração segue `SpeechFrame.speaking`: pausa ouvida = inspira.
 * A saída é centrada em 0 (b − 0,5): a pose média não "afunda" nem "sobe" com o tempo.
 */

/** Faixa do período do ciclo autônomo, por estado (s). */
const CYCLE_MIN: Readonly<StateWeights> = { idle: 3.5, listening: 3.2, thinking: 4, speaking: 3.5 }
const CYCLE_MAX: Readonly<StateWeights> = { idle: 5, listening: 4.4, thinking: 5.5, speaking: 5 }
const INHALE_FRACTION = 0.4

/** Amplitudes (rad) para a respiração completa (b de 0 a 1) com `tuning.breathing = 1`. */
const SPINE1_PITCH = 0.35 * DEG
const SPINE2_PITCH = 0.75 * DEG
const SHOULDER_RAISE = 0.9 * DEG
/** O pescoço compensa parte do peito, senão a cabeça "boia" junto com a respiração. */
const NECK_COMPENSATION = 0.45

export class BreathingLayer {
  private phase = 0
  private period = 4.2
  private speechBreath = 0.5
  /** 0 = expirado, 1 = inspirado (depois do cross-fade), para testes/diagnóstico. */
  value = 0.5

  reset(): void {
    this.phase = 0
    this.period = 4.2
    this.speechBreath = 0.5
    this.value = 0.5
  }

  update(ctx: BehaviorContext, bones: BoneOffsets): void {
    const { dt, weights, speech, tuning } = ctx
    this.phase += dt / this.period
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase)
      this.period = randRange(ctx.rng, blendByState(weights, CYCLE_MIN), blendByState(weights, CYCLE_MAX))
    }
    const cycle = this.phase < INHALE_FRACTION
      ? easeInOutSine(this.phase / INHALE_FRACTION)
      : 1 - easeInOutSine((this.phase - INHALE_FRACTION) / (1 - INHALE_FRACTION))

    // Na fala: pausa = inspiração rápida (~0,35 s); frase = expiração lenta até ~15%.
    this.speechBreath = speech.speaking ? damp(this.speechBreath, 0.15, 3.5, dt) : damp(this.speechBreath, 1, 0.35, dt)

    const speaking = weights.speaking
    this.value = cycle * (1 - speaking) + this.speechBreath * speaking
    const amount = (this.value - 0.5) * tuning.breathing
    // X negativo = extensão (o peito abre para trás/cima).
    addBoneOffset(bones, "Spine1", -SPINE1_PITCH * amount, 0, 0)
    addBoneOffset(bones, "Spine2", -SPINE2_PITCH * amount, 0, 0)
    addBoneOffset(bones, "Neck", (SPINE1_PITCH + SPINE2_PITCH) * NECK_COMPENSATION * amount, 0, 0)
    // Ombro esquerdo sobe com +Z; o direito, com −Z (a ponta lateral está em −X).
    addBoneOffset(bones, "LeftShoulder", 0, 0, SHOULDER_RAISE * amount)
    addBoneOffset(bones, "RightShoulder", 0, 0, -SHOULDER_RAISE * amount)
  }
}
