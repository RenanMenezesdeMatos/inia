import { describe, expect, it } from "vitest"
import { classifyScannedPage, mergeStrips, type PdfImagePlacement } from "./embedded-prints.js"

const W = 595
const H = 842
const image = (left: number, top: number, right: number, bottom: number, marksOver = 0): PdfImagePlacement => ({ left, top, right, bottom, marksOver })

describe("prints pela posição das imagens do PDF", () => {
  it("imagem do tamanho da página é digitalização: os prints ficam para a regra da tinta", () => {
    expect(classifyScannedPage([image(0, 0, W, H)], W, H)).toEqual({ source: "SCAN", prints: [] })
  })

  it("digitalização guardada em tiras também é digitalização", () => {
    const strips = Array.from({ length: 120 }, (_, index) => image(0, index * 7.02, W, (index + 1) * 7.02))
    expect(classifyScannedPage(strips, W, H).source).toBe("SCAN")
  })

  it("página com texto em contorno e prints como imagem: cada print é a imagem, com a letra do tamanho que for", () => {
    const result = classifyScannedPage([image(60, 385, 537, 638), image(60, 29, 537, 294)], W, H)
    expect(result).toEqual({ source: "EMBEDDED", prints: [{ left: 60, top: 29, right: 537, bottom: 294 }, { left: 60, top: 385, right: 537, bottom: 638 }] })
  })

  it("tiras de um print viram um corte só", () => {
    const strips = Array.from({ length: 36 }, (_, index) => image(60, 300 + index * 7, 537, 300 + (index + 1) * 7))
    expect(mergeStrips(strips)).toHaveLength(1)
    expect(classifyScannedPage(strips, W, H).prints).toEqual([{ left: 60, top: 300, right: 537, bottom: 552 }])
  })

  it("linha separadora, ícone e enfeite pequeno não são print", () => {
    expect(classifyScannedPage([image(60, 200, 537, 201), image(500, 40, 515, 55), image(40, 40, 70, 60)], W, H)).toEqual({ source: "EMBEDDED", prints: [] })
  })

  it("imagem com texto desenhado por cima é fundo, e o texto é do documento", () => {
    expect(classifyScannedPage([image(38, 460, 560, 510, 30)], W, H).prints).toEqual([])
    expect(classifyScannedPage([image(38, 460, 560, 510, 3)], W, H).prints).toHaveLength(1)
  })

  it("imagem dentro de outra (o número sobre a tela) não vira um segundo corte", () => {
    expect(classifyScannedPage([image(60, 100, 537, 400), image(100, 120, 140, 160)], W, H).prints).toEqual([{ left: 60, top: 100, right: 537, bottom: 400 }])
  })

  it("página sem nenhuma imagem e sem texto: nada a cortar", () => {
    expect(classifyScannedPage([], W, H)).toEqual({ source: "EMBEDDED", prints: [] })
  })
})
