import type { Scene, WebGLRenderer } from "three"
import { Color, DirectionalLight, Group, HemisphereLight, NeutralToneMapping, PMREMGenerator, SRGBColorSpace } from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

/**
 * Iluminação de estúdio do avatar — um módulo sem React para que o componente e o harness de
 * render do laboratório usem EXATAMENTE as mesmas luzes.
 *
 * Personagem estilizada (pele quente, polo roxa, cabelo escuro): luz principal quente e suave
 * vinda da esquerda da câmera (acima dos olhos, ~30°), preenchimento frio e fraco do outro lado
 * (a sombra não fica preta nem suja), duas luzes de recorte por trás (separam cabelo e ombros do
 * fundo claro) e um RoomEnvironment pré-filtrado (PMREM) só para reflexos/ambiente — nada de HDR
 * baixado da rede. Saída sRGB + tone mapping Neutral (Khronos PBR Neutral): mantém as cores da
 * marca (o ACES padrão do R3F dessatura e escurece o roxo).
 *
 * Luzes direcionais: a posição é só a DIREÇÃO (o alvo fica na origem).
 * Calibrado em renders do `inia-avatar-poc.glb` (2026-09-25): menos ambiente escurece a órbita dos
 * olhos e o olhar fica "sonolento"; luz principal mais quente deixa a pele laranja.
 */

export const STUDIO_EXPOSURE = 1
export const STUDIO_ENVIRONMENT_INTENSITY = 0.42

export function configureStudioRenderer(renderer: WebGLRenderer): void {
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = STUDIO_EXPOSURE
}

export function createStudioLights(): Group {
  const group = new Group()
  group.name = "INIA_StudioLights"
  const hemisphere = new HemisphereLight(new Color("#fbf6f2"), new Color("#6b5a7c"), 0.6)
  const key = new DirectionalLight(new Color("#fff0e4"), 2.2)
  key.position.set(-2.1, 2.0, 3.2)
  const fill = new DirectionalLight(new Color("#e2dcff"), 0.55)
  fill.position.set(2.8, 0.8, 2.4)
  const rimLeft = new DirectionalLight(new Color("#d3c4ff"), 1.4)
  rimLeft.position.set(-2.4, 2.2, -2.6)
  const rimRight = new DirectionalLight(new Color("#ffd8c0"), 0.9)
  rimRight.position.set(2.4, 1.6, -2.4)
  group.add(hemisphere, key, fill, rimLeft, rimRight)
  return group
}

/**
 * Coloca o RoomEnvironment pré-filtrado em `scene.environment`. Devolve a limpeza (libera a
 * textura PMREM e só remove o ambiente se ainda for o nosso).
 */
export function applyStudioEnvironment(renderer: WebGLRenderer, scene: Scene): () => void {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const target = pmrem.fromScene(room, 0.04)
  room.dispose()
  pmrem.dispose()
  scene.environment = target.texture
  scene.environmentIntensity = STUDIO_ENVIRONMENT_INTENSITY
  return () => {
    if (scene.environment === target.texture) scene.environment = null
    target.dispose()
  }
}
