import { describe, expect, it } from "vitest"
import type { AssessedCriterion, VerifiedCallAnalysis } from "./call-analysis.js"
import { buildMonitoringBrief, rulesFromSources, type SourceLineMeta } from "./feedback-brief.js"
import { feedbackViewOf } from "./feedback-view.js"
import { usefulnessOf } from "./composition.js"
import { compositionPayloadOf } from "./composition-prompt.js"

/**
 * Titularidade (06/10/2026), zero IA. A obrigação junta linhas de várias fontes (lista da base, orientação do argumentário, item "evitar")
 * e o retorno saiu com:
 *   - o item "evitar" do argumentário ("Ler para o cliente a lista de documentos da outra parte") em "O processo orienta";
 *   - um ponto "Caminho do atendimento" que juntava cinco condutas diferentes — o redator comunicou duas, e a recapitulação e o contato
 *     anterior sumiram (e eram marcados como entregues);
 *   - títulos com o texto cru da regra ("informe o número do protocolo", "…contado em…").
 */
const KB = "kb-tt"
const ARG = "arg-tt"
const RESPECT = "arg-respeito"
const meta = (documentId: string, documentTitle: string, heading: string | null, overrides: Partial<SourceLineMeta> = {}): SourceLineMeta => ({ documentId, documentTitle, heading, source: documentId === KB ? "KNOWLEDGE_DOCUMENT" : "ARGUMENT_SCRIPT", avoid: false, leadIn: null, condition: null, ...overrides })
const SOURCE_LINES = new Map<string, SourceLineMeta>([
  ["kb-18-open", meta(KB, "Troca de Titularidade entre Empresas", "18. Documentos da empresa cessionária")],
  ["kb-18-aceite", meta(KB, "Troca de Titularidade entre Empresas", "18. Documentos da empresa cessionária", { leadIn: "Poderão ser solicitados:" })],
  ["ag-guidance", meta(ARG, "Troca de titularidade entre empresas", "Orientação ao operador")],
  ["ag-point", meta(ARG, "Troca de titularidade entre empresas", "Pontos obrigatórios na fala")],
  ["ag-avoid-list", meta(ARG, "Troca de titularidade entre empresas", "Condutas ou promessas a evitar", { avoid: true })],
  ["rs-language", meta(RESPECT, "Respeito e acolhimento observáveis na fala", "Pontos obrigatórios na fala")],
  ["ag-avoid-impatience", meta(ARG, "Troca de titularidade entre empresas", "Condutas ou promessas a evitar", { avoid: true })],
  ["rs-welcome", meta(RESPECT, "Respeito e acolhimento observáveis na fala", "Pontos obrigatórios na fala", { condition: "Quando o cliente relatar uma dificuldade." })],
  ["kb-64-open", meta(KB, "Troca de Titularidade entre Empresas", "64. Recapitulação obrigatória")],
  ["kb-64-protocol", meta(KB, "Troca de Titularidade entre Empresas", "64. Recapitulação obrigatória")],
])
const source = (lineKey: string, text: string) => ({ handle: lineKey, lineKey, text, heading: SOURCE_LINES.get(lineKey)!.heading })
const quote = (turn: string, text: string) => ({ turn, speaker: "OPERADOR", quote: text, timestamp: null })
const criterion = (overrides: Partial<AssessedCriterion>): AssessedCriterion => ({
  lineHandle: "O1", lineKey: "k", documentId: ARG, documentHandle: "G1", sectionHandle: "S1", heading: null, text: "x", leadIn: null, onPath: true, origin: "ANALYSIS",
  declaredStatus: "NOT_MET", proposedStatus: "NOT_MET", status: "NOT_MET", confirmation: "CONFIRMED", confirmationReasons: [], review: null, evidenceKind: "CONDUCT_OBSERVED",
  declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: null, materiality: "HIGH", guidance: null, whyItMatters: null, ruleConflict: false,
  downgrades: [], contract: "OBLIGATIONS_V1", ...overrides,
}) as AssessedCriterion

