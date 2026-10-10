import { describe, expect, it } from "vitest"
import { headingOf } from "../../reliable-feedback/domain/feedback-view.js"
import { interactionHeadingOf, legacyHeadingCorrectionOf, NEUTRAL_INTERACTION_TITLE, readableSubjectOf, legacyFeedbackHeadingOf, linkedInteractionIdOf } from "./feedback-heading.js"

/**
 * TÍTULO = ASSUNTO DO ATENDIMENTO, DATA À PARTE (`FEEDBACK_HEADING_V1`) — sem IA.
 *
 * DEFEITO REPRODUZIDO: o rótulo do atendimento só levava o assunto quando o bruto tinha alias no catálogo canônico; as chamadas da
 * demonstração ("Contas em atraso", "Internet fixa sem funcionamento"…) não têm alias, o rótulo virava "Atendimento de 29/09/2026"
 * e `headingOf` usava a data inteira como TÍTULO (subtítulo vazio) — no Acompanhamento, no feed da estrutura e nos recados.
 */
describe("assunto legível do atendimento", () => {
  it("canônico vence; sem canônico, o assunto GRAVADO legível; código vira o nome do mesmo código; sem assunto confiável = nada", () => {
    expect(readableSubjectOf({ canonicalName: "Contestação de cobrança", raw: "contestacao" })).toEqual({ text: "Contestação de cobrança", source: "CANONICAL" })
    expect(readableSubjectOf({ raw: "Contas em atraso" })).toEqual({ text: "Contas em atraso", source: "RECORDED" })
    expect(readableSubjectOf({ raw: "segunda_via", nameOfCode: (code) => (code === "segunda_via" ? "Segunda via" : null) })).toEqual({ text: "Segunda via", source: "RECORDED_CODE" })
    // Código sem nome no catálogo, número, vazio: não é assunto para a pessoa ler.
    for (const raw of ["CONTESTACAO_COBRANCA", "segunda_via", "4471", "   ", null]) expect(readableSubjectOf({ raw })).toBeNull()
    // Não inventa especificidade: o que está gravado é o que vai (sem "juros e multa" se o dado não diz).
    expect(readableSubjectOf({ raw: "Contestação de cobrança" })!.text).toBe("Contestação de cobrança")
  })

  it("cabeçalho: assunto no título e a data como subtítulo; sem assunto, título neutro — a data continua separada", () => {
    expect(interactionHeadingOf({ text: "Mudança de endereço", source: "RECORDED" }, "29/09/2026")).toEqual({ title: "Mudança de endereço", subtitle: "Atendimento de 29/09/2026", subjectSource: "RECORDED" })
    expect(interactionHeadingOf(null, "29/09/2026")).toEqual({ title: NEUTRAL_INTERACTION_TITLE, subtitle: "Atendimento de 29/09/2026", subjectSource: "NONE" })
  })

  it("view do feedback confiável: rótulo com assunto separa título/data; rótulo SÓ com a data não vira mais título; indicador intacto", () => {
    expect(headingOf("Atendimento de 29/09/2026 · Troca de número")).toEqual({ title: "Troca de número", subtitle: "Atendimento de 29/09/2026" })
    expect(headingOf("Atendimento de 29/09/2026")).toEqual({ title: NEUTRAL_INTERACTION_TITLE, subtitle: "Atendimento de 29/09/2026", subjectSource: "NONE" })
    expect(headingOf("Tempo Médio de Atendimento · Fechamento de agosto de 2026")).toEqual({ title: "Tempo Médio de Atendimento · Fechamento de agosto de 2026", subtitle: null })
  })
})

