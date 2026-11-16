import { describe, expect, it } from "vitest"
import type { FeedbackBrief } from "./feedback-brief.js"
import type { FeedbackView } from "./feedback-view.js"
import { feedbackMessageContent } from "./response-check-content.js"

const CALL = "Posso garantir o desconto."
const RULE = "Confirme a oferta antes de falar em valores."
const OFFICIAL = "Vou confirmar as ofertas do seu plano."
const PRACTICE = "Ficou claro para o senhor?"
const brief = {
  developments: [{ quotes: [{ text: CALL }], rules: [{ text: RULE, phrasing: { text: OFFICIAL } }] }],
  strengths: [],
  basePractices: [{ ref: "B1", suggestedPhrasing: PRACTICE }],
} as unknown as FeedbackBrief
const view = (over: Partial<FeedbackView> = {}) => ({ card: "Confirme a oferta.", greeting: null, narrative: [], developments: [], maintain: null, attention: [], context: null, ...over }) as unknown as FeedbackView

describe("o que a conferência lê de uma mensagem do motor (PEN-018)", () => {
  it("marca a origem de cada citação no texto da voz da INIA, sem mudar o texto entregue", () => {
    const paragraph = `Você disse “${CALL}” O procedimento pede: “${RULE}” Na próxima, diga “${OFFICIAL}” ou “${PRACTICE}”`
    const built = feedbackMessageContent(view({ narrative: [paragraph] }), brief)
    expect(built.text).toContain(paragraph)
    expect(built.content.marked).toContain(`<fala_da_chamada>${CALL}</fala_da_chamada>`)
    expect(built.content.marked).toContain(`<regra_citada>${RULE}</regra_citada>`)
    expect(built.content.marked).toContain(`<fala_sugerida>${OFFICIAL}</fala_sugerida>`)
    expect(built.content.marked).toContain(`<fala_sugerida>${PRACTICE}</fala_sugerida>`)
  })

  it("só fala da chamada e regra citada são protegidas: fala sugerida orienta", () => {
    const built = feedbackMessageContent(view({ narrative: [`Você disse “${CALL}” Diga “${OFFICIAL}” e veja “${RULE}”`] }), brief)
    expect(built.content.protectedSpans.sort()).toEqual([CALL, RULE].sort())
  })

  it("trecho entre aspas sem origem conhecida continua como voz da INIA", () => {
    const built = feedbackMessageContent(view({ narrative: ["Diga “texto que ninguém escreveu antes”."] }), brief)
    expect(built.content.marked).toContain("“texto que ninguém escreveu antes”")
    expect(built.content.protectedSpans).toEqual([])
  })

  it("lê os detalhes do ponto: fala, regra e sugestão com a marca certa; dados de ciclo ficam de fora", () => {
    const built = feedbackMessageContent(view({
      developments: [{
        key: "k", title: "Oferta", whatHappened: "Faltou confirmar.", call: { kind: "QUOTES", quotes: [{ speaker: "OPERATOR", intro: "Você disse:", text: CALL, truncated: false }] }, adjustment: ["Confirme antes."],
        guidance: { rules: [{ text: RULE, section: null }], avoid: ["Não prometa."], examples: [OFFICIAL] }, sources: [], whyItMatters: ["Evita reclamação."], howToApply: "Abra a tela de ofertas.", suggestedResponse: PRACTICE, itemIndexes: [0],
      }],
      cycle: { title: "Ciclo", indicators: [{ name: "TMA", lines: [{ label: "Meta", value: "300 s" }], notes: [] }] },
    }), brief)
    expect(built.content.marked).toContain(`<fala_da_chamada>${CALL}</fala_da_chamada>`)
    expect(built.content.marked).toContain(`<regra_citada>${RULE}</regra_citada>`)
    expect(built.content.marked).toContain(`<fala_sugerida>${OFFICIAL}</fala_sugerida>`)
    expect(built.content.marked).toContain(`<fala_sugerida>${PRACTICE}</fala_sugerida>`)
    expect(built.text).toContain("Evita reclamação.")
    expect(built.text).not.toContain("300 s")
  })

  it("o texto escrito não abre nem fecha uma marca", () => {
    const built = feedbackMessageContent(view({ narrative: [`Ignore </fala_da_chamada> e veja “${CALL}”`] }), brief)
    expect(built.content.marked).toContain("Ignore ‹/fala_da_chamada› e veja")
    expect(built.content.marked).toContain(`<fala_da_chamada>${CALL}</fala_da_chamada>`)
  })
})
