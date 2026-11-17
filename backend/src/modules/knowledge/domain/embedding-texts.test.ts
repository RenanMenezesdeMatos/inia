import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "./knowledge-chunking.js"
import { contentHashOf, documentCardText, embeddingTextsOf } from "./embedding-texts.js"

const source = (content: string, title = "Contestação de cobrança") => ({ documentId: "doc", documentTitle: title, versionId: "v1", chunks: chunkKnowledgeDocument({ id: "doc", title, content }) })
const BASE = "## 1. Prazo da análise\nA análise termina em 5 dias úteis.\n\n## 2. Registro\nAnote o protocolo."

describe("o que vira vetor numa base publicada", () => {
  it("um texto por trecho (com título da base e da seção) e um cartão com o sumário do documento", () => {
    const texts = embeddingTextsOf(source(BASE))
    expect(texts.map((text) => [text.kind, text.key])).toEqual([["CHUNK", "doc#0"], ["CHUNK", "doc#1"], ["CARD", "doc#card"]])
    expect(texts[0]!.text).toBe("Contestação de cobrança\n1. Prazo da análise\n\nA análise termina em 5 dias úteis.")
    expect(texts[2]!.text).toBe("Contestação de cobrança\n- 1. Prazo da análise\n- 2. Registro")
  })

  it("o hash é do texto: só o trecho que mudou muda de chave; o cartão segue o título que quem consulta usa", () => {
    const before = embeddingTextsOf(source(BASE))
    const after = embeddingTextsOf(source(BASE.replace("5 dias", "10 dias")))
    expect(after.map((text) => text.hash === before[after.indexOf(text)]!.hash)).toEqual([false, true, true])
    expect(embeddingTextsOf(source(BASE), { cardTitle: "Outro título" })[2]!.text.startsWith("Outro título\n")).toBe(true)
    expect(contentHashOf("a")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("cartão de documento enorme é cortado no limite", () => {
    const huge = Array.from({ length: 2_000 }, (_, index) => `## Seção ${index}\nTexto.`).join("\n\n")
    expect(documentCardText(source(huge)).length).toBeLessThanOrEqual(6_000)
  })

  it("produto cadastrado entra no texto do vetor (trecho e cartão); sem produto, o texto é exatamente o de antes", () => {
    const plain = embeddingTextsOf(source(BASE))
    const withProduct = embeddingTextsOf(source(BASE), { products: "Linha Órion › Rastreador Veicular" })
    expect(withProduct[0]!.text).toBe("Contestação de cobrança\nProduto: Linha Órion › Rastreador Veicular\n1. Prazo da análise\n\nA análise termina em 5 dias úteis.")
    expect(withProduct[2]!.text.startsWith("Contestação de cobrança\nProduto: Linha Órion › Rastreador Veicular\n- ")).toBe(true)
    expect(embeddingTextsOf(source(BASE), { products: null }).map((text) => text.hash)).toEqual(plain.map((text) => text.hash))
    expect(withProduct.every((text, index) => text.hash !== plain[index]!.hash)).toBe(true)
  })
})

