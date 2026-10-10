import type { Object3D } from "three"

/**
 * Nomes dos ossos do rig (Mixamo, sem prefixo). Os dois GLBs da INIA (`inia-avatar-poc.glb` e
 * `inia-mentora.glb`) usam o MESMO esqueleto; mesmo assim tudo aqui é opcional — osso ausente é
 * simplesmente ignorado por quem o usaria.
 *
 * O GLTFLoader sanitiza nomes (`mixamorig:Hips` → `mixamorigHips`): a busca aceita os dois.
 */

export type Side = "Left" | "Right"
export const SIDES: readonly Side[] = ["Left", "Right"]

/** +1 = lado esquerdo da personagem (+X no referencial dela), −1 = direito. */
export function sideSign(side: Side): 1 | -1 {
  return side === "Left" ? 1 : -1
}

export const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const
export type Finger = (typeof FINGERS)[number]

export function fingerBoneName(side: Side, finger: Finger, joint: 1 | 2 | 3): string {
  return `${side}Hand${finger}${joint}`
}

export function armBoneNames(side: Side): { shoulder: string; arm: string; foreArm: string; hand: string } {
  return { shoulder: `${side}Shoulder`, arm: `${side}Arm`, foreArm: `${side}ForeArm`, hand: `${side}Hand` }
}

/** Todos os ossos que a pose base e os gestos podem escrever. */
export function poseBoneNames(): string[] {
  const names = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"]
  for (const side of SIDES) {
    const arm = armBoneNames(side)
    names.push(arm.shoulder, arm.arm, arm.foreArm, arm.hand)
    for (const finger of FINGERS) for (const joint of [1, 2, 3] as const) names.push(fingerBoneName(side, finger, joint))
  }
  return names
}

export function normalizeBoneName(name: string): string {
  return name.replace(/^mixamorig[:_]?/i, "")
}

/**
 * Mapa nome-canônico → osso, varrendo a cena uma vez. Prefere objetos `isBone` (um mesh ou empty
 * com o mesmo nome nunca "rouba" o osso).
 */
export function collectBones(root: Object3D): Map<string, Object3D> {
  const bones = new Map<string, Object3D>()
  const fallback = new Map<string, Object3D>()
  root.traverse((object) => {
    if (!object.name) return
    const name = normalizeBoneName(object.name)
    if ((object as Object3D & { isBone?: boolean }).isBone) {
      if (!bones.has(name)) bones.set(name, object)
    } else if (!fallback.has(name)) {
      fallback.set(name, object)
    }
  })
  // Sem nenhum osso "de verdade" (rig exportado como empties): usa os nós pelo nome.
  if (bones.size === 0) return fallback
  return bones
}