const LIST = criterion({ lineKey: "ag-guidance#1", documentId: ARG, heading: "Orientação ao operador", text: "…", scenarioRole: "CENTRAL", evidence: [quote("T17", "O senhor vai mandar: … o termo de transferência, a carta de autorização…"), quote("T21", "Não, senhor, não precisa. Eu já li a lista inteira pro senhor.")], sources: [source("kb-18-open", "Poderão ser solicitados:"), source("kb-18-aceite", "- Termo de aceite;"), source("ag-guidance", "Antes de informar os documentos, identificar a parte e informar a lista dessa parte."), source("ag-point", "Informar os documentos da empresa que o cliente representa"), source("ag-avoid-list", "Ler para o cliente a lista de documentos da outra parte da troca.")] })
const LANGUAGE = criterion({ lineHandle: "O2", lineKey: "rs-language#1", documentId: RESPECT, heading: "Pontos obrigatórios na fala", scenarioRole: "SUPPORTING", evidence: [quote("T19", "Se o senhor mandar diferente vai travar de novo.")], sources: [source("rs-language", "Empregar linguagem respeitosa e objetiva."), source("ag-avoid-impatience", "Demonstrar impaciência, levantar o tom ou culpar o cliente.")] })
const WELCOME = criterion({ lineHandle: "O3", lineKey: "rs-welcome", documentId: RESPECT, heading: "Pontos obrigatórios na fala", evidence: [quote("T23", "Eu entendi, senhor, mas eu já expliquei.")], sources: [source("rs-welcome", "Responder à dificuldade relatada com acolhimento verbal pertinente.")] })
const RECAP = criterion({ lineHandle: "O4", lineKey: "kb-64-open#1", documentId: KB, heading: "64. Recapitulação obrigatória", materiality: "MEDIUM", scenarioRole: "SUPPORTING", evidenceKind: "OMISSION", evidence: [], sources: [source("kb-64-open", "Antes de encerrar, resumir:"), source("kb-64-protocol", "- Protocolo.")] })

const analysis = (criteria: AssessedCriterion[]): VerifiedCallAnalysis => ({
  transcriptStatus: "COMPLETE",
  scenario: { customerNeed: "Lista de documentos da cessionária", conditions: [], procedureDocumentId: KB, procedureTitle: "Troca de Titularidade entre Empresas", procedureVersion: 2, rulePerspective: "RULE_IN_FORCE_AT_CALL", correctPath: "", pathTaken: "…", pathAssessment: "INCORRECT", pathEvidence: [], pathRationale: "…" },
  criteria,
  limitations: [],
  coverage: { status: "COMPLETE" },
}) as unknown as VerifiedCallAnalysis

const briefInput = (criteria: AssessedCriterion[]) => ({ analysis: analysis(criteria), interactionId: "i", label: "Troca de titularidade", dateLabel: "06/10/2026", selectionReason: "nota da URA 1", criterionKeys: new Map(criteria.map((entry, index) => [entry.lineKey, `KC-00000000000${index}`])), documentTitles: new Map([[KB, "Troca de Titularidade entre Empresas"]]), documentVersions: new Map<string, number>(), history: new Map(), delivered: new Set<string>(), sourceLines: SOURCE_LINES })
const briefOf = (criteria: AssessedCriterion[], extra: { sourceLines?: boolean; lineTitles?: Map<string, string> } = {}) => buildMonitoringBrief({
  analysis: analysis(criteria),
  interactionId: "i",
  label: "Troca de titularidade",
  dateLabel: "06/10/2026",
  selectionReason: "nota da URA 1",
  criterionKeys: new Map(criteria.map((entry, index) => [entry.lineKey, `KC-00000000000${index}`])),
  documentTitles: new Map([[KB, "Troca de Titularidade entre Empresas"]]),
  documentVersions: new Map(),
  history: new Map(),
  delivered: new Set(),
  ...(extra.sourceLines === false ? {} : { sourceLines: SOURCE_LINES }),
  ...(extra.lineTitles ? { lineTitles: extra.lineTitles } : {}),
})

