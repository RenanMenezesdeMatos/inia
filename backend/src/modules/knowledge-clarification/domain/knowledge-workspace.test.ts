import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import type { CatalogSource } from "../../knowledge/domain/knowledge-catalog.js"
import { DEFAULT_NAVIGATION_BUDGET, KnowledgeWorkspace } from "./knowledge-workspace.js"

/** Bases fictícias, só para este teste. */
function source(id: string, title: string, sections: number): CatalogSource {
  const content = Array.from({ length: sections }, (_, index) => `## ${index + 1}. Seção ${index + 1} de ${title}\nTexto da seção ${index + 1} de ${title}.`).join("\n\n")
  return { documentId: id, documentTitle: title, versionId: `${id}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id, title, content }) }
}
const A = source("kb-a", "Base A (fictícia)", 5)
const B = source("kb-b", "Base B (fictícia)", 3)
const NARROW = { ...DEFAULT_NAVIGATION_BUDGET, fullOutlineChars: 0, sampleSectionsPerBase: 2 }
const textOf = (view: { catalog: string; details: string }) => `${view.catalog}\n${view.details}`

describe("espaço de navegação da IA", () => {
  it("sumários pequenos: todas as bases já começam abertas (uma consulta a menos)", () => {
    const view = new KnowledgeWorkspace([A, B]).render()
    expect(view.details).toContain("BASES ABERTAS")
    expect(view.details).toContain("### Base A (fictícia) [B1]")
    expect(view.readable.bases.size).toBe(0)
  })

  it("lista com o começo do sumário de cada base; abrir mostra tudo; ler traz o texto — com marcadores estáveis entre as rodadas", () => {
    const workspace = new KnowledgeWorkspace([A, B], NARROW)
    const first = workspace.render()
    expect(textOf(first)).not.toContain("BASES ABERTAS")
    expect(first.catalog).toContain("[K1] 1. Seção 1 de Base A (fictícia) · [K2] 2. Seção 2 de Base A (fictícia) · … (abra a base para ver todas as seções)")
    expect([...first.readable.bases]).toEqual([["B1", "kb-a"], ["B2", "kb-b"]])
    expect(first.evidence.get("B1")).toMatchObject({ documentId: "kb-a", heading: "Base A (fictícia)" })
    expect(first.answerable.has("B1")).toBe(false)
    expect(first.answerable.has("K1")).toBe(true)

    workspace.open(["kb-a"])
    workspace.read([first.evidence.get("K2")!])
    const second = workspace.render()
    // A lista das bases não muda com o que foi aberto ou lido (começo fixo do prompt).
    expect(second.catalog).toBe(first.catalog)
    expect(second.details).toContain("### Base A (fictícia) [B1]")
    expect(second.details).toContain("[K1] 1. Seção 1 de Base A (fictícia)")
    expect(second.details).toContain("[K2] 2. Seção 2 de Base A (fictícia) — texto abaixo")
    expect(second.details).toContain("SEÇÕES LIDAS")
    expect(second.details).toContain("Texto da seção 2 de Base A (fictícia).")
    // Seção já lida não volta a ser "consultável"; base aberta também não.
    expect(second.readable.sections.has("K2")).toBe(false)
    expect(second.readable.bases.has("B1")).toBe(false)
    expect(workspace.refFor({ documentId: "kb-a", chunkIndex: 1, heading: "2. Seção 2 de Base A (fictícia)", documentTitle: "Base A (fictícia)" })).toBe("K2")
    expect(workspace.trace()).toMatchObject({ opened: ["Base A (fictícia)"], read: 1 })
  })

  it("orçamento de leitura: o que não cabe fica de fora e é registrado; lista cortada aparece na cobertura", () => {
    const workspace = new KnowledgeWorkspace([A, B], { ...NARROW, maxReadChars: 60, maxListedBases: 1 })
    const view = workspace.render()
    workspace.read([view.evidence.get("K1")!, view.evidence.get("K2")!])
    expect(workspace.trace()).toMatchObject({ read: 1, skippedReads: 1 })
    expect(workspace.coverage()).toEqual({ consideredDocuments: 2, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 1, complete: false })
    expect(view.catalog).toContain("(+1 bases não listadas por limite de tamanho)")
  })
})
