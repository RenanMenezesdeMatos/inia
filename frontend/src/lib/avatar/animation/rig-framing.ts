import type { Object3D, PerspectiveCamera } from "three"
import { Box3, Vector3 } from "three"

import { easeInOutSine } from "./tuning"

/**
 * Enquadramento da câmera por "vista", a partir de ÂNCORAS medidas no próprio modelo (nunca uma
 * posição fixa: os dois GLBs têm cabelo/proporções diferentes).
 *
 * Âncoras: se o GLB trouxer empties `INIA_Frame_Top` (topo do cabelo), `INIA_Frame_Face` (centro
 * do rosto), `INIA_Frame_Chest` (limite inferior da vista do chat, abaixo do broche) e
 * `INIA_Frame_Belt` (limite inferior das vistas de referência, abaixo do cinto), eles mandam; senão
 * tudo sai do osso `Head`/`Spine2`/`Hips` + caixas envolventes (cabelo, cabeça, broche).
 *
 * Vistas (câmera orbitando a personagem, que olha para +Z):
 *  - chat: cabeça + ombros + peito com o broche/logo, com respiro acima do cabelo;
 *  - front / threequarter / profile / back: do topo do cabelo até logo abaixo do cinto, nos
 *    ângulos das imagens de referência (`assets/avatar/inia/ref_*.png`): 3/4 = ela virada ~35° para
 *    a esquerda dela (vemos a bochecha direita), perfil = ela olhando para a esquerda da imagem;
 *  - full: corpo inteiro.
 */

/** "presenting": de três quartos leve, virada para a DIREITA da imagem (onde fica o que ela apresenta), meio corpo, CENTRALIZADA
 * no quadro e com folga dos dois lados para o cabelo e o gesto — a sessão de feedback. */
export type AvatarView = "chat" | "front" | "threequarter" | "profile" | "back" | "full" | "presenting"

export type FramingAnchors = {
  top: number
  face: Vector3
  chestBottom: number
  belt: number
  bottom: number
  /** Metade da largura dos ombros (com braços caídos). */
  halfWidth: number
  /** Metade da profundidade do corpo+cabelo (perfil). */
  halfDepth: number
  height: number
}

type ViewSpec = { azimuthDeg: number; elevationDeg: number; fovDeg: number }

const VIEW_SPECS: Readonly<Record<AvatarView, ViewSpec>> = {
  chat: { azimuthDeg: 0, elevationDeg: 3, fovDeg: 24 },
  front: { azimuthDeg: 0, elevationDeg: 0, fovDeg: 22 },
  // Câmera do lado DIREITO dela (−X): vemos a bochecha direita, como na referência 3/4.
  threequarter: { azimuthDeg: -35, elevationDeg: 0, fovDeg: 22 },
  // Câmera do lado esquerdo dela (+X): ela aparece olhando para a esquerda da imagem.
  profile: { azimuthDeg: 90, elevationDeg: 0, fovDeg: 22 },
  back: { azimuthDeg: 180, elevationDeg: 0, fovDeg: 22 },
  full: { azimuthDeg: 0, elevationDeg: 2, fovDeg: 24 },
  presenting: { azimuthDeg: -24, elevationDeg: 2, fovDeg: 24 },
}

/**
 * Para onde ela precisa se virar (graus, + = esquerda dela) para ficar DE FRENTE para quem a vê nesta vista — a câmera é a
 * pessoa. Na vista do chat é 0 (ela já está de frente); em "presenting" a câmera fica do lado direito dela.
 */
export function viewerFacingDeg(view: AvatarView): number {
  return (VIEW_SPECS[view] ?? VIEW_SPECS.chat).azimuthDeg
}

const FRAME_EMPTIES = { top: "INIA_Frame_Top", face: "INIA_Frame_Face", chest: "INIA_Frame_Chest", belt: "INIA_Frame_Belt" } as const

function findByName(root: Object3D, pattern: RegExp): Object3D[] {
  const found: Object3D[] = []
  root.traverse((object) => {
    if (pattern.test(object.name)) found.push(object)
  })
  return found
}

function boxOf(objects: Object3D[]): Box3 | null {
  if (objects.length === 0) return null
  const box = new Box3()
  for (const object of objects) box.expandByObject(object)
  return box.isEmpty() ? null : box
}

/** Mede as âncoras com o modelo em REPOUSO (chame antes do mixer começar). */
export function computeFramingAnchors(root: Object3D, bones: Map<string, Object3D>): FramingAnchors {
  root.updateMatrixWorld(true)
  const empty = (name: string) => {
    const object = root.getObjectByName(name)
    return object ? root.worldToLocal(object.getWorldPosition(new Vector3())) : null
  }
  const bonePosition = (name: string) => {
    const bone = bones.get(name)
    return bone ? root.worldToLocal(bone.getWorldPosition(new Vector3())) : null
  }

  const all = boxOf([root]) ?? new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
  const height = Math.max(0.1, all.max.y - all.min.y)
  const head = bonePosition("Head")
  const spine2 = bonePosition("Spine2")
  const hips = bonePosition("Hips")
  const hair = boxOf(findByName(root, /^INIA_Hair/))
  const headMesh = boxOf(findByName(root, /(^INIA_Head$|head$)/i).filter((object) => (object as { isMesh?: boolean }).isMesh))
  const badge = boxOf(findByName(root, /^INIA_Badge/))

  const top = empty(FRAME_EMPTIES.top)?.y ?? Math.max(all.max.y, hair?.max.y ?? -Infinity)
  const face = empty(FRAME_EMPTIES.face)
    ?? (headMesh ? headMesh.getCenter(new Vector3()) : head ? head.clone().add(new Vector3(0, height * 0.05, height * 0.03)) : new Vector3(0, all.max.y - height * 0.1, 0))
  const chestFromBones = spine2 ? spine2.y - height * 0.045 : face.y - height * 0.2
  const chestBottom = empty(FRAME_EMPTIES.chest)?.y ?? Math.min(chestFromBones, badge ? badge.min.y - height * 0.015 : Infinity)
  const belt = empty(FRAME_EMPTIES.belt)?.y ?? (hips ? hips.y - height * 0.05 : all.min.y + height * 0.5)
  const leftArm = bonePosition("LeftArm")
  const rightArm = bonePosition("RightArm")
  const halfWidth = leftArm && rightArm ? Math.abs(leftArm.x - rightArm.x) / 2 + height * 0.06 : height * 0.14
  const halfDepth = Math.max(height * 0.1, hair ? (hair.max.z - hair.min.z) / 2 : 0)

  return { top, face, chestBottom, belt, bottom: all.min.y, halfWidth, halfDepth, height }
}

