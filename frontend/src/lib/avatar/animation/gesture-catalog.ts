/**
 * Catálogo dos gestos (metadados puros, sem three.js): o agendador decide QUANDO e QUAL, o
 * `gestures.ts` constrói os AnimationClips aditivos com as mesmas durações.
 *
 * `kind` agrupa variações do mesmo gesto (mão direita/esquerda): "nunca o mesmo gesto duas vezes
 * seguidas" vale por tipo — explicar com a direita e logo depois com a esquerda ainda é repetir.
 */

export const GESTURE_IDS = ["explainRight", "explainLeft", "welcome", "aboutMe", "beatRight", "beatLeft", "listenShift"] as const

export type GestureId = (typeof GESTURE_IDS)[number]

export type GestureKind = "explain" | "welcome" | "aboutMe" | "beat" | "listenShift"

export type GestureInfo = {
  kind: GestureKind
  /** Duração do clip (s), com entrada e saída suaves embutidas. */
  seconds: number
  /** Só no estado "listening" (os demais: só falando). */
  listening: boolean
}

export const GESTURES: Readonly<Record<GestureId, GestureInfo>> = {
  explainRight: { kind: "explain", seconds: 1.9, listening: false },
  explainLeft: { kind: "explain", seconds: 1.9, listening: false },
  welcome: { kind: "welcome", seconds: 2.3, listening: false },
  aboutMe: { kind: "aboutMe", seconds: 2.1, listening: false },
  beatRight: { kind: "beat", seconds: 1.3, listening: false },
  beatLeft: { kind: "beat", seconds: 1.3, listening: false },
  listenShift: { kind: "listenShift", seconds: 2.4, listening: true },
}

/** Comando do agendador para o rig (aplicado no AnimationMixer). */
export type GestureCommand =
  | { type: "play"; id: GestureId; weight: number }
  | { type: "stop"; fadeSeconds: number }
