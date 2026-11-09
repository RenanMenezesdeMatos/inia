import { describe, expect, it } from "vitest"
import { docxWithLines, pdfWithLines } from "../testing/knowledge-file-fixtures.js"
import { extractTextFromFile, fileContentAccepted } from "./text-extractor.js"

describe("texto extraído dos arquivos da base", () => {
  it("PDF: só o texto do arquivo, sem o separador de páginas do extrator", async () => {
    const file = pdfWithLines(["Confirme o e-mail.", "Encerre o atendimento."])
    expect(await fileContentAccepted(file, "PDF")).toBe(true)
    expect(await extractTextFromFile(file, "PDF")).toBe("Confirme o e-mail.\nEncerre o atendimento.")
  })

  it("PDF sem texto (digitalizado): nada extraído, para a base nunca tratar o marcador de página como conteúdo", async () => {
    const file = pdfWithLines([])
    expect(await fileContentAccepted(file, "PDF")).toBe(true)
    expect(await extractTextFromFile(file, "PDF")).toBe("")
  })

  it("DOCX: o texto dos parágrafos", async () => {
    const file = docxWithLines(["Confirme o e-mail.", "Encerre o atendimento."])
    expect(await fileContentAccepted(file, "DOCX")).toBe(true)
    expect(await extractTextFromFile(file, "DOCX")).toBe("Confirme o e-mail.\n\nEncerre o atendimento.")
  })
})
