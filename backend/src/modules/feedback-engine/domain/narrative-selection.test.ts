import { describe, expect, it } from "vitest"

import type { BriefFinding, FeedbackBrief } from "./feedback-brief.js"
import { contentLeaksOf } from "./composition.js"
import { compositionPayloadOf } from "./composition-prompt.js"
import { feedbackViewOf, viewMaterialsOf } from "./feedback-view.js"
import { bySeverity, limitNarrativeFailures, mergeMonitoringBriefs, NARRATIVE_FAILURES_LIMIT } from "./narrative-selection.js"
import { callAnalysisRefsOf, CALL_ANALYSIS_NODE_OUTPUT_KIND } from "./node-output.js"

const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "MEDIUM", status: "NOT_MET", observed: "Esta etapa não foi cumprida nesta chamada.", reading: "leitura do modelo", quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
const rule = (documentId: string, section: string, text: string) => ({ text, section, documentId, documentTitle: `Base ${documentId}` })
const quote = (turn: string, text: string) => ({ speaker: "OPERATOR" as const, text, turn })

const briefOf = (developments: BriefFinding[], extra: Partial<FeedbackBrief> = {}): FeedbackBrief => ({
  version: "FEEDBACK_COMPOSITION_V37", domain: "MONITORING", label: "Cancelamento", heading: { title: "Cancelamento", subtitle: null }, context: ["Sinal que selecionou a chamada: cancelamento"], readerNotes: [],
  developments: developments.map((point, index) => ({ ...point, ref: `A${index + 1}` })), strengths: [], limitations: [], materials: [], officialLines: [], indicatorName: null, tone: "DEVELOPMENT", suppressed: [], ...extra,
}) as FeedbackBrief

// Sete falhas de três especialistas (retenção, faturamento, qualidade) — o caso do pedido: 10 especialistas, 7 erros, 3 no texto.
const caminho = finding({ findingKey: "CALL:i:PATH:ret", origin: "PATH", status: "PATH_INCORRECT", title: "Caminho do atendimento", materiality: "HIGH", quotes: [quote("T12", "Vou cancelar agora.")], criterionKeys: ["KC-ret-1"], rules: [rule("ret", "Retenção", "Oferecer retenção antes do cancelamento.")] })
const ofertaAlta = finding({ findingKey: "CALL:i:KC-ret-2", title: "Oferta de retenção", materiality: "HIGH", quotes: [quote("T10", "Não tenho nada para oferecer.")], criterionKeys: ["KC-ret-2"], rules: [rule("ret", "Retenção", "Apresentar a oferta vigente.")] })
const reincidente = finding({ findingKey: "CALL:i:KC-fat-1", title: "Protocolo", materiality: "MEDIUM", absence: { opportunity: null }, criterionKeys: ["KC-fat-1"], firmness: { level: "INSIST", basis: [] }, rules: [rule("fat", "Contestação", "Informar o protocolo.")] })
const cedo = finding({ findingKey: "CALL:i:KC-q-1", title: "Saudação", materiality: "MEDIUM", quotes: [quote("T1", "Fala.")], criterionKeys: ["KC-q-1"], rules: [rule("q", "Abertura", "Saudar o cliente.")] })
const tarde = finding({ findingKey: "CALL:i:KC-q-2", title: "Encerramento", materiality: "MEDIUM", quotes: [quote("T30", "Tchau.")], criterionKeys: ["KC-q-2"], rules: [rule("q", "Encerramento", "Perguntar se há algo mais.")] })
const fatura = finding({ findingKey: "CALL:i:KC-fat-2", title: "Valor contestado", materiality: "MEDIUM", quotes: [quote("T8", "Isso é com o financeiro.")], criterionKeys: ["KC-fat-2"], rules: [rule("fat", "Contestação", "Registrar o valor contestado.")] })
const espera = finding({ findingKey: "CALL:i:KC-q-3", title: "Espera", materiality: "MEDIUM", quotes: [quote("T15", "Aguarde.")], criterionKeys: ["KC-q-3"], rules: [rule("q", "Espera", "Informar o motivo da espera.")] })

