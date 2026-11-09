import { describe, expect, it } from "vitest"
import { parseHocr, wordsOf } from "./hocr.js"

const HOCR = `
  <div class='ocr_page' id='page_1' title='image "/input"; bbox 0 0 1654 2339; ppageno 0'>
   <div class='ocr_carea' id='block_1_1' title="bbox 200 300 1400 400">
    <p class='ocr_par' id='par_1_1' lang='por' title="bbox 200 300 1400 400">
     <span class='ocr_line' id='line_1_1' title="bbox 200 300 1400 340; baseline 0.001 -8; x_size 40; x_descenders 9; x_ascenders 10">
      <span class='ocrx_word' id='word_1_1' title='bbox 200 300 420 340; x_wconf 96'>Devolução</span>
      <span class='ocrx_word' id='word_1_2' title='bbox 440 300 520 340; x_wconf 91'>&amp;</span>
      <span class='ocrx_word' id='word_1_3' title='bbox 540 300 700 340; x_wconf 88'><strong>R$</strong></span>
     </span>
     <span class='ocr_textfloat' id='line_1_2' title="bbox 200 360 600 400; baseline 0 -6; x_size 30; x_descenders 6; x_ascenders 8">
      <span class='ocrx_word' id='word_1_4' title='bbox 200 360 600 400; x_wconf 70'>&quot;prazo&quot;</span>
     </span>
    </p>
   </div>
   <div class='ocr_photo' id='block_1_2' title="bbox 100 500 1500 1200"></div>
  </div>`

describe("hOCR do Tesseract", () => {
  it("lê palavras e linhas em pontos da página, com o texto decodificado", () => {
    const page = parseHocr(HOCR, 2)
    expect(page.lines).toHaveLength(2)
    expect(wordsOf(page).map((word) => word.text)).toEqual(["Devolução", "&", "R$", '"prazo"'])
    expect(page.lines[0]).toMatchObject({ left: 100, top: 150, right: 700, bottom: 170, size: 20, baseline: 166 })
    expect(page.lines[0]!.words[0]).toMatchObject({ left: 100, top: 150, right: 210, bottom: 170, confidence: 96 })
  })

  it("palavra solta depois de um bloco novo não entra na linha anterior", () => {
    const page = parseHocr(`<span class='ocr_line' id='l1' title="bbox 0 0 100 20"><span class='ocrx_word' id='w1' title='bbox 0 0 50 20; x_wconf 90'>um</span></span><div class='ocr_photo' id='b' title="bbox 0 40 100 90"></div><span class='ocrx_word' id='w2' title='bbox 0 50 50 70; x_wconf 90'>solta</span>`, 1)
    expect(wordsOf(page).map((word) => word.text)).toEqual(["um"])
  })

  it("linha sem palavra fica de fora; sem x_size, a altura da linha é a medida", () => {
    const page = parseHocr(`<span class='ocr_line' id='l1' title="bbox 0 0 100 20"></span><span class='ocr_line' id='l2' title="bbox 0 30 100 50"><span class='ocrx_word' id='w' title='bbox 0 30 100 50; x_wconf 90'>ok</span></span>`, 1)
    expect(page.lines).toHaveLength(1)
    expect(page.lines[0]!.size).toBe(20)
  })

  it("página vazia não tem nada", () => {
    expect(parseHocr("", 2)).toEqual({ lines: [] })
  })
})
