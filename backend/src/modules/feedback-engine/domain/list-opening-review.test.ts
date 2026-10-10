import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { reviewAnalysis } from "../application/analyze-call.js"
import type { EngineModelPort, EngineModelRequest } from "../application/ports.js"
import { mergeReviewedLines, verifyCallAnalysis, type ModelCallAnalysis, type ReviewInput } from "./call-analysis.js"
import { callReviewResponseSchemaFor, linesToAssessOf, MAX_LINES_TO_ASSESS, type CallReview, type ClaimVerdict, type ExclusionVerdict } from "./call-review.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { buildProcedureContext, listContextOf, listOpeningsOf } from "./procedure.js"

/**
 * ABERTURA DE LISTA NA REVISÃO (`LIST_OPENING_V1` / `CALL_REVIEW_V3`) — zero IA. Reproduz a FALHA da rodada real da C07 (01/10 à
 * tarde): a análise deu conclusões à frase que ABRE duas listas — "…avaliar:" como parcial (a operadora escolheu crédito, uma das
 * alternativas) e "Antes de encerrar, informar:" como cumprida (sem olhar os itens) —, a revisão recebeu as aberturas SEM os itens
 * (sameList vazio), respondeu NOT_A_LIST e confirmou; a mensagem saiu com "avalie estorno em vez de crédito". Procedimento e conversa
 * SINTÉTICOS no mesmo formato.
 */
