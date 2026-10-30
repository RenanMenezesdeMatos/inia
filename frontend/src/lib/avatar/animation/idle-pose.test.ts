import { AdditiveAnimationBlendMode, AnimationMixer, LoopOnce, Quaternion, Vector3 } from "three"
import type { Object3D } from "three"
import { describe, expect, it } from "vitest"

import { GESTURE_IDS, GESTURES } from "./gesture-catalog"
import { buildGestureClips } from "./gestures"
import { buildIdlePose } from "./idle-pose"
import { collectBones, sideSign } from "./rig-bones"
import { AVATAR_MODEL_FILES, loadGlbSkeleton } from "./testing/glb-skeleton"
import { PROCEDURAL_BONES } from "./types"

function world(object: Object3D): Vector3 {
  return object.getWorldPosition(new Vector3())
}

function direction(from: Object3D, to: Object3D): Vector3 {
  return world(to).sub(world(from)).normalize()
}

function setupModel(file: string) {
  const root = loadGlbSkeleton(file)!
  const bones = collectBones(root)
  const setup = buildIdlePose(root, bones)
  const gestures = buildGestureClips(setup, root)
  const bone = (name: string) => bones.get(name)!
  return { root, bones, setup, gestures, bone }
}

describe.each(AVATAR_MODEL_FILES)("pose base e gestos — %s (esqueleto real)", (file) => {
  it("o esqueleto tem os ossos que a animação usa", () => {
    const { bones } = setupModel(file)
    for (const name of PROCEDURAL_BONES) expect(bones.has(name), name).toBe(true)
  })

  it("no repouso (A-pose) as palmas apontam para baixo (medição da palma coerente)", () => {
    const { setup } = setupModel(file)
    for (const side of ["Left", "Right"] as const) {
      const palm = setup.solver.palmNormal(side, new Vector3())!
      expect(palm.dot(new Vector3(0, -1, 0)), side).toBeGreaterThan(0.6)
    }
  })

  it("a pose base (tocada no AnimationMixer) deixa os braços caídos ao lado do corpo", () => {
    const { root, setup, bone } = setupModel(file)
    const hipsY = world(bone("Hips")).y
    const mixer = new AnimationMixer(root)
    mixer.clipAction(setup.clip).play()
    mixer.update(0.016)
    root.updateMatrixWorld(true)
    for (const side of ["Left", "Right"] as const) {
      const sign = sideSign(side)
      const upper = direction(bone(`${side}Arm`), bone(`${side}ForeArm`))
      const fore = direction(bone(`${side}ForeArm`), bone(`${side}Hand`))
      const fromVertical = (upper.angleTo(new Vector3(0, -1, 0)) * 180) / Math.PI
      expect(fromVertical, `${side} braço vs vertical`).toBeGreaterThan(5)
      expect(fromVertical, `${side} braço vs vertical`).toBeLessThan(20)
      expect(Math.sign(upper.x), `${side} braço para fora`).toBe(sign)
      const elbow = (upper.angleTo(fore) * 180) / Math.PI
      expect(elbow, `${side} cotovelo`).toBeGreaterThan(8)
      expect(elbow, `${side} cotovelo`).toBeLessThan(35)
      expect(fore.z, `${side} antebraço levemente à frente`).toBeGreaterThan(0)
      const hand = world(bone(`${side}Hand`))
      expect(hand.y, `${side} mão perto do quadril`).toBeLessThan(hipsY + 0.08)
      expect(hand.x * sign, `${side} mão fora do quadril`).toBeGreaterThan(0.15)
      // Palma voltada para a coxa (para dentro).
      const palm = setup.solver.palmNormal(side, new Vector3())!
      expect(palm.x * -sign, `${side} palma para dentro`).toBeGreaterThan(0.5)
    }
  })

  it("a pose base cobre todos os ossos procedurais com quaternions unitários (o mixer reescreve a cada quadro)", () => {
    const { setup, bones } = setupModel(file)
    const tracked = new Set(setup.clip.tracks.map((track) => track.name.replace(/\.quaternion$/, "")))
    for (const name of PROCEDURAL_BONES) expect(tracked.has(bones.get(name)!.name), name).toBe(true)
    for (const track of setup.clip.tracks) {
      expect(track.times.length).toBe(2)
      const q = new Quaternion().fromArray(track.values)
      expect(Math.abs(q.length() - 1)).toBeLessThan(1e-4)
    }
    // Montar a pose não deixa os ossos fora do repouso.
    for (const [name, rest] of setup.rest) expect(bones.get(name)!.quaternion.equals(rest), name).toBe(true)
  })

  it("gestos: clips aditivos válidos, começam e terminam na pose base", () => {
    const { gestures, bones } = setupModel(file)
    const names = new Set([...bones.values()].map((bone) => bone.name))
    for (const id of GESTURE_IDS) {
      const clip = gestures.get(id)!
      expect(clip, id).toBeDefined()
      expect(clip.blendMode).toBe(AdditiveAnimationBlendMode)
      expect(clip.duration).toBeCloseTo(GESTURES[id].seconds, 5)
      expect(clip.duration).toBeGreaterThanOrEqual(1.2)
      expect(clip.duration).toBeLessThanOrEqual(2.4)
      let moved = 0
      for (const track of clip.tracks) {
        expect(names.has(track.name.replace(/\.quaternion$/, "")), track.name).toBe(true)
        for (let index = 1; index < track.times.length; index++) expect(track.times[index]).toBeGreaterThan(track.times[index - 1]!)
        const count = track.times.length
        const first = new Quaternion().fromArray(track.values, 0)
        const last = new Quaternion().fromArray(track.values, (count - 1) * 4)
        expect(Math.abs(first.w), `${id} ${track.name} início`).toBeCloseTo(1, 4)
        expect(Math.abs(last.w), `${id} ${track.name} fim`).toBeCloseTo(1, 4)
        for (let index = 0; index < count; index++) {
          const q = new Quaternion().fromArray(track.values, index * 4)
          expect(Math.abs(q.length() - 1)).toBeLessThan(1e-3)
          moved = Math.max(moved, 2 * Math.acos(Math.min(1, Math.abs(q.w))))
        }
      }
      expect((moved * 180) / Math.PI, `${id} mexe de verdade`).toBeGreaterThan(8)
    }
  })

  it("mão no peito termina na frente do esterno; explicar leva a mão para a frente", () => {
    const { root, setup, gestures, bone } = setupModel(file)
    const sample = (id: (typeof GESTURE_IDS)[number], at: number) => {
      const mixer = new AnimationMixer(root)
      mixer.clipAction(setup.clip).play()
      const action = mixer.clipAction(gestures.get(id)!)
      action.setLoop(LoopOnce, 1)
      action.play()
      mixer.update(at * gestures.get(id)!.duration)
      root.updateMatrixWorld(true)
      const hand = world(bone("RightHand"))
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      return hand
    }
    const chest = world(bone("Spine2"))
    const neck = world(bone("Neck"))
    const aboutMe = sample("aboutMe", 0.55)
    expect(Math.abs(aboutMe.x)).toBeLessThan(0.14)
    expect(aboutMe.y).toBeGreaterThan(chest.y - 0.15)
    expect(aboutMe.y).toBeLessThan(neck.y)
    expect(aboutMe.z).toBeGreaterThan(chest.z + 0.04)
    const explain = sample("explainRight", 0.3)
    const idleHand = sample("explainRight", 0)
    expect(explain.z).toBeGreaterThan(idleHand.z + 0.15)
    expect(explain.y).toBeGreaterThan(idleHand.y + 0.1)
  })
})
