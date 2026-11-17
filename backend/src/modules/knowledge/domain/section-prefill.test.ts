import { describe, expect, it } from "vitest"
import type { CatalogSource } from "./knowledge-catalog.js"
import { planSectionPrefill, type SectionPrefillPolicy } from "./section-prefill.js"

function source(documentId: string, sections: readonly (readonly [string, string])[]): CatalogSource {
  return { documentId, documentTitle: documentId, versionId: `${documentId}-v1`, documentType: null, chunks: sections.map(([heading, text], index) => ({ documentId, documentTitle: documentId, heading, index, text })) }
}
const policy: SectionPrefillPolicy = { maxSections: 3, maxPerDocument: 2, smallBaseChars: 0, maxChars: 1_000 }
const sources = (...items: CatalogSource[]) => new Map(items.map((item) => [item.documentId, item]))
const large = source("grande", [["A", "a".repeat(100)], ["B", "b".repeat(100)], ["C", "c".repeat(100)], ["D", "d".repeat(100)]])
const other = source("outra", [["X", "x".repeat(100)]])
const keys = (planned: { documentId: string; chunkIndex: number }[]) => planned.map((item) => `${item.documentId}#${item.chunkIndex}`)

describe("planSectionPrefill", () => {
  it("o limite por base abre espaço para o segundo assunto", () => {
    const hits = [{ documentId: "grande", chunkIndex: 0 }, { documentId: "grande", chunkIndex: 1 }, { documentId: "grande", chunkIndex: 2 }, { documentId: "outra", chunkIndex: 0 }]
    expect(keys(planSectionPrefill(hits, sources(large, other), policy))).toEqual(["grande#0", "grande#1", "outra#0"])
  })

  it("vaga que sobrou volta para quem o limite por base deixou de fora", () => {
    const hits = [{ documentId: "grande", chunkIndex: 0 }, { documentId: "grande", chunkIndex: 1 }, { documentId: "grande", chunkIndex: 2 }]
    expect(keys(planSectionPrefill(hits, sources(large), policy))).toEqual(["grande#0", "grande#1", "grande#2"])
  })

  it("base pequena tocada pelo ranking entra inteira, mesmo com seção sem as palavras da pergunta", () => {
    const small = source("pequena", [["5. Caso", "documentos"], ["10. Débitos", "ficam com o titular"], ["11. Prazo", "3 dias úteis"]])
    const planned = planSectionPrefill([{ documentId: "pequena", chunkIndex: 0 }], sources(small), { ...policy, smallBaseChars: 8_000 })
    expect(keys(planned)).toEqual(["pequena#0", "pequena#1", "pequena#2"])
    expect(planned.map((item) => item.reason)).toEqual(["RANKED", "SMALL_BASE", "SMALL_BASE"])
  })

  it("só a primeira base do ranking entra inteira quando o limite é 1", () => {
    const first = source("primeira", [["A", "a"], ["B", "b"]])
    const second = source("segunda", [["C", "c"], ["D", "d"]])
    const hits = [{ documentId: "primeira", chunkIndex: 0 }, { documentId: "segunda", chunkIndex: 0 }]
    expect(keys(planSectionPrefill(hits, sources(first, second), { ...policy, smallBaseChars: 8_000, smallBaseTopDocuments: 1 }))).toEqual(["primeira#0", "segunda#0", "primeira#1"])
  })

  it("com o mínimo de 2 seções, a base tocada uma vez fica como está e a base tocada duas vezes entra inteira", () => {
    const stray = source("solta", [["A", "a"], ["B", "b"]])
    const dense = source("densa", [["C", "c"], ["D", "d"], ["E", "e"]])
    const hits = [{ documentId: "solta", chunkIndex: 0 }, { documentId: "densa", chunkIndex: 0 }, { documentId: "densa", chunkIndex: 1 }]
    const planned = planSectionPrefill(hits, sources(stray, dense), { ...policy, maxSections: 8, smallBaseChars: 8_000, smallBaseMinRanked: 2 })
    expect(keys(planned)).toEqual(["solta#0", "densa#0", "densa#1", "densa#2"])
  })

  it("base grande nunca entra inteira", () => {
    expect(keys(planSectionPrefill([{ documentId: "grande", chunkIndex: 0 }], sources(large), { ...policy, smallBaseChars: 100 }))).toEqual(["grande#0"])
  })

  it("respeita o teto de caracteres sem cortar seção", () => {
    const hits = [{ documentId: "grande", chunkIndex: 0 }, { documentId: "outra", chunkIndex: 0 }]
    const planned = planSectionPrefill(hits, sources(large, other), { ...policy, maxChars: 150 })
    expect(keys(planned)).toEqual(["grande#0"])
    expect(planned[0]!.chars).toBe(100)
  })

  it("partes da mesma seção contam uma vez, pela primeira", () => {
    const parts = source("partes", [["A", "um"], ["A", "dois"], ["B", "tres"]])
    expect(keys(planSectionPrefill([{ documentId: "partes", chunkIndex: 1 }, { documentId: "partes", chunkIndex: 0 }], sources(parts), policy))).toEqual(["partes#0"])
  })

  it("resultado de base fora do escopo nunca é planejado", () => {
    expect(planSectionPrefill([{ documentId: "desconhecida", chunkIndex: 0 }], sources(large), policy)).toEqual([])
  })
})
