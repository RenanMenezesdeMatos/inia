// Etapa 08 (parte Node) — carrega o GLB com o GLTFLoader do three.js do frontend e confere o contrato.
//
//   node tools/avatar/inia-realista-v02/lib/export_three_check.mjs [frontend/public/models/inia-mentora-v02.glb] [--json <saida.json>]
//
// No Node não há DOM/ImageBitmap: as texturas podem falhar ao decodificar (esperado; o teste é do
// grafo de cena, skinning, morphs, ossos e extras). Sai com código ≠ 0 se algo do contrato faltar.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null
const file = resolve(repo, args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--json") ?? "frontend/public/models/inia-mentora-v02.glb")
const three = resolve(repo, "frontend/node_modules/three")
const THREE = await import(pathToFileURL(resolve(three, "build/three.module.js")).href)
const { GLTFLoader } = await import(pathToFileURL(resolve(three, "examples/jsm/loaders/GLTFLoader.js")).href)

globalThis.self ??= globalThis
const quiet = console.error
const textureErrors = []
console.error = (...m) => (String(m[0]).includes("texture") ? textureErrors.push(String(m[0])) : quiet(...m))
console.warn = () => {}

const buffer = readFileSync(file)
const gltf = await new Promise((ok, fail) =>
  new GLTFLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "", ok, fail))
console.error = quiet

const CONTRACT = ["INIA_Rig", "INIA_Body", "INIA_Head", "INIA_Eyes", "INIA_Polo", "INIA_Logos", "INIA_Badge", "INIA_Hair", "INIA_HairCurls"]
const FRAMES = ["INIA_Frame_Top", "INIA_Frame_Face", "INIA_Frame_Chest", "INIA_Frame_Belt"]
const errors = []
const report = { file, bytes: buffer.byteLength, objects: {}, frames: {}, textureErrors: textureErrors.length }

const scene = gltf.scene
scene.updateMatrixWorld(true)
for (const name of [...CONTRACT, ...FRAMES]) if (!scene.getObjectByName(name)) errors.push(`objeto ausente: ${name}`)

const skinned = []
const bones = new Set()
scene.traverse((o) => {
  if (o.isBone) bones.add(o.name)
  if (!o.isMesh) return
  const owner = CONTRACT.includes(o.name) ? o.name : CONTRACT.includes(o.parent?.name) && o.parent.name !== "INIA_Rig" ? o.parent.name : `${o.name} (pai ${o.parent?.name})`
  const entry = (report.objects[owner] ??= { meshes: 0, skinned: 0, triangles: 0, morphs: 0, vertexColors: false, materials: [] })
  entry.meshes++
  entry.triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
  if (o.isSkinnedMesh) { entry.skinned++; skinned.push(o) }
  if (o.morphTargetDictionary) entry.morphs = Object.keys(o.morphTargetDictionary).length
  if (o.geometry.attributes.color) entry.vertexColors = true
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  for (const m of mats) entry.materials.push(`${m.name}${m.alphaTest ? ` (alphaTest ${m.alphaTest})` : ""}${m.transparent ? " (transparent)" : ""}`)
})
for (const [name, entry] of Object.entries(report.objects)) {
  if (entry.skinned !== entry.meshes) errors.push(`${name}: ${entry.meshes - entry.skinned} malha(s) sem skin`)
}
report.bones = bones.size
report.skeletons = [...new Set(skinned.map((m) => m.skeleton))].map((s) => s.bones.length)
if (bones.size !== 55) errors.push(`esperava 55 ossos, achei ${bones.size}`)

const ARKIT_CHECK = ["eyeBlinkLeft", "eyeLookInRight", "jawOpen", "mouthSmileLeft", "mouthFunnel", "tongueOut", "cheekPuff", "browInnerUp"]
for (const name of ["INIA_Head", "INIA_Eyes"]) {
  const root = scene.getObjectByName(name)
  const meshes = []
  root?.traverse((o) => o.isMesh && meshes.push(o))
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary ?? {}
    const names = Object.keys(dict)
    if (names.length !== 52) errors.push(`${name}/${mesh.name}: ${names.length} morphs`)
    for (const key of ARKIT_CHECK) if (!(key in dict)) errors.push(`${name}: morph ${key} ausente`)
    if (!mesh.geometry.morphAttributes.normal) errors.push(`${name}: morphs sem normais`)
  }
  if (report.objects[name]) report.objects[name].morphNames = meshes[0] ? Object.keys(meshes[0].morphTargetDictionary ?? {}).slice(0, 6) : []
}

for (const name of FRAMES) {
  const o = scene.getObjectByName(name)
  if (o) report.frames[name] = o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4))
}
const f = report.frames
if (!(f.INIA_Frame_Top?.[1] > f.INIA_Frame_Face?.[1] && f.INIA_Frame_Face[1] > f.INIA_Frame_Chest[1] && f.INIA_Frame_Chest[1] > f.INIA_Frame_Belt[1]))
  errors.push("empties fora de ordem (Top > Face > Chest > Belt em Y)")
const faceZ = f.INIA_Frame_Face?.[2] ?? 0
const hairBack = new THREE.Box3().setFromObject(scene.getObjectByName("INIA_Hair")).min.z
if (!(faceZ > hairBack)) errors.push("a personagem deveria olhar para +Z (rosto à frente do cabelo)")

report.rig = { extras: scene.getObjectByName("INIA_Rig")?.userData ?? {}, rootChildren: scene.children.map((c) => c.name) }
report.animations = gltf.animations.length
report.copyright = gltf.parser.json.asset.copyright
if (gltf.animations.length) errors.push("o GLB não deveria ter animações")
report.errors = errors
if (jsonOut) writeFileSync(resolve(repo, jsonOut), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ok: errors.length === 0, bones: report.bones, skeletons: report.skeletons, frames: report.frames, textureErrors: report.textureErrors, errors }, null, 0))
process.exit(errors.length ? 1 : 0)
