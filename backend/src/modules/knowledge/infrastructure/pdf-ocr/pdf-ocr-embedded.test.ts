import { describe, expect, it } from "vitest"
import { ocrPageLayouts } from "../../domain/pdf-ocr/ocr-layout.js"
import { pdfLayoutToMarkdown } from "../../domain/pdf-markdown/pdf-markdown.js"
import { buildFixturePdf, type FixturePage } from "../../testing/pdf-layout-fixture.js"
import type { OcrEngine } from "./ocr-engine.js"
import { readScannedPages } from "./pdf-ocr-reader.js"
import { OCR_RENDER_DPI } from "./pdf-page-raster.js"

/**
 * A página impressa do navegador pelo "Print To PDF" (20/11/2026): sem camada de texto (o texto é contorno vetorial) e com o print como imagem
 * própria do PDF, em tiras, com margem branca em volta da tela. O motor é falso e sempre "lê" as mesmas linhas, inclusive a do print com a letra
 * do MESMO tamanho do corpo, que a regra da tinta não reconheceria: o que se prova é que o print sai pela posição da imagem.
 */
const SCALE = OCR_RENDER_DPI / 72
const px = (points: number) => Math.round(points * SCALE)
const hocrLine = (top: number, words: string[], confidence: number) =>
  `<span class='ocr_line' title="bbox ${px(60)} ${px(top)} ${px(400)} ${px(top + 10)}; baseline 0 -2; x_size ${px(10)}">${words
    .map((text, index) => `<span class='ocrx_word' title='bbox ${px(60 + index * 60)} ${px(top)} ${px(110 + index * 60)} ${px(top + 10)}; x_wconf ${confidence}'>${text}</span>`)
    .join("")}</span>`
const HOCR = `<div class='ocr_carea' title="bbox 0 0 10 10">${hocrLine(100, ["Clique", "em", "Login"], 95)}${hocrLine(400, ["Name", "Password", "Cancel", "Options"], 92)}${hocrLine(700, ["Clique", "em", "File"], 95)}</div>`
const fakeEngine: OcrEngine = { recognize: async () => HOCR, close: async () => undefined }

/** A tela: cinza com um quadro escuro, guardada em 30 tiras com 40 pontos de margem branca dos lados. */
function printedPage(): FixturePage {
  const width = 480
  const height = 6
  const strips: FixturePage = []
  for (let index = 0; index < 30; index += 1) {
    const pixels = Buffer.alloc(width * height, 255)
    for (let y = 0; y < height; y += 1) for (let x = 80; x < width - 80; x += 1) pixels[y * width + x] = index > 3 && index < 26 && x > 120 && x < 300 ? 60 : 200
    strips.push({ kind: "image", x: 60, y: 360 + index * height, width, height, image: { format: "gray", pixels, width, height } })
  }
  // O texto do documento é desenho vetorial, não texto: a página fica sem camada de texto.
  const vector: FixturePage = [{ kind: "thinRect", x: 60, y: 100, width: 300, height: 8 }, { kind: "thinRect", x: 60, y: 700, width: 300, height: 8 }]
  return [...vector, ...strips]
}

describe("página sem camada de texto que não é digitalização", () => {
  it("o print sai pela posição da imagem do PDF, recortado à tinta, e o texto dele não entra", async () => {
    const result = await readScannedPages(buildFixturePdf([printedPage()]), [1], fakeEngine)
    const page = result.pages[0]!
    expect(page.source).toBe("EMBEDDED")
    expect(page.prints).toHaveLength(1)
    const print = page.prints[0]!
    // As tiras viraram uma imagem só (360 a 540), e a margem branca de 40 pontos de cada lado ficou de fora.
    expect(print.top).toBeGreaterThanOrEqual(358)
    expect(print.bottom).toBeLessThanOrEqual(542)
    expect(print.left).toBeGreaterThan(95)
    expect(print.right).toBeLessThan(505)
    expect(result.images).toHaveLength(1)
    const { markdown } = pdfLayoutToMarkdown(ocrPageLayouts(result.pages), { images: result.images, omitted: 0 })
    expect(markdown).toContain("Clique em Login")
    expect(markdown).toContain("Clique em File")
    expect(markdown).not.toContain("Password")
    expect(result.reviews).toEqual([])
  })

  it("página digitalizada (imagem do tamanho da página) continua pela regra da tinta", async () => {
    const pixels = Buffer.alloc(60 * 80, 250)
    const scan: FixturePage = [{ kind: "image", x: 0, y: 0, width: 595, height: 842, image: { format: "gray", pixels, width: 60, height: 80 } }]
    const result = await readScannedPages(buildFixturePdf([scan]), [1], fakeEngine)
    expect(result.pages[0]!.source).toBe("SCAN")
  })
})
