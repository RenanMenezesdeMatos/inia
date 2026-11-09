import { createHash } from "node:crypto"
import { getDocument, ImageKind, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api.js"
import type { PdfPageImage } from "../domain/pdf-markdown/layout.js"

/**
 * Lê as imagens do PDF para mostrar ao usuário (prints de instruções de trabalho). É uma leitura à parte da do texto, que não decodifica imagens
 * (`pdf-layout-reader.ts`): decodificar custa caro, e a leitura do texto não depende disso. Só usa o que o `pdf-parse` já traz: o pdf.js e o canvas
 * que ele carrega. Grava em WebP q90: nos manuais reais os prints ficaram com cerca de 60% do tamanho do PDF, contra 3 vezes em PNG, e o texto da tela
 * continua nítido. Nada aqui altera o arquivo, e a IA não recebe estas imagens.
 */
export const KNOWLEDGE_IMAGE_MIME_TYPE = "image/webp"
const WEBP_QUALITY = 90

/** Abaixo disso é ícone ou enfeite: o mesmo mínimo de área que a leitura do texto usa para dizer que a página tem imagem. */
const MIN_PAGE_SHARE = 0.005
const MIN_SIDE_PIXELS = 32
/** Imagem maior que isso não é decodificada: protege a memória, e print de tela nem chega perto. */
const MAX_DECODED_PIXELS = 25_000_000
/** O maior lado guardado: foto ou digitalização enorme é reduzida; print de tela fica como está. */
const MAX_SIDE_PIXELS = 2_400
const IMAGE_WAIT_MS = 15_000

export const PDF_IMAGE_LIMITS = { maxImages: 500, maxBytes: 64 * 1024 * 1024 }

export type ExtractedPdfImage = { id: string; mimeType: typeof KNOWLEDGE_IMAGE_MIME_TYPE; width: number; height: number; data: Buffer }
export type PdfImageRead = { images: PdfPageImage[]; files: ExtractedPdfImage[]; omitted: number }

type Matrix = [number, number, number, number, number, number]
type DecodedImage = { width: number; height: number; kind?: number | null; data?: Uint8Array | Uint8ClampedArray | null }
type CanvasLike = { encode(format: "webp", quality: number): Promise<Buffer> }
type ContextLike = {
  createImageData(width: number, height: number): { data: Uint8ClampedArray }
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  drawImage(source: CanvasLike, x: number, y: number): void
}
type CanvasPair = { canvas: CanvasLike; context: ContextLike }
type CanvasFactory = { create(width: number, height: number): CanvasPair; destroy(pair: CanvasPair): void }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** O pdf.js entrega 1 bit, RGB ou RGBA; o canvas só aceita RGBA. */
function toRgba(image: DecodedImage & { data: Uint8Array | Uint8ClampedArray }, pixels: Uint8ClampedArray): boolean {
  const { data, width, height, kind } = image
  if (kind === ImageKind.RGBA_32BPP) {
    pixels.set(data.subarray(0, pixels.length))
    return true
  }
  if (kind === ImageKind.RGB_24BPP) {
    for (let source = 0, target = 0; source + 2 < data.length && target < pixels.length; source += 3, target += 4) {
      pixels[target] = data[source]!
      pixels[target + 1] = data[source + 1]!
      pixels[target + 2] = data[source + 2]!
      pixels[target + 3] = 255
    }
    return true
  }
  if (kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const value = (data[row * rowBytes + (column >> 3)]! >> (7 - (column & 7))) & 1 ? 255 : 0
        const target = (row * width + column) * 4
        pixels[target] = value
        pixels[target + 1] = value
        pixels[target + 2] = value
        pixels[target + 3] = 255
      }
    }
    return true
  }
  return false
}

/**
 * Como desenhar a imagem para ela ficar como aparece na página: na página girada, o arquivo pode guardar o print deitado. `full` é a matriz do
 * quadrado da imagem na página (y para baixo); o caso normal não precisa de transformação. Inclinação que não seja de 90 graus fica como está.
 */
