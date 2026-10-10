import type { GestureCommand, GestureId, GestureKind } from "../gesture-catalog"
import { GESTURES } from "../gesture-catalog"
import { chance, pickWeighted, randRange } from "../random"
import type { BehaviorContext } from "./context"

/**
 * Quando e qual gesto de braço tocar.
 *
 *  - Só falando, no COMEÇO de uma frase com alguma energia (é onde as pessoas gesticulam), no
 *    máximo um por vez e com intervalo de 6–15 s entre o fim de um e o próximo (dividido por
 *    `gestureIntensity`; 0 desliga tudo). Nunca o mesmo tipo duas vezes seguidas.
 *  - Saudação no começo do turno puxa o "boas-vindas"; "eu sou…/me chamo…" puxa a mão no peito.
 *  - Ouvindo: só um ajuste mínimo das mãos, raro. Pensando/parada: nada.
 *  - Saiu de "speaking" com gesto no ar: o gesto sai suave (fade), não congela nem corta.
 */

const GREETING = /\b(ola|oi|bom dia|boa tarde|boa noite|bem[- ]vind[oa]s?)\b/
const ABOUT_ME = /\b(eu sou|sou a inia|me chamo|meu nome|minha funcao|estou aqui para)\b/
const SPEAKING_GESTURES: readonly GestureId[] = ["explainRight", "explainLeft", "welcome", "aboutMe", "beatRight", "beatLeft"]
const BASE_WEIGHTS: Readonly<Record<GestureId, number>> = {
  explainRight: 3,
  explainLeft: 2,
  welcome: 1,
  aboutMe: 0.6,
  beatRight: 1.4,
  beatLeft: 1.1,
  listenShift: 0,
}
const PHRASE_START_CHANCE = 0.6
/** Cue de texto vale para as frases que começam logo depois dele. */
const CUE_WINDOW_SECONDS = 4

export class GestureScheduler {
  private lastKind: GestureKind | null = null
  private activeUntil = -1
  private nextAllowedAt = 2.5
  private nextListeningAt = 8
  private greetingUntil = -1
  private aboutMeUntil = -1
  private readonly weights: number[] = SPEAKING_GESTURES.map(() => 0)
  /** Histórico (só para testes). */
  readonly history: GestureId[] = []
  recordHistory = false

  reset(): void {
    this.lastKind = null
    this.activeUntil = -1
    this.nextAllowedAt = 2.5
    this.nextListeningAt = 8
    this.greetingUntil = -1
    this.aboutMeUntil = -1
    this.history.length = 0
  }

  update(ctx: BehaviorContext): GestureCommand | null {
    const { time, events, state, tuning, rng, speech } = ctx
    const intensity = tuning.gestureIntensity
    const active = time < this.activeUntil

    if (events.assistantText) {
      if (GREETING.test(events.assistantText)) this.greetingUntil = time + CUE_WINDOW_SECONDS
      if (ABOUT_ME.test(events.assistantText)) this.aboutMeUntil = time + CUE_WINDOW_SECONDS
    }

    if (intensity <= 0.01) {
      if (active) return this.stop(0.35)
      return null
    }
    if (events.stateEntered !== null && active) return this.stop(0.4)
    if (active) return null
    // Pedido da tela (momento de atenção): toca agora, em qualquer estado — exceto ouvindo (a pessoa está falando).
    if (events.requestedGesture && state !== "listening") return this.play(events.requestedGesture, time, randRange(rng, 4, 8), intensity)

    const gapScale = 1 / Math.max(0.35, intensity)
    if (state === "speaking") {
      if (!events.phraseStarted || time < this.nextAllowedAt) return null
      if (speech.energy < 0.12 && speech.emphasis < 0.2) return null
      if (!chance(rng, PHRASE_START_CHANCE)) return null
      const id = this.pick(ctx)
      if (id === null) return null
      return this.play(id, time, randRange(rng, 6, 15) * gapScale, intensity)
    }
    if (state === "listening") {
      if (time < this.nextListeningAt) return null
      this.nextListeningAt = time + randRange(rng, 12, 25) * gapScale
      if (this.lastKind === "listenShift" || !chance(rng, 0.5)) return null
      return this.play("listenShift", time, 0, intensity * 0.8)
    }
    return null
  }

  private pick(ctx: BehaviorContext): GestureId | null {
    const { time, rng } = ctx
    for (let index = 0; index < SPEAKING_GESTURES.length; index++) {
      const id = SPEAKING_GESTURES[index]
      let weight = BASE_WEIGHTS[id]
      if (id === "welcome" && time < this.greetingUntil) weight = 5
      if (id === "aboutMe" && time < this.aboutMeUntil) weight = 5
      if (GESTURES[id].kind === this.lastKind) weight = 0
      this.weights[index] = weight
    }
    const index = pickWeighted(rng, this.weights)
    return index < 0 ? null : SPEAKING_GESTURES[index]
  }

  private play(id: GestureId, time: number, gapAfter: number, intensity: number): GestureCommand {
    const info = GESTURES[id]
    this.lastKind = info.kind
    this.activeUntil = time + info.seconds
    this.nextAllowedAt = Math.max(this.nextAllowedAt, this.activeUntil + gapAfter)
    if (id === "welcome") this.greetingUntil = -1
    if (id === "aboutMe") this.aboutMeUntil = -1
    if (this.recordHistory && this.history.length < 1024) this.history.push(id)
    // Amplitude: 1 → 0,9; 2 → 1,2 (aditivo aceita > 1); 0,25 (movimento reduzido) → ~0,5.
    return { type: "play", id, weight: Math.min(1.2, 0.35 + 0.55 * intensity) }
  }

  private stop(fadeSeconds: number): GestureCommand {
    this.activeUntil = -1
    return { type: "stop", fadeSeconds }
  }
}