const DOC = "00000000-0000-4000-8000-00000000e101"
const INTERACTION = "00000000-0000-4000-8000-00000000e1f1"
const PROCEDURE = `# Procedimento — Contestação (teste de abertura de lista)

## 1. Contestação

- Registrar a contestação;
- Informar prazo.

## 2. Conta já paga

Quando o cliente já tiver pago a cobrança contestada, avaliar:
- Crédito em conta futura;
- Estorno;
- Transferência bancária, quando prevista.

## 3. Recapitulação obrigatória

Antes de encerrar, informar:
- Valor;
- Ação realizada;
- Serviço cancelado, quando aplicável;
- Protocolo.
`
const TRANSCRIPT = [
  "Operador: Bom dia, aqui é a Ana.",
  "Cliente: Cancelei o plano em julho e continuo sendo cobrada.",
  "Operador: O pedido de cancelamento está aberto desde julho e não foi concluído.",
  "Operador: A fatura de agosto já foi paga?",
  "Cliente: Já paguei.",
  "Operador: Registrei a contestação dos R$ 59,90. A análise leva até cinco dias úteis e, se aprovada, o valor volta como crédito na próxima fatura.",
  "Operador: Resumindo: contestação dos R$ 59,90 registrada, protocolo 4455.",
  "Cliente: Obrigada.",
  "Operador: Tenha um bom dia.",
].join("\n")
const context = buildProcedureContext([{ documentId: DOC, title: "Procedimento — Contestação", version: 1, content: PROCEDURE, contentHash: "lo1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 10 }])
const projection = projectTranscript(TRANSCRIPT)
const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
const section = (heading: string) => [...context.sections.values()].find((entry) => entry.heading?.includes(heading))!.handle
const T3 = { turn: "T3", speaker: "OPERADOR", quote: "O pedido de cancelamento está aberto desde julho e não foi concluído." }
const T5 = { turn: "T5", speaker: "CLIENTE", quote: "Já paguei." }
const CREDIT = { turn: "T6", speaker: "OPERADOR", quote: "se aprovada, o valor volta como crédito na próxima fatura" }
const RECAP = { turn: "T7", speaker: "OPERADOR", quote: "Resumindo: contestação dos R$ 59,90 registrada, protocolo 4455." }

/** A análise do formato da rodada real: conclusões dadas às ABERTURAS das listas, itens sem disposição própria. */
function openingAnalysis(): ModelCallAnalysis {
  return {
    scenario: { customerNeed: "Contestar a mensalidade cobrada depois do pedido de cancelamento", conditions: [{ text: "Cancelamento pendente, não concluído", evidence: [T3] }, { text: "Fatura já paga", evidence: [T5] }], procedure: "D1", procedureRationale: null, pathSections: [section("Contestação"), section("Conta já paga"), section("Recapitulação")], correctPath: "Contestar, informar prazo, tratar a conta paga e recapitular.", pathTaken: "Contestou, deu prazo, ofereceu crédito e recapitulou.", pathAssessment: "PARTIALLY_CORRECT", pathRationale: "Faltou avaliar outras formas de devolução.", pathEvidence: [CREDIT] },
    criteria: [
      { line: line("Registrar a contestação"), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [{ turn: "T6", speaker: "OPERADOR", quote: "Registrei a contestação dos R$ 59,90." }], opportunityTurn: null, rationale: "Registrou.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL" },
      { line: line("Informar prazo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T6", speaker: "OPERADOR", quote: "A análise leva até cinco dias úteis" }], opportunityTurn: null, rationale: "Informou o prazo.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "CENTRAL" },
      { line: line("avaliar:"), status: "PARTIAL", evidenceKind: "CONDUCT_OBSERVED", evidence: [CREDIT], opportunityTurn: null, rationale: "Fixou o crédito sem avaliar estorno ou transferência.", materiality: "MEDIUM", guidance: { moment: "Quando o cliente já pagou", condition: null, action: "avalie estorno ou transferência em vez de crédito", ruleLines: [line("avaliar:")] }, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "SUPPORTING" },
      { line: line("Antes de encerrar, informar:"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [RECAP], opportunityTurn: null, rationale: "Recapitulou valor, ação e protocolo.", materiality: "MEDIUM", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "ROUTINE" },
    ],
    sectionDispositions: [],
    groupDispositions: [],
    sourceConflicts: [],
    limitations: [],
    contractViolations: [],
  }
}
const base = { context, projection, transcriptStatus: "COMPLETE" as const, interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: false }
const claim = (id: string, fields: Partial<ClaimVerdict> = {}): [string, ClaimVerdict] => [id, { id, verdict: "CONFIRMED", issues: [], listReading: "NOT_A_LIST", conditionEvidence: [], counterEvidence: [], note: null, ...fields }]
const exclusion = (id: string, fields: Partial<ExclusionVerdict>): [string, ExclusionVerdict] => [id, { id, verdict: "CHALLENGED", proposedStatus: null, itemNature: null, scenarioRole: null, issues: [], listReading: null, conditionEvidence: [], evidence: [], opportunityTurn: null, note: null, ...fields }]
function reviewOf(claims: [string, ClaimVerdict][], exclusions: [string, ExclusionVerdict][] = []): CallReview {
  return { claims: new Map(claims), path: { verdict: "CONFIRMED", issues: [], note: null }, lines: [], exclusions: new Map(exclusions), violations: [] }
}
const verified = (review: CallReview, requested?: ReviewInput["requested"]) => verifyCallAnalysis({ ...base, model: openingAnalysis(), review: { attempted: true, review, error: null, ...(requested ? { requested } : {}) } })
const criterionOf = (result: ReturnType<typeof verified>, text: string) => result.criteria.find((criterion) => criterion.text.includes(text))!
const briefOf = (result: ReturnType<typeof verified>) => buildMonitoringBrief({ analysis: result, listContext: listContextOf(context), interactionId: INTERACTION, label: "Contestação de cobrança", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(result.criteria.map((criterion) => [criterion.lineKey, `KC-${criterion.lineHandle}`])), documentTitles: new Map([[DOC, "Procedimento"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })
const ALL_ROUTINE = [claim(line("Registrar a contestação")), claim(line("Informar prazo"))]

describe("a abertura de uma lista vai à revisão com os itens da lista", () => {
  it("o mapa de aberturas acha as duas listas; a proposta leva os itens (não avaliados = NOT_ASSESSED) e os itens viram alvos próprios — uma chamada", async () => {
    const openings = listOpeningsOf(context)
    expect([...openings.values()].map((items) => items.length)).toEqual([3, 4])
    const calls: EngineModelRequest[] = []
    const model: EngineModelPort = { async generate(request) {
      calls.push(request)
      return { text: JSON.stringify({ claims: [], path: { verdict: "CONFIRMED", issues: [] } }), model: "fake", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, durationMs: 1, costUsd: 0, finishReason: "STOP" }
    } }
    await reviewAnalysis({ model }, { model: openingAnalysis(), context, projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subject: "Contestação de cobrança", anchored: [DOC] }, [])
    expect(calls.map((call) => call.stage)).toEqual(["CALL_REVIEW"])
    const payload = JSON.parse(calls[0]!.contents[0]!.text.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { claims: { id: string; attention: string[]; rule: { sameList: { text: string; proposedStatus: string }[] } }[]; exclusions?: { id: string; excludedAs: string; aggregateStatus?: string; rule: { text: string } }[]; linesToAssess?: unknown[] }
    const avaliar = payload.claims.find((entry) => entry.id === line("avaliar:"))!
    expect(avaliar.attention).toContain("LIST_OPENING")
    expect(avaliar.rule.sameList).toEqual([{ text: "- Crédito em conta futura;", proposedStatus: "NOT_ASSESSED" }, { text: "- Estorno;", proposedStatus: "NOT_ASSESSED" }, { text: "- Transferência bancária, quando prevista.", proposedStatus: "NOT_ASSESSED" }])
    const aggregated = payload.exclusions!.filter((entry) => entry.excludedAs === "AGGREGATED")
    expect(aggregated.map((entry) => [entry.rule.text, entry.aggregateStatus])).toContainEqual(["- Serviço cancelado, quando aplicável;", "MET"])
    expect(aggregated.map((entry) => [entry.rule.text, entry.aggregateStatus])).toContainEqual(["- Estorno;", "PARTIAL"])
    // Englobado não é pedido duas vezes: não vai como "linha sem disposição".
    expect(payload.linesToAssess ?? []).toEqual([])
    expect(calls[0]!.responseSchema).toEqual(callReviewResponseSchemaFor({ linesToAssess: [] }))
  })
})

describe("o que a revisão confirma sobre uma abertura", () => {
  it("FALHA REAL REPRODUZIDA: revisora confirma as aberturas lendo NOT_A_LIST → nenhuma é confirmada; 'avalie estorno em vez de crédito' não chega ao brief", () => {
    // Como na resposta real: CONFIRMED, NOT_A_LIST e a fala da condição ("Já paguei") citada.
    const result = verified(reviewOf([...ALL_ROUTINE, claim(line("avaliar:"), { conditionEvidence: [T5] }), claim(line("Antes de encerrar, informar:"))]))
    expect(criterionOf(result, "avaliar:")).toMatchObject({ proposedStatus: "PARTIAL", status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["LIST_OPENING_NOT_READ_AS_LIST"] })
    expect(criterionOf(result, "Antes de encerrar, informar:")).toMatchObject({ proposedStatus: "MET", confirmation: "UNCONFIRMED", confirmationReasons: ["LIST_OPENING_NOT_READ_AS_LIST"] })
    const brief = briefOf(result)
    expect(brief.developments).toEqual([])
    expect(JSON.stringify(brief)).not.toMatch(/estorno ou transferência em vez de crédito/)
  })

  it("lida como ALTERNATIVAS, 'parcial' da lista não existe — escolher uma opção cabível basta", () => {
    const result = verified(reviewOf([...ALL_ROUTINE, claim(line("avaliar:"), { listReading: "ALTERNATIVES", conditionEvidence: [T5] })]))
    expect(criterionOf(result, "avaliar:")).toMatchObject({ confirmation: "UNCONFIRMED", confirmationReasons: ["LIST_OPENING_ALTERNATIVES"] })
  })

  it("lida como CUMULATIVA e um item englobado é contestado com a condição que a análise registrou → o item vira o ajuste e a lista não fica como 'cumprida'", () => {
    const result = verified(reviewOf(
      [...ALL_ROUTINE, claim(line("Antes de encerrar, informar:"), { listReading: "CUMULATIVE" })],
      [exclusion(line("Serviço cancelado"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["COMMUNICATION_EXPECTED"], listReading: "CUMULATIVE", conditionEvidence: [T3], opportunityTurn: "T7", note: "A cliente disse que continua sendo cobrada; o resumo não disse o que acontece com o cancelamento." })],
    ))
    expect(criterionOf(result, "Serviço cancelado")).toMatchObject({ origin: "REVIEW_CHALLENGE", declaredStatus: "MET", status: "NOT_MET", confirmation: "CONFIRMED", confirmationReasons: ["EXCLUSION_REVERSED"], scenarioRole: "CENTRAL" })
    expect(criterionOf(result, "Antes de encerrar, informar:")).toMatchObject({ confirmation: "UNCONFIRMED", confirmationReasons: ["AGGREGATE_CONTRADICTED_BY_ITEM"] })
    const brief = briefOf(result)
    expect(brief.developments.map((finding) => finding.role)).toEqual(["CENTRAL"])
    expect(brief.developments[0]!.rules.map((rule) => rule.text)).toContainEqual(expect.stringContaining("Serviço cancelado"))
    expect(brief.strengths.map((finding) => finding.title)).not.toContain("Recapitulação obrigatória")
    // 7 itens englobados pela abertura + "Registrar a contestação" (registro no sistema só DECLARADO: não observável pela conversa
    // — vai à revisora com a leitura de onde acontece, para que ela possa mostrar se a leitura errou).
    expect(result.checks.review.exclusions).toMatchObject({ sent: 8, answered: 1, aggregated: 7, reversedConfirmed: 1 })
    expect(criterionOf(result, "Registrar a contestação")).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" })
  })

  it("o mesmo item contestado como dependente de ação interna fica em aberto — nunca acusação", () => {
    const result = verified(reviewOf(
      [...ALL_ROUTINE, claim(line("Antes de encerrar, informar:"), { listReading: "CUMULATIVE" })],
      [exclusion(line("Serviço cancelado"), { proposedStatus: "NOT_OBSERVABLE", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["DEPENDS_ON_INTERNAL_ACTION"], listReading: "CUMULATIVE", conditionEvidence: [T3] })],
    ))
    expect(criterionOf(result, "Serviço cancelado")).toMatchObject({ status: "NOT_OBSERVABLE", confirmationReasons: ["EXCLUSION_REOPENED"] })
    expect(briefOf(result).openPoints!.map((point) => point.title)).toContain("Serviço cancelado, quando aplicável")
  })
})

describe("pedido × resposta", () => {
  it("o que foi pedido e não respondido fica registrado como não revisado (nunca 'revisado'); as notas são de auditoria", () => {
    const result = verified(reviewOf([...ALL_ROUTINE]), { linesToAssess: [line("Estorno")], linesWithheld: 3, exclusions: [] })
    expect(result.checks.review.exclusions).toMatchObject({ sent: 8, answered: 0, reviewed: 0 })
    expect(result.checks.review.coverage).toEqual({ requested: 1, answered: 0, unanswered: 1, withheld: 3 })
    expect(result.auditNotes!.join(" ")).toMatch(/1 de 1 linha\(s\) pedidas à revisão ficaram sem resposta/)
    expect(result.auditNotes!.join(" ")).toMatch(/3 linha\(s\) do caminho não foram pedidas/)
    expect(result.limitations.join(" ")).not.toMatch(/revisão/)
  })

  it("com linhas pedidas, o schema exige a resposta delas", () => {
    expect((callReviewResponseSchemaFor({ linesToAssess: [{ id: "L1", rule: { section: null, leadIn: null, text: "x", conditional: false } }] }) as { required: string[] }).required).toEqual(["claims", "linesToAssess"])
  })

  it("pedido de cobertura PROPORCIONAL: teto por chamada, encerramento primeiro, depois seções com etapa decidida, na ordem do documento", () => {
    const missing = Array.from({ length: MAX_LINES_TO_ASSESS + 10 }, (_, index) => ({ handle: `L${index + 1}`, sectionHandle: index < 30 ? "S-PATH" : index < 45 ? "S-DECIDED" : "S-CLOSING" }))
    const { sent, withheld } = linesToAssessOf(missing, { closingSections: new Set(["S-CLOSING"]), decidedSections: new Set(["S-DECIDED"]) })
    expect(sent).toHaveLength(MAX_LINES_TO_ASSESS)
    expect(withheld).toHaveLength(10)
    expect(sent.filter((entry) => entry.sectionHandle === "S-CLOSING")).toHaveLength(5)
    expect(sent.filter((entry) => entry.sectionHandle === "S-DECIDED")).toHaveLength(15)
    expect(withheld.every((entry) => entry.sectionHandle === "S-PATH")).toBe(true)
    expect(linesToAssessOf(missing.slice(0, 3), { closingSections: new Set(), decidedSections: new Set() }).withheld).toEqual([])
  })
})

/**
 * FOCO COMO ENVIADO (`REVIEW_FOCUS_AS_SENT_V1`) — defeito da rodada real de 02/10 (chamada da Larissa, segunda via): a revisora
 * CONFIRMOU "enviou para e-mail informado na hora sem validação" (item de "É proibido:") com a fala; na decisão, o código recalculou
 * o foco com os itens irmãos que a PRÓPRIA revisão tinha avaliado como cumpridos na mesma resposta e derrubou o desvio como "leitura
 * da lista incerta". Zero IA.
 */
describe("a decisão usa o foco que foi enviado à revisora", () => {
  const DOC_P = "00000000-0000-4000-8000-00000000f501"
  const PROCEDURE_P = `# Envio (teste)

## 1. Forma de envio

É proibido:
- Enviar a conta para e-mail informado durante o atendimento sem validação adicional;
- Utilizar e-mail pessoal do atendente;
- Compartilhar a conta com terceiros.
`
  const CALL_P = ["Cliente: O e-mail antigo eu não uso mais, manda pro novo: ana.nova@exemplo.com.", "Operador: Certo, vou atualizar o e-mail e reenviar agora.", "Cliente: Obrigada.", "Operador: Enviado. Mais alguma coisa?", "Cliente: Não."].join("\n")
  const setupP = () => {
    const ctx = buildProcedureContext([{ documentId: DOC_P, title: "Envio", version: 1, content: PROCEDURE_P, contentHash: "p1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 1 }])
    const handle = (text: string) => [...ctx.lines.values()].find((entry) => entry.text.includes(text))!.handle
    return { ctx, handle, projection: projectTranscript(CALL_P) }
  }
  const T2 = { turn: "T2", speaker: "OPERADOR", quote: "Certo, vou atualizar o e-mail e reenviar agora." }
  const T4 = { turn: "T4", speaker: "OPERADOR", quote: "Enviado. Mais alguma coisa?" }
  const modelOf = (handle: (text: string) => string): ModelCallAnalysis => ({
    scenario: { customerNeed: "Receber a conta no e-mail novo", conditions: [], procedure: "D1", procedureRationale: null, pathSections: [], correctPath: "x", pathTaken: "y", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
    criteria: [{ line: handle("Enviar a conta para e-mail informado"), status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T2, T4], opportunityTurn: null, rationale: "Reenviou para o e-mail informado na hora, sem validação adicional.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "PROHIBITION", scenarioRole: "CENTRAL", applicability: "APPLIES", observability: "IN_CONVERSATION" }],
    sectionDispositions: [], groupDispositions: [], sourceConflicts: [], limitations: [], contractViolations: [],
  })
  const run = (siblingEvidence: { turn: string; speaker: string; quote: string }[]) => {
    const { ctx, handle, projection: proj } = setupP()
    const target = handle("Enviar a conta para e-mail informado")
    const siblings = [handle("Utilizar e-mail pessoal"), handle("Compartilhar a conta")]
    const review: CallReview = { claims: new Map([[target, { id: target, verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: "Acolheu o e-mail novo e reenviou sem validação." }]]), path: null, lines: siblings.map((id) => ({ id, status: "MET" as const, evidenceKind: siblingEvidence.length > 0 ? "CONDUCT_OBSERVED" as const : "COMPLIANCE_BY_ABSENCE" as const, evidence: siblingEvidence, opportunityTurn: null, rationale: "não aconteceu", applicability: "APPLIES" as const, observability: "IN_CONVERSATION" as const })), exclusions: new Map(), violations: [] }
    const merged = mergeReviewedLines(modelOf(handle), review.lines, siblings)
    const result = verifyCallAnalysis({ model: merged, context: ctx, projection: proj, transcriptStatus: "COMPLETE", interactionId: "00000000-0000-4000-8000-00000000f5f1", subjectAnchoredDocumentIds: [DOC_P], repairAttempted: true, review: { attempted: true, review, error: null, requested: { linesToAssess: siblings, linesWithheld: 0, exclusions: [] } } })
    return result.criteria.find((criterion) => criterion.lineHandle === target)!
  }

  it("(revisão LEGACY, sem leitura da evidência) proibição lida como violada na conversa e confirmada: continua desvio confirmado mesmo com os outros itens avaliados pela revisão como cumpridos", () => {
    expect(run([])).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
  })

  it("proteção mantida: se a MESMA fala prova um item irmão cumprido, o desvio não é confirmado sem a lista lida como cumulativa", () => {
    // V10: é COERÊNCIA da própria resposta (a revisora deu a mesma fala ao irmão cumprido), não um foco novo criado depois.
    expect(run([T2, T4])).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["REVIEW_SELF_INCONSISTENT"] })
  })

  it("pedido de cobertura: itens do argumentário que se aplica vêm antes do encerramento e do resto do caminho", () => {
    const lines = [...Array(5).keys()].map((index) => ({ handle: `L${index + 1}`, sectionHandle: index < 3 ? "S9" : "S1" }))
    const withScript = [...lines, { handle: "L90", sectionHandle: "S50", argument: { scriptId: "g" } }]
    expect(linesToAssessOf(withScript, { closingSections: new Set(["S9"]), decidedSections: new Set(), max: 3 }).sent.map((line) => line.handle)).toEqual(["L1", "L2", "L90"])
  })
})
