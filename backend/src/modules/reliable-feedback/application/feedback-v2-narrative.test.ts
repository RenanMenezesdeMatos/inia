import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import golden from "../testing/contestacao-v173-golden-artifact.json" with { type: "json" }
import { emittedItems, nodeOutputOf, presentationOf, renderPublishedNarrative, type EmittedItem, type ReliableFeedbackArtifactV1 } from "../domain/reliable-feedback-artifact.js"
import { resolvePresentation, type StoredPresentation } from "../domain/feedback-presentation.js"
import { cardViolations, deterministicNarrative, narrativeBriefOf, narrativeViolations, resolveNarrative, SUPERVISOR_NARRATIVE_VERSION, type StoredNarrative } from "../domain/supervisor-narrative.js"
import { feedbackViewOf, withMaterialAccess, type FeedbackView } from "../domain/feedback-view.js"
import { parseNarrativeResponse, projectCompositionBriefForModel, projectNarrativeBriefForModel, SUPERVISOR_NARRATIVE_PROMPT_VERSION, SUPERVISOR_NARRATIVE_PROMPT_VERSIONS, SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS, supervisorNarrativeFingerprint, supervisorNarrativeFreezeFile } from "../domain/supervisor-narrative-prompt.js"
import { writeSupervisorNarrative } from "../infrastructure/gemini-reliable-feedback-writer.js"
import { replayV173 } from "../testing/replay-v173.js"
import type { GatewayRequest, GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"

/**
 * FEEDBACK POR FLAG V2 — narrativa de supervisor + detalhes (progressive disclosure). Só APRESENTAÇÃO: o artefato (diagnóstico,
 * status, completude, checkpointRefs, readiness, disposição) é a matéria-prima e nunca muda.
 */
const GOLDEN = golden as unknown as ReliableFeedbackArtifactV1
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const LEGACY_TEXT = readFileSync(join(import.meta.dirname, "..", "testing", "contestacao-v173-golden-legacy-recommendation.md"), "utf8").trimEnd()
const LABEL = GOLDEN.label
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
const TECHNICAL = /READY|HOLD_FOR_QA|BLOCKED|VERIFIED(?:_OMISSION)?|NEEDS_REVIEW|MISSING_REQUIRED|checkpointRef|CP-[0-9a-f]|P1\.C\d|canonicalBehavior|RECAPITULATE_|PROVIDE_PROTOCOL|sourceLineage|analyticsStatus|contractVersion|writerVersion|OBSERVED_(?:ACTION|DECLARATION)|evidenceType/

/** O diagnóstico ATUAL do mesmo caso: replay sem modelo dos insumos reais do smoke (aplicabilidade dos subitens corrigida). */
const REPLAYED = (await replayV173()).artifact
const goldenItems = () => emittedItems(clone(REPLAYED), [])
const narrativeText = (paragraphs: readonly string[]) => paragraphs.join("\n\n")
const storedWith = (items: readonly EmittedItem[], draft: { paragraphs: string[]; card: string } | null, error: string | null = null): StoredPresentation => ({
  version: "FEEDBACK_PRESENTATION_V1", recipient: { firstName: "Larissa" }, writerDraft: null, writerViolations: [],
  narrative: { version: SUPERVISOR_NARRATIVE_VERSION, promptVersion: SUPERVISOR_NARRATIVE_PROMPT_VERSION, itemsKey: narrativeBriefOf(items, LABEL).itemsKey, draft, violations: { narrative: [], card: [] }, error } satisfies StoredNarrative,
})

// Itens sintéticos (mesmo formato dos emitidos) para os cenários fora do golden.
let next = 100
const DOC = "11111111-2222-4333-8444-555555555555"
function item(section: "STRENGTH" | "OPPORTUNITY", code: string | null, options: { observed?: string; whatYouCanDo?: string; line?: string; heading?: string; quote?: string; evidenceType?: string; completeness?: EmittedItem["process"] extends infer P ? P extends { completeness?: infer C } ? C : never : never } = {}): EmittedItem {
  const index = next++
  const title: Record<string, string> = { IDENTIFY_CHARGE: "Identificação da cobrança", CHECK_PAYMENT: "Verificação do pagamento", VALIDATE_HOLDER: "Validação do titular", REGISTER_DISPUTE: "Registro da contestação", CANCEL_RECURRING_SERVICE: "Cancelamento da recorrência", PROVIDE_PROTOCOL: "Protocolo", CONFIRM_UNDERSTANDING: "Confirmação de entendimento", INFORM_DEADLINE: "Prazo da análise", RECAPITULATE_INTERACTION: "Recapitulação", OPEN_ANALYSIS: "Abertura de análise" }
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed: options.observed ?? (section === "STRENGTH" ? `Você fez ${title[code ?? ""] ?? "a etapa"} corretamente.` : `Nesta chamada, ${title[code ?? ""] ?? "a etapa"} não aconteceu como o procedimento prevê.`), whyItMatters: "", whatYouCanDo: options.whatYouCanDo ?? "" },
    wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: options.line === "" ? [] : [{ role: "OPERADOR", text: options.line ?? `Fala do operador ${index}.`, truncated: false, masked: false }],
    knowledge: { documentId: DOC, documentTitle: "Procedimento de Contestação", heading: options.heading ?? `${index}. Seção ${index}`, version: 1, quote: options.quote ?? `O operador deverá cumprir a etapa ${index}.`, applicability: "VERIFIED", href: `/materiais/${DOC}`, contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Procedimento de Contestação", requirement: `Etapa ${index}`, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: (options.evidenceType ?? "OBSERVED_ACTION") as never, stepTitle: `Etapa ${index}`, ...(code ? { behavior: { code, title: title[code] ?? code, facets: [], conflict: false, sources: [] } } : {}), ...(options.completeness ? { completeness: options.completeness } : {}) },
  }
}
const strengths = () => [item("STRENGTH", "VALIDATE_HOLDER"), item("STRENGTH", "IDENTIFY_CHARGE"), item("STRENGTH", "CHECK_PAYMENT"), item("STRENGTH", "CANCEL_RECURRING_SERVICE"), item("STRENGTH", "INFORM_DEADLINE"), item("STRENGTH", "CONFIRM_UNDERSTANDING")]
const system = (items: readonly EmittedItem[]) => deterministicNarrative(narrativeBriefOf(items, LABEL))
const selfCheck = (items: readonly EmittedItem[]) => {
  const brief = narrativeBriefOf(items, LABEL)
  const draft = deterministicNarrative(brief)
  return { narrative: narrativeViolations(draft.paragraphs, brief, items, CONTEXT), card: cardViolations(draft.card, brief, items, CONTEXT) }
}

