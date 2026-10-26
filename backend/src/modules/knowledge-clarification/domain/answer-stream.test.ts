import { describe, expect, it } from "vitest"
import { createAnswerStream, partialJsonStringField } from "./answer-stream.js"
import { CLARIFICATION_ANSWER_CONTRACT, validateAnswerOutput } from "./clarification-contract.js"
import type { KnowledgeSourceRef } from "./clarification-state.js"

const source = (chunkIndex: number): KnowledgeSourceRef => ({ documentId: "doc-1", documentTitle: "Base", versionId: "v1", heading: `Seção ${chunkIndex}`, chunkIndex })
const evidence = new Map([["K1", source(0)], ["K2", source(1)], ["K7", source(6)]])

/** Entrega `raw` em pedaços de `size` caracteres e devolve o que saiu para a tela. */
function streamed(raw: string, size: number) {
  const out: string[] = []
  const stream = createAnswerStream(evidence, (text) => out.push(text))
  for (let i = 0; i < raw.length; i += size) stream.push(raw.slice(i, i + size))
  return { shown: out.join(""), pieces: out, stream }
}

const answerJson = (answer: string, sources: string[] = ["K1"]) => JSON.stringify({ contract: CLARIFICATION_ANSWER_CONTRACT, answer, sources, limitations: null })

describe("resposta do esclarecimento em fluxo", () => {
  it("mostra só o campo answer, com os marcadores numerados como na validação final — em qualquer tamanho de pedaço", () => {
    const answer = "  Para registrar a contestação, abra o protocolo [K2].\n\n- Confira a fatura [K7, K2]\n- Anexe o comprovante [k1]\n\nEmoji 👍 e aspas \"assim\" \\ barra."
    const raw = "```json\n" + answerJson(answer, ["K2", "K7", "K1"]) + "\n```"
    const final = validateAnswerOutput(raw, evidence)
    expect(final.ok).toBe(true)
    if (!final.ok) return
    for (const size of [1, 2, 3, 5, 8, 13, 64, raw.length]) {
      const { shown, stream } = streamed(raw, size)
      expect(shown).toBe(final.text)
      expect(stream.blocked()).toBe(false)
    }
  })

  it("marcador ainda incompleto no fim espera; texto entre colchetes que não é marcador sai como está", () => {
    const out: string[] = []
    const stream = createAnswerStream(evidence, (text) => out.push(text))
    stream.push(`{"contract":"${CLARIFICATION_ANSWER_CONTRACT}","answer":"Faça assim [K`)
    expect(out.join("")).toBe("Faça assim ")
    stream.push("1, K")
    expect(out.join("")).toBe("Faça assim ")
    stream.push("2] e veja [nota 1] [1]")
    expect(out.join("")).toBe("Faça assim [1][2] e veja [nota 1] [1]")
  })

  it("marcador de seção não lida trava o fluxo — a validação final recusa a mesma resposta", () => {
    const raw = answerJson("Comece pelo cadastro [K1]. Depois o prazo [K9]. E mais texto que nunca aparece.")
    const { shown, stream } = streamed(raw, 4)
    expect(shown).toBe("Comece pelo cadastro [1]. Depois o prazo ")
    expect(stream.blocked()).toBe(true)
    expect(validateAnswerOutput(raw, evidence).ok).toBe(false)
  })

  it("nada sai antes do campo answer (nem de outro campo de texto) e espaço inicial não sai", () => {
    const out: string[] = []
    const stream = createAnswerStream(evidence, (text) => out.push(text))
    stream.push('{"contract":"KNOWLEDGE_CLARIFICATION_ANSWER_V1","sources":["K1"],"limitations":"nada [K9]","answer":"')
    stream.push("   \\n ")
    expect(out).toEqual([])
    stream.push("Resposta [K1]")
    expect(out.join("")).toBe("Resposta [1]")
  })

  it("leitura parcial do JSON: escape e emoji partidos esperam o próximo pedaço; campo ausente ou não-texto = nada", () => {
    expect(partialJsonStringField('{"answer":"linha\\', "answer")).toEqual({ text: "linha", complete: false })
    expect(partialJsonStringField('{"answer":"a\\u00', "answer")).toEqual({ text: "a", complete: false })
    expect(partialJsonStringField('{"answer":"a\\ud83d', "answer")).toEqual({ text: "a", complete: false })
    expect(partialJsonStringField('{"answer":"a\\ud83d\\udc4d', "answer")).toEqual({ text: "a👍", complete: false })
    expect(partialJsonStringField('{"answer":"fim"}', "answer")).toEqual({ text: "fim", complete: true })
    expect(partialJsonStringField('{"contract":"X","answer":null}', "answer")).toBeNull()
    expect(partialJsonStringField('{"contract":"X","sources":["K1"', "answer")).toBeNull()
    expect(partialJsonStringField('{"meta":{"answer":"aninhado"},"answer":"topo"}', "answer")).toEqual({ text: "topo", complete: true })
    expect(partialJsonStringField("texto sem objeto", "answer")).toBeNull()
  })
})
