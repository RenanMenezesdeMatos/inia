import { createIsolatedParser, IsolatedParserError, runIsolated, siblingModule, type IsolatedParserLimits } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { inspectPdf } from "../../../shared/infrastructure/pdf-guard.js"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { PDF_OCR_VERSION, type PdfExtraction, type PdfPageLayout } from "../domain/pdf-markdown/layout.js"
import { pdfLayoutToMarkdown } from "../domain/pdf-markdown/pdf-markdown.js"
import { ocrPageLayouts } from "../domain/pdf-ocr/ocr-layout.js"
import { PDF_PRINT_RULE } from "../domain/pdf-ocr/print-regions.js"
import type { DocumentParseJob } from "./document-parser-job.js"
import { PDF_IMAGE_LIMITS, type ExtractedPdfImage, type PdfImageRead } from "./pdf-image-reader.js"
import { OCR_ENGINE_LABEL, OcrEngineUnavailableError, ocrEngineFiles } from "./pdf-ocr/ocr-engine.js"
import type { OcrJobInput, OcrJobOutput } from "./pdf-ocr/pdf-ocr-job.js"
import type { OcrProgress } from "./pdf-ocr/pdf-ocr-reader.js"

const log = createLogger("knowledge-extractor")

export type KnowledgeSourceType = "TEXT" | "PDF" | "DOCX" | "TXT" | "JSON"

const MIME_TO_SOURCE_TYPE: Record<string, KnowledgeSourceType> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
  "application/json": "JSON",
}

export function resolveSourceType(mimeType: string, filename: string): KnowledgeSourceType {
  if (MIME_TO_SOURCE_TYPE[mimeType]) return MIME_TO_SOURCE_TYPE[mimeType]
  const extension = filename.split(".").pop()?.toLowerCase()
  if (extension === "pdf") return "PDF"
  if (extension === "docx") return "DOCX"
  if (extension === "json") return "JSON"
  return "TXT"
}

/**
 * O conteúdo bate com o tipo detectado? PDF começa com `%PDF-`; DOCX é um pacote ZIP (`PK\x03\x04`). Texto/JSON não podem
 * ter bytes nulos (binário renomeado). Barra arquivo trocado/polígota antes de qualquer parser rodar sobre ele.
 */
export function contentMatchesSourceType(buffer: Buffer, sourceType: KnowledgeSourceType): boolean {
  if (sourceType === "PDF") return buffer.subarray(0, 5).toString("latin1") === "%PDF-"
  if (sourceType === "DOCX") return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  return !buffer.includes(0)
}

/**
 * Conteúdo do tipo certo E que o parser pode abrir sem explodir a memória: além da assinatura, o DOCX passa pela guarda de ZIP
 * (zip bomb recusada antes do mammoth) e o PDF tem os fluxos comprimidos medidos de verdade (pdf-guard.ts).
 */
export async function fileContentAccepted(buffer: Buffer, sourceType: KnowledgeSourceType): Promise<boolean> {
  if (!contentMatchesSourceType(buffer, sourceType)) return false
  if (sourceType === "DOCX") return (await inspectZip(buffer)).ok
  if (sourceType === "PDF") return (await inspectPdf(buffer)).ok
  return true
}

const DOCUMENT_PARSER_JOB = siblingModule(import.meta.url, "document-parser-job")

/**
 * Teto próprio da leitura de layout e de imagens do PDF, com um filho por vez e fila curta. Medido em 06/11/2026 com os maiores manuais de `docs/manuais`
 * (macOS, Node 24, com o tsx do desenvolvimento): 14 MB e 110 páginas pedem até 768 MB no layout (~1 s) e 1.024 MB nas imagens (121 imagens, ~11 s). O teto
 * cobre arquivo maior que esses. Passou dele: o layout cai no texto corrido e as imagens ficam de fora, como em qualquer falha dessas leituras.
 */
export const PDF_READING_LIMITS: IsolatedParserLimits = { heapMb: 512, rssMb: 1_536, timeoutMs: 90_000 }
const runPdfReading = createIsolatedParser({ maxRunning: 1, maxWaiting: 4 })

/**
 * pdf.js e mammoth rodam num processo filho com teto de memória e de tempo (R-24): a pré-varredura acima só mede os fluxos
 * FlateDecode, e outros filtros, cadeias de filtros e a memória do próprio parser não têm teto no processo da API. Estourou, travou
 * ou o filho morreu: `IsolatedParserError` (a rota recusa o arquivo) e a API segue de pé. Vale para toda leitura do arquivo
 * enviado: o texto corrido, o layout que vira Markdown, as imagens e a prévia do DOCX.
 */