describe("correção da projeção de feedbacks já publicados", () => {
  it("legado COM informação suficiente (assunto gravado na interação vinculada): título corrigido, data no subtítulo", () => {
    expect(legacyHeadingCorrectionOf({ current: { title: "Atendimento de 29/09/2026", subtitle: null }, recordedSubject: "Internet fixa sem funcionamento", exactCodeName: null, dateLabel: "29/09/2026" })).toEqual({ kind: "CORRECTED", heading: { title: "Internet fixa sem funcionamento", subtitle: "Atendimento de 29/09/2026", subjectSource: "RECORDED" } })
  })

  it("legado SEM assunto confiável: título neutro, data separada — nunca o nome da base, do agente ou do erro", () => {
    expect(legacyHeadingCorrectionOf({ current: { title: "Atendimento de 29/09/2026", subtitle: null }, recordedSubject: "COD_77", exactCodeName: null, dateLabel: "29/09/2026" })).toEqual({ kind: "CORRECTED", heading: { title: NEUTRAL_INTERACTION_TITLE, subtitle: "Atendimento de 29/09/2026", subjectSource: "NONE" } })
  })

  it("cabeçalho que já tem assunto não é tocado; segunda rodada não muda nada (idempotente)", () => {
    expect(legacyHeadingCorrectionOf({ current: { title: "Contestação de cobrança", subtitle: "Atendimento de 25/09/2026" }, recordedSubject: "Outra coisa", exactCodeName: null, dateLabel: "25/09/2026" })).toEqual({ kind: "UNCHANGED", reason: "HAS_SUBJECT" })
    const once = legacyHeadingCorrectionOf({ current: { title: "Atendimento de 29/09/2026", subtitle: null }, recordedSubject: "Código 99_X", exactCodeName: null, dateLabel: "29/09/2026" })
    expect(once.kind).toBe("CORRECTED")
    const twice = legacyHeadingCorrectionOf({ current: once.kind === "CORRECTED" ? once.heading : null, recordedSubject: "Código 99_X", exactCodeName: null, dateLabel: "29/09/2026" })
    expect(twice).toEqual({ kind: "UNCHANGED", reason: "SAME_HEADING" })
  })
})

describe("feedback anterior SEM view model — título na leitura", () => {
  it("vínculo: o interactionId gravado no snapshot; senão a ÚNICA interação citada como evidência do caso; duas ou mais = sem vínculo", () => {
    expect(linkedInteractionIdOf({ snapshotInteractionId: "i-1", evidenceInteractionIds: ["i-2"] })).toBe("i-1")
    expect(linkedInteractionIdOf({ snapshotInteractionId: undefined, evidenceInteractionIds: ["i-2", "i-2"] })).toBe("i-2")
    expect(linkedInteractionIdOf({ snapshotInteractionId: null, evidenceInteractionIds: ["i-2", "i-3"] })).toBeNull()
    expect(linkedInteractionIdOf({ snapshotInteractionId: 42, evidenceInteractionIds: [] })).toBeNull()
  })

  it("com vínculo: assunto gravado com a interação + data; código sem nome exato ou sem assunto = neutro com a data", () => {
    expect(legacyFeedbackHeadingOf({ recordedSubject: "Segunda via de fatura", exactCodeName: null, dateLabel: "14/09/2026" })).toEqual({ title: "Segunda via de fatura", subtitle: "Atendimento de 14/09/2026", subjectSource: "RECORDED" })
    expect(legacyFeedbackHeadingOf({ recordedSubject: "CONTESTACAO_CONTA", exactCodeName: "Contestação de conta", dateLabel: "14/09/2026" })).toMatchObject({ title: "Contestação de conta", subjectSource: "RECORDED_CODE" })
    expect(legacyFeedbackHeadingOf({ recordedSubject: "CONTESTACAO_CONTA", exactCodeName: null, dateLabel: "14/09/2026" })).toEqual({ title: NEUTRAL_INTERACTION_TITLE, subtitle: "Atendimento de 14/09/2026", subjectSource: "NONE" })
    expect(legacyFeedbackHeadingOf({ recordedSubject: null, exactCodeName: null, dateLabel: "14/09/2026" })).toMatchObject({ title: NEUTRAL_INTERACTION_TITLE, subjectSource: "NONE" })
  })

  it("sem vínculo confiável: título neutro e nenhum subtítulo — nunca o nome da base, do agente ou do indicador impactado", () => {
    expect(legacyFeedbackHeadingOf(null)).toEqual({ title: NEUTRAL_INTERACTION_TITLE, subtitle: null, subjectSource: "NONE" })
  })
})
