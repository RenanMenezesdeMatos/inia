import type { Object3D } from "three"
import { Mesh, Quaternion, Vector3 } from "three"
import { describe, expect, it } from "vitest"

import { AvatarRig } from "./avatar-rig"
import { createBoneOffsets } from "./behavior/context"
import { createBlendshapeWeights } from "./face-mixer"
import { createCameraPose, framingFor } from "./rig-framing"
import { AVATAR_MODEL_FILES, loadGlbSkeleton } from "./testing/glb-skeleton"
import type { AvatarFrameOutput } from "./types"

function frame(): AvatarFrameOutput & { bones: ReturnType<typeof createBoneOffsets> } {
  return { blendshapes: createBlendshapeWeights(), bones: createBoneOffsets() }
}

function worldPosition(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, false)
  return object.getWorldPosition(new Vector3())
}

function forwardOf(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, false)
  return new Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new Quaternion()))
}

describe.each(AVATAR_MODEL_FILES)("AvatarRig — %s (esqueleto real)", (file) => {
  function createRig() {
    const root = loadGlbSkeleton(file)!
    // Malhas falsas com morphs (o GLB real tem cabeça e olhos com os 52 ARKit).
    const head = new Mesh()
    head.name = "INIA_Head"
    head.morphTargetDictionary = { jawOpen: 0, EyeBlinkLeft: 1, mouthSmileLeft: 2 }
    head.morphTargetInfluences = [0, 0, 0]
    const curls = new Mesh()
    curls.name = "INIA_HairCurls"
    root.add(head, curls)
    return { rig: new AvatarRig(root), root, head, curls }
  }

  it("o procedural multiplica sobre o mixer a cada quadro e NÃO acumula", () => {
    const { rig } = createRig()
    rig.start()
    const output = frame()
    output.bones.Head.x = 0.1
    output.bones.Spine2.z = 0.05
    const head = rig.bones.get("Head")!
    rig.update(1 / 60, output)
    const once = head.quaternion.clone()
    for (let index = 0; index < 120; index++) rig.update(1 / 60, output)
    expect(head.quaternion.angleTo(once)).toBeLessThan(1e-4)
    // Sem offset, volta exatamente à pose do mixer.
    rig.update(1 / 60, frame())
    expect(head.quaternion.angleTo(once)).toBeGreaterThan(0.09)
  })

  it("offsets no referencial da personagem: X inclina p/ frente, Y gira p/ a esquerda dela, ombro sobe com Z", () => {
    const { rig } = createRig()
    rig.start()
    rig.update(1 / 60, frame())
    const head = rig.bones.get("Head")!
    const restForward = forwardOf(head)
    const leftArm = rig.bones.get("LeftArm")!
    const restArmY = worldPosition(leftArm).y

    const nod = frame()
    nod.bones.Head.x = 0.2
    rig.update(1 / 60, nod)
    expect(forwardOf(head).y).toBeLessThan(restForward.y - 0.1)

    const turn = frame()
    turn.bones.Head.y = 0.3
    rig.update(1 / 60, turn)
    expect(forwardOf(head).x).toBeGreaterThan(restForward.x + 0.2)

    const shrug = frame()
    shrug.bones.LeftShoulder.z = 0.15
    rig.update(1 / 60, shrug)
    expect(worldPosition(leftArm).y).toBeGreaterThan(restArmY + 0.005)
  })

  it("morphs por nome (inclusive com grafia diferente) e cachos escondidos na qualidade baixa", () => {
    const { rig, head, curls } = createRig()
    rig.start()
    const output = frame()
    output.blendshapes.jawOpen = 0.4
    output.blendshapes.eyeBlinkLeft = 1
    output.blendshapes.mouthSmileLeft = Number.NaN
    rig.update(1 / 60, output)
    expect(head.morphTargetInfluences).toEqual([0.4, 1, 0])
    rig.setQuality("low")
    expect(curls.visible).toBe(false)
    rig.setQuality("medium")
    expect(curls.visible).toBe(true)
  })

  it("start/stop são reversíveis (StrictMode) e o stop devolve o repouso", () => {
    const { rig } = createRig()
    const arm = rig.bones.get("LeftArm")!
    const rest = arm.quaternion.clone()
    rig.start()
    rig.update(1 / 60, frame())
    expect(arm.quaternion.angleTo(rest)).toBeGreaterThan(0.3)
    rig.stop()
    expect(arm.quaternion.angleTo(rest)).toBeLessThan(1e-3)
    rig.start()
    rig.start()
    rig.update(1 / 60, frame())
    expect(arm.quaternion.angleTo(rest)).toBeGreaterThan(0.3)
  })

  it("gesto toca por cima da pose base e some ao terminar", () => {
    const { rig } = createRig()
    rig.start()
    rig.update(1 / 60, frame())
    const hand = rig.bones.get("RightHand")!
    const idle = worldPosition(hand)
    rig.applyGesture({ type: "play", id: "explainRight", weight: 1 })
    for (let index = 0; index < 36; index++) rig.update(1 / 60, frame())
    expect(worldPosition(hand).distanceTo(idle)).toBeGreaterThan(0.12)
    for (let index = 0; index < 120; index++) rig.update(1 / 60, frame())
    expect(worldPosition(hand).distanceTo(idle)).toBeLessThan(0.005)
  })

  it("enquadramento: chat mostra rosto + peito; vistas nos ângulos das referências", () => {
    const { rig } = createRig()
    const anchors = rig.anchors
    const neck = worldPosition(rig.bones.get("Neck")!)
    const chat = framingFor(anchors, "chat", 1.4, createCameraPose())
    expect(chat.target.y).toBeGreaterThan(anchors.chestBottom)
    expect(anchors.chestBottom).toBeLessThan(neck.y)
    expect(chat.position.z).toBeGreaterThan(chat.target.z + 0.5)
    const front = framingFor(anchors, "front", 0.7, createCameraPose())
    expect(front.target.y).toBeLessThan(chat.target.y)
    const threeQuarter = framingFor(anchors, "threequarter", 0.7, createCameraPose())
    const angle = (Math.atan2(threeQuarter.position.x - threeQuarter.target.x, threeQuarter.position.z - threeQuarter.target.z) * 180) / Math.PI
    expect(angle).toBeCloseTo(-35, 0)
    expect(framingFor(anchors, "profile", 0.7, createCameraPose()).position.x).toBeGreaterThan(1)
    expect(framingFor(anchors, "back", 0.7, createCameraPose()).position.z).toBeLessThan(0)
    const full = framingFor(anchors, "full", 0.7, createCameraPose())
    expect(full.position.distanceTo(full.target)).toBeGreaterThan(front.position.distanceTo(front.target))
  })

  it("enquadramento 'presenting': quadro alto → o topo do cabelo fica no topo do quadro (a sobra vai para baixo)", () => {
    const { rig } = createRig()
    const anchors = rig.anchors
    const halfFov = (24 * Math.PI) / 360
    const topOf = (pose: ReturnType<typeof createCameraPose>) => pose.target.y + pose.position.distanceTo(pose.target) * Math.tan(halfFov)
    const tall = framingFor(anchors, "presenting", 0.6, createCameraPose())
    const wide = framingFor(anchors, "presenting", 2, createCameraPose())
    // Mesmo topo (logo acima do cabelo) nas duas proporções; no quadro alto o centro desce.
    expect(Math.abs(topOf(tall) - topOf(wide))).toBeLessThan(anchors.height * 0.02)
    expect(topOf(tall)).toBeGreaterThan(anchors.top)
    expect(tall.target.y).toBeLessThan(wide.target.y)
    // Centralizada: o alvo da câmera fica no rosto (na horizontal), sem empurrá-la para um lado do quadro.
    expect(tall.target.x).toBeCloseTo(anchors.face.x, 6)
    expect(tall.target.z).toBeCloseTo(anchors.face.z, 6)
  })
})