export function parseDocumentIsolated(kind: "PDF_TEXT" | "DOCX_TEXT" | "DOCX_HTML", buffer: Buffer, options: { omitImages?: boolean } = {}): Promise<string> {
  return runIsolated<string>(DOCUMENT_PARSER_JOB, { kind, data: buffer, ...options } satisfies DocumentParseJob)
}

function readPdfLayoutIsolated(buffer: Buffer): Promise<PdfPageLayout[]> {
  return runPdfReading<PdfPageLayout[]>(DOCUMENT_PARSER_JOB, { kind: "PDF_LAYOUT", data: buffer } satisfies DocumentParseJob, PDF_READING_LIMITS)
}

/** Entre processos o Buffer chega como Uint8Array; quem grava as imagens espera Buffer. */
const asBuffers = (files: readonly ExtractedPdfImage[]): ExtractedPdfImage[] => files.map((file) => ({ ...file, data: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength) }))

async function readPdfImagesIsolated(buffer: Buffer, skipPages: readonly number[] = []): Promise<PdfImageRead> {
  const read = await runPdfReading<PdfImageRead>(DOCUMENT_PARSER_JOB, { kind: "PDF_IMAGES", data: buffer, skipPages: [...skipPages] } satisfies DocumentParseJob, PDF_READING_LIMITS)
  return { ...read, files: asBuffers(read.files) }
}

/** Leitores ocupados: a resposta é "tente de novo", nunca um resultado pior. Qualquer outra falha do layout cai no texto corrido, que tem o próprio teto e recusa o arquivo se estourar. */
const readersBusy = (error: unknown) => error instanceof IsolatedParserError && error.reason === "BUSY"

/** Texto corrido do PDF, sem estrutura: a leitura anterior ao Markdown e a saída quando a conversão falha. */
export async function extractPlainPdfText(buffer: Buffer): Promise<string> {
  return (await parseDocumentIsolated("PDF_TEXT", buffer)).trim()
}

/** `scannedPages` = páginas digitalizadas (sem camada de texto), que só o OCR lê: a leitura delas é feita depois, em segundo plano. */
export type ExtractedFile = { text: string; extraction: PdfExtraction | null; images: ExtractedPdfImage[]; scannedPages: number[] }

const NO_IMAGES: PdfImageRead = { images: [], files: [], omitted: 0 }

const scannedPagesOf = (extraction: PdfExtraction) => extraction.pages.filter((page) => page.status === "NO_TEXT").map((page) => page.page)

/** Imagens das páginas com texto. As digitalizadas ficam de fora quando o OCR vai lê-las: a imagem delas é a página inteira. */
async function readTextPageImages(buffer: Buffer, layout: readonly PdfPageLayout[], scanned: readonly number[]): Promise<PdfImageRead | null> {
  const skip = ocrEngineFiles() ? new Set(scanned) : new Set<number>()
  // Sem imagem numa página com texto, não há o que decodificar.
  const wanted = layout.some((page) => !skip.has(page.page) && page.imageCount > 0) && layout.some((page) => page.runs.length > 0)
  if (!wanted) return NO_IMAGES
  return readPdfImagesIsolated(buffer, [...skip]).catch((error: unknown) => {
    if (readersBusy(error)) throw error
    log.error({ error: error instanceof Error ? error.message : String(error) }, "pdf image reading failed; keeping the text only")
    return null
  })
}

const PDF_OCR_JOB = siblingModule(import.meta.url, "pdf-ocr/pdf-ocr-job")
/** Uma leitura por OCR por vez no processo: cada uma pode levar minutos e chegar ao teto de memória. */
const runOcrReading = createIsolatedParser({ maxRunning: 1, maxWaiting: 2 })

/**
 * Teto da leitura por OCR, no mesmo processo filho com teto de memória das outras leituras do PDF (R-24): o pdf.js desenha a página do arquivo enviado
 * e o Tesseract lê a imagem. O motor ocupa cerca de 80 MB fora do heap, e a página desenhada até 64 MB. O prazo cresce com as páginas: 1,3 s por
 * página neste Mac, com folga para um servidor mais lento e para a segunda leitura das páginas com print.
 */
export const pdfOcrLimits = (pages: number): IsolatedParserLimits => ({ heapMb: 512, rssMb: 1_536, timeoutMs: 120_000 + pages * 60_000 })

/**
 * O texto que a busca e a IA vão usar, e as imagens que só o usuário vê. PDF vira Markdown com o registro das páginas; se a conversão falhar, fica o
 * texto corrido e o upload segue. Falha nas imagens não atrapalha o texto: o registro fica sem `images`, e a tela continua abrindo o PDF, onde elas estão.
 */
