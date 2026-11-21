import type { OcrBox, OcrLine, OcrWord } from "./hocr.js"
import { isInside } from "./print-regions.js"

/**
 * Conferências da página lida por OCR, depois da leitura. Não mudam o texto nem cortam nada: só dizem a quem publica QUAIS páginas olhar com o PDF
 * ao lado, e por quê. Errar aqui custa uma conferência a mais; deixar de avisar custa um passo com lixo de tela publicado sem ninguém ver.
 *
 *  - `SUSPECT_PRINT_TEXT`: uma faixa de tinta ficou como texto, mas a leitura dela é de baixa confiança. Na página impressa de 20/11, os prints
 *    lidos como texto tinham confiança mediana de 29 a 66; o corpo, de 93 a 96. É o sinal de print que nenhuma regra achou (ou de digitalização ruim).
 *  - `LOW_CONFIDENCE`: boa parte das palavras da página foi lida com baixa confiança (digitalização torta, borrada, papel escuro).
 *  - `SMALL_TEXT_LEFT` (só digitalização): sobrou no texto letra de tela (bem menor que o corpo) junto de um print cortado, ou em quantidade no
 *    meio da página. É o print que a regra da tinta cortou em pedaços (tela de fundo cinza claro sobre papel tingido), ou não achou. Rodapé e
 *    cabeçalho (as margens de cima e de baixo) não contam.
 *  - `NOTHING_READ`: a página tem tinta, nenhum print e nenhuma palavra lida.
 *
 * Confiança é a do Tesseract (0 a 100, por palavra). Os números foram escolhidos com folga entre o corpo e a tela; mudar exige medir de novo com a
 * ferramenta de validação (`scripts/dev/pdf-ocr-eval`).
 */
export const PDF_OCR_CHECKS = {
  version: "PDF_OCR_CHECKS_V1",
  /** Faixa suspeita: pelo menos tantas palavras e confiança mediana abaixo disto. */
  suspectMinWords: 5,
  suspectConfidence: 70,
  /** Faixa que já é, na maior parte, print cortado não é conferida de novo. */
  printOverlap: 0.5,
  /** Página de leitura fraca: pelo menos tantas palavras e esta fração delas abaixo da confiança. */
  lowMinWords: 20,
  lowShare: 0.3,
  lowConfidence: 50,
  /**
   * Letra de tela: a altura mediana das palavras da LINHA até esta fração da letra do corpo (a mesma da regra da tinta). Por linha, e não por
   * palavra: palavra sem letra alta ("mesmo") é baixa em qualquer texto, e por palavra a IT-013 (sem nenhum print) era acusada em 6 de 8 páginas.
   */
  smallTextRatio: 0.8,
  /** Perto de um print: até isto em pontos da borda dele, e pelo menos tantas palavras. */
  nearPrint: 40,
  nearPrintWords: 5,
  /** Em qualquer lugar fora das margens: pelo menos tantas palavras pequenas. */
  scatteredWords: 15,
  margin: 0.08,
} as const

export type OcrReviewReason = "SUSPECT_PRINT_TEXT" | "LOW_CONFIDENCE" | "SMALL_TEXT_LEFT" | "NOTHING_READ"
export type OcrPageReview = { page: number; reasons: OcrReviewReason[] }

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
const area = (box: OcrBox) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
const intersection = (a: OcrBox, b: OcrBox) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/** `lines` = o texto final da página (já sem os prints); `bands` = as faixas de tinta da página inteira; `prints` = o que foi cortado. */
export function reviewOcrPage(
  page: number,
  lines: readonly OcrLine[],
  bands: readonly OcrBox[],
  prints: readonly OcrBox[],
  /** Só na digitalização: a letra do corpo do documento e a altura da página, para a letra de tela que sobrou. */
  scan?: { bodyHeight: number; pageHeight: number },
): OcrPageReview | null {
  const rule = PDF_OCR_CHECKS
  const words: OcrWord[] = lines.flatMap((line) => line.words)
  const reasons: OcrReviewReason[] = []
  const textBands = bands.filter((band) => prints.reduce((sum, print) => sum + intersection(band, print), 0) < area(band) * rule.printOverlap)
  const suspect = textBands.some((band) => {
    const inside = words.filter((word) => isInside(word, band))
    return inside.length >= rule.suspectMinWords && median(inside.map((word) => word.confidence)) < rule.suspectConfidence
  })
  if (suspect) reasons.push("SUSPECT_PRINT_TEXT")
  if (words.length >= rule.lowMinWords && words.filter((word) => word.confidence < rule.lowConfidence).length >= words.length * rule.lowShare) reasons.push("LOW_CONFIDENCE")
  if (scan && scan.bodyHeight > 0) {
    const small = lines
      .filter((line) => line.words.length >= 2 && median(line.words.map((word) => word.bottom - word.top)) <= scan.bodyHeight * rule.smallTextRatio)
      .flatMap((line) => line.words)
      .filter((word) => word.top > scan.pageHeight * rule.margin && word.bottom < scan.pageHeight * (1 - rule.margin))
    const near = small.filter((word) => prints.some((print) => word.right >= print.left - rule.nearPrint && word.left <= print.right + rule.nearPrint && word.bottom >= print.top - rule.nearPrint && word.top <= print.bottom + rule.nearPrint))
    if (near.length >= rule.nearPrintWords || small.length >= rule.scatteredWords) reasons.push("SMALL_TEXT_LEFT")
  }
  if (words.length === 0 && prints.length === 0 && textBands.length > 0) reasons.push("NOTHING_READ")
  return reasons.length > 0 ? { page, reasons } : null
}