describe("NARRATIVE_TOP_FAILURES_V1 — o texto fala das 3 falhas mais graves", () => {
  it("gravidade: caminho errado, depois materialidade alta, depois reincidência, depois a ordem na chamada", () => {
    expect(bySeverity([tarde, cedo, reincidente, ofertaAlta, caminho]).map((point) => point.title)).toEqual(["Caminho do atendimento", "Oferta de retenção", "Protocolo", "Saudação", "Encerramento"])
  })

  it("7 falhas: 3 no texto (A1–A3), 4 só nos cards (A4–A7); o redator recebe só as 3", () => {
    const brief = limitNarrativeFailures(briefOf([tarde, cedo, fatura, espera, reincidente, ofertaAlta, caminho]))
    expect(NARRATIVE_FAILURES_LIMIT).toBe(3)
    expect(brief.developments.map((point) => [point.ref, point.title])).toEqual([["A1", "Caminho do atendimento"], ["A2", "Oferta de retenção"], ["A3", "Protocolo"]])
    expect(brief.additionalDevelopments?.map((point) => [point.ref, point.title])).toEqual([["A4", "Saudação"], ["A5", "Valor contestado"], ["A6", "Espera"], ["A7", "Encerramento"]])
    const writer = JSON.stringify(compositionPayloadOf(brief))
    expect(writer).toContain("Oferta de retenção")
    for (const hidden of ["Saudação", "Valor contestado", "Espera", "Encerramento"]) expect(writer).not.toContain(hidden)
  })

  it("até 3 falhas: nada muda (sem cards extras); indicador nunca é cortado", () => {
    expect(limitNarrativeFailures(briefOf([cedo, tarde])).additionalDevelopments).toBeUndefined()
    const indicator = { ...briefOf([cedo, tarde, fatura, espera]), domain: "INDICATOR" as const }
    expect(limitNarrativeFailures(indicator).developments).toHaveLength(4)
  })

  it("cards: as 3 do texto + todas as demais (só fatos do sistema), o aviso no fim do texto e os materiais de todas", () => {
    const brief = limitNarrativeFailures(briefOf([tarde, cedo, fatura, espera, reincidente, ofertaAlta, caminho], { materials: [{ documentId: "q", documentVersion: 1, title: "Base q", sections: [], reason: "", criterionKeys: ["KC-q-2"], usedIn: ["Encerramento"] }] }))
    const view = feedbackViewOf(brief, { card: "Resumo", paragraphs: ["Texto do redator."], sentences: [], communicatedRefs: ["A1", "A2", "A3"] })
    expect(view.developments.map((card) => card.title)).toEqual(["Caminho do atendimento", "Oferta de retenção", "Protocolo", "Saudação", "Valor contestado", "Espera", "Encerramento"])
    expect(view.developments.filter((card) => card.beyondNarrative).map((card) => card.title)).toEqual(["Saudação", "Valor contestado", "Espera", "Encerramento"])
    expect(view.narrative.at(-1)).toBe("Esta chamada teve mais 4 pontos de melhoria. Você encontra os detalhes de cada um em “Entenda este feedback”, no bloco “O que precisa ser ajustado”.")
    // Card extra mostra a fala literal e a regra literal — nunca a leitura do modelo.
    const saudacao = view.developments.find((card) => card.title === "Saudação")!
    expect(saudacao.call).toEqual({ kind: "QUOTES", quotes: [expect.objectContaining({ text: "Fala." })] })
    expect(JSON.stringify(saudacao)).not.toContain("leitura do modelo")
    expect(viewMaterialsOf(brief, ["A1", "A2", "A3"]).map((material) => material.documentId)).toEqual(["q"])
    expect(contentLeaksOf({ card: "Resumo", sentences: [], view }, brief, { rejected: ["Fala."], untrusted: ["Fala."] })).toEqual([])
  })

  it("um ponto além do texto: aviso no singular; nenhum além: sem aviso", () => {
    const one = limitNarrativeFailures(briefOf([cedo, tarde, fatura, espera]))
    expect(feedbackViewOf(one, { card: "c", paragraphs: ["p"], sentences: [] }).narrative.at(-1)).toBe("Esta chamada teve mais um ponto de melhoria. Você encontra os detalhes dele em “Entenda este feedback”, no bloco “O que precisa ser ajustado”.")
    expect(feedbackViewOf(limitNarrativeFailures(briefOf([cedo])), { card: "c", paragraphs: ["p"], sentences: [] }).narrative).toEqual(["p"])
  })
})

