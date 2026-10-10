import { closeSync, existsSync, openSync, readSync } from "node:fs"
import { resolve } from "node:path"

import { Bone, Group, Object3D, Quaternion, Vector3 } from "three"

/**
 * Só para testes: reconstrói a HIERARQUIA de nós de um GLB real (transformações de repouso,
 * ossos como `Bone`) lendo apenas o chunk JSON — sem malhas, texturas nem GLTFLoader (que precisa
 * de DOM/ImageBitmap). É o bastante para validar pose base, gestos e enquadramento contra o
 * esqueleto verdadeiro dos modelos da INIA.
 */

type GltfNode = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }
type GltfJson = { nodes: GltfNode[]; scenes?: Array<{ nodes: number[] }>; scene?: number; skins?: Array<{ joints: number[] }> }

export const MODELS_DIR = resolve(__dirname, "../../../../../public/models")

export function modelPath(file: string): string {
  return resolve(MODELS_DIR, file)
}

export function readGlbJson(path: string): GltfJson {
  const fd = openSync(path, "r")
  try {
    const header = Buffer.alloc(20)
    readSync(fd, header, 0, 20, 0)
    if (header.readUInt32LE(0) !== 0x46546c67) throw new Error(`não é GLB: ${path}`)
    const length = header.readUInt32LE(12)
    const json = Buffer.alloc(length)
    readSync(fd, json, 0, length, 20)
    return JSON.parse(json.toString("utf8")) as GltfJson
  } finally {
    closeSync(fd)
  }
}

/** Raiz (Group) com a hierarquia do GLB; nós do skin viram `Bone`. */
export function loadGlbSkeleton(file: string): Object3D | null {
  const path = modelPath(file)
  if (!existsSync(path)) return null
  const gltf = readGlbJson(path)
  const joints = new Set(gltf.skins?.flatMap((skin) => skin.joints) ?? [])
  const objects = gltf.nodes.map((node, index) => {
    const object = joints.has(index) ? new Bone() : new Object3D()
    object.name = node.name ?? ""
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.copy(new Quaternion().fromArray(node.rotation))
    if (node.scale) object.scale.copy(new Vector3().fromArray(node.scale))
    return object
  })
  gltf.nodes.forEach((node, index) => node.children?.forEach((child) => objects[index].add(objects[child])))
  const root = new Group()
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  const rootNodes = scene?.nodes ?? gltf.nodes.map((_, index) => index).filter((index) => !objects[index].parent)
  for (const index of rootNodes) root.add(objects[index])
  root.updateMatrixWorld(true)
  return root
}

/** Os modelos que existirem no repositório (o `inia-mentora.glb` ainda pode não ter chegado). */
export const AVATAR_MODEL_FILES = ["inia-avatar-poc.glb", "inia-mentora.glb"].filter((file) => existsSync(modelPath(file)))
