import { describe, expect, it } from "vitest"
import { compositionViolations, narrativeBriefOf, resolveNarrative, SUPERVISOR_NARRATIVE_VERSION, type NarrativeDraft } from "../domain/supervisor-narrative.js"
import { projectCompositionBriefForModel, SUPERVISOR_NARRATIVE_PROMPT_VERSION } from "../domain/supervisor-narrative-prompt.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { factualityVerdictFor } from "../testing/narrative-factuality-cases.js"

/**
 * MONITORING ARCHITECTURE V2 — WRITER CANNOT CREATE FACTS. O redator de composição tem liberdade de estrutura, ordem e extensão;
 * o que ele não pode é criar ponto forte, achado, ação ou conclusão: cada frase declara a postura e os pontos (S-n/A-n) a que se
 * refere, e o código confere o vínculo + as checagens objetivas — nunca uma lista de palavras permitidas.
 */
const LABEL = "Atendimento de 29/09/2026 · Bloqueio por inadimplência"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
let next = 1
function item(section: "STRENGTH" | "OPPORTUNITY", title: string, observed: string, quote: string, line: string, summary: string | null = null): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed, whyItMatters: "", whatYouCanDo: section === "OPPORTUNITY" ? "Antes de orientar o aplicativo, confirme se a funcionalidade está disponível." : "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [{ role: "OPERADOR", text: line, truncated: false, masked: false }],
    knowledge: { documentId: "doc", documentTitle: "Guia de Abordagem | Atendimento", heading: "Informe de pagamento", version: 1, quote, applicability: "VERIFIED", href: "/materiais/doc", contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Guia de Abordagem | Atendimento", requirement: quote, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: "OBSERVED_ACTION" as never, stepTitle: title, ...(summary ? { summary } : {}) },
  } as EmittedItem
}
const development = () => [
  item("OPPORTUNITY", "Informe de pagamento", "Você orientou o informe pelo aplicativo sem antes avaliar se a funcionalidade estava disponível.", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", "É só informar pelo aplicativo, essa opção está disponível.", "Orientou o informe pelo aplicativo sem checar a disponibilidade."),
  item("OPPORTUNITY", "Não prometer desbloqueio imediato", "Você disse que o desbloqueio seria imediato.", "Não prometer desbloqueio imediato.", "Assim que você informar, o desbloqueio é imediato."),
]
const mixed = () => [
  item("STRENGTH", "Negociação", "Você orientou a consulta dos débitos pelo Vivo em Dia.", "Orientar o Vivo em Dia para consultar débitos.", "Pelo Vivo em Dia você consulta os débitos e as opções de parcelamento."),
  item("OPPORTUNITY", "Promessas", "Você garantiu a aprovação do parcelamento antes da consulta.", "Não garantir aprovação antes da consulta.", "Ele vai ser aprovado na hora, isso eu te garanto."),
]
type Sentence = NonNullable<NarrativeDraft["sentences"]>[number]
const draft = (sentences: [number, string, Sentence["stance"], string[]][], card: string, cardRefs: string[]): NarrativeDraft => {
  const list = sentences.map(([paragraph, text, stance, refs]) => ({ paragraph, text, stance, refs }))
  const paragraphs = [...new Set(list.map((entry) => entry.paragraph))].map((number) => list.filter((entry) => entry.paragraph === number).map((entry) => entry.text).join(" "))
  return { paragraphs, card, sentences: list, cardRefs }
}
const check = (items: EmittedItem[], value: NarrativeDraft) => compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT)

