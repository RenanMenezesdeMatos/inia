import type { AnimationAction, AnimationClip, Mesh, Object3D } from "three"
import { AnimationMixer, Euler, LoopOnce, LoopRepeat, Quaternion } from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"

import type { GestureCommand, GestureId } from "./gesture-catalog"
import { buildGestureClips } from "./gestures"
import { applyLocal, buildIdlePose } from "./idle-pose"
import type { FramingAnchors } from "./rig-framing"
import { computeFramingAnchors } from "./rig-framing"
import { collectBones } from "./rig-bones"
import type { AvatarFrameOutput, AvatarQuality, ProceduralBone } from "./types"
import { ARKIT_BLENDSHAPES, HAIR_SWAY_BONE, PROCEDURAL_BONES } from "./types"

/**
 * AvatarRig — liga o comportamento (quadro do `BehaviorController`) a UMA cópia da cena do GLB.
 *
 * - Cada montagem usa o seu clone (`SkeletonUtils.clone`): o `useLoader` guarda o GLTF original
 *   em cache pela URL e um `<primitive>` só pode ter um pai — duas montagens (chat desktop +
 *   mobile, StrictMode) nunca disputam a mesma cena nem os mesmos morphs. Geometrias, materiais e
 *   texturas continuam compartilhados com o cache e NUNCA são descartados aqui.
 * - Ossos e índices de morph são resolvidos por nome uma vez; o quadro não aloca.
 * - Ordem por quadro: `mixer.update` (pose base + gestos aditivos) → rotações procedurais
 *   multiplicadas POR CIMA do resultado do mixer → morphs. Cuidado: o PropertyMixer do three.js
 *   só escreve no osso quando o valor MISTURADO muda (a pose base parada nunca é reescrita). Por
 *   isso o rig guarda o resultado do mixer de cada osso procedural e o devolve ANTES do próximo
 *   `mixer.update`: o procedural nunca acumula e o cache do mixer continua batendo com o osso.
 */

type ProceduralBinding = { bone: Object3D; parent: Quaternion; parentInverse: Quaternion; mixerResult: Quaternion }
type MorphBinding = { influences: number[]; indices: Int16Array }

const GESTURE_FADE_IN = 0.08

/** Clona a cena do cache para esta montagem (materiais/geometrias compartilhados). */
export function cloneAvatarScene(source: Object3D): Object3D {
  const scene = cloneSkinned(source)
  // A caixa envolvente do skinned mesh é a do repouso; a pose e os gestos saem dela — sem isso o
  // three.js pode "cortar" o avatar de perto.
  scene.traverse((object) => {
    object.frustumCulled = false
  })
  return scene
}

export class AvatarRig {
  readonly root: Object3D
  readonly anchors: FramingAnchors
  readonly bones: Map<string, Object3D>
  private mixer: AnimationMixer | null = null
  private readonly idleClip: AnimationClip
  private readonly gestureClips: Map<GestureId, AnimationClip>
  private readonly rest: Map<string, Quaternion>
  private readonly procedural: Array<ProceduralBinding | null>
  /** Osso de balanço do cabelo, se o esqueleto tiver (`mixerResult` aqui guarda o REPOUSO do osso). */
  private hair: ProceduralBinding | null = null
  private readonly morphs: MorphBinding[]
  private readonly hairCurls: Object3D[]
  private activeGesture: AnimationAction | null = null
  /** Os `mixerResult` valem (senão o osso ainda não passou por um quadro desde o start). */
  private mixerResultValid = false
  private quality: AvatarQuality = "high"
  private readonly euler = new Euler(0, 0, 0, "YXZ")
  private readonly q = new Quaternion()
  private readonly q2 = new Quaternion()

  constructor(root: Object3D) {
    this.root = root
    this.bones = collectBones(root)
    // Âncoras no repouso, antes de qualquer pose.
    this.anchors = computeFramingAnchors(root, this.bones)
    const setup = buildIdlePose(root, this.bones)
    this.idleClip = setup.clip
    this.rest = setup.rest
    this.gestureClips = buildGestureClips(setup, root)

    // Referencial do pai de cada osso procedural, medido NA POSE BASE (o antebraço herda o braço já
    // abaixado). Converte a rotação "da personagem" para o espaço local: L' = P⁻¹·R·P·L.
    applyLocal(setup.bones, setup.idle, root)
    setup.solver.refresh()
    this.procedural = PROCEDURAL_BONES.map((name) => {
      const bone = this.bones.get(name)
      if (!bone) return null
      const parent = bone.parent ? setup.solver.orientation(bone.parent, new Quaternion()) : new Quaternion()
      return { bone, parent, parentInverse: parent.clone().invert(), mixerResult: bone.quaternion.clone() }
    })
    // Osso de balanço do cabelo: fora do mixer (nenhum clipe o anima), então volta ao repouso a cada quadro.
    const hairBone = this.bones.get(HAIR_SWAY_BONE)
    if (hairBone) {
      const parent = hairBone.parent ? setup.solver.orientation(hairBone.parent, new Quaternion()) : new Quaternion()
      this.hair = { bone: hairBone, parent, parentInverse: parent.clone().invert(), mixerResult: hairBone.quaternion.clone() }
    }
    applyLocal(setup.bones, setup.rest, root)
    setup.solver.refresh()

    this.morphs = []
    this.hairCurls = []
    root.traverse((object) => {
      if (/^INIA_HairCurls/.test(object.name)) this.hairCurls.push(object)
      const mesh = object as Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return
      const dictionary = mesh.morphTargetDictionary
      const lower = new Map<string, number>()
      for (const [name, index] of Object.entries(dictionary)) lower.set(name.toLowerCase(), index)
      const indices = new Int16Array(ARKIT_BLENDSHAPES.length).fill(-1)
      let found = 0
      ARKIT_BLENDSHAPES.forEach((name, position) => {
        const index = dictionary[name] ?? lower.get(name.toLowerCase())
        if (index !== undefined) {
          indices[position] = index
          found++
        }
      })
      if (found > 0) this.morphs.push({ influences: mesh.morphTargetInfluences, indices })
    })
  }

