import { describe, expect, it } from "vitest"
import { documentOrderOf, fuseRecall } from "./hybrid-recall.js"

const key = (documentId: string, chunkIndex: number) => ({ documentId, chunkIndex })

describe("camada 2: BM25 ∪ vetor pela posição", () => {
  it("a união guarda o que só uma das listas achou e põe primeiro o que as duas acharam", () => {
    const fused = fuseRecall({ lexical: [key("a", 0), key("a", 1)], vector: [key("b", 3), key("a", 1)] })
    expect(fused.map((item) => `${item.documentId}#${item.chunkIndex}`)).toEqual(["a#1", "a#0", "b#3"])
    expect(fused[0]).toMatchObject({ lexicalRank: 2, vectorRank: 2 })
    expect(fused[2]).toMatchObject({ lexicalRank: null, vectorRank: 1 })
  })

  it("sem vetor (sem policy ou sem índice) o resultado é a ordem do BM25; limite de candidatos respeitado", () => {
    const lexical = Array.from({ length: 80 }, (_, index) => key("d", index))
    const fused = fuseRecall({ lexical, vector: [] })
    expect(fused).toHaveLength(40)
    expect(fused.map((item) => item.chunkIndex)).toEqual(Array.from({ length: 40 }, (_, index) => index))
  })

  it("ordem das bases = a melhor posição de cada uma", () => {
    expect(documentOrderOf(fuseRecall({ lexical: [key("b", 0), key("a", 0), key("b", 1)], vector: [] }))).toEqual(["b", "a"])
  })

  it("intercalado: 1º do vetor, 1º do texto, 2º do vetor… — o melhor de cada lista chega ao topo (é o que a IA lê primeiro)", () => {
    const fused = fuseRecall({ lexical: [key("a", 0), key("a", 1), key("b", 1)], vector: [key("c", 0), key("b", 1), key("a", 0)], method: "INTERLEAVE" })
    expect(fused.map((item) => `${item.documentId}#${item.chunkIndex}`)).toEqual(["c#0", "a#0", "b#1", "a#1"])
    expect(fused[2]).toMatchObject({ lexicalRank: 3, vectorRank: 2 })
  })

  it("por seção: partes da mesma seção não gastam vagas; o candidato aponta o início da seção", () => {
    const sectionOf = (item: { chunkIndex: number }) => (item.chunkIndex < 3 ? 0 : 3)
    const fused = fuseRecall({ lexical: [key("a", 1), key("a", 2), key("a", 4)], vector: [key("a", 0)], unit: "SECTION", sectionOf })
    expect(fused.map((item) => `${item.documentId}#${item.chunkIndex}`)).toEqual(["a#0", "a#3"])
  })
})