describe("o redator não cria fato", () => {
  it("sem ponto forte no assessment, frase STRENGTH é recusada", () => {
    const result = check(development(), draft([[1, "Você fez a orientação do aplicativo corretamente.", "STRENGTH", []], [1, "O desbloqueio não pode ser prometido como imediato.", "ADJUSTMENT", ["A2"]], [1, "Antes de orientar o aplicativo, confirme a disponibilidade.", "ADJUSTMENT", ["A1"]]], "Ajuste a orientação do informe de pagamento.", ["A1"]))
    expect(result.narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
  it("elogio escondido numa frase de contexto ou de orientação também é recusado (o bug real da chamada 4)", () => {
    const result = check(development(), draft([[1, "Você orientou corretamente o uso do aplicativo.", "CONTEXT", []], [1, "Faltou confirmar a disponibilidade antes.", "ADJUSTMENT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]], "Faltou confirmar a disponibilidade.", ["A1"]))
    expect(result.narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
  it("achado que não está no assessment (ref inexistente) é recusado; o ajuste PRINCIPAL esquecido (ou só como contexto) também", () => {
    const invented = check(development(), draft([[1, "Faltou confirmar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "Você também não confirmou o CPF.", "ADJUSTMENT", ["A3"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]], "Faltou confirmar a disponibilidade.", ["A1"]))
    expect(invented.narrative).toContain("NARRATIVE_REF_UNKNOWN")
    // FEEDBACK EXPERIENCE V2 — o redator prioriza: o secundário pode ficar para os detalhes; o principal nunca.
    const secondaryLeft = check(development(), draft([[1, "Faltou confirmar a disponibilidade.", "ADJUSTMENT", ["A1"]]], "Faltou confirmar a disponibilidade.", ["A1"]))
    expect(secondaryLeft.narrative).not.toContain("NARRATIVE_GAP_OMITTED")
    const mainAsContext = check(development(), draft([[1, "Você orientou o informe pelo aplicativo.", "CONTEXT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]], "O desbloqueio não é imediato.", ["A2"]))
    expect(mainAsContext.narrative).toContain("NARRATIVE_GAP_OMITTED")
  })
  it("força citada fora de uma frase STRENGTH, ou num ajuste, não passa (nada de força disfarçada)", () => {
    const result = check(mixed(), draft([[1, "Você orientou o Vivo em Dia, e garantiu a aprovação.", "ADJUSTMENT", ["S1", "A1"]]], "Evite garantir a aprovação.", ["A1"]))
    expect(result.narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
  it("o card cita o principal ajuste; elogio no card só com ponto forte", () => {
    const noGap = check(development(), draft([[1, "Faltou confirmar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "O desbloqueio não é imediato.", "ADJUSTMENT", ["A2"]]], "Você conduziu bem o atendimento.", []))
    expect(noGap.card).toEqual(expect.arrayContaining(["NARRATIVE_GAP_OMITTED", "NARRATIVE_UNSUPPORTED_STRENGTH"]))
  })
  it("checagens objetivas continuam: número sem fonte e efeito garantido", () => {
    const result = check(development(), draft([[1, "Faltou confirmar a disponibilidade; a liberação leva 3 dias.", "ADJUSTMENT", ["A1"]], [1, "Prometer desbloqueio imediato garante reclamação.", "ADJUSTMENT", ["A2"]]], "Faltou confirmar a disponibilidade.", ["A1"]))
    expect(result.narrative).toEqual(expect.arrayContaining(["UNSUPPORTED_NUMBER"]))
  })
})

describe("o redator tem liberdade de composição", () => {
  it("contexto + ajuste + orientação, começando pelo problema e sem elogio (DEVELOPMENT com zero elogio) → aceito", () => {
    const result = check(development(), draft([
      [1, "Nesta chamada o cliente ligou porque a linha continuava bloqueada depois do pagamento.", "CONTEXT", []],
      [1, "Você orientou o informe pelo aplicativo sem antes confirmar se a funcionalidade estava disponível para ele, e ainda disse que o desbloqueio seria imediato.", "ADJUSTMENT", ["A1", "A2"]],
      [2, "Na próxima situação parecida, confirme primeiro a disponibilidade e, se ela existir, explique o caminho pelo aplicativo sem garantir a liberação imediata.", "GUIDANCE", ["A1", "A2"]],
    ], "Antes de orientar o informe pelo aplicativo, confirme a disponibilidade e não prometa desbloqueio imediato.", ["A1", "A2"]))
    expect(result).toEqual({ narrative: [], card: [] })
  })
  it("paráfrase livre de um ajuste passa — palavras que a lista antiga recusava ('prazos', 'comunicação') não são problema", () => {
    const result = check(development(), draft([[1, "Vale rever a comunicação sobre prazos de desbloqueio: ele não é imediato.", "ADJUSTMENT", ["A2"]], [1, "E a disponibilidade da funcionalidade precisa ser confirmada antes do caminho pelo aplicativo.", "ADJUSTMENT", ["A1"]]], "Reveja a comunicação sobre o desbloqueio e confirme a disponibilidade antes.", ["A1", "A2"]))
    expect(result).toEqual({ narrative: [], card: [] })
  })
  it("MIXED legítimo: força independente reconhecida + ajuste, em qualquer ordem", () => {
    const result = check(mixed(), draft([[1, "Você garantiu a aprovação do parcelamento antes da consulta; isso precisa mudar.", "ADJUSTMENT", ["A1"]], [2, "A orientação pelo Vivo em Dia para consultar os débitos foi correta e vale manter.", "STRENGTH", ["S1"]]], "Evite garantir a aprovação do parcelamento antes da consulta.", ["A1"]))
    expect(result).toEqual({ narrative: [], card: [] })
  })
  it("falsos positivos léxicos herdados não recusam mais: 'falha na internet', 'status do reparo'; culpa dirigida ao colaborador continua recusada", () => {
    const ok = check(development(), draft([[1, "O cliente ligou por uma falha na internet e perguntou pelo status do reparo.", "CONTEXT", []], [1, "Você orientou o informe sem confirmar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "E disse que o desbloqueio seria imediato.", "ADJUSTMENT", ["A2"]]], "Confirme a disponibilidade antes.", ["A1"]))
    expect(ok).toEqual({ narrative: [], card: [] })
    const blame = check(development(), draft([[1, "Foi uma falha sua não confirmar a disponibilidade; você errou ao prometer o desbloqueio.", "ADJUSTMENT", ["A1", "A2"]]], "Confirme a disponibilidade antes.", ["A1"]))
    expect(blame.narrative).toContain("PRESENTATION_BLAME")
  })
  it("frase que só se refere a forças é reconhecimento, qualquer que seja o rótulo; força + ajuste na mesma frase continua recusada", () => {
    const relabeled = check(mixed(), draft([[1, "Você indicou corretamente o Vivo em Dia para consultar os débitos.", "CONTEXT", ["S1"]], [2, "Mas garantiu a aprovação do parcelamento antes da consulta.", "ADJUSTMENT", ["A1"]]], "Evite garantir a aprovação antes da consulta.", ["A1"]))
    expect(relabeled).toEqual({ narrative: [], card: [] })
  })
  it("payload da composição leva o contexto da chamada e o que aconteceu em cada ponto (especialista), com refs S-n/A-n", () => {
    const payload = projectCompositionBriefForModel(narrativeBriefOf(development(), LABEL, { interaction: { customerNeed: "Linha bloqueada após pagamento", situation: null, path: "Orientou o aplicativo" } }))
    expect(payload.interaction).toMatchObject({ customerNeed: "Linha bloqueada após pagamento", path: "Orientou o aplicativo" })
    expect(payload.adjustments[0]).toMatchObject({ ref: "A1", context: ["Orientou o informe pelo aplicativo sem checar a disponibilidade."] })
  })
  it("na emissão: rascunho V5 válido é o texto exibido; inválido cai para a narrativa do sistema (sem elogio quando não há força)", () => {
    const items = development()
    const valid = draft([[1, "Você orientou o informe sem confirmar a disponibilidade.", "ADJUSTMENT", ["A1"]], [1, "E disse que o desbloqueio seria imediato.", "ADJUSTMENT", ["A2"]]], "Confirme a disponibilidade antes e não prometa desbloqueio imediato.", ["A1", "A2"])
    const stored = (value: NarrativeDraft) => ({ version: SUPERVISOR_NARRATIVE_VERSION, promptVersion: SUPERVISOR_NARRATIVE_PROMPT_VERSION, itemsKey: narrativeBriefOf(items, LABEL).itemsKey, draft: value, violations: { narrative: [], card: [] }, error: null, factuality: factualityVerdictFor(value) })
    expect(resolveNarrative(stored(valid), items, CONTEXT).source).toEqual({ narrative: "WRITER", card: "WRITER" })
    const invalid = draft([[1, "Você fez tudo corretamente.", "STRENGTH", ["S1"]]], "Você conduziu bem.", [])
    const fallback = resolveNarrative(stored(invalid), items, CONTEXT)
    expect(fallback.source).toEqual({ narrative: "SYSTEM", card: "SYSTEM" })
    expect([...fallback.paragraphs, fallback.card].join(" ")).not.toMatch(/corretamente|conduziu bem|mantenha/i)
  })
})