describe("MULTI_SPECIALIST_MERGE_V1 — as análises de todos os especialistas viram um feedback só", () => {
  it("junta os ajustes de cada especialista, sem repetir o mesmo fato visto por dois, e o teto vale sobre todos", () => {
    const retencao = briefOf([caminho, ofertaAlta], { context: ["Sinal que selecionou a chamada: cancelamento", "Procedimento aplicado: Retenção"] })
    const faturamento = briefOf([reincidente, fatura], { context: ["Sinal que selecionou a chamada: cancelamento", "Procedimento aplicado: Faturamento"] })
    const qualidade = briefOf([cedo, espera, tarde, { ...ofertaAlta }], { context: ["Procedimento aplicado: Jeito de atender"] })
    const merged = limitNarrativeFailures(mergeMonitoringBriefs([retencao, faturamento, qualidade]))
    expect(merged.developments.map((point) => point.title)).toEqual(["Caminho do atendimento", "Oferta de retenção", "Protocolo"])
    expect(merged.additionalDevelopments?.map((point) => point.title)).toEqual(["Saudação", "Valor contestado", "Espera", "Encerramento"])
    expect(merged.context).toEqual(["Sinal que selecionou a chamada: cancelamento", "Procedimento aplicado: Retenção", "Procedimento aplicado: Faturamento", "Procedimento aplicado: Jeito de atender"])
  })

  it("a mesma PRÁTICA vista por dois especialistas (bases diferentes, chaves diferentes) vira um ponto com as regras e falas das duas", () => {
    // Caso real da validação paga de 21/11: a recapitulação veio da base de Retenção e da de Qualidade com a mesma prática.
    const recapRetencao = finding({ findingKey: "CALL:i:KC-cc7a", title: "Realizar recapitulação das informações antes do encerramento", materiality: "MEDIUM", criterionKeys: ["KC-cc7a"], practiceKeys: ["KP-8593"], quotes: [quote("T94", "Então fica assim.")], rules: [rule("ret", "Encerramento", "Recapitular o que foi feito.")] })
    const recapQualidade = finding({ findingKey: "CALL:i:KC-692c", title: "Realizar recapitulação das informações antes do encerramento", materiality: "HIGH", criterionKeys: ["KC-692c"], practiceKeys: ["KP-8593"], quotes: [quote("T94", "Então fica assim."), quote("T162", "Mais alguma coisa?")], rules: [rule("q", "Encerramento", "Realizar a recapitulação antes de encerrar.")], firmness: { level: "INSIST", basis: [] } })
    const merged = mergeMonitoringBriefs([briefOf([ofertaAlta, recapRetencao]), briefOf([recapQualidade, cedo])])
    const recap = merged.developments.filter((point) => point.title.startsWith("Realizar recapitulação"))
    expect(recap).toHaveLength(1)
    expect(recap[0]).toMatchObject({ findingKey: "CALL:i:KC-cc7a", materiality: "HIGH", criterionKeys: ["KC-cc7a", "KC-692c"], memberFindingKeys: ["CALL:i:KC-692c"], firmness: { level: "INSIST" } })
    expect(recap[0]!.rules.map((entry) => entry.documentId)).toEqual(["ret", "q"])
    expect(recap[0]!.quotes.map((entry) => entry.turn)).toEqual(["T94", "T162"])
    expect(merged.developments.map((point) => point.title)).toEqual(["Oferta de retenção", "Realizar recapitulação das informações antes do encerramento", "Saudação"])
  })

  it("dentro de um mesmo especialista, a mesma prática não é juntada aqui (a consolidação do brief já decidiu)", () => {
    const a = finding({ findingKey: "CALL:i:KC-a", title: "a", criterionKeys: ["KC-a"], practiceKeys: ["KP-x"] })
    const b = finding({ findingKey: "CALL:i:KC-b", title: "b", criterionKeys: ["KC-b"], practiceKeys: ["KP-x"] })
    expect(mergeMonitoringBriefs([briefOf([a, b]), briefOf([cedo])]).developments.map((point) => point.title)).toEqual(["a", "b", "Saudação"])
  })

  it("reconhecimentos juntos respeitam o mesmo limite; pontos em aberto são renumerados", () => {
    const strength = (key: string) => finding({ findingKey: key, kind: "STRENGTH", status: "MET", title: key })
    const open = (key: string) => ({ ref: "O1", findingKey: key, title: key, nature: null, why: "w", rules: [], quotes: [] })
    const merged = mergeMonitoringBriefs([
      briefOf([cedo], { strengths: [strength("s1"), strength("s2")], openPoints: [open("o1")] }),
      briefOf([tarde], { strengths: [strength("s3"), strength("s1"), strength("s4")], openPoints: [open("o2")] }),
    ])
    expect(merged.strengths.map((point) => [point.ref, point.findingKey])).toEqual([["S1", "s1"], ["S2", "s2"], ["S3", "s3"]])
    expect(merged.openPoints?.map((point) => [point.ref, point.findingKey])).toEqual([["O1", "o1"], ["O2", "o2"]])
  })

  it("MULTI_SPECIALIST_MERGE_V2: a mesma prática como ajuste (Qualidade) e reconhecimento (Retenção) fica só como ajuste, com o conflito registrado", () => {
    const faltou = finding({ findingKey: "CALL:i:KC-q-recap", title: "Recapitulação", criterionKeys: ["KC-q-recap"], practiceKeys: ["KP-recap"], rules: [rule("q", "Encerramento", "Recapitular.")] })
    const feita = finding({ findingKey: "CALL:i:KC-ret-recap", kind: "STRENGTH", status: "MET", title: "Recapitulação feita", criterionKeys: ["KC-ret-recap"], practiceKeys: ["KP-recap"] })
    const outra = finding({ findingKey: "CALL:i:KC-ret-ok", kind: "STRENGTH", status: "MET", title: "Oferta apresentada", criterionKeys: ["KC-ret-ok"], practiceKeys: ["KP-oferta"] })
    const merged = mergeMonitoringBriefs([briefOf([faltou]), briefOf([], { strengths: [feita, outra] })])
    expect(merged.developments.map((point) => point.findingKey)).toEqual(["CALL:i:KC-q-recap"])
    expect(merged.strengths.map((point) => [point.ref, point.findingKey])).toEqual([["S1", "CALL:i:KC-ret-ok"]])
    expect(merged.mergeConflicts).toEqual([{ kind: "STRENGTH_VS_DEVELOPMENT", kept: "CALL:i:KC-q-recap", dropped: "CALL:i:KC-ret-recap", practiceKey: "KP-recap", sharedKeys: [] }])
    // O conflito é auditoria: nunca vai ao redator.
    expect(JSON.stringify(compositionPayloadOf(merged))).not.toContain("Recapitulação feita")
  })

  it("MULTI_SPECIALIST_MERGE_V2: reconhecimento que divide uma chave com um ajuste de outro especialista também sai", () => {
    const ajuste = finding({ findingKey: "CALL:i:KC-x", title: "x", criterionKeys: ["KC-x"] })
    const elogio = finding({ findingKey: "CALL:i:KC-x", kind: "STRENGTH", status: "MET", title: "x feito", criterionKeys: ["KC-x"] })
    const merged = mergeMonitoringBriefs([briefOf([ajuste]), briefOf([], { strengths: [elogio] })])
    expect(merged.strengths).toEqual([])
    expect(merged.tone).toBe("DEVELOPMENT")
    expect(merged.mergeConflicts?.[0]).toMatchObject({ kept: "CALL:i:KC-x", dropped: "CALL:i:KC-x", sharedKeys: ["CALL:i:KC-x"] })
  })

  it("MULTI_SPECIALIST_MERGE_V2: ajuste com chave PARCIALMENTE repetida é juntado ao dono e as chaves próprias dele vão junto", () => {
    const dono = finding({ findingKey: "CALL:i:KC-a", title: "a", criterionKeys: ["KC-a"], memberFindingKeys: ["CALL:i:KC-b"], quotes: [quote("T3", "Fala a.")] })
    const parcial = finding({ findingKey: "CALL:i:KC-b", title: "b", criterionKeys: ["KC-b", "KC-c"], memberFindingKeys: ["CALL:i:KC-c"], steps: [{ title: "etapa", status: "NOT_MET", quotes: [], absentInCall: true, declaredOnly: false, rule: null, findingKey: "CALL:i:KC-d" }], quotes: [quote("T9", "Fala b.")] })
    const merged = mergeMonitoringBriefs([briefOf([dono]), briefOf([parcial])])
    expect(merged.developments).toHaveLength(1)
    expect(merged.developments[0]).toMatchObject({ findingKey: "CALL:i:KC-a", criterionKeys: ["KC-a", "KC-b", "KC-c"] })
    // Todas as chaves dos dois: o que o ponto comunica fica entregue por inteiro (nada some nem volta como novo).
    expect(new Set(merged.developments[0]!.memberFindingKeys)).toEqual(new Set(["CALL:i:KC-b", "CALL:i:KC-c", "CALL:i:KC-d"]))
    expect(merged.developments[0]!.quotes.map((entry) => entry.turn)).toEqual(["T3", "T9"])
    // Totalmente repetido continua entrando uma vez só, sem juntar nada.
    expect(mergeMonitoringBriefs([briefOf([dono]), briefOf([{ ...dono }])]).developments).toEqual([expect.objectContaining({ findingKey: "CALL:i:KC-a", memberFindingKeys: ["CALL:i:KC-b"] })])
  })

  it("lê a análise de cada especialista que o Orquestrador acionou (antes só a primeira)", () => {
    const ref = (run: string) => ({ kind: CALL_ANALYSIS_NODE_OUTPUT_KIND, analysisRunId: run, callAssessmentId: null, interactionId: "i", personId: "p", agentId: `agent-${run}` })
    const orchestrated = { results: [{ agentId: "agent-a", structured: { callAnalysis: ref("a") } }, { agentId: "agent-b", structured: { callAnalysis: ref("b") } }, { agentId: "agent-a", structured: { callAnalysis: ref("a") } }, { agentId: "x", text: "sem análise" }] }
    expect(callAnalysisRefsOf(orchestrated).map((entry) => entry.analysisRunId)).toEqual(["a", "b"])
    expect(callAnalysisRefsOf(ref("solo")).map((entry) => entry.analysisRunId)).toEqual(["solo"])
    expect(callAnalysisRefsOf({ kind: "monitoring" })).toEqual([])
  })
})
