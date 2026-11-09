import { openRasterDocument } from "../infrastructure/pdf-ocr/pdf-page-raster.js"
import { buildFixturePdf, PAGE_HEIGHT, PAGE_WIDTH, type FixturePage } from "./pdf-layout-fixture.js"

/**
 * PDF digitalizado de verdade para os testes do OCR: cada página com texto é desenhada como imagem (cinza, 200 pontos por polegada) e entra num PDF
 * novo como uma imagem do tamanho da página, sem camada de texto, como sai de um scanner. `textPages` = páginas que continuam com texto (PDF misto).
 */
export async function buildScannedPdf(pages: readonly FixturePage[], options: { textPages?: readonly number[] } = {}): Promise<Buffer> {
  const source = await openRasterDocument(buildFixturePdf(pages))
  try {
    const out: FixturePage[] = []
    for (let number = 1; number <= pages.length; number += 1) {
      if (options.textPages?.includes(number)) {
        out.push(pages[number - 1]!)
        continue
      }
      const rendered = await source.render(number)
      const rgba = rendered.pixels()
      const gray = Buffer.alloc(rendered.pixelWidth * rendered.pixelHeight)
      for (let pixel = 0; pixel < gray.length; pixel += 1) gray[pixel] = Math.round((rgba[pixel * 4]! + rgba[pixel * 4 + 1]! + rgba[pixel * 4 + 2]!) / 3)
      out.push([{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: { format: "gray", pixels: gray, width: rendered.pixelWidth, height: rendered.pixelHeight } }])
      rendered.release()
    }
    return buildFixturePdf(out)
  } finally {
    await source.close()
  }
}
