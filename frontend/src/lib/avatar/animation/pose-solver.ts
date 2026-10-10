import type { Object3D } from "three"
import { Quaternion, Vector3 } from "three"

import type { Finger, Side } from "./rig-bones"
import { armBoneNames, fingerBoneName, sideSign } from "./rig-bones"

/**
 * Posiciona braços e dedos por DIREÇÕES no referencial da personagem (+X = esquerda dela, +Y =
 * cima, +Z = frente), não por ângulos locais do osso. Os eixos locais de ombro/braço do Mixamo
 * são arbitrários (e mudam de um export para outro); direção do segmento é o que o olho vê.
 * Usado SÓ na montagem (pose base e gestos): muta os ossos e quem chama restaura o repouso.
 *
 * Direções de braço são escritas para o lado ESQUERDO; o direito é espelhado (x → −x).
 */

export type Vec3 = readonly [number, number, number]

export type ArmTarget = {
  /** Direção ombro → cotovelo. */
  upper: Vec3
  /** Direção cotovelo → punho. */
  fore: Vec3
  /** Direção punho → dedos (opcional). */
  hand?: Vec3
  /** Para onde a PALMA aponta (opcional; gira o antebraço em torno do próprio eixo). */
  palm?: Vec3
}

/** Graus de flexão por falange (1, 2, 3) de cada dedo. */
export type FingerCurl = Partial<Record<Finger, readonly [number, number, number]>>

const DEG = Math.PI / 180

export class PoseSolver {
  private readonly root: Object3D
  private readonly bones: Map<string, Object3D>
  private readonly rootQuaternion = new Quaternion()
  private readonly palmLocal = new Map<Side, Vector3>()
  private readonly a = new Vector3()
  private readonly b = new Vector3()
  private readonly c = new Vector3()
  private readonly q = new Quaternion()
  private readonly q2 = new Quaternion()

  constructor(root: Object3D, bones: Map<string, Object3D>) {
    this.root = root
    this.bones = bones
    this.refresh()
    // Normal da palma medida no REPOUSO e guardada no espaço da mão (acompanha a mão depois).
    for (const side of ["Left", "Right"] as const) {
      const normal = this.measurePalmNormal(side)
      if (normal) this.palmLocal.set(side, normal)
    }
  }

  bone(name: string): Object3D | undefined {
    return this.bones.get(name)
  }

  refresh(): void {
    this.root.updateMatrixWorld(true)
    this.root.getWorldQuaternion(this.rootQuaternion).invert()
  }

  /** Posição no referencial da raiz (personagem). */
  position(object: Object3D, out: Vector3): Vector3 {
    object.getWorldPosition(out)
    return this.root.worldToLocal(out)
  }

  /** Orientação no referencial da raiz (personagem). */
  orientation(object: Object3D, out: Quaternion): Quaternion {
    object.getWorldQuaternion(out)
    return out.premultiply(this.rootQuaternion)
  }

  /** Palma atual (referencial da personagem), se o rig tem dedos para medi-la. */
  palmNormal(side: Side, out: Vector3): Vector3 | null {
    const local = this.palmLocal.get(side)
    const hand = this.bones.get(armBoneNames(side).hand)
    if (!local || !hand) return null
    return out.copy(local).applyQuaternion(this.orientation(hand, this.q2))
  }

  /** Aplica `delta` (rotação no referencial da personagem, no pivô do osso) sobre a pose atual. */
  rotateInCharacterSpace(bone: Object3D, delta: Quaternion): void {
    const parent = bone.parent
    const parentOrientation = parent ? this.orientation(parent, this.q2) : this.q2.identity()
    // L' = P⁻¹·D·P·L
    this.q.copy(parentOrientation).invert().multiply(delta).multiply(parentOrientation)
    bone.quaternion.premultiply(this.q).normalize()
    bone.updateMatrixWorld(true)
  }

  /** Gira `bone` pelo menor arco até o segmento bone → child apontar para `direction`. */
  aim(boneName: string, childName: string, direction: Vector3): boolean {
    const bone = this.bones.get(boneName)
    const child = this.bones.get(childName)
    if (!bone || !child) return false
    const from = this.position(child, this.a).sub(this.position(bone, this.b))
    if (from.lengthSq() < 1e-12) return false
    from.normalize()
    const delta = new Quaternion().setFromUnitVectors(from, this.c.copy(direction).normalize())
    this.rotateInCharacterSpace(bone, delta)
    return true
  }

