import type { OcrBox, OcrWord } from "../../../src/modules/knowledge/domain/pdf-ocr/hocr.js"

/**
 * Notas da validação do OCR, puras. O gabarito vem do próprio PDF quando ele tem camada de texto: as palavras de verdade (com posição) e as imagens
 * de verdade. Assim qualquer PDF com texto selecionável vira caso de teste, sem ninguém marcar nada à mão.
 */
export type TruthWord = OcrBox & { text: string }

/** A mesma palavra dos dois lados: minúscula, sem acento e só letras e números. Acento errado conta à parte. */
export const foldWord = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
const accentKey = (text: string) => text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

const center = (box: OcrBox) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })
export const inside = (word: OcrBox, box: OcrBox) => {
  const { x, y } = center(word)
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}
export const iou = (a: OcrBox, b: OcrBox) => {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const inter = w * h
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter
  return union > 0 ? inter / union : 0
}
/** Quanto de `a` está dentro de `b`. */
export const covered = (a: OcrBox, b: OcrBox) => {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const area = (a.right - a.left) * (a.bottom - a.top)
  return area > 0 ? (w * h) / area : 0
}

export type PageScore = {
  truthWords: number
  /** Palavras de verdade que o OCR leu (contagem por multiconjunto, sem posição). */
  wordsRead: number
  /** Das lidas, quantas com o acento certo. */
  accentsRight: number
  accentedTruth: number
  /** Palavras de verdade com o centro dentro de um print cortado: texto do documento que sumiu do texto. É a falha grave. */
  realWordsCut: number
  /** Palavras do OCR que não existem no gabarito (lixo de tela, erro de leitura). */
  extraWords: number
  truthPrints: number
  /** Prints de verdade com um corte que cobre a maior parte dele. */
  printsFound: number
  /** Cortes que não correspondem a nenhuma imagem de verdade. */
  falsePrints: number
}

export function scorePage(truth: readonly TruthWord[], truthImages: readonly OcrBox[], read: readonly OcrWord[], prints: readonly OcrBox[]): PageScore {
  const truthBag = new Map<string, number>()
  const accentBag = new Map<string, number>()
  let accentedTruth = 0
  for (const word of truth) {
    const key = foldWord(word.text)
    if (!key) continue
    truthBag.set(key, (truthBag.get(key) ?? 0) + 1)
    if (foldWord(word.text) !== accentKey(word.text)) {
      accentedTruth += 1
      accentBag.set(accentKey(word.text), (accentBag.get(accentKey(word.text)) ?? 0) + 1)
    }
  }
  const truthWords = [...truthBag.values()].reduce((a, b) => a + b, 0)
  let wordsRead = 0
  let extraWords = 0
  let accentsRight = 0
  for (const word of read) {
    const key = foldWord(word.text)
    if (!key) continue
    const left = truthBag.get(key) ?? 0
    if (left > 0) {
      truthBag.set(key, left - 1)
      wordsRead += 1
      const accented = accentKey(word.text)
      const remaining = accentBag.get(accented) ?? 0
      if (remaining > 0) {
        accentBag.set(accented, remaining - 1)
        accentsRight += 1
      }
    } else extraWords += 1
  }
  const realWordsCut = truth.filter((word) => foldWord(word.text) && !truthImages.some((image) => inside(word, image)) && prints.some((print) => inside(word, print))).length
  const printsFound = truthImages.filter((image) => prints.some((print) => covered(image, print) >= 0.7 && covered(print, image) >= 0.5)).length
  const falsePrints = prints.filter((print) => !truthImages.some((image) => covered(print, image) >= 0.5 || covered(image, print) >= 0.7)).length
  return { truthWords, wordsRead, accentsRight, accentedTruth, realWordsCut, extraWords, truthPrints: truthImages.length, printsFound, falsePrints }
}

export function sumScores(scores: readonly PageScore[]): PageScore {
  const total: PageScore = { truthWords: 0, wordsRead: 0, accentsRight: 0, accentedTruth: 0, realWordsCut: 0, extraWords: 0, truthPrints: 0, printsFound: 0, falsePrints: 0 }
  for (const score of scores) for (const key of Object.keys(total) as (keyof PageScore)[]) total[key] += score[key]
  return total
}