export function orientationOf(full: readonly number[], width: number, height: number, scale: number): { matrix: Matrix; width: number; height: number } | null {
  const [a, b, c, d] = full as [number, number, number, number]
  const tiny = 1e-3 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d))
  const straight = Math.abs(b) <= tiny && Math.abs(c) <= tiny
  const sideways = Math.abs(a) <= tiny && Math.abs(d) <= tiny
  if (!straight && !sideways) return scale === 1 ? null : { matrix: [scale, 0, 0, scale, 0, 0], width: Math.round(width * scale), height: Math.round(height * scale) }
  // Para onde vão o eixo x da imagem e o eixo y dela (que desce a partir da primeira linha de pixels).
  const xAxis = straight ? [Math.sign(a), 0] : [0, Math.sign(b)]
  const yAxis = straight ? [0, -Math.sign(d)] : [-Math.sign(c), 0]
  if (scale === 1 && xAxis[0] === 1 && yAxis[1] === 1) return null
  const w = width * scale
  const h = height * scale
  const offsetX = (xAxis[0]! < 0 ? w : 0) + (yAxis[0]! < 0 ? h : 0)
  const offsetY = (xAxis[1]! < 0 ? w : 0) + (yAxis[1]! < 0 ? h : 0)
  return { matrix: [xAxis[0]! * scale, xAxis[1]! * scale, yAxis[0]! * scale, yAxis[1]! * scale, offsetX, offsetY], width: Math.round(straight ? w : h), height: Math.round(straight ? h : w) }
}

async function encodeImage(factory: CanvasFactory, image: DecodedImage & { data: Uint8Array | Uint8ClampedArray }, full: readonly number[]): Promise<{ data: Buffer; width: number; height: number } | null> {
  const source = factory.create(image.width, image.height)
  let target: CanvasPair | null = null
  try {
    const frame = source.context.createImageData(image.width, image.height)
    if (!toRgba(image, frame.data)) return null
    source.context.putImageData(frame, 0, 0)
    const scale = Math.min(1, MAX_SIDE_PIXELS / Math.max(image.width, image.height))
    const oriented = orientationOf(full, image.width, image.height, scale)
    if (!oriented) return { data: await source.canvas.encode("webp", WEBP_QUALITY), width: image.width, height: image.height }
    target = factory.create(oriented.width, oriented.height)
    target.context.setTransform(...oriented.matrix)
    target.context.drawImage(source.canvas, 0, 0)
    return { data: await target.canvas.encode("webp", WEBP_QUALITY), width: oriented.width, height: oriented.height }
  } finally {
    factory.destroy(source)
    if (target) factory.destroy(target)
  }
}