  /** Gira o antebraço em torno do próprio eixo até a palma apontar o mais perto possível de `palm`. */
  twistPalm(side: Side, palm: Vector3): void {
    const names = armBoneNames(side)
    const foreArm = this.bones.get(names.foreArm)
    const hand = this.bones.get(names.hand)
    if (!foreArm || !hand) return
    const current = this.palmNormal(side, new Vector3())
    if (!current) return
    const axis = this.position(hand, new Vector3()).sub(this.position(foreArm, this.a))
    if (axis.lengthSq() < 1e-12) return
    axis.normalize()
    const from = current.addScaledVector(axis, -current.dot(axis))
    const to = new Vector3().copy(palm).addScaledVector(axis, -palm.dot(axis))
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return
    from.normalize()
    to.normalize()
    const angle = Math.atan2(this.b.crossVectors(from, to).dot(axis), from.dot(to))
    this.rotateInCharacterSpace(foreArm, new Quaternion().setFromAxisAngle(axis, angle))
  }

  /** Resolve o braço inteiro para `target` (escrito para o lado esquerdo; espelha no direito). */
  solveArm(side: Side, target: ArmTarget): void {
    const names = armBoneNames(side)
    const mirror = sideSign(side)
    const dir = (v: Vec3) => new Vector3(v[0] * mirror, v[1], v[2]).normalize()
    this.aim(names.arm, names.foreArm, dir(target.upper))
    this.aim(names.foreArm, names.hand, dir(target.fore))
    if (target.palm) this.twistPalm(side, dir(target.palm))
    if (target.hand) {
      const tip = this.bones.has(fingerBoneName(side, "Middle", 1)) ? fingerBoneName(side, "Middle", 1) : fingerBoneName(side, "Index", 1)
      this.aim(names.hand, tip, dir(target.hand))
    }
  }

  /** Flexiona os dedos em direção à palma (graus por falange). */
  curlFingers(side: Side, curl: FingerCurl): void {
    const palm = this.palmNormal(side, new Vector3())
    if (!palm) return
    for (const finger of Object.keys(curl) as Finger[]) {
      const angles = curl[finger]
      if (!angles) continue
      for (const joint of [1, 2, 3] as const) {
        const bone = this.bones.get(fingerBoneName(side, finger, joint))
        if (!bone) continue
        const next = joint < 3 ? this.bones.get(fingerBoneName(side, finger, (joint + 1) as 2 | 3)) : undefined
        const previous = joint > 1 ? this.bones.get(fingerBoneName(side, finger, (joint - 1) as 1 | 2)) : undefined
        const direction = next
          ? this.position(next, this.a).sub(this.position(bone, this.b))
          : previous
            ? this.position(bone, this.a).sub(this.position(previous, this.b))
            : null
        if (!direction || direction.lengthSq() < 1e-12) continue
        const axis = new Vector3().crossVectors(direction.normalize(), palm)
        if (axis.lengthSq() < 1e-8) continue
        this.rotateInCharacterSpace(bone, new Quaternion().setFromAxisAngle(axis.normalize(), angles[joint - 1] * DEG))
      }
    }
  }

  /**
   * Palma no repouso: o dorso da mão é (indicador − mínimo) × (direção dos dedos), com o sinal
   * trocado por lado (a mão direita é o espelho da esquerda). Guardada no espaço da mão.
   */
  private measurePalmNormal(side: Side): Vector3 | null {
    const hand = this.bones.get(armBoneNames(side).hand)
    const index = this.bones.get(fingerBoneName(side, "Index", 1))
    const outer = this.bones.get(fingerBoneName(side, "Pinky", 1)) ?? this.bones.get(fingerBoneName(side, "Ring", 1))
    const middle = this.bones.get(fingerBoneName(side, "Middle", 1)) ?? index
    if (!hand || !index || !outer || !middle) return null
    const across = this.position(index, new Vector3()).sub(this.position(outer, this.a))
    const fingers = this.position(middle, new Vector3()).sub(this.position(hand, this.a))
    const normal = new Vector3().crossVectors(across, fingers)
    if (normal.lengthSq() < 1e-12) return null
    normal.normalize().multiplyScalar(-sideSign(side))
    return normal.applyQuaternion(this.orientation(hand, new Quaternion()).invert())
  }
}