  /** Começa a pose base (idempotente; o StrictMode chama start/stop/start no mesmo rig). */
  start(): void {
    if (this.mixer) return
    this.mixer = new AnimationMixer(this.root)
    const idle = this.mixer.clipAction(this.idleClip)
    idle.setLoop(LoopRepeat, Infinity)
    idle.play()
    this.mixerResultValid = false
    this.mixer.update(0)
  }

  /** Para tudo e devolve o esqueleto ao repouso (pode chamar `start` de novo depois). */
  stop(): void {
    if (!this.mixer) return
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    this.mixer = null
    this.activeGesture = null
    this.mixerResultValid = false
    for (const [name, quaternion] of this.rest) this.bones.get(name)?.quaternion.copy(quaternion)
  }

  get gestureIds(): GestureId[] {
    return [...this.gestureClips.keys()]
  }

  applyGesture(command: GestureCommand | null): void {
    if (!command || !this.mixer) return
    if (command.type === "stop") {
      this.activeGesture?.fadeOut(Math.max(0.05, command.fadeSeconds))
      this.activeGesture = null
      return
    }
    const clip = this.gestureClips.get(command.id)
    if (!clip) return
    const previous = this.activeGesture
    const action = this.mixer.clipAction(clip)
    if (previous && previous !== action) previous.fadeOut(0.3)
    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = false
    action.setEffectiveWeight(Math.max(0, command.weight))
    action.fadeIn(GESTURE_FADE_IN)
    action.play()
    this.activeGesture = action
  }

  setQuality(quality: AvatarQuality): void {
    if (quality === this.quality) return
    this.quality = quality
    for (const object of this.hairCurls) object.visible = quality !== "low"
  }

  /** Um quadro: mixer → procedural → morphs. `dt` em segundos. */
  update(dt: number, frame: AvatarFrameOutput): void {
    // Desfaz o procedural do quadro anterior (volta ao que o mixer tinha escrito).
    if (this.mixerResultValid) {
      for (const binding of this.procedural) binding?.bone.quaternion.copy(binding.mixerResult)
    }
    if (this.mixer) this.mixer.update(dt)
    for (const binding of this.procedural) binding?.mixerResult.copy(binding.bone.quaternion)
    this.mixerResultValid = true
    const bones = frame.bones
    for (let index = 0; index < PROCEDURAL_BONES.length; index++) {
      const binding = this.procedural[index]
      if (!binding) continue
      const offset = bones[PROCEDURAL_BONES[index] as ProceduralBone]
      if (!offset || (offset.x === 0 && offset.y === 0 && offset.z === 0)) continue
      this.euler.set(offset.x, offset.y, offset.z, "YXZ")
      this.q.setFromEuler(this.euler)
      this.q2.copy(binding.parentInverse).multiply(this.q).multiply(binding.parent)
      binding.bone.quaternion.premultiply(this.q2)
    }
    const hair = this.hair
    if (hair) {
      hair.bone.quaternion.copy(hair.mixerResult)
      const offset = frame.hair
      if (offset && (offset.x !== 0 || offset.y !== 0 || offset.z !== 0)) {
        this.euler.set(offset.x, offset.y, offset.z, "YXZ")
        this.q.setFromEuler(this.euler)
        this.q2.copy(hair.parentInverse).multiply(this.q).multiply(hair.parent)
        hair.bone.quaternion.premultiply(this.q2)
      }
    }
    const weights = frame.blendshapes
    for (const morph of this.morphs) {
      const { influences, indices } = morph
      for (let position = 0; position < indices.length; position++) {
        const index = indices[position]!
        if (index < 0) continue
        const value = weights[ARKIT_BLENDSHAPES[position]!]
        influences[index] = value === undefined || !Number.isFinite(value) ? 0 : value
      }
    }
  }
}

export function createAvatarRig(scene: Object3D): AvatarRig {
  return new AvatarRig(scene)
}
