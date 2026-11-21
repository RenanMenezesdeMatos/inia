import { createHash } from "node:crypto"
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api.js"
import { PDF_EMBEDDED_PRINT_RULE, type PdfImagePlacement } from "../../domain/pdf-ocr/embedded-prints.js"
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
/** Recorte justo do print: pixel com algum canal abaixo disto é tinta; e a folga deixada em volta, em pixels. */
const INK_BELOW = 245
const TRIM_PADDING = 4
/**
 * Teto do desenho de UMA página. O conteúdo vem do arquivo enviado: uma página de formulários aninhados de poucos bytes levava ~21 s só para ser
 * desenhada, e o prazo do processo filho cresce com as páginas. Passou disto, o desenho é cancelado e a página fica sem leitura, como qualquer falha.
 */
export const OCR_RENDER_TIMEOUT_MS = 20_000

export class PageRenderTimeoutError extends Error {
  override name = "PageRenderTimeoutError"
}

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
  /**
   * A área encolhida até a tinta de dentro dela (o print guardado com margem branca em volta, como sai do "Print To PDF"), em pontos. Null = não há
   * tinta: imagem toda branca, que não é print.
   */
  trimToInk(box: OcrBox): OcrBox | null
  /** Pinta as áreas de branco: o que vem depois (`png`) já sai sem elas. Corte antes de pintar. */
  paintWhite(boxes: readonly OcrBox[]): void
  release(): void
}

export type RasterDocument = {
  pageCount: number
  render(page: number): Promise<RenderedPage>
  /** Onde o PDF põe cada imagem da página (pontos, origem no alto), com os pequenos desenhos pintados por cima dela. Ver `embedded-prints.ts`. */
  /** `null` = a página não foi lida pelas imagens (operações ou imagens demais, prazo, falha): ela segue a regra da tinta. */
  imagePlacements(page: number): Promise<PdfImagePlacement[] | null>
  close(): Promise<void>
}

type Matrix = [number, number, number, number, number, number]

/** Desenho pequeno (letra contornada, ícone): até isto em pontos, nos dois lados. */
const SMALL_MARK = 40

function boxOf(full: readonly number[], minX = 0, minY = 0, maxX = 1, maxY = 1): OcrBox {
  const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => [full[0]! * x! + full[2]! * y! + full[4]!, full[1]! * x! + full[3]! * y! + full[5]!] as const)
  const xs = corners.map((point) => point[0])
  const ys = corners.map((point) => point[1])
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

/**
 * A lista de operações da página, sem desenhar: segue a matriz (como `pdf-image-reader.ts`) e anota o quadrado de cada imagem. Depois de cada imagem,
 * conta os desenhos pequenos com o centro dentro dela (o texto contornado escrito sobre um fundo de imagem).
 */
export async function placementsOf(page: PDFPageProxy): Promise<PdfImagePlacement[] | null> {
  const viewport = page.getViewport({ scale: 1 })
  const operators = await page.getOperatorList()
  // Tetos da regra V2 (SB-01): página com operações ou imagens demais não é lida pelas imagens.
  if (operators.fnArray.length > PDF_EMBEDDED_PRINT_RULE.maxPageOperators) return null
  const placements: PdfImagePlacement[] = []
  let matrix: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index]
    const args = operators.argsArray[index] as unknown[] | null
    if (fn === OPS.save) stack.push(matrix)
    else if (fn === OPS.restore) matrix = stack.pop() ?? matrix
    else if (fn === OPS.transform && args) matrix = Util.transform(matrix, args as number[]) as Matrix
    else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push(matrix)
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) matrix = Util.transform(matrix, Array.from(args[0] as ArrayLike<number>)) as Matrix
    } else if (fn === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? matrix
    else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && args) {
      placements.push({ ...boxOf(Util.transform(viewport.transform, matrix)), marksOver: 0 })
      if (placements.length > PDF_EMBEDDED_PRINT_RULE.maxPlacements) return null
    } else if (fn === OPS.constructPath && args && placements.length > 0 && args[0] !== OPS.endPath) {
      const minMax = args[2] as ArrayLike<number> | null | undefined
      if (!minMax || minMax.length < 4 || !Number.isFinite(minMax[0]!)) continue
      const mark = boxOf(Util.transform(viewport.transform, matrix), minMax[0], minMax[1], minMax[2], minMax[3])
      if (mark.right - mark.left > SMALL_MARK || mark.bottom - mark.top > SMALL_MARK) continue
      const x = (mark.left + mark.right) / 2
      const y = (mark.top + mark.bottom) / 2
      for (const placement of placements) if (x >= placement.left && x <= placement.right && y >= placement.top && y <= placement.bottom) placement.marksOver += 1
    }
  }
  return placements
}

export async function openRasterDocument(buffer: Buffer, options: { renderTimeoutMs?: number } = {}): Promise<RasterDocument> {
  const renderTimeoutMs = options.renderTimeoutMs ?? OCR_RENDER_TIMEOUT_MS
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, maxImageSize: MAX_DECODED_PIXELS }).promise
  const factory = document.canvasFactory as unknown as CanvasFactory
  return {
    pageCount: document.numPages,
    async imagePlacements(number) {
      const page = await document.getPage(number)
      // Mesmo prazo do desenho da página: a lista de operações passou dele (ou falhou) = a página segue a regra da tinta (SB-01).
      let timer: NodeJS.Timeout | undefined
      try {
        return await Promise.race([placementsOf(page), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), renderTimeoutMs)))])
      } catch {
        return null
      } finally {
        clearTimeout(timer)
        page.cleanup()
      }
    },
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
        const task = page.render({ canvasContext: pair.context as never, viewport, canvas: pair.canvas as never })
        // O prazo é conferido entre os trechos do desenho (o pdf.js pausa a cada ~15 ms) e também pelo relógio, para a espera dos dados da página.
        const deadline = performance.now() + renderTimeoutMs
        let expired = false
        const expire = () => {
          if (expired) return
          expired = true
          task.cancel()
        }
        task.onContinue = (proceed: () => void) => (performance.now() > deadline ? expire() : proceed())
        const timer = setTimeout(expire, renderTimeoutMs)
        try {
          await task.promise
        } catch (error) {
          throw expired ? new PageRenderTimeoutError(`A página ${number} passou de ${renderTimeoutMs} ms para ser desenhada.`) : error
        } finally {
          clearTimeout(timer)
        }
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
        trimToInk(box) {
          const area = toPixels(box)
          if (area.width < 1 || area.height < 1) return null
          const pixels = pair.context.getImageData(area.left, area.top, area.width, area.height).data
          let left = area.width
          let top = area.height
          let right = -1
          let bottom = -1
          for (let y = 0; y < area.height; y += 1) {
            for (let x = 0; x < area.width; x += 1) {
              const offset = (y * area.width + x) * 4
              // Tinta = qualquer pixel que não seja quase branco: a margem do print gravada no arquivo é branca.
              if (pixels[offset]! < INK_BELOW || pixels[offset + 1]! < INK_BELOW || pixels[offset + 2]! < INK_BELOW) {
                if (x < left) left = x
                if (x > right) right = x
                if (y < top) top = y
                if (y > bottom) bottom = y
              }
            }
          }
          if (right < 0) return null
          const pad = TRIM_PADDING
          return {
            left: Math.max(box.left, (area.left + left - pad) / scale),
            top: Math.max(box.top, (area.top + top - pad) / scale),
            right: Math.min(box.right, (area.left + right + 1 + pad) / scale),
            bottom: Math.min(box.bottom, (area.top + bottom + 1 + pad) / scale),
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
