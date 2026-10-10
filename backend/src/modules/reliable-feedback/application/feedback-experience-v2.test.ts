import { describe, expect, it } from "vitest"
import { compositionViolations, narrativeBriefOf, resolveNarrative, SUPERVISOR_NARRATIVE_VERSION, type NarrativeDraft } from "../domain/supervisor-narrative.js"
import { projectCompositionBriefForModel } from "../domain/supervisor-narrative-prompt.js"
import { feedbackViewOf, feedbackViewParts } from "../domain/feedback-view.js"
import { resolvePresentation } from "../domain/feedback-presentation.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { factualityVerdictFor } from "../testing/narrative-factuality-cases.js"

/**
 * FEEDBACK EXPERIENCE V2 — a última milha (fatos rígidos, linguagem livre): o redator recebe a disposição e as falas de cada ponto e
 * volta a escrever um card curto com vínculo; os detalhes aprofundam sem repetir a narrativa; o nome entra como vocativo natural.
 * Nenhuma checagem nova: o vínculo e as checagens objetivas de sempre.
 */
const LABEL = "Atendimento de 29/09/2026 · Bloqueio por inadimplência"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
let next = 1
function item(section: "STRENGTH" | "OPPORTUNITY", title: string, observed: string, whatYouCanDo: string, quote: string, line: string): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed, whyItMatters: "", whatYouCanDo }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [{ role: "OPERADOR", text: line, truncated: false, masked: false }],
    knowledge: { documentId: "doc", documentTitle: "Guia de Abordagem | Atendimento", heading: title, version: 1, quote, applicability: "VERIFIED", href: "/materiais/doc", contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Guia de Abordagem | Atendimento", requirement: quote, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: "OBSERVED_ACTION" as never, stepTitle: title },
  } as EmittedItem
}
const development = () => [
  item("OPPORTUNITY", "Informe de pagamento", "Nesse momento da chamada, faltou avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", "Na próxima chamada, avalie se a funcionalidade de informe de pagamento está disponível para o cliente.", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", "É só informar pelo aplicativo, essa opção está disponível pra você."),
  item("OPPORTUNITY", "Promessas", "Nesta chamada, o que o procedimento orienta em “Promessas” não foi seguido.", "Na próxima chamada, siga o que o procedimento orienta: “Não prometer desbloqueio imediato”.", "Não prometer desbloqueio imediato.", "Assim que você informar, o desbloqueio é na hora."),
]
const positive = () => [item("STRENGTH", "Negociação", "Você indicou o Vivo em Dia para consultar os débitos.", "", "Orientar o Vivo em Dia para consultar débitos.", "Pelo Vivo em Dia você consulta os débitos e as opções de parcelamento.")]
const mixed = () => [...positive(), item("OPPORTUNITY", "Promessas", "Nesta chamada, o que o procedimento orienta em “Promessas” não foi seguido.", "", "Não garantir aprovação antes da consulta.", "Pode ficar tranquila, vai ser aprovado em dez vezes.")]
type Sentence = NonNullable<NarrativeDraft["sentences"]>[number]
const draft = (sentences: [number, string, Sentence["stance"], string[]][], card: string, cardRefs: string[]): NarrativeDraft => {
  const list = sentences.map(([paragraph, text, stance, refs]) => ({ paragraph, text, stance, refs }))
  const paragraphs = [...new Set(list.map((entry) => entry.paragraph))].map((number) => list.filter((entry) => entry.paragraph === number).map((entry) => entry.text).join(" "))
  return { paragraphs, card, sentences: list, cardRefs }
}
const stored = (items: EmittedItem[], value: NarrativeDraft) => ({ version: SUPERVISOR_NARRATIVE_VERSION, promptVersion: "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V7", itemsKey: narrativeBriefOf(items, LABEL).itemsKey, draft: value, violations: { narrative: [], card: [] }, error: null, factuality: factualityVerdictFor(value) })

describe("o redator recebe o que precisa para comunicar (sem decidir nada)", () => {
  it("a disposição vem do código; cada ponto leva as falas verificadas para parafrasear", () => {
    expect(projectCompositionBriefForModel(narrativeBriefOf(development(), LABEL))).toMatchObject({ disposition: "DEVELOPMENT", strengths: [], adjustments: [{ ref: "A1", quotes: ["Operador: É só informar pelo aplicativo, essa opção está disponível pra você."] }, { ref: "A2" }] })
    expect(projectCompositionBriefForModel(narrativeBriefOf(positive(), LABEL))).toMatchObject({ disposition: "POSITIVE", strengths: [{ ref: "S1", quotes: [expect.stringMatching(/^Operador: Pelo Vivo em Dia/)] }] })
    expect(projectCompositionBriefForModel(narrativeBriefOf(mixed(), LABEL)).disposition).toBe("MIXED")
  })
})

describe("card curto do redator, preso ao assessment pelo vínculo", () => {
  it("DEVELOPMENT: card de ação com ref do ajuste → aceito; o texto direto, sem elogio, também", () => {
    const items = development()
    const value = draft([
      [1, "Nesta chamada o cliente já tinha pago e queria a linha de volta; você indicou o aplicativo afirmando que a opção estava disponível, sem conferir antes, e disse que o desbloqueio seria na hora.", "ADJUSTMENT", ["A1", "A2"]],
      [1, "Antes de indicar o aplicativo, confira se a opção existe para ele e explique o próximo passo sem garantir liberação imediata.", "GUIDANCE", ["A1", "A2"]],
    ], "Confira a disponibilidade antes de orientar o aplicativo.", ["A1"])
    expect(compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT)).toEqual({ narrative: [], card: [] })
    expect(resolveNarrative(stored(items, value), items, CONTEXT)).toMatchObject({ card: "Confira a disponibilidade antes de orientar o aplicativo.", source: { narrative: "WRITER", card: "WRITER" } })
  })
  it("card que elogia sem ponto forte, ou que não traz o ajuste, cai para o card do sistema", () => {
    const items = development()
    const value = draft([[1, "Você indicou o aplicativo sem conferir a disponibilidade e prometeu desbloqueio na hora.", "ADJUSTMENT", ["A1", "A2"]]], "Boa condução no informe de pagamento.", [])
    const resolved = resolveNarrative(stored(items, value), items, CONTEXT)
    expect(resolved.source).toEqual({ narrative: "WRITER", card: "SYSTEM" })
    expect(resolved.violations.card).toEqual(expect.arrayContaining(["NARRATIVE_GAP_OMITTED", "NARRATIVE_UNSUPPORTED_STRENGTH"]))
  })
  it("POSITIVE: reconhecimento específico no card, com a ref da força → aceito", () => {
    const items = positive()
    const value = draft([[1, "Na negociação, você direcionou o cliente ao Vivo em Dia para consultar os débitos e as opções, sem antecipar condição de parcelamento. Vale manter essa condução.", "STRENGTH", ["S1"]]], "Boa condução na negociação pelo Vivo em Dia.", ["S1"])
    expect(resolveNarrative(stored(items, value), items, CONTEXT)).toMatchObject({ card: "Boa condução na negociação pelo Vivo em Dia.", source: { narrative: "WRITER", card: "WRITER" } })
  })
})

