import { describe, expect, it } from "vitest"

import { canReadAsContent, documentInserts, imageInsertAt } from "./document-inserts"
import type { PdfExtraction } from "@/schemas/admin/knowledge.schema"

const page = (number: number, status: PdfExtraction["pages"][number]["status"], offset: number | null) => ({ page: number, status, chars: 10, headings: 0, tables: 0, offset })
const extraction = (pages: PdfExtraction["pages"], images?: PdfExtraction["images"]): PdfExtraction => ({ version: "PDF_MARKDOWN_V1", pageCount: pages.length, pages, headings: 0, tables: 0, repeatedLinesRemoved: 0, taggedPages: 0, edited: false, ...(images ? { images } : {}) })
const image = (id: string, pageNumber: number, offset: number | null) => ({ id, page: pageNumber, offset, width: 800, height: 400 })

describe("PDF lido como conteúdo", () => {
  it("só quando isso não esconde nada: sem a leitura das imagens, ou com a maior parte sem texto, fica o PDF", () => {
    const texto = [page(1, "TEXT", 0), page(2, "TEXT", 10)]
    expect(canReadAsContent("Texto", extraction(texto, []))).toBe(true)
    expect(canReadAsContent("Texto", extraction(texto))).toBe(false)
    expect(canReadAsContent("   ", extraction(texto, []))).toBe(false)
    expect(canReadAsContent("Texto", null)).toBe(false)
    expect(canReadAsContent("Texto", extraction([page(1, "TEXT", 0), page(2, "NO_TEXT", null), page(3, "NO_TEXT", null)], []))).toBe(false)
    expect(canReadAsContent("Texto", extraction([page(1, "TEXT", 0), page(2, "NO_TEXT", null), page(3, "BLANK", null)], []))).toBe(true)
  })
})

describe("onde cada coisa entra no texto", () => {
  it("a imagem entra no fim da linha; sem lugar, no fim do texto", () => {
    const content = "1. Abrir.\n2. Salvar."
    expect(imageInsertAt(content, 9)).toBe(9)
    expect(imageInsertAt(content, 3)).toBe(9)
    expect(imageInsertAt(content, 0)).toBe(0)
    expect(imageInsertAt(content, null)).toBe(content.length)
    expect(imageInsertAt(content, 500)).toBe(content.length)
  })

  it("no meio de uma tabela, depois de uma edição, a imagem espera a tabela terminar", () => {
    const content = "| A |\n| --- |\n| 1 |\n\nDepois."
    expect(imageInsertAt(content, 5)).toBe("| A |\n| --- |\n| 1 |".length)
  })

  it("âncora de página no começo do bloco, nunca na página 1; imagem e aviso no lugar deles", () => {
    const content = "Primeiro bloco.\n\nSegundo bloco.\n\nTerceiro bloco."
    const second = content.indexOf("Segundo")
    const third = content.indexOf("Terceiro")
    const inserts = documentInserts(content, extraction([page(1, "TEXT", 0), page(2, "TEXT", second + 3), page(3, "NO_TEXT", null), page(4, "TEXT", third), page(5, "BLANK", null), page(6, "UNREADABLE", null)], [image("a", 2, second + "Segundo bloco.".length)]))
    expect(inserts).toEqual([
      { kind: "page", at: second, page: 2 },
      { kind: "image", at: second + "Segundo bloco.".length, image: image("a", 2, second + "Segundo bloco.".length) },
      { kind: "missing", at: third, page: 3 },
      { kind: "page", at: third, page: 4 },
      { kind: "missing", at: content.length, page: 6 },
    ])
  })

  it("página sem texto que virou imagem não ganha aviso: ela aparece", () => {
    const inserts = documentInserts("Texto.", extraction([page(1, "TEXT", 0), page(2, "NO_TEXT", null)], [image("scan", 2, 6)]))
    expect(inserts.map((insert) => insert.kind)).toEqual(["image"])
  })
})
