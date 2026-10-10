import type { SpeechFrame } from "../lipsync/types"
import type { GestureId } from "./gesture-catalog"

/**
 * Contratos da animação do avatar (corpo + rosto), independentes de React.
 *
 * Camadas (todas somam sobre os MESMOS controles, cada uma com sua faixa):
 *  1. Pose base (braços relaxados) — AnimationClip estático no AnimationMixer.
 *  2. Gestos ocasionais de braços/mãos — AnimationClips aditivos no mesmo mixer.
 *  3. Procedural por quadro, aplicado DEPOIS do mixer: respiração, postura, cabeça/pescoço,
 *     olhar (morphs eyeLook*), piscadas, sorriso/sobrancelhas, e a boca (lip-sync).
 *
 * O `FaceMixer` é o único lugar que escreve morph targets; ele resolve conflitos (o sorriso
 * nunca impede o selamento dos lábios, `mouthClose ≤ jawOpen`, piscada + squint ≤ 1).
 * O `BehaviorController` é o único que decide o comportamento por estado.
 */

export type AvatarConversationState = "idle" | "listening" | "thinking" | "speaking"

export type AvatarQuality = "high" | "medium" | "low"

/** Parâmetros de ajuste expostos (laboratório e, se preciso, produto). Todos 0..2, 1 = padrão. */
export type AvatarTuning = {
  /** Amplitude e frequência dos gestos de braços/mãos (0 desliga). */
  gestureIntensity: number
  /** Amplitude da respiração. */
  breathing: number
  /** Frequência de piscadas (1 ≈ a cada 2–6 s). */
  blinkRate: number
  /** Intensidade do sorriso (base e reativo). */
  smile: number
  /** Amplitude da articulação da boca. */
  lipsync: number
  /** Movimento de cabeça/pescoço. */
  headMotion: number
  /** Micro-movimentos de olhar. */
  gaze: number
}

export const DEFAULT_AVATAR_TUNING: Readonly<AvatarTuning> = Object.freeze({
  gestureIntensity: 1,
  breathing: 1,
  blinkRate: 1,
  smile: 1,
  lipsync: 1,
  headMotion: 1,
  gaze: 1,
})

/** Dicas vindas da conversa (texto já transcrito), usadas para sorriso/gestos. Nunca por quadro. */
export type ConversationCue =
  | { type: "assistant-text"; text: string }
  | { type: "user-level"; level: number }
  | { type: "turn-started" }
  | { type: "turn-ended" }
  /** Gesto pedido pela TELA num momento de atenção (ex.: a INIA apresenta o feedback ao abrir a sessão) — toca uma vez,
   * mesmo sem fala, se nenhum gesto estiver no ar. Nunca repetido sozinho. */
  | { type: "gesture"; id: GestureId }

/**
 * Tudo o que o avatar precisa ler a cada quadro. É um objeto estável (criado uma vez pelo chat)
 * e mutável — o `useFrame` lê os campos, nunca via props/estado do React.
 */
export interface AvatarDriver {
  /** Estado da conversa (muda poucas vezes por turno). */
  readonly state: AvatarConversationState
  /** Preenche `out` com a fala no instante ouvido; `nowMs` = performance.now(). */
  sampleSpeech(out: SpeechFrame, nowMs: number): void
  /** Consome dicas pendentes (texto, nível do microfone...) — chamado pelo controlador por quadro. */
  drainCues(): ConversationCue[]
  readonly tuning: AvatarTuning
}

/** Nomes dos 52 blendshapes ARKit presentes no modelo (cabeça e olhos). */
export const ARKIT_BLENDSHAPES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  "mouthClose", "mouthFunnel", "mouthPucker", "mouthRight", "mouthLeft",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownRight", "mouthFrownLeft", "mouthDimpleLeft", "mouthDimpleRight",
  "mouthStretchLeft", "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft", "noseSneerRight", "tongueOut",
] as const

export type ArkitBlendshape = (typeof ARKIT_BLENDSHAPES)[number]

/** Pesos de blendshape por nome (0..1); ausente = 0. Saída do `FaceMixer`. */
export type BlendshapeWeights = Partial<Record<ArkitBlendshape, number>>

/** Ossos do rig (nomes Mixamo sem prefixo) que o controlador procedural pode mover. */
export const PROCEDURAL_BONES = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
] as const

export type ProceduralBone = (typeof PROCEDURAL_BONES)[number]

/**
 * Rotação aditiva em radianos, no referencial da PERSONAGEM aplicado no pivô do osso (ordem YXZ):
 * X = inclinar p/ frente (+ = frente), Y = girar (+ = p/ a esquerda dela), Z = inclinar p/ o lado
 * (+ = o lado esquerdo sobe). Na coluna/pescoço/cabeça coincide com o espaço local do osso; nos
 * ombros e braços o `AvatarRig` converte (os eixos locais do Mixamo ali são arbitrários).
 */
export type BoneOffset = { x: number; y: number; z: number }

/** Saída de um quadro do controlador de comportamento (aplicada pelo `AvatarRig`). */
export type AvatarFrameOutput = {
  blendshapes: BlendshapeWeights
  bones: Partial<Record<ProceduralBone, BoneOffset>>
}
