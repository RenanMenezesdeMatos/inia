import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { describe, expect, it } from "vitest"
import { IsolatedParserError } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { chainedFilterBombPdf, textPdf } from "../testing/pdf-fixtures.js"
import { pdfLayoutToMarkdown } from "../domain/pdf-markdown/pdf-markdown.js"
import { renderDocxPreviewHtml } from "./docx-preview.js"
import { readPdfImages } from "./pdf-image-reader.js"
import { readPdfLayout } from "./pdf-layout-reader.js"
import { extractKnowledgeFile, extractPlainPdfText, extractTextFromFile } from "./text-extractor.js"

const MANUAL = fileURLToPath(new URL("../../../../../docs/manuais/IT-INIA-002-Liberacao-de-acesso-e-primeiro-login", import.meta.url))
/** `docs/manuais` fica fora do snapshot do GitHub (scripts/github/exclusoes.txt): lá, e na cópia do `--verificar`, estes dois casos são pulados. */
const WITHOUT_MANUAL = !existsSync(`${MANUAL}.pdf`) || !existsSync(`${MANUAL}.docx`)

/** O que a API extraía antes, com o pdf-parse no próprio processo. */
async function inProcessPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    return (await parser.getText({ pageJoiner: "" })).text.trim()
  } finally {
    await parser.destroy()
  }
}

describe("extração de texto da Base de Conhecimento no processo filho (R-24, achado DATA-1)", () => {
  it("PDF comum: o texto extraído no filho é idêntico ao do pdf-parse no processo", async () => {
    const pdf = textPdf(["Procedimento de cancelamento", "Confirme o CPF antes de seguir"])
    const text = await extractPlainPdfText(pdf)
    expect(text).toContain("Procedimento de cancelamento")
    expect(text).toBe(await inProcessPdfText(pdf))
  })

  it.skipIf(WITHOUT_MANUAL)("manual real (docs/manuais): PDF e DOCX extraem igual ao parser no processo e a prévia DOCX também", async () => {
    const pdf = readFileSync(`${MANUAL}.pdf`)
    expect(await extractPlainPdfText(pdf)).toBe(await inProcessPdfText(pdf))
    const docx = readFileSync(`${MANUAL}.docx`)
    expect(await extractTextFromFile(docx, "DOCX")).toBe((await mammoth.extractRawText({ buffer: docx })).value.trim())
    expect(await renderDocxPreviewHtml(docx)).toBe((await mammoth.convertToHtml({ buffer: docx })).value)
  })

  it.skipIf(WITHOUT_MANUAL)("manual real: o Markdown e as imagens lidos no filho são os mesmos da leitura no processo, e as imagens chegam como Buffer", async () => {
    const pdf = readFileSync(`${MANUAL}.pdf`)
    const layout = await readPdfLayout(pdf)
    const images = await readPdfImages(pdf)
    expect(images.files.length).toBeGreaterThan(0)
    const expected = pdfLayoutToMarkdown(layout, { images: images.images, omitted: images.omitted })
    const extracted = await extractKnowledgeFile(pdf, "PDF")
    expect(extracted.text).toBe(expected.markdown)
    expect(extracted.extraction).toEqual(expected.extraction)
    const placed = new Set(expected.extraction.images?.map((image) => image.id))
    expect(extracted.images.map((image) => image.id)).toEqual(images.files.filter((file) => placed.has(file.id)).map((file) => file.id))
    expect(extracted.images.every((image) => Buffer.isBuffer(image.data))).toBe(true)
    expect(extracted.images[0]!.data.equals(images.files.find((file) => file.id === extracted.images[0]!.id)!.data)).toBe(true)
    expect(await extractTextFromFile(pdf, "PDF")).toBe(pdfLayoutToMarkdown(layout).markdown)
  })

  it("PDF-bomba com cadeia de filtros (que a pré-varredura não mede) é recusado no filho sem a memória deste processo subir", async () => {
    const bomb = chainedFilterBombPdf()
    expect(bomb.length).toBeLessThan(64 * 1024)
    const before = process.memoryUsage.rss()
    const error = await extractTextFromFile(bomb, "PDF").then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(IsolatedParserError)
    expect((error as IsolatedParserError).reason).toBe("MEMORY")
    expect(process.memoryUsage.rss() - before).toBeLessThan(64 * 1024 * 1024)
    // Dois filhos que chegam ao teto de 1,5 GB: 4 s na máquina livre; com a suíte inteira (e as leituras por OCR, também em processo filho) passa de 20 s.
  }, 60_000)

  it("texto e JSON continuam lidos direto, sem processo filho", async () => {
    expect(await extractTextFromFile(Buffer.from("  Procedimento  \n"), "TXT")).toBe("Procedimento")
  })
})