describe("RULE_SOURCES_V1 — uma regra por origem; o item \"evitar\" nunca é orientação", () => {
  it("separa as fontes por documento/seção, marca o \"evitar\" e põe a linha principal primeiro", () => {
    const rules = rulesFromSources({ sources: LIST.sources!, primary: { documentId: ARG, heading: "Orientação ao operador" }, sourceLines: SOURCE_LINES })!
    expect(rules.map((rule) => [rule.section, rule.avoid ?? false])).toEqual([
      ["Orientação ao operador", false],
      ["Documentos da empresa cessionária", false],
      ["Pontos obrigatórios na fala", false],
      ["Condutas ou promessas a evitar", true],
    ])
    expect(rules[1]).toMatchObject({ text: "Poderão ser solicitados:\n- Termo de aceite;", leadIn: null, documentTitle: "Troca de Titularidade entre Empresas" })
    expect(rules[0]).toMatchObject({ sourceKind: "ARGUMENT_SCRIPT", argumentName: "Troca de titularidade entre empresas", documentTitle: "Argumentário: Troca de titularidade entre empresas" })
  })

  it("origem desconhecida de qualquer linha = regra única (nunca mistura origem conhecida com palpite)", () => {
    expect(rulesFromSources({ sources: [...LIST.sources!, source("kb-18-open", "x")].map((entry, index) => (index === 0 ? { ...entry, lineKey: "desconhecida" } : entry)), primary: { documentId: ARG, heading: null }, sourceLines: SOURCE_LINES })).toBeNull()
  })

  it("condição do item vira \"Condição: …\" (nunca \"somente quando Quando…\")", () => {
    const [rule] = rulesFromSources({ sources: WELCOME.sources!, primary: { documentId: RESPECT, heading: "Pontos obrigatórios na fala" }, sourceLines: SOURCE_LINES })!
    expect(rule!.leadIn).toBe("Condição: Quando o cliente relatar uma dificuldade.")
  })

  it("nos detalhes: o \"evitar\" sai de \"O processo orienta\" e vai para \"pede evitar\"; regra de argumentário tem o rótulo dele", () => {
    const brief = briefOf([LIST])
    const view = feedbackViewOf(brief, { card: "", paragraphs: [], sentences: [], communicatedRefs: ["A1"] })
    const detail = view.developments[0]!
    expect(detail.guidance.rules.map((rule) => rule.text).join(" ")).not.toContain("Ler para o cliente a lista de documentos da outra parte")
    expect(detail.guidance.avoid).toEqual(["Ler para o cliente a lista de documentos da outra parte da troca."])
    expect(detail.guidance.rules[0]!.label).toBe("Argumentário “Troca de titularidade entre empresas”")
    expect(detail.sources).toEqual([expect.objectContaining({ documentId: KB, section: "Documentos da empresa cessionária" })])
  })

  it("o redator vê o \"evitar\" marcado como o que NÃO fazer", () => {
    const facts = compositionPayloadOf(briefOf([LIST])).facts.developments[0] as { rule: string[] }
    expect(facts.rule.find((text) => text.includes("Ler para o cliente"))).toMatch(/^\[evitar — a operação pede para NÃO fazer isto\]/)
  })

  it("sem a origem das linhas (análise antiga sem contexto), continua a regra única", () => {
    expect(briefOf([LIST], { sourceLines: false }).developments[0]!.rules).toHaveLength(1)
  })
})