describe("Feedback por Flag V2 — narrativa de supervisor (A–L)", () => {
  it("A) Larissa (8 positivos + recapitulação parcial + protocolo ausente): narrativa natural que se entende sozinha", () => {
    const items = goldenItems()
    const { paragraphs, card } = system(items)
    const text = narrativeText(paragraphs)
    // O que fez bem (investigação e tratativa), o principal ajuste (recapitulação incompleta + protocolo), o que fazer, o que manter.
    expect(paragraphs[0]).toMatch(/^Você conduziu bem a investigação do caso e a tratativa: validou o titular da linha, identificou a cobrança que o cliente não reconhecia e verificou se a conta já tinha sido paga; na tratativa, informou ao cliente o registro da contestação e a abertura da análise e cancelou a recorrência do serviço\.$/)
    // A recapitulação só ficou sem o protocolo (conta ajustada e valor a pagar não se aplicavam): dito uma vez, junto do protocolo.
    expect(paragraphs[1]).toBe("O principal ajuste está no encerramento: o protocolo não foi informado ao cliente, nem mesmo na recapitulação.")
    expect(paragraphs[2]).toBe("Na próxima chamada, antes de se despedir, informe claramente o número do protocolo gerado para a solicitação.")
    expect(paragraphs[3]).toBe("Mantenha também o que você fez bem no restante da chamada: informou o prazo da análise e verificou se o cliente tinha dúvidas.")
    // Sem placar, sem linguagem de auditoria, sem o checklist inteiro, sem repetir o protocolo como item faltante.
    expect(text).not.toMatch(/\d+\s+pontos?|pontos? fortes?|ponto de desenvolvimento|Recapitulação obrigatória|foi identificado que|conforme análise/i)
    expect(text).not.toMatch(/conta analisada|lançamento contestado|canal de retorno|conta ajustada|valor a pagar/i)
    expect(text.match(/protocolo/g)).toHaveLength(2)
    expect(text).not.toMatch(TECHNICAL)
    expect(card).toBe("Você conduziu bem a investigação do caso e a tratativa, mas o protocolo não foi informado ao cliente, nem mesmo na recapitulação. Veja no feedback como ajustar o encerramento nas próximas chamadas.")
    expect(selfCheck(items)).toEqual({ narrative: [], card: [] })
  })

  it("A') o texto do redator que respeita os fatos é aceito campo a campo (e o nome do cadastro abre a mensagem)", () => {
    const items = goldenItems()
    const draft = {
      paragraphs: [
        "Você conduziu bem a identificação da cobrança e informou ao cliente o registro da contestação, além de cancelar a recorrência do serviço.",
        "O principal ajuste está no encerramento: o protocolo não foi informado ao cliente, nem na recapitulação final.",
        "Na próxima chamada, antes de se despedir, faça uma revisão rápida do que foi feito e informe o número do protocolo.",
        "No restante da chamada, mantenha a forma como você verificou o pagamento e explicou o prazo da análise.",
      ],
      card: "Você conduziu bem a contestação, mas o encerramento ficou incompleto: o protocolo não foi informado ao cliente. Veja no feedback como melhorar esse fechamento.",
    }
    const presentation = resolvePresentation(storedWith(items, draft), items, CONTEXT)
    expect(presentation.narrativeResolution).toEqual({ source: { narrative: "WRITER", card: "WRITER" }, violations: { narrative: [], card: [] } })
    const view = feedbackViewOf(items, presentation)!
    expect(view.greeting).toBeNull()
    expect(view.narrative[0]).toMatch(/^Larissa, você conduziu bem a identificação da cobrança/)
    expect(view.card).toBe(draft.card)
  })

  it("B) 1 ajuste simples → curto; C) zero ajustes → positivo, sem 'O que precisa ser ajustado'", () => {
    const one = [item("OPPORTUNITY", "PROVIDE_PROTOCOL", { observed: "Você encerrou sem informar o número do protocolo.", whatYouCanDo: "Antes de se despedir, informe o número do protocolo." }), ...strengths()]
    const b = system(one)
    expect(b.paragraphs.length).toBeLessThanOrEqual(4)
    expect(b.paragraphs[1]).toBe("O principal ajuste está no encerramento: o protocolo não foi informado ao cliente. O procedimento orienta: “O operador deverá cumprir a etapa 100.”")
    expect(selfCheck(one)).toEqual({ narrative: [], card: [] })

    const none = strengths()
    const c = system(none)
    expect(narrativeText(c.paragraphs)).not.toMatch(/ajuste|não foi|faltou/)
    expect(c.paragraphs[0]).toMatch(/^Você conduziu bem este atendimento sobre contestação de cobrança: na investigação do caso, validou o titular da linha e identificou/)
    expect(c.card).toBe("Você conduziu bem este atendimento sobre contestação de cobrança. Veja no feedback o que manter nas próximas chamadas.")
    const view = feedbackViewOf(none, resolvePresentation(null, none, CONTEXT))!
    expect(view.developments).toEqual([])
    expect(view.maintain?.evidence).toHaveLength(6)
    expect(selfCheck(none)).toEqual({ narrative: [], card: [] })
  })

  it("D) 4 ajustes → nenhum escondido (todos na narrativa, cada um no próprio detalhe), sem parede de texto", () => {
    const gaps = [
      item("OPPORTUNITY", "VALIDATE_HOLDER"), item("OPPORTUNITY", "CHECK_PAYMENT"),
      item("OPPORTUNITY", "INFORM_DEADLINE", { whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." }),
      item("OPPORTUNITY", "PROVIDE_PROTOCOL", { whatYouCanDo: "Antes de se despedir, informe o número do protocolo." }),
    ]
    const items = [...gaps, item("STRENGTH", "IDENTIFY_CHARGE"), item("STRENGTH", "REGISTER_DISPUTE")]
    const { paragraphs } = system(items)
    const text = narrativeText(paragraphs)
    for (const stem of ["titular", "paga", "prazo", "protocolo"]) expect(text).toContain(stem)
    expect(paragraphs.join(" ").length).toBeLessThan(1400)
    expect(paragraphs[1]).toMatch(/^Os ajustes estão na investigação do caso e no encerramento: /)
    expect(feedbackViewOf(items, resolvePresentation(null, items, CONTEXT))!.developments).toHaveLength(4)
    expect(selfCheck(items)).toEqual({ narrative: [], card: [] })
  })

  it("E) só positivos de fora das fases conhecidas → ainda natural, sem ajuste inventado", () => {
    const items = [item("STRENGTH", null, { observed: "Você ofereceu ajuda adicional ao final." })]
    const { paragraphs, card } = system(items)
    expect(narrativeText(paragraphs)).not.toMatch(/ajuste|faltou/)
    expect(card).toMatch(/^Você conduziu bem este atendimento/)
    expect(selfCheck(items)).toEqual({ narrative: [], card: [] })
  })

  it("F) ausência VERIFICADA → na narrativa 'não foi informado'; nos detalhes a CONCLUSÃO vem primeiro, a fala é só contexto", () => {
    const view = feedbackViewOf(goldenItems(), resolvePresentation(null, goldenItems(), CONTEXT))!
    // Consolidação de apresentação: a recapitulação só ficou incompleta pelo protocolo → um bloco só; a conclusão (a chamada
    // inteira) vem primeiro e o momento em que o protocolo caberia é a própria recapitulação.
    const closing = view.developments.find((detail) => detail.title === "Encerramento da chamada")!
    expect(closing.call).toMatchObject({ kind: "ABSENCE", verified: true, statement: "Não foi identificado o número do protocolo sendo informado ao cliente durante esta chamada.", context: { speaker: "OPERATOR", intro: "Você disse", text: expect.stringMatching(/^Recapitulando, Tiago:/) } })
    // Feedback Experience V2 — a ausência verificada já diz o que aconteceu; "O que aconteceu" não repete.
    expect(closing.whatHappened).toBe("")
  })

  it("G) DECLARED_ACTION_ONLY: o sistema diz 'informou ao cliente'; o redator que promove a declaração a execução é recusado", () => {
    const items = goldenItems()
    expect(narrativeText(system(items).paragraphs)).toContain("informou ao cliente o registro da contestação e a abertura da análise")
    const brief = narrativeBriefOf(items, LABEL)
    const upgraded = ["Você registrou a contestação e abriu a análise corretamente.", "O principal ajuste está no encerramento: a recapitulação ficou incompleta e o protocolo não foi informado ao cliente."]
    expect(narrativeViolations(upgraded, brief, items, CONTEXT)).toContain("DECLARED_ACTION_UPGRADE")
  })

  it("H) aplicabilidade não confirmada → ponto de atenção neutro (nunca em 'O que precisa ser ajustado', nunca erro)", () => {
    const attention: EmittedItem = { ...item("STRENGTH", null), section: "ATTENTION", sectionLabel: "Vale confirmar o produto", kind: "MONITORING_APPLICABILITY_POINT", process: null, knowledge: null, wording: { observed: "Não foi possível confirmar se a conta é Pós ou Controle.", whyItMatters: "", whatYouCanDo: "" }, applicability: { ref: "A1", status: "AMBIGUOUS", resolvedProduct: null, statementComparison: "NO_STATEMENT", compatibleProducts: [], candidates: [], affectedSteps: [] } }
    const items = [...strengths(), attention]
    const view = feedbackViewOf(items, resolvePresentation(null, items, CONTEXT))!
    expect(view.developments).toEqual([])
    expect(view.attention).toHaveLength(1)
    expect(narrativeText(view.narrative)).toContain("Em um ponto, o produto tratado ficou em aberto; os detalhes mostram o que conferir.")
    expect(narrativeText(view.narrative)).not.toMatch(/erro|falh/)
    expect(selfCheck(items)).toEqual({ narrative: [], card: [] })
  })

  it("I) redator falhou (sem rascunho) → narrativa do sistema — nunca o relatório antigo", () => {
    const items = goldenItems()
    const resolved = resolveNarrative(storedWith(items, null, "NARRATIVE_MALFORMED_JSON").narrative, items, CONTEXT)
    expect(resolved.source).toEqual({ narrative: "SYSTEM", card: "SYSTEM" })
    expect(narrativeText(resolved.paragraphs)).not.toMatch(/## |O que ajustar|Recapitulação obrigatória/)
    expect(parseNarrativeResponse("não é json")).toMatchObject({ ok: false, error: "NARRATIVE_MALFORMED_JSON" })
    expect(parseNarrativeResponse(JSON.stringify({ paragraphs: ["a"], card: "b", extra: 1 }))).toMatchObject({ ok: false, error: "NARRATIVE_SCHEMA_INVALID" })
  })

  it("J/K/L) redator que inventa efeito, número, contradiz o artefato, esconde um ajuste ou usa lacuna → recusado (fallback por campo)", () => {
    const items = goldenItems()
    const brief = narrativeBriefOf(items, LABEL)
    const base = "O principal ajuste está no encerramento: o protocolo não foi informado ao cliente, nem mesmo na recapitulação."
    const check = (extra: string, paragraphs = [base, extra]) => narrativeViolations(paragraphs, brief, items, CONTEXT)
    expect(check("Informar o protocolo garante que o cliente não volte a ligar.")).toContain("GUARANTEED_EFFECT")
    expect(check("Na próxima chamada, informe o protocolo em até 3 minutos.")).toContain("UNSUPPORTED_NUMBER")
    expect(check("Você informou o protocolo com clareza.")).toContain("NARRATIVE_CONTRADICTS_ARTIFACT")
    expect(check("A validação do titular não foi feita.")).toContain("NARRATIVE_CONTRADICTS_ARTIFACT")
    expect(narrativeViolations(["Você conduziu bem a investigação.", "Na próxima chamada, faça uma revisão rápida."], brief, items, CONTEXT)).toContain("NARRATIVE_GAP_OMITTED")
    expect(check("Na próxima chamada, informe o protocolo [número].")).toContain("NARRATIVE_PLACEHOLDER")
    expect(check("Foram 8 pontos fortes e 2 pontos de desenvolvimento.")).toEqual(expect.arrayContaining(["NARRATIVE_SCOREBOARD", "NARRATIVE_AUDIT_LANGUAGE"]))
    expect(check("Você costuma esquecer o protocolo.")).toContain("PATTERN_LANGUAGE")
    // Campo a campo: narrativa inválida cai para a do sistema; o card válido do redator fica.
    const presentation = resolvePresentation(storedWith(items, { paragraphs: [base, "Isso garante que o cliente fique satisfeito."], card: "Você conduziu bem a contestação, mas o protocolo não foi informado ao cliente. Veja no feedback como ajustar o encerramento." }), items, CONTEXT)
    expect(presentation.narrativeResolution!.source).toEqual({ narrative: "SYSTEM", card: "WRITER" })
    expect(presentation.narrative).toEqual(system(items).paragraphs)
  })

  it("o rascunho só vale para os MESMOS itens: se o QA rejeitou um ponto, a narrativa volta a ser a do sistema (sem o ponto rejeitado)", () => {
    const artifact = clone(REPLAYED)
    const items = emittedItems(artifact, [])
    const draft = { paragraphs: ["Você conduziu bem a investigação do caso.", "O principal ajuste está no encerramento: o protocolo não foi informado ao cliente, nem mesmo na recapitulação."], card: "Você conduziu bem a investigação do caso, mas o protocolo não foi informado ao cliente. Veja no feedback como ajustar." }
    artifact.presentation = storedWith(items, draft)
    const withoutProtocol = emittedItems(artifact, [{ itemIndex: 1, status: "REJECTED", finalWording: null }])
    const presentation = presentationOf(artifact, withoutProtocol)!
    expect(presentation.narrativeResolution!.violations.narrative).toEqual(["ITEMS_CHANGED"])
    expect(narrativeText(presentation.narrative!)).not.toContain("protocolo não foi informado")
  })
})

describe("Feedback por Flag V2 — detalhes determinísticos (A–J)", () => {
  const view = (): FeedbackView => feedbackViewOf(goldenItems(), resolvePresentation(null, goldenItems(), CONTEXT))!
  it("A–E, H, J) cada ajuste: o que aconteceu, a fala, o que ajustar, a regra oficial, o documento e a seção, e como aplicar contextual; o que manter com evidências", () => {
    // Recapitulação PARCIAL só pelo protocolo + protocolo não informado → UM bloco (apresentação); os itens seguem separados.
    const developments = view().developments
    expect(developments).toHaveLength(1)
    const closing = developments[0]!
    expect(closing).toMatchObject({ title: "Encerramento da chamada", consolidates: ["Protocolo", "Recapitulação obrigatória"] })
    expect(closing.itemIndexes.sort()).toEqual([0, 1])
    // Feedback Experience V2 — com a ausência verificada nos detalhes, o texto do que aconteceu não é repetido.
    expect(closing.adjustment).toEqual([])
    // O processo orienta: a regra do protocolo e a lista da recapitulação (com o protocolo), cada uma com a sua seção.
    expect(closing.guidance.rules.map((rule) => rule.text)).toEqual(expect.arrayContaining([expect.stringMatching(/Forneci protocolo\?/), expect.stringMatching(/^Antes de encerrar, informar:[\s\S]*- Protocolo\.$/)]))
    expect(closing.sources.map((source) => source.section)).toEqual(expect.arrayContaining(["Checklist do operador", "Recapitulação obrigatória"]))
    // Como melhorar: a orientação do protocolo + onde mais ele deveria aparecer (sem repetir a mesma orientação duas vezes).
    expect(closing.howToApply).toMatch(/Inclua também o número do protocolo na recapitulação final\.$/)
    expect(closing.howToApply!.match(/protocolo/g)!.length).toBeLessThanOrEqual(3)
    // Exemplos OFICIAIS da base (só rotulados como exemplo do procedimento; o número dele nunca vira o protocolo desta chamada).
    expect(closing.guidance.examples).toEqual([expect.stringMatching(/^Seu protocolo é 202609130184/), expect.stringMatching(/^Recapitulando: contestamos/)])
    expect(closing.suggestedResponse).toBeNull()
    const maintain = view().maintain!
    // Feedback Experience V2 — nos detalhes, "O que manter" são as evidências (a narrativa já reconheceu; sem resumo repetido).
    expect(maintain.summary).toBe("")
    expect(maintain.evidence.find((entry) => entry.title === "Verificação do pagamento")).toMatchObject({ quotes: [{ intro: "Você perguntou", text: "Entendi. E essa fatura de setembro, você já pagou?" }] })
    expect(view().materials).toEqual([expect.objectContaining({ title: "Procedimento Operacional — Contestação de Contas Móvel", href: "/materiais/c8f2c818-72db-48dc-8d7d-d8a9fe861c65", sections: expect.arrayContaining(["Recapitulação obrigatória", "Checklist do operador"]) })])
  })

  it("F/G) link do material só para quem pode abrir; sem acesso → sem link (nunca link quebrado)", () => {
    const open = withMaterialAccess(view(), new Set(["c8f2c818-72db-48dc-8d7d-d8a9fe861c65"]), (id) => `/materiais/${id}`)
    expect(open.materials[0]).toMatchObject({ accessible: true, href: "/materiais/c8f2c818-72db-48dc-8d7d-d8a9fe861c65" })
    const closed = withMaterialAccess(view(), new Set(), (id) => `/materiais/${id}`)
    expect(closed.materials[0]).toMatchObject({ accessible: false, href: null })
    expect(closed.developments.every((detail) => detail.sources.every((source) => source.href === null && source.accessible === false))).toBe(true)
  })

  it("I) fonte que acrescenta uma dimensão ao ponto aparece como outra regra/fonte do mesmo ajuste", () => {
    const gap = item("OPPORTUNITY", "INFORM_DEADLINE", { whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." })
    gap.process!.behavior!.sources = [{ checkpointRef: "CP-x", role: "SUPPORTING", status: "NOT_FOLLOWED", applicability: "VERIFIED", documentId: "99999999-2222-4333-8444-555555555555", documentTitle: "Jeito de Atender", heading: "20. Encerramento", quote: "(3) explique o próximo passo e o prazo", leadIn: null, href: "/materiais/99999999-2222-4333-8444-555555555555", facets: ["NEXT_STEP"], addsFacets: ["NEXT_STEP"] }]
    const detail = feedbackViewOf([gap], resolvePresentation(null, [gap], CONTEXT))!.developments[0]!
    expect(detail.sources.map((source) => source.documentTitle)).toEqual(["Procedimento de Contestação", "Jeito de Atender"])
    expect(detail.guidance.rules.map((rule) => rule.text)).toContain("(3) explique o próximo passo e o prazo")
  })

  it("nada técnico chega ao colaborador (view model inteiro)", () => {
    expect(JSON.stringify(view())).not.toMatch(TECHNICAL)
    expect(JSON.stringify(view())).not.toMatch(/Ponto forte|Ponto de desenvolvimento|“Etapa \d/)
  })
})

describe("Feedback por Flag V2 — não regressão do golden (SMOKE-V173-CONTESTACAO-001)", () => {
  it("o diagnóstico é o mesmo byte a byte: apresentar nunca muda artefato, itens, status, completude, refs, readiness ou disposição", () => {
    const artifact = clone(GOLDEN)
    const frozen = JSON.stringify(artifact)
    const output = nodeOutputOf("a", artifact, [])
    feedbackViewOf(output.items, output.presentation)
    renderPublishedNarrative(output.items, [], { presentation: output.presentation ?? null })
    expect(JSON.stringify(artifact)).toBe(frozen)
    expect(output.disposition).toBe("READY")
    expect(output.items.map((entry) => [entry.section, entry.process?.behavior?.code, entry.process?.status, entry.process?.checkpointRef, entry.process?.completeness?.status ?? null, entry.process?.analyticReadiness?.status, entry.process?.evidenceType])).toEqual(
      GOLDEN.items.map((entry) => [entry.section, entry.process?.behavior?.code, entry.process?.status, entry.process?.checkpointRef, entry.process?.completeness?.status ?? null, entry.process?.analyticReadiness?.status, entry.process?.evidenceType]),
    )
    expect(GOLDEN.items.every((entry) => entry.decision.disposition === "READY")).toBe(true)
    expect(output.findings).toMatchObject({ reliable: 10, inFeedback: 10, heldForQa: 0, blocked: 0 })
  })

  it("ANTES = o texto publicado de verdade (composição V1.7.2 reproduzida byte a byte); DEPOIS = narrativa + 'Entenda este feedback'", () => {
    const artifact = clone(GOLDEN)
    const items = emittedItems(artifact, [])
    const before = renderPublishedNarrative(items, [], { presentation: presentationOf(artifact, items, { supervisorV172: true }) })
    expect(before).toBe(LEGACY_TEXT)
    const after = nodeOutputOf("a", artifact, []).text
    expect(after.indexOf("Larissa, você conduziu bem")).toBeLessThan(after.indexOf("**Entenda este feedback**"))
    expect(after).toContain("## O que precisa ser ajustado")
    expect(after).not.toContain("O principal ajuste está em “Recapitulação obrigatória”")
    expect(after).not.toContain("No geral, a tratativa foi bem conduzida")
  })
})

describe("Feedback por Flag V2 — redator da narrativa (SUPERVISOR_FEEDBACK_NARRATIVE)", () => {
  it("payload sem nome, id, link nem índice; rota fixa do piloto; resposta válida → rascunho; inválida → sem rascunho (nunca lança)", async () => {
    const brief = narrativeBriefOf(goldenItems(), LABEL)
    const payload = JSON.stringify(projectCompositionBriefForModel(brief))
    expect(payload).not.toMatch(/Larissa|[0-9a-f]{8}-[0-9a-f]{4}-|\/materiais\/|itemIndexes|itemsKey|mention/)
    const requests: GatewayRequest[] = []
    // FEEDBACK EXPERIENCE V2 — composição V7: a disposição e as falas de cada ponto vão ao redator; ele devolve frases com vínculo + card curto.
    expect(JSON.parse(payload)).toMatchObject({ disposition: "MIXED", adjustments: expect.arrayContaining([expect.objectContaining({ quotes: expect.arrayContaining([expect.stringMatching(/^Operador: /)]) })]) })
    const ok = await writeSupervisorNarrative(async (request) => { requests.push(request); return { kind: "text", text: JSON.stringify({ sentences: [{ paragraph: 1, text: "Você validou o titular.", stance: "STRENGTH", refs: ["S1"] }, { paragraph: 2, text: "Faltou informar o protocolo.", stance: "ADJUSTMENT", refs: ["A1"] }], card: { text: "Informe o protocolo antes de encerrar.", refs: ["A1"] } }), model: "gemini-3.1-flash-lite" } as GatewayResponse }, brief)
    expect(ok).toMatchObject({ draft: { paragraphs: ["Você validou o titular.", "Faltou informar o protocolo."], card: "Informe o protocolo antes de encerrar.", cardRefs: ["A1"] }, error: null })
    const withoutCard = await writeSupervisorNarrative(async () => ({ kind: "text", text: JSON.stringify({ sentences: [{ paragraph: 1, text: "Faltou informar o protocolo.", stance: "ADJUSTMENT", refs: ["A1"] }] }) }) as GatewayResponse, brief)
    expect(withoutCard).toMatchObject({ draft: null, error: "NARRATIVE_SCHEMA_INVALID" })
    expect(requests[0]).toMatchObject({ structuredOutput: true, transport: { retries: 0 }, classification: { purpose: "FEEDBACK_WRITING", tags: ["stage:SUPERVISOR_NARRATIVE"] }, route: { profile: { model: "gemini-3.1-flash-lite" } } })
    expect(requests[0]!.systemPrompt).toBe(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[SUPERVISOR_NARRATIVE_PROMPT_VERSION])
    const bad = await writeSupervisorNarrative(async () => ({ kind: "text", text: "{ quebrado" }) as GatewayResponse, brief)
    expect(bad).toMatchObject({ draft: null, error: "NARRATIVE_MALFORMED_JSON" })
    const down = await writeSupervisorNarrative(async () => { throw new Error("timeout") }, brief)
    expect(down).toMatchObject({ draft: null, error: expect.stringMatching(/^NARRATIVE_TRANSPORT_ERROR/) })
  })

  it("prompts congelados (V1–V7 intactos; V8 = o atual — mudou um byte → nova versão)", () => {
    for (const version of SUPERVISOR_NARRATIVE_PROMPT_VERSIONS) {
      const frozen = JSON.parse(readFileSync(join(import.meta.dirname, "..", "domain", supervisorNarrativeFreezeFile(version)), "utf8")) as Record<string, unknown>
      expect(frozen).toMatchObject({ ...supervisorNarrativeFingerprint(version), systemPrompt: SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[version] })
    }
    expect(SUPERVISOR_NARRATIVE_PROMPT_VERSION).toBe("SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V8")
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[SUPERVISOR_NARRATIVE_PROMPT_VERSION]).toContain("A PARÁFRASE PODE ABSTRAIR, NUNCA ESPECIFICAR MAIS")
    // V6 (congelado) — sem card; V7 — o card curto volta (com refs), o tom vem da disposição e nada de elogio para equilibrar.
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V6).not.toContain("\"card\"")
    const current = SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[SUPERVISOR_NARRATIVE_PROMPT_VERSION]
    expect(current).toContain("NÃO foi feito como o procedimento pede")
    expect(current).toContain("DEVELOPMENT: vá direto ao ponto")
    expect(current).toContain("\"card\": UMA frase curta")
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V4).toContain("nunca liste rótulos de checklist")
    // V1.7.4 — efeito/valor atribuído à conduta é proibido explicitamente (V4); a composição V5 mantém a proibição.
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V4).toContain("Nunca atribua utilidade, eficiência, benefício ou efeito à conduta")
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V5).toContain("responsável pela COMPOSIÇÃO do feedback, não por descobrir novos fatos")
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[SUPERVISOR_NARRATIVE_PROMPT_VERSION]).toContain("Sua tarefa é COMUNICAR isso bem. Fatos são fixos; a forma de dizer é livre.")
  })

  it("payload V2: o que faltou vai como comportamento e o ajuste coberto aponta para o mesmo ponto (nunca rótulo de checklist)", () => {
    const payload = projectNarrativeBriefForModel(narrativeBriefOf(goldenItems(), LABEL))
    const recap = payload.toAdjust.find((gap) => gap.topic === "a recapitulação final")!
    expect(recap).toMatchObject({ whatHappened: "a recapitulação final não incluiu o número do protocolo", missingPoints: [], sameAsAdjustment: "o protocolo" })
    expect(JSON.stringify(payload)).not.toMatch(/conta ajustada|valor a pagar/i)
  })
})
