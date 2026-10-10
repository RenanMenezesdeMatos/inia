import type { FaceExpression } from "../face-mixer"
import type { Rng } from "../random"
import { chance, randRange, SmoothNoise } from "../random"
import { clamp01, damp } from "../tuning"
import type { BehaviorContext, StateWeights } from "./context"
import { blendByState } from "./context"

/**
 * Expressão: sorriso, sobrancelhas e olhos (apertar/arregalar).
 *
 * Sorriso — calor, nunca máscara: base morna parada/ouvindo, BEM mais leve falando (o `FaceMixer`
 * ainda reduz com a mandíbula), e "sobe" em momentos: saudação/palavras positivas do texto do
 * assistente e às vezes no fim de uma frase. Os picos decaem sozinhos — sorriso fixo durante a
 * resposta inteira é exatamente o que deixava o rosto artificial.
 * O texto (transcrição) chega ANTES do áudio correspondente; o pico espera ~0,6 s para cair perto
 * de quando a palavra é ouvida (aproximação: o texto não tem carimbo de tempo).
 *
 * Sobrancelhas: sobem no acento de frase pelo TIPO dele (`accent.ts`: subida = sobe bem, pico =
 * um pouco, queda/nuclear = quase nada — ali quem marca é o aceno), sobem no fim de perguntas; pensando,
 * leve franzido com o centro para cima (concentração); ouvindo, um mínimo de "interesse".
 */

// Calibrado no navegador com o modelo da INIA Mentora (2026-09-25): abaixo de ~0,4 o sorriso de
// repouso quase não aparece nesse rosto; as referências mostram um sorriso discreto e acolhedor.
// Na fala o sorriso cai (a articulação manda) e o mixer ainda o suprime em p/b/m e vogais arredondadas.
const BASE_SMILE: Readonly<StateWeights> = { idle: 0.46, listening: 0.44, thinking: 0.14, speaking: 0.2 }
const BROW_INNER: Readonly<StateWeights> = { idle: 0, listening: 0.07, thinking: 0.18, speaking: 0 }
const BROW_DOWN: Readonly<StateWeights> = { idle: 0, listening: 0, thinking: 0.12, speaking: 0 }
const EYE_SQUINT: Readonly<StateWeights> = { idle: 0, listening: 0, thinking: 0.1, speaking: 0 }
const EYE_WIDE: Readonly<StateWeights> = { idle: 0, listening: 0.04, thinking: 0, speaking: 0 }
/** Sobrancelha no acento ascendente cheio (antes: 0,22 em todo acento). */
const ACCENT_BROW = 0.3

const GREETING = /\b(ola|oi|bom dia|boa tarde|boa noite|bem[- ]vind[oa]s?)\b/
const POSITIVE = /\b(obrigad[oa]s?|otim[oa]s?|excelente|parabens|legal|perfeito|que bom|feliz|incrivel|muito bem|maravilh\w*|adorei|gostei|sucesso|conseguiu|conseguimos|show)\b/
/**
 * Atraso do pico de sorriso em relação à dica. O driver já entrega a dica de texto quando o
 * trecho correspondente está sendo OUVIDO (não na chegada, que adianta o áudio em segundos).
 */
const TEXT_TO_AUDIO_DELAY = 0.1

export class ExpressionLayer {
  private readonly smileNoise: SmoothNoise
  private readonly browNoise: SmoothNoise
  private smile = 0.46
  private bump = 0
  private pendingBump = 0
  private pendingBumpAt = -1
  private emphasisBrow = 0
  private questionBrow = 0
  private questionHoldUntil = -1
  private browInner = 0
  private browDown = 0
  private squint = 0
  private wide = 0

  constructor(rng: Rng) {
    this.smileNoise = new SmoothNoise(rng, 0.05, 2)
    this.browNoise = new SmoothNoise(rng, 0.07, 2)
  }

  reset(): void {
    this.smile = 0.46
    this.bump = 0
    this.pendingBump = 0
    this.pendingBumpAt = -1
    this.emphasisBrow = 0
    this.questionBrow = 0
    this.questionHoldUntil = -1
    this.browInner = 0
    this.browDown = 0
    this.squint = 0
    this.wide = 0
  }

  update(ctx: BehaviorContext, out: FaceExpression): void {
    const { dt, time, weights, speech, accent, events, tuning, rng } = ctx

    // --- Dicas do texto --------------------------------------------------------------------------
    if (events.assistantText) {
      const greeting = GREETING.test(events.assistantText)
      const positive = POSITIVE.test(events.assistantText)
      if (greeting || positive) {
        this.pendingBump = Math.max(this.pendingBump, greeting ? 0.34 : 0.26)
        if (this.pendingBumpAt < 0) this.pendingBumpAt = time + TEXT_TO_AUDIO_DELAY
      }
    }
    if (this.pendingBumpAt >= 0 && time >= this.pendingBumpAt) {
      this.bump = Math.max(this.bump, this.pendingBump)
      this.pendingBump = 0
      this.pendingBumpAt = -1
    }
    if (events.phraseEnded && events.phraseDuration > 1.2 && chance(rng, 0.55)) {
      this.bump = Math.max(this.bump, randRange(rng, 0.12, 0.2))
    }
    this.bump = damp(this.bump, 0, 1.1, dt)

    // --- Sorriso ---------------------------------------------------------------------------------
    const smileTarget = clamp01((blendByState(weights, BASE_SMILE) + this.bump) * tuning.smile)
    this.smile = damp(this.smile, smileTarget, smileTarget > this.smile ? 0.35 : 0.6, dt)

    // --- Sobrancelhas ----------------------------------------------------------------------------
    const emphasisTarget = accent.brow * ACCENT_BROW * weights.speaking
    this.emphasisBrow = damp(this.emphasisBrow, emphasisTarget, emphasisTarget > this.emphasisBrow ? 0.06 : 0.25, dt)
    if (events.phraseEnded && events.endedPhraseWasQuestion) this.questionHoldUntil = time + 0.7
    const asking = (speech.question && speech.speaking && speech.phraseTime > 0.4) || time < this.questionHoldUntil
    this.questionBrow = damp(this.questionBrow, asking ? 0.28 * weights.speaking : 0, 0.25, dt)
    this.browInner = damp(this.browInner, blendByState(weights, BROW_INNER), 0.4, dt)
    this.browDown = damp(this.browDown, blendByState(weights, BROW_DOWN), 0.4, dt)
    this.squint = damp(this.squint, blendByState(weights, EYE_SQUINT), 0.4, dt)
    this.wide = damp(this.wide, blendByState(weights, EYE_WIDE), 0.4, dt)

    const expressive = tuning.headMotion
    out.smile = this.smile
    out.smileAsymmetry = this.smileNoise.sample(time) * 0.35
    out.cheekSquint = 0
    out.browInnerUp = clamp01((this.browInner + this.emphasisBrow * 0.6 + this.questionBrow * 0.5) * expressive)
    out.browOuterUp = clamp01((this.emphasisBrow + this.questionBrow) * expressive)
    out.browDown = clamp01(this.browDown * expressive)
    out.browAsymmetry = this.browNoise.sample(time) * 0.4
    out.eyeSquint = this.squint
    out.eyeWide = this.wide
    // Micro-assimetria da boca: sempre do mesmo lado (hábito de quem fala), com força que varia
    // devagar. Reaproveita o ruído do sorriso em outro trecho do tempo (não consome o sorteio).
    out.mouthAsymmetry = 0.6 + 0.4 * this.smileNoise.sample(time * 0.7 + 41.3)
  }
}
