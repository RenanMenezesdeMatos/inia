import { describe, expect, it } from "vitest"
import type { OcrBox, OcrWord } from "./hocr.js"
import { documentBodyHeight, inkBands, printRegions } from "./print-regions.js"

/** Página em pixels, 1 pixel por ponto: papel de um tom e retângulos pintados. */
function page(width: number, height: number, paper: [number, number, number], fills: { box: OcrBox; color: [number, number, number] }[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set([...paper, 255], pixel * 4)
  for (const { box, color } of fills) for (let y = box.top; y < box.bottom; y += 1) for (let x = box.left; x < box.right; x += 1) rgba.set([...color, 255], (y * width + x) * 4)
  return rgba
}

const word = (left: number, top: number, height: number, confidence = 95): OcrWord => ({ text: "palavra", confidence, left, top, right: left + 30, bottom: top + height })

describe("faixas de tinta", () => {
  it("acha a faixa contínua de tinta e separa as colunas pelo vão em branco", () => {
    const rgba = page(400, 300, [255, 255, 255], [
      { box: { left: 20, top: 50, right: 180, bottom: 120 }, color: [40, 90, 200] },
      { box: { left: 220, top: 50, right: 380, bottom: 120 }, color: [40, 40, 40] },
    ])
    const bands = inkBands(rgba, 400, 300, 1)
    expect(bands).toEqual([
      { left: 20, right: 180, top: 50, bottom: 120 },
      { left: 220, right: 380, top: 50, bottom: 120 },
    ])
  })

  it("faixa mais baixa que o mínimo não é área, e papel amarelado conta como papel", () => {
    const rgba = page(400, 300, [243, 241, 234], [{ box: { left: 20, top: 50, right: 380, bottom: 60 }, color: [30, 30, 30] }])
    expect(inkBands(rgba, 400, 300, 1)).toEqual([])
  })
})

describe("prints", () => {
  const body = 10
  const band = { left: 20, top: 100, right: 500, bottom: 300 }

  it("faixa com letra bem menor que a do corpo é print", () => {
    const words = [word(30, 120, 6), word(80, 120, 6), word(130, 160, 6.5), word(180, 200, 6)]
    expect(printRegions([band], words, body)).toEqual([band])
  })

  it("faixa com letra do tamanho do corpo continua texto", () => {
    const words = [word(30, 120, 10), word(80, 120, 9.5), word(130, 160, 10)]
    expect(printRegions([band], words, body)).toEqual([])
  })

  it("área grande sem texto é imagem; pequena, não", () => {
    expect(printRegions([band], [], body)).toEqual([band])
    expect(printRegions([{ left: 20, top: 100, right: 60, bottom: 130 }], [], body)).toEqual([])
  })

  it("duas áreas marcadas que se encostam viram um print só", () => {
    const top = { left: 20, top: 100, right: 500, bottom: 200 }
    const bottom = { left: 30, top: 210, right: 480, bottom: 320 }
    expect(printRegions([top, bottom], [], body)).toEqual([{ left: 20, top: 100, right: 500, bottom: 320 }])
  })

  it("o corpo é a letra das palavras confiáveis fora das faixas altas", () => {
    const tall = { left: 0, top: 0, right: 500, bottom: 200 }
    const pages = [{ bands: [tall], words: [word(10, 10, 5), word(10, 50, 5), word(10, 300, 11), word(10, 320, 11), word(10, 340, 11, 40)] }]
    expect(documentBodyHeight(pages)).toBe(11)
  })
})
