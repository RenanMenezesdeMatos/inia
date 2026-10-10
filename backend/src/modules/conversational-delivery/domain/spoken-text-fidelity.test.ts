import { describe, expect, it } from "vitest"
import { comparableWords, spellNumber, verifySpokenText } from "./spoken-text-fidelity.js"

const RECADO = "Oi, Gabi Bender. Tenho um retorno sobre o seu atendimento de 29 de setembro de 2026 (Contestação de cobrança). Você conduziu bem a investigação do caso e a tratativa, mas o protocolo não foi informado ao cliente. Veja no feedback como ajustar o encerramento nas próximas chamadas. Se quiser, posso te explicar os detalhes aqui no chat."

describe("fidelidade da fala do recado", () => {
  it("números por extenso e em dígitos são a mesma palavra", () => {
    expect(spellNumber(29)).toEqual(["vinte", "e", "nove"])
    expect(comparableWords("2026")).toEqual(comparableWords("dois mil e vinte e seis"))
    expect(comparableWords("uma chamada")).toEqual(comparableWords("1 chamada"))
    expect(comparableWords("R$ 9,90")).toEqual(comparableWords("nove, noventa"))
  })

  it("fala real do Live (Larissa, 2026-09-30): a transcrição perdeu um nome — passa", () => {
    const spoken = RECADO.replace("Gabi Bender.", "Gabi .")
    expect(verifySpokenText(RECADO, spoken)).toMatchObject({ ok: true, edits: 1, longestDeletedRun: 1 })
  })

  it("mesmo texto com números por extenso passa", () => {
    expect(verifySpokenText(RECADO, RECADO.replace("29", "vinte e nove").replace("2026", "dois mil e vinte e seis")).ok).toBe(true)
  })

  it("número trocado nunca passa, mesmo sendo uma palavra só", () => {
    expect(verifySpokenText(RECADO, RECADO.replace("29", "28"))).toMatchObject({ ok: false, numberMismatch: true, reasons: ["NUMBER_MISMATCH"] })
    expect(verifySpokenText("O prazo é de 5 dias úteis.", "O prazo é de dias úteis.").reasons).toContain("NUMBER_MISMATCH")
  })

  it("cumprimento, comentário ou trecho acrescentado não passa", () => {
    expect(verifySpokenText(RECADO, `Claro, aqui está o recado para você. ${RECADO}`).reasons).toContain("INSERTED_PASSAGE")
  })

  it("frase omitida não passa", () => {
    expect(verifySpokenText(RECADO, RECADO.replace(" Veja no feedback como ajustar o encerramento nas próximas chamadas.", "")).reasons).toContain("OMITTED_PASSAGE")
  })

  it("paráfrase não passa", () => {
    const paraphrase = "Oi, Gabi. Queria te dar um retorno do atendimento de 29 de setembro de 2026 sobre contestação. A investigação foi boa, só faltou passar o protocolo. Dá uma olhada no feedback e, se quiser, te explico no chat."
    expect(verifySpokenText(RECADO, paraphrase).ok).toBe(false)
  })

  it("fala vazia não passa", () => {
    expect(verifySpokenText(RECADO, "").reasons).toContain("EMPTY")
  })
})
