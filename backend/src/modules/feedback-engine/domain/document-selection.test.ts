import { describe, expect, it } from "vitest"
import { exceedsDocumentBudget, selectDocumentsForCall, type CandidateDocument } from "./document-selection.js"

/** Camada 4 da busca em escala: achar QUAL procedimento (cartão + texto) e ler o procedimento INTEIRO — nunca um recorte. */
const doc = (documentId: string, title: string, content: string): CandidateDocument => ({ documentId, title, version: 1, content, contentHash: documentId, perspective: "RULE_IN_FORCE_AT_CALL" })
const BIG = "x ".repeat(30_000)
const documents = [
  doc("cobranca", "Procedimento A", `## Prazo\nA análise termina em 5 dias úteis.\n${BIG}`),
  doc("segunda-via", "Procedimento B", `## Envio\nA segunda via sai por e-mail.\n${BIG}`),
  doc("titular", "Procedimento C", `## Titular\nConfirme a data de nascimento.\n${BIG}`),
]
const input = { subject: null, transcript: "cliente quer a segunda via por e-mail", budgetChars: 130_000 }

describe("seleção de documentos do motor com a ordem pelo cartão", () => {
  it("só pede a ordem quando os documentos não cabem todos", () => {
    expect(exceedsDocumentBudget(documents, 1_000_000)).toBe(false)
    expect(exceedsDocumentBudget(documents, 130_000)).toBe(true)
  })

  it("sem ordem pelo cartão: a de sempre (lexical) — o que a conversa cita entra primeiro", () => {
    const result = selectDocumentsForCall(documents, input)
    expect(result.selected.map((item) => item.documentId)).toEqual(["segunda-via", "cobranca"])
    expect(result.semanticOrdering).toBe(false)
  })

  it("com a ordem pelo cartão: as duas ordens são juntadas, o documento entra INTEIRO e o que ficou de fora é registrado", () => {
    const result = selectDocumentsForCall(documents, { ...input, semanticOrder: ["titular", "segunda-via", "cobranca"] })
    expect(result.semanticOrdering).toBe(true)
    expect(result.selected.map((item) => item.documentId)).toEqual(["segunda-via", "titular"])
    expect(result.selected.every((item) => item.content === documents.find((document) => document.documentId === item.documentId)!.content)).toBe(true)
    expect(result.omitted).toEqual([{ documentId: "cobranca", title: "Procedimento A", reason: "BUDGET" }])
  })

  it("variantes de produto continuam empatadas: entre elas decide a ordem neutra (título), nunca o cartão", () => {
    const result = selectDocumentsForCall(documents, { ...input, semanticOrder: ["titular", "segunda-via", "cobranca"], productScoped: new Set(["cobranca", "titular"]) })
    // O cartão prefere "titular", mas as duas são variantes de produto: fica a primeira pelo título (Procedimento A).
    expect(result.selected.map((item) => item.documentId)).toEqual(["segunda-via", "cobranca"])
    expect(result.omitted.map((item) => item.documentId)).toEqual(["titular"])
  })
})