export async function extractKnowledgeFile(buffer: Buffer, sourceType: KnowledgeSourceType): Promise<ExtractedFile> {
  if (sourceType === "PDF") {
    try {
      const layout = await readPdfLayoutIsolated(buffer)
      const scannedPages = scannedPagesOf(pdfLayoutToMarkdown(layout).extraction)
      const read = await readTextPageImages(buffer, layout, scannedPages)
      const { markdown, extraction } = pdfLayoutToMarkdown(layout, read ? { images: read.images, omitted: read.omitted } : undefined)
      const placed = new Set(extraction.images?.map((image) => image.id))
      return { text: markdown, extraction, images: (read?.files ?? []).filter((file) => placed.has(file.id)), scannedPages }
    } catch (error) {
      if (readersBusy(error)) throw error
      log.error({ error: error instanceof Error ? error.message : String(error) }, "pdf markdown conversion failed; using plain text")
      return { text: await extractPlainPdfText(buffer), extraction: null, images: [], scannedPages: [] }
    }
  }
  return { text: await extractTextFromFile(buffer, sourceType), extraction: null, images: [], scannedPages: [] }
}

/**
 * O PDF inteiro com as páginas digitalizadas lidas pelo OCR: as páginas com texto saem como sempre, e as outras pelo que o Tesseract leu, sem o texto
 * de dentro dos prints (que entram como imagem). Tudo passa pelo mesmo conversor para Markdown. Sem página digitalizada, é a extração de sempre.
 * O andamento chega página a página do processo filho; `onProgress` que falha (leitura cancelada) para a leitura na hora.
 */
export async function extractScannedPdf(buffer: Buffer, options: { onProgress?: (progress: OcrProgress) => Promise<void> | void; engineDirectory?: string } = {}): Promise<ExtractedFile> {
  const layout = await readPdfLayoutIsolated(buffer)
  const scanned = scannedPagesOf(pdfLayoutToMarkdown(layout).extraction)
  if (scanned.length === 0) return extractKnowledgeFile(buffer, "PDF")
  const embedded = (await readTextPageImages(buffer, layout, scanned)) ?? NO_IMAGES
  const input: OcrJobInput = {
    data: buffer,
    pages: scanned,
    limits: { maxImages: Math.max(0, PDF_IMAGE_LIMITS.maxImages - embedded.files.length), maxBytes: PDF_IMAGE_LIMITS.maxBytes },
    existingImageBytes: embedded.files.reduce((sum, file) => sum + file.data.length, 0),
    ...(options.engineDirectory ? { engineDirectory: options.engineDirectory } : {}),
  }
  let stopped: unknown = null
  let reported: Promise<unknown> = Promise.resolve()
  const onChunk = (chunk: unknown) => {
    if (stopped) throw stopped instanceof Error ? stopped : new Error(String(stopped))
    reported = reported.then(() => options.onProgress?.(chunk as OcrProgress)).catch((error: unknown) => {
      stopped ??= error
    })
  }
  let output: OcrJobOutput
  try {
    output = await runOcrReading<OcrJobOutput>(PDF_OCR_JOB, input, pdfOcrLimits(scanned.length), onChunk)
  } catch (error) {
    // Parada pedida por quem acompanha (leitura cancelada): chega o motivo dela, não a falha do processo filho que ela causou.
    await reported
    throw stopped ?? error
  }
  await reported
  if (stopped) throw stopped
  if ("unavailable" in output) throw new OcrEngineUnavailableError(output.unavailable)
  const ocr = { ...output, files: asBuffers(output.files) }
  const read = new Map(ocrPageLayouts(ocr.pages).map((page) => [page.page, page]))
  const merged = layout.map((page) => read.get(page.page) ?? page)
  const { markdown, extraction } = pdfLayoutToMarkdown(merged, { images: [...embedded.images, ...ocr.images], omitted: embedded.omitted + ocr.imagesOmitted })
  extraction.ocr = { version: PDF_OCR_VERSION, engine: OCR_ENGINE_LABEL, printRule: PDF_PRINT_RULE.version, pages: ocr.pages.map((page) => page.page), failedPages: ocr.failedPages, skippedPages: ocr.skippedPages, prints: ocr.images.length }
  const placed = new Set(extraction.images?.map((image) => image.id))
  return { text: markdown, extraction, images: [...embedded.files, ...ocr.files].filter((file) => placed.has(file.id)), scannedPages: [...ocr.failedPages, ...ocr.skippedPages] }
}

export async function extractTextFromFile(buffer: Buffer, sourceType: KnowledgeSourceType): Promise<string> {
  if (sourceType === "PDF") {
    try {
      return pdfLayoutToMarkdown(await readPdfLayoutIsolated(buffer)).markdown
    } catch (error) {
      if (readersBusy(error)) throw error
      log.error({ error: error instanceof Error ? error.message : String(error) }, "pdf markdown conversion failed; using plain text")
      return extractPlainPdfText(buffer)
    }
  }
  if (sourceType === "DOCX") return (await parseDocumentIsolated("DOCX_TEXT", buffer)).trim()
  return buffer.toString("utf8").trim()
}