describe("detalhes aprofundam, não repetem", () => {
  it("com a fala nos detalhes, sem 'O que aconteceu'; 'siga o que o procedimento orienta' sai de 'Como melhorar'; a orientação acionável fica", () => {
    const items = development()
    const view = feedbackViewOf(items, resolvePresentation(null, items, CONTEXT))!
    const [check, promise] = view.developments
    expect(check).toMatchObject({ whatHappened: "", adjustment: [], call: { kind: "QUOTES" }, howToApply: "Na próxima chamada, avalie se a funcionalidade de informe de pagamento está disponível para o cliente." })
    expect(promise).toMatchObject({ whatHappened: "", howToApply: null, guidance: { rules: [expect.objectContaining({ text: expect.stringContaining("Não prometer desbloqueio imediato") })] } })
    const text = feedbackViewParts(view, items).map((part) => part.markdown).join("\n\n")
    expect(text).not.toContain("**O que aconteceu**")
    expect(text).not.toMatch(/siga o que o procedimento orienta/i)
  })
  it("'O que manter' = as evidências (sem resumo-modelo); a frase do ponto só quando descreve a conduta", () => {
    const items = [...positive(), item("STRENGTH", "Reparo fixa", "Na sua fala ao cliente, citada abaixo, aparece o que o procedimento orienta em “Reparo fixa”.", "", "Realizar o suporte.", "Vamos fazer um teste no modem.")]
    const view = feedbackViewOf(items, resolvePresentation(null, items, CONTEXT))!
    expect(view.maintain).toMatchObject({ summary: "", evidence: [{ title: "Negociação", statement: "Você indicou o Vivo em Dia para consultar os débitos." }, { title: "Reparo fixa", statement: "" }] })
    expect(view.developments).toEqual([])
  })
  it("sem ponto forte, não há 'O que manter'", () => {
    const items = development()
    expect(feedbackViewOf(items, resolvePresentation(null, items, CONTEXT))!.maintain).toBeNull()
  })
})

describe("o nome entra como vocativo natural (sem saudação-modelo)", () => {
  it("'Nesta chamada…' → 'Larissa, nesta chamada…'; abertura fora da lista segura (ex.: 'Faltou…') mantém a saudação", () => {
    const items = development()
    const value = (opening: string) => draft([[1, opening, "ADJUSTMENT", ["A1", "A2"]]], "Confira a disponibilidade antes de orientar o aplicativo.", ["A1"])
    const viewOf = (opening: string) => feedbackViewOf(items, resolvePresentation({ version: "FEEDBACK_PRESENTATION_V1", recipient: { firstName: "Larissa" }, writerDraft: null, writerViolations: [], narrative: stored(items, value(opening)) } as never, items, CONTEXT))!
    expect(viewOf("Nesta chamada o cliente já tinha pago; você indicou o aplicativo sem conferir a disponibilidade e prometeu desbloqueio na hora.")).toMatchObject({ greeting: null, narrative: [expect.stringMatching(/^Larissa, nesta chamada o cliente/)] })
    expect(viewOf("O cliente já tinha pago; você indicou o aplicativo sem conferir a disponibilidade e prometeu desbloqueio na hora.")).toMatchObject({ narrative: [expect.stringMatching(/^Larissa, o cliente já tinha pago/)] })
    expect(viewOf("Faltou conferir a disponibilidade antes de indicar o aplicativo, e o desbloqueio foi prometido para a hora.")).toMatchObject({ greeting: "Olá, Larissa!", narrative: [expect.stringMatching(/^Faltou conferir/)] })
  })
})
