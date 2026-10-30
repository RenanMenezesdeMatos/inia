import type { Object3D } from "three"
import { AdditiveAnimationBlendMode, AnimationClip, AnimationUtils, Quaternion, QuaternionKeyframeTrack } from "three"

import type { GestureId } from "./gesture-catalog"
import { GESTURE_IDS, GESTURES } from "./gesture-catalog"
import type { RigPoseSetup } from "./idle-pose"
import { applyLocal, captureLocal } from "./idle-pose"
import type { ArmTarget } from "./pose-solver"
import type { Side } from "./rig-bones"
import { armBoneNames, SIDES } from "./rig-bones"
import { easeInOutSine } from "./tuning"

/**
 * Gestos de braço como AnimationClips ADITIVOS (três.js `AnimationUtils.makeClipAdditive`),
 * construídos em código sobre a pose base: cada gesto é uma sequência de "fases" (poses por
 * direção, ver `PoseSolver`) com ease in/out senoidal entre elas; o primeiro e o último quadro são
 * a própria pose base, então o delta começa e termina em zero — o gesto entra e sai sem fade.
 *
 * Direções no referencial da personagem para o braço ESQUERDO (+X = para fora); o direito é
 * espelhado. `null` = braço na pose base.
 */

type Phase = { at: number; Left?: ArmTarget | null; Right?: ArmTarget | null }

/*
 * Altura: as mãos sobem até o peito (≈ altura do broche) — é onde se gesticula conversando e é o
 * que aparece no enquadramento do chat (cabeça + peito); gesto na cintura seria invisível ali.
 */
/*
 * A palma é sempre perpendicular à direção dos dedos (senão o solver "briga" entre torcer o
 * antebraço e apontar a mão).
 */
/** Mão aberta "apresentando": dedos para a frente/fora, palma para cima, na frente do peito. */
const EXPLAIN_OPEN: ArmTarget = { upper: [0.22, -0.86, 0.46], fore: [0.12, 0.5, 0.86], hand: [0.3, 0.2, 0.93], palm: [-0.12, 0.98, -0.18] }
const EXPLAIN_BEAT: ArmTarget = { upper: [0.22, -0.88, 0.42], fore: [0.15, 0.32, 0.94], hand: [0.32, 0.08, 0.94], palm: [-0.08, 0.99, -0.06] }
/** Os dois braços abertos, palmas para cima (boas-vindas). */
const WELCOME_OPEN: ArmTarget = { upper: [0.45, -0.8, 0.4], fore: [0.55, 0.5, 0.67], hand: [0.7, 0.3, 0.65], palm: [-0.4, 0.9, 0.02] }
const WELCOME_HOLD: ArmTarget = { upper: [0.42, -0.82, 0.39], fore: [0.5, 0.4, 0.77], hand: [0.66, 0.22, 0.72], palm: [-0.35, 0.93, 0.04] }
/** Mão no peito ("sobre mim"): cotovelo para fora/frente, mão sobe até o esterno, palma no corpo. */
const ABOUT_ME: ArmTarget = { upper: [0.3, -0.78, 0.55], fore: [-0.75, 0.46, 0.46], hand: [-0.8, 0.5, 0.2], palm: [-0.17, 0.11, -0.96] }
/** Batida pequena: mão "de lado" (palma para dentro) na frente do peito, desce uma vez. */
const BEAT_UP: ArmTarget = { upper: [0.2, -0.9, 0.38], fore: [0.02, 0.5, 0.87], hand: [0.1, 0.25, 0.96], palm: [-0.99, 0.05, 0.1] }
const BEAT_DOWN: ArmTarget = { upper: [0.2, -0.92, 0.34], fore: [0.04, 0.25, 0.97], hand: [0.1, 0.05, 0.99], palm: [-0.99, 0, 0.1] }
/** Ouvindo: as mãos se acomodam um pouco para a frente e voltam. */
const LISTEN_SHIFT: ArmTarget = { upper: [0.18, -0.97, 0.14], fore: [0.2, -0.82, 0.54], hand: [0.14, -0.84, 0.52], palm: [-0.95, 0, -0.1] }

const oneHand = (side: Side, poses: readonly (readonly [number, ArmTarget | null])[]): Phase[] =>
  poses.map(([at, pose]) => ({ at, [side]: pose }))

