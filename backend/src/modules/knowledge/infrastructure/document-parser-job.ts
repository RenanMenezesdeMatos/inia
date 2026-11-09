import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { readPdfImages, type PdfImageRead } from "./pdf-image-reader.js"
import { readPdfLayout } from "./pdf-layout-reader.js"
import type { PdfPageLayout } from "../domain/pdf-markdown/layout.js"

/**
 * Roda SÓ no processo filho do parser isolado (`shared/infrastructure/isolated-parser`), nunca na API: é aqui que o pdf.js e o
 * mammoth abrem o arquivo enviado. Quem chama é `text-extractor.ts` (`parseDocumentIsolated` e as leituras de layout e imagens).
 */
/** `skipPages` (PDF_IMAGES): páginas digitalizadas que o OCR lê; a imagem delas é a página inteira e não entra como print. */
export type DocumentParseJob = { kind: "PDF_TEXT" | "PDF_LAYOUT" | "PDF_IMAGES" | "DOCX_TEXT" | "DOCX_HTML"; data: Uint8Array; omitImages?: boolean | undefined; skipPages?: number[] | undefined }

type DocumentElement = { type: string; children?: DocumentElement[] }
const withoutImages = (element: DocumentElement): DocumentElement =>
  element.children ? { ...element, children: element.children.filter((child) => child.type !== "image").map(withoutImages) } : element

export async function run(job: DocumentParseJob): Promise<string | PdfPageLayout[] | PdfImageRead> {
  const buffer = Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength)
  if (job.kind === "PDF_LAYOUT") return readPdfLayout(buffer)
  if (job.kind === "PDF_IMAGES") return readPdfImages(buffer, undefined, { skipPages: new Set(job.skipPages ?? []) })
  if (job.kind === "PDF_TEXT") {
    const parser = new PDFParse({ data: buffer })
    try {
      // Sem o separador de páginas do extrator ("-- 1 of 1 --"): ele não é conteúdo, faria um PDF sem texto parecer ter texto e
      // apareceria como diferença na comparação de versões quando o número de páginas muda.
      return (await parser.getText({ pageJoiner: "" })).text
    } finally {
      await parser.destroy()
    }
  }
  if (job.kind === "DOCX_TEXT") return (await mammoth.extractRawText({ buffer })).value
  // Imagens ficam embutidas como data URI (padrão do mammoth); o frontend sanitiza o HTML e só aceita data:image/*.
  return (await mammoth.convertToHtml({ buffer }, job.omitImages ? { transformDocument: withoutImages as never } : {})).value
}
