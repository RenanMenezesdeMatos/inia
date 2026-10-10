import type { MouthChannels } from "../lipsync/types"
import { REST_MOUTH } from "../lipsync/types"
import { clamp, clamp01 } from "./tuning"
import type { BlendshapeWeights } from "./types"
import { ARKIT_BLENDSHAPES } from "./types"

/**
 * FaceMixer — o ÚNICO lugar que decide os pesos dos blendshapes do rosto.
 *
 * Três camadas chegam aqui e disputam os mesmos morphs:
 *  - boca (canais articulatórios do lip-sync, `MouthChannels`);
 *  - expressão (sorriso, bochechas, sobrancelhas, apertar/arregalar os olhos);
 *  - olhos (piscada + olhar).
 * As regras abaixo vieram de renders verificados do modelo (auditoria de 2026-09-24):
 *  - `mouthClose` sozinho "infla" os lábios: ele só existe como fração da mandíbula aberta
 *    (`mouthClose = lipClose × jawOpen`, logo nunca passa de `jawOpen`);
 *  - `jawOpen` acima de ~0,7 lê como grito; `mouthPress` acima de 0,5 deforma;
 *  - selar os lábios (p/b/m) precisa VENCER o sorriso: `lipClose` pressiona e suprime
 *    sorriso/estiramento/lábio superior/inferior, senão a INIA "fala m sorrindo" de boca aberta;
 *  - o sorriso cede proporcionalmente à mandíbula e ao arredondamento (o/u com sorriso cheio vira
 *    careta); a parte "dos olhos" do sorriso (bochecha/squint) continua — é o que mantém o
 *    calor do rosto enquanto a boca articula;
 *  - piscada + squint nunca passam de 1 por olho (somados, fecham o olho duas vezes);
 *  - `eyeLook*` = 1 gira o olho 22–33°: o olhar usa valores pequenos (graus → morph).
 * Morphs da fala que o modelo tem com geometria e que a articulação passou a usar (2026-10-07):
 *  - compressão labial (p > b > m, canal `lipCompress`, só com o selo): `mouthRollUpper`,
 *    `mouthRollLower`, `mouthShrugLower` (queixo empurra o lábio inferior) e um mínimo de
 *    `cheekPuff` (pressão da oclusiva) — sem isso o selo lê como lábios só encostados;
 *  - `jawForward` nas sibilantes (canal `jawForward`): a mandíbula avança para alinhar os incisivos;
 *  - micro-assimetria: `mouthLeft/Right` pequeno, crescendo com a articulação (a boca de ninguém
 *    abre igual dos dois lados). `tongueOut` não tem geometria no modelo e nunca é escrito.
 */

export const MAX_JAW_OPEN = 0.7
export const MAX_MOUTH_PRESS = 0.5
/** `jawForward` = 1 avança o queixo ~9 mm no modelo: a sibilante usa no máximo isto. */
export const MAX_JAW_FORWARD = 0.3
/** Deslocamento lateral máximo da boca (`mouthLeft/Right`) da micro-assimetria. */
export const MAX_MOUTH_SHIFT = 0.08
/** Graus de rotação do olho por unidade de `eyeLook*` (medido: 22–33° em 1,0). */
export const EYE_LOOK_DEGREES_PER_UNIT = 27
/** Olhar nunca passa disso (≈13°): mais que isso, a cabeça é quem vira. */
export const MAX_EYE_LOOK = 0.5

export type FaceExpression = {
  /** Sorriso 0..1 (os dois lados). */
  smile: number
  /** -1..1: + = mais do lado ESQUERDO da personagem. */
  smileAsymmetry: number
  cheekSquint: number
  browInnerUp: number
  browOuterUp: number
  browDown: number
  /** -1..1: + = sobrancelha externa ESQUERDA mais alta. */
  browAsymmetry: number
  eyeSquint: number
  eyeWide: number
  /** -1..1: lado e força da micro-assimetria da boca ao falar (+ = para a ESQUERDA da personagem). */
  mouthAsymmetry: number
}

export type FaceMixInput = {
  mouth: MouthChannels
  expression: FaceExpression
  blinkLeft: number
  blinkRight: number
  /** Graus; + = para a ESQUERDA da personagem. */
  gazeYawDeg: number
  /** Graus; + = para cima. */
  gazePitchDeg: number
  /** `AvatarTuning.lipsync` (0..2): escala a articulação; 0 desliga a boca. */
  lipsync: number
}