export const GESTURE_PHASES: Readonly<Record<GestureId, readonly Phase[]>> = {
  explainRight: oneHand("Right", [[0, null], [0.3, EXPLAIN_OPEN], [0.52, EXPLAIN_BEAT], [0.72, EXPLAIN_OPEN], [1, null]]),
  explainLeft: oneHand("Left", [[0, null], [0.3, EXPLAIN_OPEN], [0.52, EXPLAIN_BEAT], [0.72, EXPLAIN_OPEN], [1, null]]),
  welcome: [
    { at: 0, Left: null, Right: null },
    { at: 0.35, Left: WELCOME_OPEN, Right: WELCOME_OPEN },
    { at: 0.68, Left: WELCOME_HOLD, Right: WELCOME_HOLD },
    { at: 1, Left: null, Right: null },
  ],
  aboutMe: oneHand("Right", [[0, null], [0.38, ABOUT_ME], [0.7, ABOUT_ME], [1, null]]),
  beatRight: oneHand("Right", [[0, null], [0.35, BEAT_UP], [0.55, BEAT_DOWN], [1, null]]),
  beatLeft: oneHand("Left", [[0, null], [0.35, BEAT_UP], [0.55, BEAT_DOWN], [1, null]]),
  listenShift: [
    { at: 0, Left: null, Right: null },
    { at: 0.45, Left: LISTEN_SHIFT, Right: LISTEN_SHIFT },
    { at: 1, Left: null, Right: null },
  ],
}

/** Amostragem dos clips (as fases têm ease; o mixer interpola linearmente entre as amostras). */
export const GESTURE_FPS = 30

function armBones(): string[] {
  const names: string[] = []
  for (const side of SIDES) {
    const arm = armBoneNames(side)
    names.push(arm.arm, arm.foreArm, arm.hand)
  }
  return names
}

/**
 * Constrói todos os gestos para este rig. Deixa os ossos no REPOUSO ao terminar.
 * Gestos cujos ossos não existem no rig simplesmente não entram no mapa.
 */
export function buildGestureClips(setup: RigPoseSetup, root: Object3D): Map<GestureId, AnimationClip> {
  const clips = new Map<GestureId, AnimationClip>()
  const names = armBones().filter((name) => setup.bones.has(name))
  if (names.length === 0) return clips

  for (const id of GESTURE_IDS) {
    const phases = GESTURE_PHASES[id]
    const solved: Map<string, Quaternion>[] = phases.map((phase) => {
      applyLocal(setup.bones, setup.idle, root)
      setup.solver.refresh()
      for (const side of SIDES) {
        const target = phase[side]
        if (target) setup.solver.solveArm(side, target)
      }
      return captureLocal(setup.bones, names)
    })

    const seconds = GESTURES[id].seconds
    const frameCount = Math.max(2, Math.round(seconds * GESTURE_FPS) + 1)
    const times = new Float32Array(frameCount)
    const values = new Map<string, Float32Array>()
    for (const name of names) values.set(name, new Float32Array(frameCount * 4))
    const sample = new Quaternion()
    let segment = 0
    for (let frame = 0; frame < frameCount; frame++) {
      const u = frame / (frameCount - 1)
      times[frame] = u * seconds
      while (segment < phases.length - 2 && u > phases[segment + 1]!.at) segment++
      const from = phases[segment]!
      const to = phases[segment + 1]!
      const span = Math.max(1e-6, to.at - from.at)
      const eased = easeInOutSine((u - from.at) / span)
      for (const name of names) {
        const a = solved[segment]!.get(name)!
        const b = solved[segment + 1]!.get(name)!
        sample.slerpQuaternions(a, b, eased)
        values.get(name)!.set([sample.x, sample.y, sample.z, sample.w], frame * 4)
      }
    }
    const tracks = names.map((name) => new QuaternionKeyframeTrack(`${setup.bones.get(name)!.name}.quaternion`, Array.from(times), Array.from(values.get(name)!)))
    const absolute = new AnimationClip(`inia:gesture:${id}`, seconds, tracks)
    // Quadro 0 = pose base: o clip vira "delta sobre a pose base" (começa e termina em identidade).
    const additive = AnimationUtils.makeClipAdditive(absolute, 0)
    additive.blendMode = AdditiveAnimationBlendMode
    clips.set(id, additive)
  }

  applyLocal(setup.bones, setup.rest, root)
  setup.solver.refresh()
  return clips
}
