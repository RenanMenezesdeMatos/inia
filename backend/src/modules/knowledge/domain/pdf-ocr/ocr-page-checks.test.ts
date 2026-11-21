import { describe, expect, it } from "vitest"
import type { OcrLine, OcrWord } from "./hocr.js"
import { reviewOcrPage } from "./ocr-page-checks.js"

const word = (left: number, top: number, height: number, confidence: number): OcrWord => ({ text: "x", left, top, right: left + 30, bottom: top + height, confidence })
const line = (top: number, count: number, height: number, confidence: number, left = 60): OcrLine => {
  const words = Array.from({ length: count }, (_, index) => word(left + index * 35, top, height, confidence))
  return { left, top, right: left + count * 35, bottom: top + height, baseline: top + height, size: height, words }
}

describe("conferências da página lida por OCR", () => {
  it("página limpa não pede conferência", () => {
    const lines = [line(100, 8, 10, 95), line(120, 8, 10, 94)]
    expect(reviewOcrPage(1, lines, [{ left: 50, top: 95, right: 400, bottom: 135 }], [])).toBeNull()
  })

  it("faixa lida como texto com confiança baixa é print suspeito", () => {
    const lines = [line(100, 8, 10, 95), line(120, 8, 10, 95), line(140, 8, 10, 95), line(300, 6, 10, 40)]
    const bands = [{ left: 50, top: 95, right: 400, bottom: 115 }, { left: 50, top: 290, right: 400, bottom: 330 }]
    expect(reviewOcrPage(2, lines, bands, [])).toEqual({ page: 2, reasons: ["SUSPECT_PRINT_TEXT"] })
  })

  it("faixa que já foi cortada como print não é conferida de novo", () => {
    const lines = [line(100, 8, 10, 95), line(300, 6, 10, 40)]
    const band = { left: 50, top: 290, right: 400, bottom: 330 }
    expect(reviewOcrPage(2, lines, [band], [band])).toBeNull()
  })

  it("muitas palavras de baixa confiança: leitura fraca", () => {
    expect(reviewOcrPage(3, [line(100, 10, 10, 40), line(120, 10, 10, 95)], [], [])?.reasons).toEqual(["LOW_CONFIDENCE"])
  })

  it("na digitalização, letra de tela que sobrou junto de um print é avisada", () => {
    const lines = [line(100, 8, 10, 95), line(420, 3, 6, 92, 210), line(440, 3, 6, 92, 210)]
    const print = { left: 200, top: 400, right: 500, bottom: 600 }
    expect(reviewOcrPage(4, lines, [], [print], { bodyHeight: 10, pageHeight: 842 })?.reasons).toEqual(["SMALL_TEXT_LEFT"])
    // Fora da digitalização (prints pela posição das imagens) o sinal não vale: lá o print é exato.
    expect(reviewOcrPage(4, lines, [], [print])).toBeNull()
  })

  it("letra pequena só no rodapé não pede conferência", () => {
    const lines = [line(100, 8, 10, 95), line(800, 10, 6, 95), line(815, 10, 6, 95)]
    expect(reviewOcrPage(5, lines, [], [], { bodyHeight: 10, pageHeight: 842 })).toBeNull()
  })

  it("página com tinta e nada lido", () => {
    expect(reviewOcrPage(6, [], [{ left: 50, top: 100, right: 400, bottom: 300 }], [])?.reasons).toEqual(["NOTHING_READ"])
  })
})