export function createFaceExpression(): FaceExpression {
  return {
    smile: 0,
    smileAsymmetry: 0,
    cheekSquint: 0,
    browInnerUp: 0,
    browOuterUp: 0,
    browDown: 0,
    browAsymmetry: 0,
    eyeSquint: 0,
    eyeWide: 0,
    mouthAsymmetry: 0,
  }
}

export function createFaceMixInput(): FaceMixInput {
  return {
    mouth: { ...REST_MOUTH },
    expression: createFaceExpression(),
    blinkLeft: 0,
    blinkRight: 0,
    gazeYawDeg: 0,
    gazePitchDeg: 0,
    lipsync: 1,
  }
}

/** Todos os 52 nomes com 0 — o objeto de saída é reaproveitado a cada quadro. */
export function createBlendshapeWeights(): BlendshapeWeights {
  const weights: BlendshapeWeights = {}
  for (const name of ARKIT_BLENDSHAPES) weights[name] = 0
  return weights
}

/** Mistura as camadas em `out` (sem alocar) e devolve `out`. Função pura sobre as entradas. */
export function mixFace(input: FaceMixInput, out: BlendshapeWeights): BlendshapeWeights {
  for (const name of ARKIT_BLENDSHAPES) out[name] = 0
  const { mouth, expression } = input
  const scale = Number.isFinite(input.lipsync) ? clamp(input.lipsync, 0, 2) : 1

  // --- Boca -------------------------------------------------------------------------------
  const jaw = Math.min(MAX_JAW_OPEN, clamp01(mouth.jaw * scale))
  // Fechar os lábios é informação (p/b/m), não amplitude: meia escala já fecha por completo.
  const seal = clamp01(mouth.lipClose * Math.min(1, scale * 2))
  const open = 1 - seal
  const round = clamp01(mouth.round * scale * 1.05)
  const pucker = clamp01(mouth.pucker * scale * 1.05)
  const tuck = clamp01(mouth.lowerLipTuck * scale * 0.875)

  out.jawOpen = jaw
  out.mouthClose = seal * jaw
  const press = Math.min(MAX_MOUTH_PRESS, seal * MAX_MOUTH_PRESS)
  out.mouthPressLeft = press
  out.mouthPressRight = press
  out.mouthFunnel = round * open
  out.mouthPucker = pucker * (1 - 0.5 * seal)
  out.mouthRollLower = tuck
  const upperUp = clamp01(mouth.upperLipRaise * scale * 1.5 + tuck * 0.25) * open
  out.mouthUpperUpLeft = upperUp
  out.mouthUpperUpRight = upperUp
  const lowerDown = clamp01(mouth.lowerLipDown * scale * 1.4) * open
  out.mouthLowerDownLeft = lowerDown
  out.mouthLowerDownRight = lowerDown

  // Compressão dos lábios selados (p/b/m): só existe junto com o selo.
  const compress = clamp01(mouth.lipCompress * Math.min(1, scale * 2)) * seal
  out.mouthRollUpper = clamp01(0.25 * compress)
  out.mouthRollLower = Math.max(out.mouthRollLower, clamp01(0.2 * compress))
  out.mouthShrugLower = clamp01(0.25 * compress + 0.15 * pucker)
  out.cheekPuff = clamp01(0.12 * compress)
  out.jawForward = Math.min(MAX_JAW_FORWARD, clamp01(mouth.jawForward * scale * 0.5))

  // Micro-assimetria: cresce com a articulação (parada, a boca fica simétrica).
  const articulating = clamp01(jaw / 0.4 + 0.5 * Math.max(round, pucker) + 0.5 * clamp01(mouth.spread * scale))
  const shift = clamp(Number.isFinite(expression.mouthAsymmetry) ? expression.mouthAsymmetry : 0, -1, 1) * MAX_MOUTH_SHIFT * articulating
  if (shift > 0) out.mouthLeft = shift
  else if (shift < 0) out.mouthRight = -shift

  // --- Sorriso ------------------------------------------------------------------------------
  const smileInput = clamp01(expression.smile)
  const rounding = Math.max(round, pucker)
  const smile =
    smileInput * (1 - 0.45 * (jaw / MAX_JAW_OPEN)) * (1 - 0.85 * rounding) * (1 - 0.5 * tuck) * open
  const asymmetry = clamp(expression.smileAsymmetry, -1, 1) * 0.25
  out.mouthSmileLeft = clamp01(smile * (1 + asymmetry))
  out.mouthSmileRight = clamp01(smile * (1 - asymmetry))
  out.mouthDimpleLeft = clamp01(smile * 0.2)
  out.mouthDimpleRight = clamp01(smile * 0.2)
  // Estirar + sorrir alargam os mesmos cantos: o estiramento cede um pouco ao sorriso.
  const stretch = clamp01(mouth.spread * scale * 0.85) * open * (1 - 0.4 * smile)
  out.mouthStretchLeft = stretch
  out.mouthStretchRight = stretch

  // A parte "dos olhos" do sorriso usa o sorriso PEDIDO, não o que sobrou depois da articulação.
  const cheek = clamp01(expression.cheekSquint + smileInput * 0.35)
  out.cheekSquintLeft = cheek
  out.cheekSquintRight = cheek

  // --- Sobrancelhas ---------------------------------------------------------------------------
  out.browInnerUp = clamp01(expression.browInnerUp)
  const browAsymmetry = clamp(expression.browAsymmetry, -1, 1) * 0.3
  const outer = clamp01(expression.browOuterUp)
  out.browOuterUpLeft = clamp01(outer * (1 + browAsymmetry))
  out.browOuterUpRight = clamp01(outer * (1 - browAsymmetry))
  const down = clamp01(expression.browDown)
  out.browDownLeft = down
  out.browDownRight = down

  // --- Olhar ---------------------------------------------------------------------------------
  const yaw = clamp((Number.isFinite(input.gazeYawDeg) ? input.gazeYawDeg : 0) / EYE_LOOK_DEGREES_PER_UNIT, -MAX_EYE_LOOK, MAX_EYE_LOOK)
  const pitch = clamp((Number.isFinite(input.gazePitchDeg) ? input.gazePitchDeg : 0) / EYE_LOOK_DEGREES_PER_UNIT, -MAX_EYE_LOOK, MAX_EYE_LOOK)
  if (yaw > 0) {
    // Para a esquerda da personagem: olho esquerdo vai "para fora", o direito "para dentro".
    out.eyeLookOutLeft = yaw
    out.eyeLookInRight = yaw
  } else if (yaw < 0) {
    out.eyeLookInLeft = -yaw
    out.eyeLookOutRight = -yaw
  }
  if (pitch > 0) {
    out.eyeLookUpLeft = pitch
    out.eyeLookUpRight = pitch
  } else if (pitch < 0) {
    out.eyeLookDownLeft = -pitch
    out.eyeLookDownRight = -pitch
  }

  // --- Pálpebras -----------------------------------------------------------------------------
  // Olhando para baixo, a pálpebra superior acompanha o olho (sem isso o olhar fica "vidrado").
  const lidFollow = pitch < 0 ? -pitch * 0.3 : 0
  const blinkLeft = clamp01(input.blinkLeft + lidFollow)
  const blinkRight = clamp01(input.blinkRight + lidFollow)
  out.eyeBlinkLeft = blinkLeft
  out.eyeBlinkRight = blinkRight
  const squint = clamp01(expression.eyeSquint + smileInput * 0.3)
  out.eyeSquintLeft = Math.min(squint, 1 - blinkLeft)
  out.eyeSquintRight = Math.min(squint, 1 - blinkRight)
  const wide = clamp01(expression.eyeWide)
  out.eyeWideLeft = wide * (1 - blinkLeft)
  out.eyeWideRight = wide * (1 - blinkRight)

  return out
}

/** Morphs que só a articulação escreve (usados nos testes: silêncio = todos em zero). */
export const ARTICULATION_BLENDSHAPES = [
  "jawOpen",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthRollLower",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthRollUpper",
  "mouthShrugLower",
  "cheekPuff",
  "jawForward",
  "mouthLeft",
  "mouthRight",
] as const satisfies readonly (keyof BlendshapeWeights)[]
