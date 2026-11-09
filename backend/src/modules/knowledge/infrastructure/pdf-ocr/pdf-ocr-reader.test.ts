import { describe, expect, it } from "vitest"
import { grayImage, paragraph, type FixturePage } from "../../testing/pdf-layout-fixture.js"
import { buildScannedPdf } from "../../testing/scanned-pdf-fixture.js"
import { extractKnowledgeFile, extractScannedPdf } from "../text-extractor.js"
import { createOcrEngine, OcrEngineUnavailableError, ocrEngineFiles } from "./ocr-engine.js"

/** Com o motor de verdade (backend/vendor/tesseract), no processo filho com teto de memória (R-24): é o mesmo caminho do servidor. */
const RULES = "A devolução atrasada de equipamento gera multa de R$ 210,00 por item, cobrada na fatura seguinte ao fim do prazo de 30 dias corridos."
const MORE = "O cliente pode contestar a multa em até 10 dias úteis com o comprovante de postagem."

function documentPage(): FixturePage {
  const title: FixturePage = [{ kind: "text", x: 56, y: 80, text: "Regulamento de devolução", size: 18, font: "bold" }]
  const first = paragraph(RULES, { x: 56, y: 130, width: 480 })
  // Uma área escura sem texto no meio da página: é uma imagem e sai cortada.
  const picture: FixturePage = [{ kind: "image", x: 56, y: first.y + 20, width: 300, height: 150, image: grayImage(300, 150, 90) }]
  const second = paragraph(MORE, { x: 56, y: first.y + 200, width: 480 })
  return [...title, ...first.ops, ...picture, ...second.ops]
}

describe("leitura de PDF digitalizado (OCR)", () => {
  it("o motor e o português estão no projeto", () => {
    expect(ocrEngineFiles()).not.toBeNull()
  })

  it("no envio, a página digitalizada fica marcada para o OCR e sem texto", async () => {
    const pdf = await buildScannedPdf([documentPage()])
    const extracted = await extractKnowledgeFile(pdf, "PDF")
    expect(extracted.text).toBe("")
    expect(extracted.scannedPages).toEqual([1])
    expect(extracted.images).toEqual([])
  })

  it("lê o texto da imagem da página, com título, acentos e números, e corta a área de imagem", async () => {
    const pdf = await buildScannedPdf([documentPage()])
    const steps: string[] = []
    const result = await extractScannedPdf(pdf, { onProgress: (progress) => void steps.push(`${progress.stage} ${progress.done}/${progress.total}`) })
    expect(result.text).toMatch(/^#+ Regulamento de devolução/)
    expect(result.text).toContain("R$ 210,00")
    // "corridos" fica de fora: no runner Linux a página sintética é desenhada com outra fonte substituta da Helvetica, e o OCR lê "comidos" (rr → m).
    expect(result.text).toContain("30 dias")
    expect(result.text).toContain("10 dias úteis")
    expect(result.extraction?.ocr).toMatchObject({ version: "PDF_OCR_V1", pages: [1], failedPages: [], skippedPages: [], prints: 1 })
    expect(result.extraction?.pages[0]?.status).not.toBe("NO_TEXT")
    expect(result.images).toHaveLength(1)
    expect(result.images[0]!.data.subarray(8, 12).toString("latin1")).toBe("WEBP")
    expect(result.extraction?.images?.[0]).toMatchObject({ page: 1, id: result.images[0]!.id })
    expect(result.scannedPages).toEqual([])
    expect(steps).toContain("READING 1/1")
    expect(steps).toContain("PRINTS 1/1")
  })

  it("PDF misto: a página com texto sai da camada de texto e só a digitalizada passa pelo OCR", async () => {
    const textPage = paragraph("Esta página tem texto selecionável sobre a segunda via de fatura.", { x: 56, y: 100, width: 480 }).ops
    const pdf = await buildScannedPdf([textPage, documentPage()], { textPages: [1] })
    const result = await extractScannedPdf(pdf)
    expect(result.text.indexOf("segunda via de fatura")).toBeGreaterThanOrEqual(0)
    expect(result.text.indexOf("segunda via de fatura")).toBeLessThan(result.text.indexOf("10 dias úteis"))
    expect(result.extraction?.ocr?.pages).toEqual([2])
  })

  it("sem os arquivos do motor, a leitura falha com o motivo, e o PDF com texto nem chega ao motor", async () => {
    const missing = createOcrEngine({ directory: "/nao/existe/" })
    await expect(missing.recognize(Buffer.from("x"))).rejects.toBeInstanceOf(OcrEngineUnavailableError)
    await missing.close()
    await expect(extractScannedPdf(await buildScannedPdf([documentPage()]), { engineDirectory: "/nao/existe/" })).rejects.toBeInstanceOf(OcrEngineUnavailableError)
    const textOnly = await buildScannedPdf([paragraph("Página com texto.", { x: 56, y: 100, width: 480 }).ops], { textPages: [1] })
    const result = await extractScannedPdf(textOnly, { engineDirectory: "/nao/existe/" })
    expect(result.extraction?.ocr).toBeUndefined()
    expect(result.text).toContain("Página com texto.")
  })

  it("andamento que falha (leitura cancelada) para o processo filho e chega a quem pediu", async () => {
    const pdf = await buildScannedPdf([documentPage(), documentPage()])
    const cancelled = new Error("cancelada")
    await expect(extractScannedPdf(pdf, { onProgress: () => Promise.reject(cancelled) })).rejects.toBe(cancelled)
  })
})
