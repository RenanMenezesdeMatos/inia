import { parseHocr, wordsOf, type OcrBox, type OcrLine } from "../../domain/pdf-ocr/hocr.js"
import type { OcrPageInput } from "../../domain/pdf-ocr/ocr-layout.js"
import { documentBodyHeight, inkBands, printRegions } from "../../domain/pdf-ocr/print-regions.js"
import type { PdfPageImage } from "../../domain/pdf-markdown/layout.js"
import { KNOWLEDGE_IMAGE_MIME_TYPE, PDF_IMAGE_LIMITS, type ExtractedPdfImage } from "../pdf-image-reader.js"
import type { OcrEngine } from "./ocr-engine.js"
import { openRasterDocument, type RenderedPage } from "./pdf-page-raster.js"

/**
 * Lê as páginas digitalizadas de um PDF. Duas passadas, porque o tamanho da letra do corpo é do documento e não da página:
 *  1. cada página é desenhada e lida inteira; guarda-se o texto e as faixas de tinta;
 *  2. com a letra do corpo conhecida, as páginas com print são desenhadas de novo: cada print é cortado como imagem e a página é lida mais uma
 *     vez com ele pintado de branco, para o texto da tela não se misturar ao do documento.
 * Página que falha fica sem texto (e aparece assim no registro) sem impedir as outras.
 */
export const OCR_MAX_PAGES = 300

export type OcrProgress = { stage: "READING" | "PRINTS"; done: number; total: number }

export type OcrPageResult = OcrPageInput & { ok: true }

export type OcrReadResult = {
  pages: OcrPageResult[]
  failedPages: number[]
  /** Páginas digitalizadas além do limite: ficaram sem leitura. */
  skippedPages: number[]
  images: PdfPageImage[]
  files: ExtractedPdfImage[]
  /** Prints que não puderam ser guardados (limite de imagens ou falha no corte). Continuam fora do texto. */
  imagesOmitted: number
}

type FirstPass = { page: number; width: number; height: number; lines: OcrLine[]; bands: OcrBox[] }

const pause = () => new Promise((resume) => setImmediate(resume))

async function readPage(engine: OcrEngine, rendered: RenderedPage): Promise<OcrLine[]> {
  return parseHocr(await engine.recognize(await rendered.png()), rendered.scale).lines
}

export async function readScannedPages(
  buffer: Buffer,
  pages: readonly number[],
  engine: OcrEngine,
  options: { onProgress?: (progress: OcrProgress) => Promise<void> | void; limits?: { maxImages: number; maxBytes: number }; existingImageBytes?: number } = {},
): Promise<OcrReadResult> {
  const wanted = [...new Set(pages)].sort((a, b) => a - b)
  const reading = wanted.slice(0, OCR_MAX_PAGES)
  const skippedPages = wanted.slice(OCR_MAX_PAGES)
  const limits = options.limits ?? PDF_IMAGE_LIMITS
  const document = await openRasterDocument(buffer)
  const failedPages: number[] = []
  const first: FirstPass[] = []
  try {
    for (const [index, number] of reading.entries()) {
      await options.onProgress?.({ stage: "READING", done: index, total: reading.length })
      let rendered: RenderedPage | null = null
      try {
        rendered = await document.render(number)
        await pause()
        const bands = inkBands(rendered.pixels(), rendered.pixelWidth, rendered.pixelHeight, rendered.scale)
        await pause()
        first.push({ page: number, width: rendered.width, height: rendered.height, lines: await readPage(engine, rendered), bands })
      } catch (error) {
        // Sem o motor não há o que fazer nas outras páginas: o erro sobe para quem pediu a leitura.
        if (error instanceof Error && error.name === "OcrEngineUnavailableError") throw error
        failedPages.push(number)
      } finally {
        rendered?.release()
      }
    }
    await options.onProgress?.({ stage: "READING", done: reading.length, total: reading.length })

    const body = documentBodyHeight(first.map((page) => ({ words: wordsOf(page), bands: page.bands })))
    const withPrints = first.map((page) => ({ page, prints: printRegions(page.bands, wordsOf(page), body) }))
    const pending = withPrints.filter((entry) => entry.prints.length > 0)
    const images: PdfPageImage[] = []
    const files: ExtractedPdfImage[] = []
    const seen = new Set<string>()
    let bytes = options.existingImageBytes ?? 0
    let imagesOmitted = 0
    const results: OcrPageResult[] = []
    let done = 0
    for (const { page, prints } of withPrints) {
      if (prints.length === 0) {
        results.push({ ok: true, page: page.page, width: page.width, height: page.height, lines: page.lines, prints: [] })
        continue
      }
      await options.onProgress?.({ stage: "PRINTS", done, total: pending.length })
      let rendered: RenderedPage | null = null
      try {
        rendered = await document.render(page.page)
        for (const print of prints) {
          const cut = files.length >= limits.maxImages || bytes >= limits.maxBytes ? null : await rendered.cut(print).catch(() => null)
          if (!cut) {
            imagesOmitted += 1
            continue
          }
          if (!seen.has(cut.id)) {
            seen.add(cut.id)
            files.push({ id: cut.id, mimeType: KNOWLEDGE_IMAGE_MIME_TYPE, width: cut.width, height: cut.height, data: cut.data })
            bytes += cut.data.length
          }
          images.push({ id: cut.id, page: page.page, ...print, width: cut.width, height: cut.height })
        }
        rendered.paintWhite(prints)
        await pause()
        // A segunda leitura, sem os prints, é o texto da página. O print continua fora dele mesmo se não pôde ser guardado.
        results.push({ ok: true, page: page.page, width: page.width, height: page.height, lines: await readPage(engine, rendered), prints })
      } catch (error) {
        if (error instanceof Error && error.name === "OcrEngineUnavailableError") throw error
        // Falhou a segunda leitura: fica a primeira, sem o texto de dentro dos prints (ele é filtrado pela posição).
        results.push({ ok: true, page: page.page, width: page.width, height: page.height, lines: page.lines, prints })
      } finally {
        rendered?.release()
        done += 1
      }
    }
    await options.onProgress?.({ stage: "PRINTS", done: pending.length, total: pending.length })
    return { pages: results, failedPages, skippedPages, images, files, imagesOmitted }
  } finally {
    await document.close()
  }
}