export type CameraPose = { position: Vector3; target: Vector3; fov: number }

export function createCameraPose(): CameraPose {
  return { position: new Vector3(0, 1.5, 2), target: new Vector3(0, 1.5, 0), fov: 24 }
}

/** Pose da câmera para uma vista e proporção (largura/altura). Escreve em `out`. */
export function framingFor(anchors: FramingAnchors, view: AvatarView, aspect: number, out: CameraPose): CameraPose {
  const spec = VIEW_SPECS[view] ?? VIEW_SPECS.chat
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1
  const presenting = view === "presenting"
  const margin = anchors.height * (view === "chat" ? 0.05 : presenting ? 0.045 : 0.03)
  const yMax = anchors.top + margin
  const yMin = view === "chat" ? anchors.chestBottom : view === "full" ? anchors.bottom - margin : anchors.belt
  const azimuth = (spec.azimuthDeg * Math.PI) / 180
  // Largura aparente: ombros de frente, profundidade (cabelo) de perfil.
  const side = Math.abs(Math.sin(azimuth))
  // De três quartos o cabelo ocupa mais que os ombros: "presenting" reserva a maior das duas larguras, com folga.
  const bodyHalfWidth = presenting ? Math.max(anchors.halfWidth, anchors.halfDepth) * 1.15 : (anchors.halfWidth * (1 - side) + anchors.halfDepth * side) * (view === "chat" ? 1.1 : 1.2)
  // "presenting": folga para o gesto (a mão vai para a direita da imagem, onde está o que ela apresenta). Ela fica no CENTRO do
  // quadro, então a folga vale dos dois lados — é quem exibe que põe o quadro no meio do espaço livre do palco.
  const gestureRoom = presenting ? bodyHalfWidth * 0.4 : 0
  const halfWidth = bodyHalfWidth + gestureRoom
  const halfHeight = (yMax - yMin) / 2
  const tan = Math.tan(((spec.fovDeg * Math.PI) / 180) / 2)
  const distance = Math.max(halfHeight / tan, halfWidth / (tan * safeAspect))
  const elevation = (spec.elevationDeg * Math.PI) / 180

  // "presenting": o topo do quadro fica no topo do cabelo — a cabeça dela logo abaixo do balão de fala, nunca um vazio entre
  // os dois; a sobra vertical (quadro mais alto que largo) vai para baixo, onde o corpo continua até a borda da tela.
  const targetY = presenting ? yMax - distance * tan : (yMin + yMax) / 2
  out.target.set(anchors.face.x, targetY, anchors.face.z)
  out.position.set(
    out.target.x + distance * Math.sin(azimuth) * Math.cos(elevation),
    out.target.y + distance * Math.sin(elevation),
    out.target.z + distance * Math.cos(azimuth) * Math.cos(elevation),
  )
  out.fov = spec.fovDeg
  return out
}

/** Leva a câmera até a vista pedida (transição suave de ~0,7 s; o primeiro quadro é imediato). */
export class CameraFramer {
  private readonly from = createCameraPose()
  private readonly to = createCameraPose()
  private readonly current = createCameraPose()
  private view: AvatarView | null = null
  private aspect = 0
  private progress = 1
  private initialized = false

  constructor(private readonly anchors: FramingAnchors, private readonly seconds = 0.7) {}

  update(camera: PerspectiveCamera, view: AvatarView, aspect: number, dt: number): void {
    const aspectChanged = Math.abs(aspect - this.aspect) > 1e-3
    if (view !== this.view || aspectChanged || !this.initialized) {
      framingFor(this.anchors, view, aspect, this.to)
      if (!this.initialized || (aspectChanged && view === this.view)) {
        // Primeiro quadro ou redimensionamento: sem animação (senão a câmera "passeia" ao abrir).
        this.progress = 1
      } else {
        this.from.position.copy(this.current.position)
        this.from.target.copy(this.current.target)
        this.from.fov = this.current.fov
        this.progress = 0
      }
      this.view = view
      this.aspect = aspect
      this.initialized = true
    }
    this.progress = Math.min(1, this.progress + (this.seconds > 0 ? dt / this.seconds : 1))
    const t = easeInOutSine(this.progress)
    if (t >= 1) {
      this.current.position.copy(this.to.position)
      this.current.target.copy(this.to.target)
      this.current.fov = this.to.fov
    } else {
      this.current.position.lerpVectors(this.from.position, this.to.position, t)
      this.current.target.lerpVectors(this.from.target, this.to.target, t)
      this.current.fov = this.from.fov + (this.to.fov - this.from.fov) * t
    }
    camera.position.copy(this.current.position)
    camera.lookAt(this.current.target)
    if (Math.abs(camera.fov - this.current.fov) > 1e-4) {
      camera.fov = this.current.fov
      camera.updateProjectionMatrix()
    }
  }
}
