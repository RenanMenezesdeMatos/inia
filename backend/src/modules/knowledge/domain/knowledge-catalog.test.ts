import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "./knowledge-chunking.js"
import { outlineSize, sectionOf, sectionsOf, type CatalogSource } from "./knowledge-catalog.js"

/** Bases fictícias, só para este teste. */
function source(id: string, title: string, content: string): CatalogSource {
  return { documentId: id, documentTitle: title, versionId: `${id}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id, title, content }) }
}

describe("catálogo das bases (estrutural)", () => {
  it("sumário na ordem do documento: uma entrada por seção, mesmo quando a seção tem várias partes", () => {
    const long = source("kb-long", "Base longa (fictícia)", `## 1. Seção longa\n${Array.from({ length: 6 }, (_, index) => `Parágrafo ${index} ${"palavra ".repeat(60)}`).join("\n\n")}\n\n## 2. Outra\nFim.`)
    expect(long.chunks.filter((chunk) => chunk.heading === "1. Seção longa").length).toBeGreaterThan(1)
    expect(sectionsOf(long).map((section) => section.heading)).toEqual(["1. Seção longa", "2. Outra"])
  })

  it("documento sem títulos de seção: uma entrada por trecho, com o começo do texto (sem quebras de linha) como prévia", () => {
    const flat = source("kb-flat", "Base sem títulos (fictícia)", "Primeira linha do trecho.\nSegunda linha.\n\nOutro parágrafo.")
    const sections = sectionsOf(flat, 30)
    expect(sections[0]).toMatchObject({ heading: "", chunkIndex: 0 })
    expect(sections[0]!.preview).toBe("Primeira linha do trecho. Seg…")
    expect(outlineSize(flat)).toBeGreaterThan(0)
  })

  it("leitura direcionada: o texto inteiro da seção (partes seguidas com o mesmo título), limitado; trecho inexistente = null", () => {
    const long = source("kb-long", "Base longa (fictícia)", `## 1. Seção longa\n${Array.from({ length: 6 }, (_, index) => `Parágrafo ${index} ${"palavra ".repeat(60)}`).join("\n\n")}\n\n## 2. Outra\nFim.`)
    const first = long.chunks.find((chunk) => chunk.heading === "1. Seção longa")!
    const section = sectionOf(long, first.index + 1)!
    expect(section.heading).toBe("1. Seção longa")
    expect(section.text).toContain("Parágrafo 0")
    expect(section.text).toContain("Parágrafo 5")
    expect(section.text).not.toContain("Fim.")
    expect(sectionOf(long, first.index, 500)!.text.length).toBeLessThanOrEqual(500)
    expect(sectionOf(long, 999)).toBeNull()
  })
})
