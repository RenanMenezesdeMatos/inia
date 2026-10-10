import type { Object3D } from "three"
import { AnimationClip, Quaternion, QuaternionKeyframeTrack } from "three"

import type { ArmTarget, FingerCurl } from "./pose-solver"
import { PoseSolver } from "./pose-solver"
import { poseBoneNames, SIDES } from "./rig-bones"

/**
 * Pose base "em pé, relaxada", construída a partir do repouso em A (braços ~39° abaixo da
 * horizontal, palmas para baixo): braços caem soltos ao lado do corpo, quase encostados no tronco como
 * nas referências (~7° de abertura: com os braços cheios da Mentora sobra ~1 cm entre braço e tronco e
 * ~2 cm entre mão/antebraço e quadril), cotovelo levemente dobrado, palmas voltadas para as coxas,
 * dedos meio curvados.
 * Tocada com peso 1 num AnimationMixer; os gestos somam por cima (aditivos) e o procedural
 * (respiração, cabeça…) é aplicado depois do mixer.
 *
 * A pose é calculada por DIREÇÕES a partir das posições reais dos ossos, então serve para os dois
 * GLBs mesmo que a orientação local dos ossos mude entre exports.
 */

export const IDLE_ARM_POSE: ArmTarget = {
  upper: [0.1, -0.99, 0.06],
  fore: [0.1, -0.95, 0.28],
  hand: [0.06, -0.96, 0.26],
  palm: [-0.95, 0, -0.25],
}

export const IDLE_FINGER_CURL: FingerCurl = {
  Thumb: [8, 10, 8],
  Index: [14, 18, 12],
  Middle: [17, 20, 14],
  Ring: [20, 23, 16],
  Pinky: [23, 26, 18],
}

export type RigPoseSetup = {
  solver: PoseSolver
  /** Ossos cobertos pela pose base (nome canônico → objeto). */
  bones: Map<string, Object3D>
  /** Quaternions locais do repouso (para restaurar depois de montar clips). */
  rest: Map<string, Quaternion>
  /** Quaternions locais da pose base. */
  idle: Map<string, Quaternion>
  clip: AnimationClip
}

/** Guarda o repouso local de todos os ossos da pose. */
export function captureLocal(bones: Map<string, Object3D>, names: Iterable<string>): Map<string, Quaternion> {
  const out = new Map<string, Quaternion>()
  for (const name of names) {
    const bone = bones.get(name)
    if (bone) out.set(name, bone.quaternion.clone())
  }
  return out
}

export function applyLocal(bones: Map<string, Object3D>, pose: Map<string, Quaternion>, root: Object3D): void {
  for (const [name, quaternion] of pose) bones.get(name)?.quaternion.copy(quaternion)
  root.updateMatrixWorld(true)
}

/**
 * Monta a pose base e devolve o clip (1 quadro, repetido) + as rotações locais de repouso e da
 * pose. Deixa os ossos no REPOUSO ao terminar (quem toca a pose é o mixer).
 */
export function buildIdlePose(root: Object3D, allBones: Map<string, Object3D>): RigPoseSetup {
  const names = poseBoneNames().filter((name) => allBones.has(name))
  const bones = new Map<string, Object3D>()
  for (const name of names) bones.set(name, allBones.get(name)!)
  const rest = captureLocal(bones, names)
  const solver = new PoseSolver(root, allBones)

  // Dedos primeiro, no repouso (a curvatura é relativa à mão e sobrevive ao reposicionar o braço).
  for (const side of SIDES) solver.curlFingers(side, IDLE_FINGER_CURL)
  for (const side of SIDES) solver.solveArm(side, IDLE_ARM_POSE)
  solver.refresh()
  const idle = captureLocal(bones, names)
  applyLocal(bones, rest, root)
  solver.refresh()

  const tracks: QuaternionKeyframeTrack[] = []
  for (const [name, quaternion] of idle) {
    const bone = bones.get(name)!
    const values = [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
    // Dois quadros iguais (0 e 1 s): clip de duração > 0, repetido — nunca "acaba".
    tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [...values, ...values]))
  }
  const clip = new AnimationClip("inia:idle-pose", 1, tracks)
  return { solver, bones, rest, idle, clip }
}