describe("cada conduta é um ponto — o caminho sem evidência própria não engole as etapas", () => {
  it("contrato de obrigações (caminho sem falas próprias): sem \"Caminho do atendimento\"; lista, respeito e recapitulação separados", () => {
    const brief = briefOf([LIST, LANGUAGE, WELCOME, RECAP], { lineTitles: new Map([["ag-guidance", "Documentação conforme a empresa representada"], ["rs-language", "Tratamento com educação e respeito"], ["rs-welcome", "Acolhimento da dificuldade do cliente"], ["kb-64-open", "Recapitulação das informações antes do encerramento"]]) })
    expect(brief.developments.map((finding) => finding.title)).toEqual(["Documentação conforme a empresa representada", "Respeito e acolhimento observáveis na fala", "Recapitulação das informações antes do encerramento"])
    expect(brief.developments.some((finding) => finding.origin === "PATH")).toBe(false)
    // Duas etapas do mesmo argumentário viram um ponto com o nome dele — e cada etapa aparece nos detalhes com a própria prova.
    expect(brief.developments[1]!.steps?.map((step) => step.title)).toEqual(["Tratamento com educação e respeito", "Acolhimento da dificuldade do cliente"])
    const view = feedbackViewOf(brief, { card: "", paragraphs: [], sentences: [], communicatedRefs: ["A1", "A2", "A3"] })
    expect(view.developments.map((detail) => [detail.title, detail.call.kind])).toEqual([
      ["Documentação conforme a empresa representada", "QUOTES"],
      ["Tratamento com educação e respeito", "QUOTES"],
      ["Acolhimento da dificuldade do cliente", "QUOTES"],
      ["Recapitulação das informações antes do encerramento", "ABSENCE"],
    ])
    expect(view.developments[1]!.guidance.avoid).toEqual(["Demonstrar impaciência, levantar o tom ou culpar o cliente."])
    expect(view.developments[2]!.call).toMatchObject({ kind: "QUOTES", quotes: [expect.objectContaining({ text: "Eu entendi, senhor, mas eu já expliquei." })] })
  })

  it("caminho com evidência própria continua sendo o ponto principal (contrato anterior)", () => {
    const withPath = { ...analysis([LIST]), scenario: { ...analysis([LIST]).scenario, pathEvidence: [quote("T17", "O senhor vai mandar…")] } } as unknown as VerifiedCallAnalysis
    const brief = buildMonitoringBrief({ analysis: withPath, interactionId: "i", label: "Troca", dateLabel: "06/10/2026", selectionReason: "x", criterionKeys: new Map(), documentTitles: new Map(), documentVersions: new Map(), history: new Map(), delivered: new Set() })
    expect(brief.developments[0]!.origin).toBe("PATH")
  })
})

describe("ALL_DEVELOPMENTS_V1 — ponto de desenvolvimento não comunicado é lacuna (pede a reescrita, nunca bloqueia)", () => {
  it("monitoria: a recapitulação que nenhuma frase menciona é lacuna; indicador não tem essa exigência", () => {
    const brief = briefOf([LIST, RECAP])
    const kept = [{ stance: "ADJUSTMENT" as const, refs: ["A1"], verdict: { id: "F1", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null } }]
    expect(usefulnessOf(brief, kept).missingDevelopment).toEqual(["A2"])
    expect(usefulnessOf({ ...brief, domain: "INDICATOR" }, kept).missingDevelopment).toBeUndefined()
  })
})

describe("ADJUSTMENT_IN_CALL_V1 e OFFICIAL_PHRASING_V1 (titularidade, 2ª rodada)", () => {
  it("ponto dito só como orientação para a próxima vez é lacuna: falta o que aconteceu nesta chamada", () => {
    const brief = briefOf([LIST, RECAP])
    const verdict = { id: "F", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null }
    const kept = [{ stance: "ADJUSTMENT" as const, refs: ["A1"], verdict }, { stance: "GUIDANCE" as const, refs: ["A2"], verdict }]
    expect(usefulnessOf(brief, kept).missingAdjustment).toEqual(["A2"])
    expect(usefulnessOf(brief, [...kept, { stance: "ADJUSTMENT" as const, refs: ["A2"], verdict }]).missingAdjustment).toBeUndefined()
  })

  it("os detalhes mostram a fraseologia OFICIAL do argumentário, identificada como tal e como está — com lacuna também (`LITERAL_QUOTES_V1`)", () => {
    const phrasing = { name: "Troca de titularidade entre empresas", text: "Como a sua empresa é a que vai receber, os documentos são: comprovante do CNPJ, contrato social, termo de aceite." }
    const brief = buildMonitoringBrief({ ...briefInput([LIST]), argumentPhrasings: new Map([[ARG, phrasing]]) })
    const detail = feedbackViewOf(brief, { card: "", paragraphs: [], sentences: [], communicatedRefs: ["A1"] }).developments[0]!
    expect(detail.suggestedResponse).toBe(phrasing.text)
    expect(detail.suggestedResponseSource).toEqual({ kind: "ARGUMENT_SCRIPT", name: phrasing.name })
    const gapped = buildMonitoringBrief({ ...briefInput([LIST]), argumentPhrasings: new Map([[ARG, { ...phrasing, text: "Os documentos da [empresa] são…" }]]) })
    expect(feedbackViewOf(gapped, { card: "", paragraphs: [], sentences: [], communicatedRefs: ["A1"] }).developments[0]!).toMatchObject({ suggestedResponse: "Os documentos da [empresa] são…", suggestedResponseSource: { kind: "ARGUMENT_SCRIPT", name: phrasing.name } })
  })
})
