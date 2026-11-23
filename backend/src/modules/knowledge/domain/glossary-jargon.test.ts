import { describe, expect, it } from "vitest"
import { embeddingTextsOf } from "./embedding-texts.js"
import { jargonKeyOf, jargonRulesOf, jargonTermsFor } from "./glossary-jargon.js"
import { chunkKnowledgeDocument } from "./knowledge-chunking.js"

/** Gíria do Glossário no texto do vetor (opção 4, `docs/dev/busca-em-escala/README.md`). Termos fictícios, só do teste. */
const GLOSSARY = [
  { term: "conta gêmea", definition: "Duplicidade de cobrança: a mesma cobrança aparece duas vezes." },
  { term: "número tampão", definition: "Número provisório. Usado até o número antigo chegar." },
  { term: "XY", definition: "XY" },
  { term: "ruído", definition: "ab" },
]
const source = (content: string) => ({ documentId: "doc", documentTitle: "Contestação", versionId: "doc-v1", chunks: chunkKnowledgeDocument({ id: "doc", title: "Contestação", content }) })

describe("gíria do Glossário no vetor", () => {
  it("regras: termo oficial = 1ª oração da definição, sem acento e minúsculo; definição curta ou igual ao termo fica de fora", () => {
    expect(jargonRulesOf(GLOSSARY)).toEqual([
      { term: "conta gêmea", official: "duplicidade de cobranca" },
      { term: "número tampão", official: "numero provisorio" },
    ])
    expect(jargonKeyOf([])).toBeNull()
    expect(jargonKeyOf(jargonRulesOf(GLOSSARY))).toBe(jargonKeyOf(jargonRulesOf([...GLOSSARY].reverse())))
  })

  it("o trecho que cita o termo oficial (sem diferença de acento ou maiúscula, no título ou no texto) recebe a gíria", () => {
    const rules = jargonRulesOf(GLOSSARY)
    expect(jargonTermsFor({ heading: "22. DUPLICIDADE DE COBRANÇA", text: "Confirmar se existem duas contas." }, rules)).toEqual(["conta gêmea"])
    expect(jargonTermsFor({ heading: "4.2", text: "O numero provisorio vale até a janela." }, rules)).toEqual(["número tampão"])
    expect(jargonTermsFor({ heading: "Prazo", text: "Cinco dias úteis." }, rules)).toEqual([])
  })

  it("só o trecho que cita o termo muda; sem regras o texto e o hash são exatamente os de antes", () => {
    const base = source("## 1. Duplicidade de cobrança\nConfirmar se existem duas contas.\n\n## 2. Prazo\nCinco dias úteis.")
    const before = embeddingTextsOf(base)
    expect(embeddingTextsOf(base, { jargon: [] })).toEqual(before)
    const after = embeddingTextsOf(base, { jargon: jargonRulesOf(GLOSSARY) })
    const changed = after.filter((text, index) => text.hash !== before[index]!.hash)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.text.endsWith("Também chamado: conta gêmea.")).toBe(true)
    // O cartão (motor de feedback) não muda.
    expect(after.find((text) => text.kind === "CARD")!.hash).toBe(before.find((text) => text.kind === "CARD")!.hash)
  })
})
