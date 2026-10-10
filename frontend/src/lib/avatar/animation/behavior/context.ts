import type { SpeechFrame } from "../../lipsync/types"
import type { AccentResponse } from "./accent"
import type { GestureId } from "../gesture-catalog"
import type { Rng } from "../random"
import type { AvatarConversationState, AvatarTuning, BoneOffset, ProceduralBone } from "../types"
import { PROCEDURAL_BONES } from "../types"

/**
 * O que toda camada de comportamento recebe a cada quadro. Tudo é preenchido pelo
 * `BehaviorController` (um objeto reaproveitado — nenhuma camada aloca por quadro).
 */

export type StateWeights = Record<AvatarConversationState, number>

/** Bordas detectadas neste quadro (eventos discretos que as camadas podem usar para agendar algo). */
export type FrameEvents = {
  /** Estado que COMEÇOU neste quadro (null = nenhuma troca). */
  stateEntered: AvatarConversationState | null
  /** A fala ouvida começou uma frase agora (subida de `speaking`). */
  phraseStarted: boolean
  /** A fala ouvida entrou em pausa agora; `phraseDuration` = quanto durou a frase. */
  phraseEnded: boolean
  phraseDuration: number
  /** A frase que acabou de terminar era pergunta. */
  endedPhraseWasQuestion: boolean
  /** Primeira frase do turno do assistente (desde o último `turn-started`). */
  firstPhraseOfTurn: boolean
  /** Texto do assistente que chegou neste quadro (já sem acentos e em minúsculas), ou "". */
  assistantText: string
  /**
   * O pulso de um acento NUCLEAR (última tônica antes da pausa de frase) acabou de passar do pico —
   * o fim da frase vem logo depois (curta ou longa; `phraseEnded` só marca pausas longas).
   */
  nuclearAccentPeak: boolean
  /** A pessoa acabou de parar de falar no microfone (fim de uma rajada enquanto a INIA ouve). */
  userBurstEnded: boolean
  /** Gesto pedido pela tela neste quadro (null = nenhum). */
  requestedGesture: GestureId | null
}

export type BehaviorContext = {
  /** Passo do quadro em segundos (já limitado). */
  dt: number
  /** Segundos acumulados desde o início do controlador (relógio da animação). */
  time: number
  rng: Rng
  state: AvatarConversationState
  /** Pesos do cross-fade entre estados (somam ~1). */
  weights: StateWeights
  speech: SpeechFrame
  /** Resposta da cabeça/sobrancelha ao acento de frase deste quadro, pelo tipo dele (`accent.ts`). */
  accent: AccentResponse
  /** Ajuste EFETIVO (já com prefers-reduced-motion aplicado). */
  tuning: AvatarTuning
  events: FrameEvents
  /** Nível do microfone da pessoa (0..1), suavizado; 0 fora de "listening". */
  userLevel: number
}

export type BoneOffsets = Record<ProceduralBone, BoneOffset>

export function createBoneOffsets(): BoneOffsets {
  const bones = {} as BoneOffsets
  for (const name of PROCEDURAL_BONES) bones[name] = { x: 0, y: 0, z: 0 }
  return bones
}

export function resetBoneOffsets(bones: BoneOffsets): void {
  for (const name of PROCEDURAL_BONES) {
    const offset = bones[name]
    offset.x = 0
    offset.y = 0
    offset.z = 0
  }
}

export function addBoneOffset(bones: BoneOffsets, name: ProceduralBone, x: number, y: number, z: number): void {
  const offset = bones[name]
  offset.x += x
  offset.y += y
  offset.z += z
}

export function createStateWeights(state: AvatarConversationState): StateWeights {
  return { idle: state === "idle" ? 1 : 0, listening: state === "listening" ? 1 : 0, thinking: state === "thinking" ? 1 : 0, speaking: state === "speaking" ? 1 : 0 }
}

/** Duração do cross-fade entre estados. */
export const STATE_BLEND_SECONDS = 0.45

const STATES: readonly AvatarConversationState[] = ["idle", "listening", "thinking", "speaking"]

/**
 * Cross-fade linear dos pesos (0,45 s para trocar tudo). Linear no peso, mas cada camada ainda
 * suaviza o próprio alvo — o resultado final não tem "quina" visível.
 */
export function updateStateWeights(weights: StateWeights, state: AvatarConversationState, dt: number): void {
  const step = dt / STATE_BLEND_SECONDS
  let total = 0
  for (const key of STATES) {
    const target = key === state ? 1 : 0
    const current = weights[key]
    weights[key] = target > current ? Math.min(target, current + step) : Math.max(target, current - step)
    total += weights[key]
  }
  if (total <= 0) {
    weights[state] = 1
    return
  }
  for (const key of STATES) weights[key] /= total
}

/** Mistura um parâmetro definido por estado com os pesos atuais. */
export function blendByState(weights: StateWeights, values: Readonly<StateWeights>): number {
  return weights.idle * values.idle + weights.listening * values.listening + weights.thinking * values.thinking + weights.speaking * values.speaking
}

export function createFrameEvents(): FrameEvents {
  return {
    stateEntered: null,
    phraseStarted: false,
    phraseEnded: false,
    phraseDuration: 0,
    endedPhraseWasQuestion: false,
    firstPhraseOfTurn: false,
    assistantText: "",
    nuclearAccentPeak: false,
    userBurstEnded: false,
    requestedGesture: null,
  }
}

/** Minúsculas e sem acentos: as regras de texto (saudação, "eu sou") não dependem de grafia. */
export function normalizeCueText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}
