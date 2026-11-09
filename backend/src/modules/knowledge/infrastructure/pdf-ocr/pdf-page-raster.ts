import { createHash } from "node:crypto"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { OcrBox } from "../../domain/pdf-ocr/hocr.js"

/**
 * A página desenhada como imagem, para o Tesseract ler e para cortar os prints. Usa o pdf.js e o canvas que o `pdf-parse` já traz, como a leitura das
 * imagens (`pdf-image-reader.ts`). 200 pontos por polegada: foi a resolução medida (texto de 98% nas amostras); página muito grande é reduzida para
 * caber no limite de pixels, e o print cortado fica com a mesma nitidez da página lida.
 */
export const OCR_RENDER_DPI = 200
const MAX_RENDER_SIDE = 4_000
/** Imagem embutida maior que isso não é decodificada (digitalização gigante): a página fica sem leitura, e o motivo vai para o registro. */
const MAX_DECODED_PIXELS = 40_000_000
const WEBP_QUALITY = 90
/** Folga em volta do print ao pintar de branco para a segunda leitura (pixels): borda que sobra viraria letra solta. */
const MASK_MARGIN = 2

type RasterCanvas = { encode(format: "png"): Promise<Buffer>; encode(format: "webp", quality: number): Promise<Buffer> }
type RasterContext = {
  fillStyle: string
  fillRect(x: number, y: number, width: number, height: number): void
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray }
  drawImage(source: RasterCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}
type CanvasPair = { canvas: RasterCanvas; context: RasterContext }
type CanvasFactory = { create(width: number, height: number): CanvasPair; destroy(pair: CanvasPair): void }

export type CutImage = { id: string; data: Buffer; width: number; height: number }

export type RenderedPage = {
  page: number
  /** Tamanho da página em pontos. */
  width: number
  height: number
  /** Pixels por ponto. */
  scale: number
  pixelWidth: number
  pixelHeight: number
  pixels(): Uint8ClampedArray
  png(): Promise<Buffer>
  /** Corta a área (em pontos) como imagem WebP. */
  cut(box: OcrBox): Promise<CutImage | null>
  /** Pinta as áreas de branco: o que vem depois (`png`) já sai sem elas. Corte antes de pintar. */
  paintWhite(boxes: readonly OcrBox[]): void
  release(): void
}

export type RasterDocument = { pageCount: number; render(page: number): Promise<RenderedPage>; close(): Promise<void> }

export async function openRasterDocument(buffer: Buffer): Promise<RasterDocument> {
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, maxImageSize: MAX_DECODED_PIXELS }).promise
  const factory = document.canvasFactory as unknown as CanvasFactory
  return {
    pageCount: document.numPages,
    async render(number) {
      const page = await document.getPage(number)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(OCR_RENDER_DPI / 72, MAX_RENDER_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const pixelWidth = Math.ceil(viewport.width)
      const pixelHeight = Math.ceil(viewport.height)
      const pair = factory.create(pixelWidth, pixelHeight)
      // Fundo branco: o canvas nasce transparente, e o PDF sem fundo desenhado sairia preto na leitura.
      pair.context.fillStyle = "#ffffff"
      pair.context.fillRect(0, 0, pixelWidth, pixelHeight)
      try {
        await page.render({ canvasContext: pair.context as never, viewport, canvas: pair.canvas as never }).promise
      } catch (error) {
        factory.destroy(pair)
        page.cleanup()
        throw error
      }
      const toPixels = (box: OcrBox) => {
        const left = Math.max(0, Math.floor(box.left * scale))
        const top = Math.max(0, Math.floor(box.top * scale))
        const right = Math.min(pixelWidth, Math.ceil(box.right * scale))
        const bottom = Math.min(pixelHeight, Math.ceil(box.bottom * scale))
        return { left, top, width: right - left, height: bottom - top }
      }
      let released = false
      return {
        page: number,
        width: base.width,
        height: base.height,
        scale,
        pixelWidth,
        pixelHeight,
        pixels: () => pair.context.getImageData(0, 0, pixelWidth, pixelHeight).data,
        png: () => pair.canvas.encode("png"),
        async cut(box) {
          const area = toPixels(box)
          if (area.width < 8 || area.height < 8) return null
          const pixels = pair.context.getImageData(area.left, area.top, area.width, area.height).data
          const id = createHash("sha256").update(`${area.width}x${area.height}:ocr:`).update(pixels).digest("hex").slice(0, 32)
          const target = factory.create(area.width, area.height)
          try {
            target.context.drawImage(pair.canvas, area.left, area.top, area.width, area.height, 0, 0, area.width, area.height)
            return { id, data: await target.canvas.encode("webp", WEBP_QUALITY), width: area.width, height: area.height }
          } finally {
            factory.destroy(target)
          }
        },
        paintWhite(boxes) {
          pair.context.fillStyle = "#ffffff"
          for (const box of boxes) {
            const area = toPixels(box)
            pair.context.fillRect(area.left - MASK_MARGIN, area.top - MASK_MARGIN, area.width + MASK_MARGIN * 2, area.height + MASK_MARGIN * 2)
          }
        },
        release() {
          if (released) return
          released = true
          factory.destroy(pair)
          page.cleanup()
        },
      }
    },
    close: () => document.destroy(),
  }
}
