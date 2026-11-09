import type { PdfPageLayout, PdfRun } from "../pdf-markdown/layout.js"
import type { OcrBox, OcrLine } from "./hocr.js"
import { isInside } from "./print-regions.js"

/**
 * O que o Tesseract leu, no formato que o conversor de PDF para Markdown já usa: cada palavra vira um trecho de texto na linha de base da linha dela, e o
 * conversor decide títulos, listas, parágrafos e colunas com as mesmas regras de um PDF com texto. Nada de título deduzido do texto: o tamanho da letra é
 * o único sinal que o OCR dá (negrito e fonte não existem aqui), e ele vem do modelo de linha do próprio Tesseract.
 *
 * Medido em 6 manuais (07/11/2026), páginas desenhadas e lidas pelo OCR contra a conversão da camada de texto deles: com a faixa do corpo e os degraus,
 * 12 de 137 títulos não batiam (31 de 165 sem eles; a maioria são as letras grandes da capa), 125 de 136 títulos foram achados, os níveis ficaram
 * coerentes em 95% dos pares e 97,3% das palavras vieram. Título que só se distingue pelo negrito não é achado: fica como parágrafo.
 */

/** Na calibração com a camada de texto dos manuais, a altura da linha do Tesseract foi 0,936 do tamanho real da fonte (mediana de 821 linhas). */
export const OCR_ROW_TO_FONT = 0.936

/**
 * Faixa em torno do corpo que conta como o próprio corpo: a medida do OCR oscila de bloco para bloco (10% a 90% das linhas ficaram entre 0,86 e 1,03 do
 * tamanho real), e no conversor uma linha 15% maior já vira título. Só o que passa claramente disso continua maior.
 */
export const OCR_BODY_BAND = 1.18
/**
 * Fora da faixa do corpo, o tamanho vai para o degrau de 25% mais próximo: duas linhas do mesmo nível de título, medidas em blocos diferentes, não
 * viram dois níveis só pela oscilação da medida.
 */
export const OCR_SIZE_STEP = 1.25

export type OcrPageInput = {
  page: number
  /** Em pontos. */
  width: number
  height: number
  lines: readonly OcrLine[]
  /** Prints cortados da página: o texto de dentro deles não entra, e eles contam como imagem da página. */
  prints: readonly OcrBox[]
}

const fontSizeOf = (line: OcrLine) => line.size / OCR_ROW_TO_FONT

/** O tamanho mais comum, pesado pelo número de caracteres, arredondado a meio ponto (como o conversor faz com o corpo do texto). */
function dominantSize(lines: readonly OcrLine[]): number {
  const bySize = new Map<number, number>()
  for (const line of lines) {
    const size = Math.round(fontSizeOf(line) * 2) / 2
    bySize.set(size, (bySize.get(size) ?? 0) + line.words.reduce((sum, word) => sum + word.text.length, 0))
  }
  return [...bySize.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0
}

export function ocrFontSize(line: OcrLine, body: number): number {
  const size = fontSizeOf(line)
  if (body <= 0) return size
  if (size < body * OCR_BODY_BAND && size > body / OCR_BODY_BAND) return body
  return body * OCR_SIZE_STEP ** Math.round(Math.log(size / body) / Math.log(OCR_SIZE_STEP))
}

/** As páginas lidas pelo OCR como páginas do conversor. O corpo é medido nas páginas lidas juntas, sem o texto de dentro dos prints. */
export function ocrPageLayouts(pages: readonly OcrPageInput[]): PdfPageLayout[] {
  const kept = pages.map((page) => page.lines.map((line) => ({ ...line, words: line.words.filter((word) => !page.prints.some((print) => isInside(word, print))) })).filter((line) => line.words.length > 0))
  const body = dominantSize(kept.flat())
  return pages.map((page, index) => {
    const runs: PdfRun[] = []
    for (const line of kept[index]!) {
      const fontSize = ocrFontSize(line, body)
      // O Tesseract já separou as palavras: o espaço entre elas é certo, mesmo quando o vão na imagem é estreito.
      line.words.forEach((word, position) => runs.push({ text: position < line.words.length - 1 ? `${word.text} ` : word.text, x: word.left, y: line.baseline, width: word.right - word.left, fontSize, bold: false, mono: false, rotated: false, hint: null }))
    }
    const area = page.width * page.height
    const printArea = page.prints.reduce((sum, print) => sum + (print.right - print.left) * (print.bottom - print.top), 0)
    return { page: page.page, width: page.width, height: page.height, runs, rules: [], imageShare: area > 0 ? Math.min(1, printArea / area) : 0, imageCount: page.prints.length, drawnPaths: 0, tagged: false }
  })
}
