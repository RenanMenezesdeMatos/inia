import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { renderAnswerInput } from "./clarification-prompts.js"
import { KnowledgeWorkspace, describeProducts } from "./knowledge-workspace.js"

/** O produto cadastrado da base chega à IA como DADO: na lista, nas bases abertas, nas seções lidas e no que a redação lê. */
const base = { documentId: "susp", documentTitle: "Suspensão temporária do Rastreador Veicular", versionId: "v1", documentType: "PROCEDURE", products: "Linha Órion › Rastreador Veicular", chunks: chunkKnowledgeDocument({ id: "susp", title: "Suspensão temporária do Rastreador Veicular", content: "## 1. Suspensão\nAté 30 dias por ano." }) }
const other = { documentId: "geral", documentTitle: "Regras gerais", versionId: "v1", documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: "geral", title: "Regras gerais", content: "## 1. Geral\nTexto." }) }

describe("produto cadastrado na lista que a IA vê", () => {
  it("em frase: o produto da família (a família citada contém a base); família sozinha e vários produtos", () => {
    expect(describeProducts("Linha Órion › Rastreador Veicular")).toBe("vale para Rastreador Veicular, produto da família Linha Órion (cadastro de produtos)")
    expect(describeProducts("Dados Avançados; Móvel › Linha Móvel")).toBe("vale para família Dados Avançados; Linha Móvel, produto da família Móvel (cadastro de produtos)")
  })

  it("lista, base aberta e seção lida trazem o produto; base sem produto fica como antes", () => {
    const workspace = new KnowledgeWorkspace([base, other])
    workspace.read([{ documentId: "susp", chunkIndex: 0 }])
    const view = workspace.render()
    expect(view.catalog).toContain("Suspensão temporária do Rastreador Veicular (PROCEDURE · 1 seção · vale para Rastreador Veicular, produto da família Linha Órion (cadastro de produtos))")
    expect(view.catalog).toContain("Regras gerais (PROCEDURE · 1 seção)")
    expect(view.details).toContain("### Suspensão temporária do Rastreador Veicular (vale para Rastreador Veicular, produto da família Linha Órion (cadastro de produtos))")
  })

  it("a redação também lê o produto de cada documento", () => {
    const text = renderAnswerInput({ state: { version: "KNOWLEDGE_CLARIFICATION_V1", id: "x", originalQuestion: "Por quanto tempo o cliente da linha Órion pode suspender?", status: "OPEN", steps: [], questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-11-16T00:00:00.000Z" }, sections: [{ ref: "K1", source: { documentId: "susp", documentTitle: base.documentTitle, versionId: "v1", heading: "1. Suspensão", chunkIndex: 0 }, text: "Até 30 dias por ano.", products: describeProducts(base.products) }], conflicts: [], glossary: [] })
    expect(text).toContain("### Suspensão temporária do Rastreador Veicular (vale para Rastreador Veicular, produto da família Linha Órion (cadastro de produtos))")
  })
})