/** A imagem decodificada, ou null se ela não chegou: imagem com defeito fica de fora, sem derrubar as outras. */
function decodedImage(page: PDFPageProxy, reference: unknown): Promise<DecodedImage | null> {
  if (typeof reference !== "string") return Promise.resolve((reference as DecodedImage | null) ?? null)
  // A mesma regra do pdf.js para desenhar: imagem usada em várias páginas leva o prefixo `g_`, fica no documento e pode ainda estar a caminho.
  const objects = reference.startsWith("g_") ? page.commonObjs : page.objs
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IMAGE_WAIT_MS)
    try {
      objects.get(reference, (value: DecodedImage | null) => {
        clearTimeout(timer)
        resolve(value ?? null)
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

const hashOf = (image: DecodedImage & { data: Uint8Array | Uint8ClampedArray }) => createHash("sha256").update(`${image.width}x${image.height}:${image.kind ?? ""}:`).update(image.data).digest("hex").slice(0, 32)

async function readPageImages(document: PDFDocumentProxy, page: PDFPageProxy, state: PdfImageRead & { bytes: number; seen: Map<string, ExtractedPdfImage>; limits: typeof PDF_IMAGE_LIMITS }): Promise<void> {
  const viewport = page.getViewport({ scale: 1 })
  const pageArea = viewport.width * viewport.height
  const operators = await page.getOperatorList()
  const factory = document.canvasFactory as unknown as CanvasFactory
  let matrix: Matrix = IDENTITY
  const stack: Matrix[] = []
  /** Imagem acima do limite de pixels: o pdf.js tira a pintura da lista, mas a matriz fica. Conta como de fora, para nada sumir sem aviso. */
  let pendingArea = 0
  const areaOf = (full: readonly number[]) => Math.abs(full[0]! * full[3]! - full[1]! * full[2]!)
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index]
    const args = operators.argsArray[index] as unknown[] | null
    if (fn === OPS.save) {
      stack.push(matrix)
      pendingArea = 0
    } else if (fn === OPS.restore) {
      if (pendingArea >= pageArea * MIN_PAGE_SHARE) state.omitted += 1
      pendingArea = 0
      matrix = stack.pop() ?? matrix
    } else if (fn === OPS.transform && args) {
      matrix = Util.transform(matrix, args as number[]) as Matrix
      pendingArea = areaOf(Util.transform(viewport.transform, matrix))
    } else if (fn === OPS.paintFormXObjectBegin && args) {
      stack.push(matrix)
      pendingArea = 0
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) matrix = Util.transform(matrix, Array.from(args[0] as ArrayLike<number>)) as Matrix
    } else if (fn === OPS.paintFormXObjectEnd) {
      pendingArea = 0
      matrix = stack.pop() ?? matrix
    } else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) pendingArea = 0
    else if (fn === OPS.constructPath && args) {
      if (args[0] !== OPS.endPath) pendingArea = 0
    } else if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) pendingArea = 0
    else if ((fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) && args) {
      pendingArea = 0
      const full = Util.transform(viewport.transform, matrix) as Matrix
      const [a, b, c, d, e, f] = full
      if (areaOf(full) < pageArea * MIN_PAGE_SHARE) continue
      const image = await decodedImage(page, args[0])
      if (!image?.data) {
        state.omitted += 1
        continue
      }
      if (image.width < MIN_SIDE_PIXELS || image.height < MIN_SIDE_PIXELS) continue
      const decoded = image as DecodedImage & { data: Uint8Array | Uint8ClampedArray }
      const id = hashOf(decoded)
      let file = state.seen.get(id)
      if (!file) {
        if (state.files.length >= state.limits.maxImages || state.bytes >= state.limits.maxBytes) {
          state.omitted += 1
          continue
        }
        const encoded = await encodeImage(factory, decoded, full).catch(() => null)
        if (!encoded) {
          state.omitted += 1
          continue
        }
        file = { id, mimeType: KNOWLEDGE_IMAGE_MIME_TYPE, ...encoded }
        state.seen.set(id, file)
        state.files.push(file)
        state.bytes += encoded.data.length
      }
      const xs = [e, a + e, c + e, a + c + e]
      const ys = [f, b + f, d + f, b + d + f]
      state.images.push({ id, page: page.pageNumber, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), width: file.width, height: file.height })
    }
  }
}

/**
 * As imagens de conteúdo do PDF, com a posição de cada aparição e cada arquivo uma vez só. O pdf.js trabalha na mesma thread do servidor: a pausa entre
 * as páginas e a codificação fora da thread (o canvas codifica em segundo plano) mantêm a API atendendo durante a leitura.
 */
export async function readPdfImages(buffer: Buffer, limits: typeof PDF_IMAGE_LIMITS = PDF_IMAGE_LIMITS, options: { skipPages?: ReadonlySet<number> } = {}): Promise<PdfImageRead> {
  const document = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, maxImageSize: MAX_DECODED_PIXELS }).promise
  const state = { images: [] as PdfPageImage[], files: [] as ExtractedPdfImage[], omitted: 0, bytes: 0, seen: new Map<string, ExtractedPdfImage>(), limits }
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      // Página digitalizada lida por OCR: a imagem dela é a página inteira, e os prints de dentro saem pelo OCR.
      if (options.skipPages?.has(number)) continue
      const page = await document.getPage(number)
      await readPageImages(document, page, state)
      page.cleanup()
      await new Promise((resume) => setImmediate(resume))
    }
    return { images: state.images, files: state.files, omitted: state.omitted }
  } finally {
    await document.destroy()
  }
}
