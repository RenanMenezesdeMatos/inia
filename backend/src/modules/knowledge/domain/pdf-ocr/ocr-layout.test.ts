import { describe, expect, it } from "vitest"
import { pdfLayoutToMarkdown } from "../pdf-markdown/pdf-markdown.js"
import type { OcrLine } from "./hocr.js"
import { OCR_ROW_TO_FONT, ocrFontSize, ocrPageLayouts } from "./ocr-layout.js"

/** Uma linha do OCR com letra de `size` pontos (a altura do Tesseract é calibrada para 0,936 do tamanho da fonte). */
function line(y: number, text: string, size = 10, x = 56): OcrLine {
  let cursor = x
  const words = text.split(" ").map((value) => {
    const word = { text: value, confidence: 95, left: cursor, top: y - size, right: cursor + value.length * size * 0.5, bottom: y }
    cursor = word.right + size * 0.3
    return word
  })
  return { left: x, top: y - size, right: words[words.length - 1]!.right, bottom: y, baseline: y, size: size * OCR_ROW_TO_FONT, words }
}

describe("OCR para o conversor", () => {
  it("uma palavra por trecho, com o espaço que o Tesseract separou, e o texto dos prints fora", () => {
    const [layout] = ocrPageLayouts([{ page: 1, width: 595, height: 842, lines: [line(100, "Clique em Salvar"), line(400, "Arquivo Editar Ajuda", 6)], prints: [{ left: 40, top: 380, right: 560, bottom: 420 }] }])
    expect(layout!.runs.map((run) => run.text)).toEqual(["Clique ", "em ", "Salvar"])
    expect(layout).toMatchObject({ imageCount: 1, rules: [], tagged: false })
    expect(layout!.imageShare).toBeCloseTo((520 * 40) / (595 * 842))
  })

  it("oscilação da medida perto do corpo vira o corpo; letra claramente maior vai para o degrau", () => {
    const body = 10
    expect(ocrFontSize(line(0, "a", 10.9), body)).toBe(10)
    expect(ocrFontSize(line(0, "a", 9.1), body)).toBe(10)
    expect(ocrFontSize(line(0, "a", 12.6), body)).toBeCloseTo(12.5)
    expect(ocrFontSize(line(0, "a", 13.4), body)).toBeCloseTo(12.5)
  })

  it("no Markdown, a linha maior vira título e as do corpo, parágrafo", () => {
    const lines = [line(80, "Prazo de devolução", 14), line(120, "O cliente tem 30 dias corridos para devolver o equipamento."), line(134, "Depois disso, a multa é cobrada na fatura seguinte.")]
    const { markdown } = pdfLayoutToMarkdown(ocrPageLayouts([{ page: 1, width: 595, height: 842, lines, prints: [] }]))
    expect(markdown.split("\n\n")[0]).toMatch(/^#+ Prazo de devolução$/)
    expect(markdown).toContain("O cliente tem 30 dias corridos para devolver o equipamento.")
  })
})
