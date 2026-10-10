import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { argumentScriptSourceOf, normalizeArgumentScriptContent } from "../../argument-scripts/domain/argument-script.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { missingCoverageOf, mergeReviewedLines, verifyCallAnalysis, type ModelCallAnalysis, type ModelCriterion, type SentReviewClaim } from "./call-analysis.js"
import { CALL_ANALYSIS_SYSTEM_PROMPT } from "./call-analysis-prompt.js"
import { CALL_REVIEW_SYSTEM_PROMPT, linesToAssessOf, type CallReview, type ClaimVerdict, type ReviewContract } from "./call-review.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { criterionPatternsOf } from "./indicator-investigation.js"
import { buildProcedureContext, listContextOf, transcriptStatusOf } from "./procedure.js"

/**
 * OBRIGAÇÃO COMPLETA (`OBLIGATION_READING_V1`, `CALL_ANALYSIS_LOGIC_V10`, `CALL_REVIEW_V7`, `PATH_COMPLETENESS_V1`) — regressões dos
 * defeitos da rodada real V8, SEM IA: o "analisador" e a "revisora" são respostas SIMULADAS. Prova a DECISÃO do código sobre as
 * leituras semânticas (nunca por verbo, palavra-chave ou nome de sistema); não prova a qualidade de um modelo real.
 */
const DOC = "00000000-0000-4000-8000-00000000c901"
const SCRIPT = "00000000-0000-4000-8000-00000000c951"
const INTERACTION = "00000000-0000-4000-8000-00000000c9f1"
const PROCEDURE = `# Contestação (teste)

## 30. Abertura de análise

Abrir análise quando:

- Não houver evidência suficiente;
- Existir cobrança após cancelamento não concluído;
- A ferramenta recomendar investigação.

## 35. Prazo da análise

- Análise de faturamento: preferencialmente em até cinco dias úteis.

## 44. Transferência

Antes de transferir:

- Informar o motivo;
- Informar protocolo.

## 5. Forma de envio

É proibido:

- Enviar a conta para e-mail ou telefone informado durante o atendimento sem validação adicional;
- Compartilhar a conta com terceiros não autorizados.
`
const TRANSCRIPT = [
  "Cliente: Apareceu uma cobrança de mensalidade depois do cancelamento.",
  "Operador: Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído.",
  "Cliente: E agora?",
  "Operador: Registrei a contestação dos R$ 59,90 pra equipe de faturamento analisar.",
  "Operador: A equipe tem até cinco dias úteis pra concluir a análise.",
  "Cliente: Manda a segunda via pro meu e-mail novo, ana.nova@exemplo.com.",
  "Operador: Vou atualizar o e-mail e reenviar.",
  "Cliente: E o protocolo?",
  "Operador: Já passei o contexto no protocolo. Vou transferir a senhora para o faturamento.",
  "Cliente: Tá bom.",
].join("\n")
const Q = {
  condition: { turn: "T2", speaker: "OPERADOR", quote: "O pedido de cancelamento está aberto desde o dia 2 de julho, mas não foi concluído." },
  declared: { turn: "T4", speaker: "OPERADOR", quote: "Registrei a contestação dos R$ 59,90 pra equipe de faturamento analisar." },
  deadline: { turn: "T5", speaker: "OPERADOR", quote: "A equipe tem até cinco dias úteis pra concluir a análise." },
  email: { turn: "T7", speaker: "OPERADOR", quote: "Vou atualizar o e-mail e reenviar." },
  protocol: { turn: "T9", speaker: "OPERADOR", quote: "Já passei o contexto no protocolo." },
}

const secondCopyScript = argumentScriptSourceOf({
  scriptId: SCRIPT,
  versionId: "s1",
  version: 1,
  name: "Segunda via",
  areaName: "Atendimento",
  scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null },
  subjectName: null,
  conversion: "NATIVE",
  content: normalizeArgumentScriptContent({
    trigger: "Durante a ligação, o cliente solicita a segunda via da fatura ou do parcelamento.",
    operatorGuidance: [{ text: "Verificar se a solicitação é referente à segunda via da fatura ou do parcelamento.", modality: "MUST" }],
    requiredPoints: [{ mode: "ALL", items: [{ text: "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar o acesso pelo aplicativo.", condition: null }] }],
    avoid: [{ text: "Não encerrar o atendimento sem tratar a necessidade apresentada pelo cliente." }],
    suggestedScript: null,
    monitoringReference: null,
  }),
  contentHash: "s1",
  effectiveFrom: new Date("2026-09-29T00:00:00Z"),
  effectiveUntil: null,
  sourceDocumentId: null,
  sourceDocumentTitle: null,
  sourceReference: null,
  perspective: "CURRENT_RULE_REEVALUATION",
}, null)

const context = (scripts = false) => buildProcedureContext([{ documentId: DOC, title: "Contestação", version: 1, content: PROCEDURE, contentHash: "c1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 1 }], scripts ? [secondCopyScript] : [])
const projection = projectTranscript(TRANSCRIPT)
const lineOf = (ctx: ReturnType<typeof context>, text: string) => [...ctx.lines.values()].find((entry) => entry.text.includes(text))!
const sectionOf = (ctx: ReturnType<typeof context>, heading: string) => [...ctx.sections.values()].find((entry) => entry.heading?.includes(heading))!
const criterion = (overrides: Partial<ModelCriterion> & Pick<ModelCriterion, "line" | "status">): ModelCriterion => ({ evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "leitura simulada da análise", materiality: "HIGH", guidance: null, whyItMatters: null, applicability: "APPLIES", observability: "IN_CONVERSATION", ...overrides })
const model = (criteria: ModelCriterion[], scenario: Partial<ModelCallAnalysis["scenario"]> = {}, extra: Partial<ModelCallAnalysis> = {}): ModelCallAnalysis => ({
  scenario: { customerNeed: "Contestar a mensalidade cobrada depois do cancelamento", conditions: [{ text: "Cancelamento pendente", evidence: [Q.condition] }], procedure: "D1", procedureRationale: null, pathSections: [], correctPath: "Abrir análise, informar prazo e protocolo.", pathTaken: "Registrou a contestação e informou o prazo.", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [], ...scenario },
  criteria,
  sectionDispositions: [],
  groupDispositions: [],
  sourceConflicts: [],
  limitations: [],
  contractViolations: [],
  ...extra,
})
const verdict = (id: string, overrides: Partial<ClaimVerdict> = {}): [string, ClaimVerdict] => [id, { id, verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [], counterEvidence: [], note: null, ...overrides }]
const reviewOf = (claims: [string, ClaimVerdict][], contract: ReviewContract, extra: Partial<CallReview> = {}): CallReview => ({ claims: new Map(claims), path: null, lines: [], violations: [], contract, ...extra })
const run = (ctx: ReturnType<typeof context>, analysis: ModelCallAnalysis, review: CallReview, options: { sentClaims?: SentReviewClaim[]; requested?: string[] } = {}) =>
  verifyCallAnalysis({ model: analysis, context: ctx, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: true, review: { attempted: true, review, error: null, ...(options.requested ? { requested: { linesToAssess: options.requested, linesWithheld: 0, exclusions: [] } } : {}), ...(options.sentClaims ? { sentClaims: options.sentClaims } : {}) } })
const briefOf = (analysis: ReturnType<typeof run>, ctx: ReturnType<typeof context>) => buildMonitoringBrief({ analysis, listContext: listContextOf(ctx), interactionId: INTERACTION, label: "Contestação", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: new Map(analysis.criteria.map((entry) => [entry.lineKey, entry.lineKey])), documentTitles: new Map([[DOC, "Contestação"]]), documentVersions: new Map([[DOC, 1]]), history: new Map(), delivered: new Set() })
const memoryRows = (analysis: ReturnType<typeof run>) => analysis.criteria.map((entry) => ({ interactionId: INTERACTION, personId: "p", criterionKey: entry.lineKey, documentId: DOC, documentTitle: "Contestação", heading: entry.heading, text: entry.text, status: entry.status, localDate: "2026-08-21", evidence: entry.evidence, rationale: entry.rationale, guidance: entry.guidance, materiality: entry.materiality }))

describe("1. a CONDIÇÃO de uma regra nunca vira desempenho do operador; declaração nunca vira execução", () => {
  it("rodada V8: item 'Existir cobrança após cancelamento…' de 'Abrir análise quando:' lido como ação interna E 'na conversa', com 'Registrei a contestação' — fica declaração não verificável (diagnóstico, revisão, memória e brief)", () => {
    const ctx = context()
    const item = lineOf(ctx, "Existir cobrança após cancelamento")
    const analysis = model([criterion({ line: item.handle, status: "MET", evidence: [Q.declared], applicabilityEvidence: [Q.condition], itemNature: "INTERNAL_ACTION", lineRole: "CONDITION_OF_ACTION", requiredAction: "Abrir análise quando existir cobrança após cancelamento não concluído." })])
    // Revisão LEGACY (resposta da rodada V8): confirmou. O código não deixa a leitura contraditória virar acerto.
    const result = run(ctx, analysis, reviewOf([verdict(item.handle, { listReading: "NOT_A_LIST", conditionEvidence: [Q.condition] })], "LEGACY"))
    const final = result.criteria.find((entry) => entry.lineHandle === item.handle)!
    expect(final).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED", lineRole: "CONDITION_OF_ACTION" })
    expect(final.downgrades).toEqual(expect.arrayContaining(["READINGS_CONFLICT_INTERNAL_ACTION_IN_CONVERSATION", "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"]))
    expect(final.confirmation).not.toBe("CONFIRMED")
    expect(result.coverageLimits).toMatchObject({ outsideConversation: 1, declaredExecutions: 1 })
    const brief = briefOf(result, ctx)
    expect([...brief.strengths, ...brief.developments].some((finding) => finding.criterionKeys.includes(final.lineKey))).toBe(false)
    expect(criterionPatternsOf(memoryRows(result)).find((pattern) => pattern.criterionKey === final.lineKey)).toMatchObject({ met: 0, notMet: 0, partial: 0, eligible: 0 })
  })

  it("a análise disse 'na conversa' e 'comunicação' (leitura errada), mas a fala citada é a MESMA que mostra a situação: condição não é conduta", () => {
    const ctx = context()
    const item = lineOf(ctx, "Existir cobrança após cancelamento")
    const result = run(ctx, model([criterion({ line: item.handle, status: "MET", evidence: [Q.condition], applicabilityEvidence: [Q.condition], itemNature: "COMMUNICATION", lineRole: "CONDITION_OF_ACTION" })]), reviewOf([verdict(item.handle)], "LEGACY"))
    expect(result.criteria.find((entry) => entry.lineHandle === item.handle)).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["CONDITION_IS_NOT_CONDUCT"] })
  })

  it("(corrigido depois da rodada V9) item-condição dado como cumprido com a fala que a PRÓPRIA análise citou como condição do cenário: condição não é conduta", () => {
    const ctx = context()
    const item = lineOf(ctx, "Existir cobrança após cancelamento")
    // Rodada V9, chamada B: "Aplicável quando houver… falha" cumprido com a fala da instabilidade, que também era condição do cenário.
    const result = run(ctx, model([criterion({ line: item.handle, status: "MET", evidence: [Q.condition], itemNature: "COMMUNICATION", lineRole: "CONDITION_OF_ACTION" })]), reviewOf([verdict(item.handle, { evidenceReading: "ACTION_IN_CALL", outsideDependency: false })], "V7"))
    expect(result.criteria.find((entry) => entry.lineHandle === item.handle)).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["CONDITION_IS_NOT_CONDUCT"] })
  })

  it("revisão V7: a revisora lê a prova como DECLARAÇÃO de algo feito fora da fala → não confirma; a leitura volta a 'fora da conversa' e a fala fica como declaração", () => {
    const ctx = context()
    const item = lineOf(ctx, "Existir cobrança após cancelamento")
    const result = run(ctx, model([criterion({ line: item.handle, status: "MET", evidence: [Q.declared], applicabilityEvidence: [Q.condition], itemNature: "COMMUNICATION", lineRole: "CONDITION_OF_ACTION" })]), reviewOf([verdict(item.handle, { evidenceReading: "STATEMENT_ABOUT_ACTION", outsideDependency: false, listReading: "CONDITIONS" })], "V7"))
    expect(result.criteria.find((entry) => entry.lineHandle === item.handle)).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["DECLARATION_IS_NOT_EXECUTION"], observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED", evidenceKind: "DECLARED_ACTION" })
    expect(result.coverageLimits?.declaredExecutions).toBe(1)
  })

  it("revisão V7: a revisora lê que a evidência mostra só a SITUAÇÃO → não confirma (CONDITION_IS_NOT_CONDUCT)", () => {
    const ctx = context()
    const item = lineOf(ctx, "Existir cobrança após cancelamento")
    // Sem condição registrada no cenário (a integridade não pega): é a leitura da revisora que barra.
    const result = run(ctx, model([criterion({ line: item.handle, status: "MET", evidence: [Q.condition], itemNature: "COMMUNICATION", lineRole: "CONDITION_OF_ACTION" })], { conditions: [] }), reviewOf([verdict(item.handle, { evidenceReading: "CONDITION_ONLY", outsideDependency: false })], "V7"))
    expect(result.criteria.find((entry) => entry.lineHandle === item.handle)).toMatchObject({ status: "NOT_OBSERVABLE", confirmationReasons: ["CONDITION_IS_NOT_CONDUCT"] })
  })

  it("na conversa, dizer que fez ('já passei…') é declaração, não a conduta: acerto com DECLARED_ACTION não se sustenta", () => {
    const ctx = context()
    const item = lineOf(ctx, "Informar protocolo")
    const result = run(ctx, model([criterion({ line: item.handle, status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [Q.protocol], itemNature: "COMMUNICATION" })]), reviewOf([verdict(item.handle)], "LEGACY"))
    expect(result.criteria.find((entry) => entry.lineHandle === item.handle)).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["DECLARATION_IS_NOT_CONDUCT"] })
  })

  it("título do ponto que é condição/conteúdo da ação vem com a frase que abre a lista (a conduta é a ação, não a situação)", () => {
    const ctx = context()
    const item = lineOf(ctx, "Informar protocolo")
    const result = run(ctx, model([criterion({ line: item.handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T9", itemNature: "COMMUNICATION", lineRole: "CONTENT_OF_ACTION" })]), reviewOf([verdict(item.handle, { evidenceReading: "ABSENCE_IN_CALL", outsideDependency: false, listReading: "CUMULATIVE" })], "V7"))
    expect(briefOf(result, ctx).developments[0]?.title).toBe("Antes de transferir: informar protocolo")
  })
})

describe("2. conclusão geral nunca excede a cobertura (`PATH_COMPLETENESS_V1`)", () => {
  it("'caminho correto' com etapa do caminho fora da conversa → não determinado; sem reconhecimento 'Condução do caso'", () => {
    const ctx = context()
    const condition = lineOf(ctx, "Existir cobrança após cancelamento")
    const deadline = lineOf(ctx, "Análise de faturamento")
    const analysis = model([
      criterion({ line: condition.handle, status: "NOT_OBSERVABLE", evidenceKind: "DECLARED_ACTION", evidence: [Q.declared], itemNature: "INTERNAL_ACTION", observability: "OUTSIDE_CONVERSATION", lineRole: "CONDITION_OF_ACTION" }),
      criterion({ line: deadline.handle, status: "MET", evidence: [Q.deadline], itemNature: "COMMUNICATION" }),
    ], { pathSections: [sectionOf(ctx, "Abertura de análise").handle, sectionOf(ctx, "Prazo da análise").handle], pathAssessment: "CORRECT", pathRationale: "O operador seguiu todas as etapas do procedimento." }, { groupDispositions: [{ lines: [lineOf(ctx, "Não houver evidência").handle, lineOf(ctx, "A ferramenta recomendar").handle], status: "NOT_APPLICABLE", rationale: "As outras situações não aparecem na conversa." }] })
    const result = run(ctx, analysis, reviewOf([verdict(deadline.handle, { evidenceReading: "ACTION_IN_CALL", outsideDependency: false })], "V7", { path: { verdict: "CONFIRMED", issues: [], note: null } }))
    expect(result.scenario).toMatchObject({ proposedPathAssessment: "CORRECT", pathAssessment: "UNDETERMINED", pathCompleteness: { status: "LIMITED", outsideConversation: 1 } })
    const brief = briefOf(result, ctx)
    expect(brief.strengths.some((finding) => finding.origin === "PATH")).toBe(false)
    // A conduta OBSERVÁVEL continua reconhecível etapa por etapa.
    expect(brief.strengths.map((finding) => finding.title)).toContain("Análise de faturamento")
  })

  it("todas as etapas do caminho que se aplicam verificadas e confirmadas → o caminho correto continua valendo", () => {
    const ctx = context()
    const deadline = lineOf(ctx, "Análise de faturamento")
    const result = run(ctx, model([criterion({ line: deadline.handle, status: "MET", evidence: [Q.deadline], itemNature: "COMMUNICATION" })], { pathSections: [sectionOf(ctx, "Prazo da análise").handle], pathAssessment: "CORRECT" }), reviewOf([verdict(deadline.handle, { evidenceReading: "ACTION_IN_CALL", outsideDependency: false })], "V7", { path: { verdict: "CONFIRMED", issues: [], note: null } }))
    expect(result.scenario).toMatchObject({ pathAssessment: "CORRECT", pathCompleteness: { status: "FULL", applicable: 1 } })
  })
})

describe("3. a decisão usa EXATAMENTE as propostas enviadas à revisora (`REVIEW_FOCUS_AS_SENT_V2`)", () => {
  const ctx = context()
  const protocol = lineOf(ctx, "Informar protocolo")
  const analysis = model([criterion({ line: protocol.handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T9", itemNature: "COMMUNICATION" })])
  const review = reviewOf([verdict(protocol.handle, { evidenceReading: "ABSENCE_IN_CALL", outsideDependency: false, listReading: "CUMULATIVE" })], "V7")
  it("o pedido enviado tratava a regra como CONDICIONAL (o que a revisora viu): sem a fala da condição, o desvio não é confirmado", () => {
    const sentClaims: SentReviewClaim[] = [{ id: protocol.handle, status: "NOT_MET", focus: ["OMISSION", "CONDITIONAL_RULE"], rule: { section: "44. Transferência", leadIn: "Antes de transferir:", text: protocol.text, conditional: true, condition: "houver transferência", sameList: [] } }]
    expect(run(ctx, analysis, review, { sentClaims }).criteria.find((entry) => entry.lineHandle === protocol.handle)).toMatchObject({ confirmation: "UNCONFIRMED", confirmationReasons: ["CONDITION_NOT_EVIDENCED"] })
  })
  it("o mesmo veredito sobre o pedido recomposto (regra sem condição lida) confirma — prova de que vale o que foi ENVIADO", () => {
    expect(run(ctx, analysis, review).criteria.find((entry) => entry.lineHandle === protocol.handle)).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
  })
})

describe("4. validação interna desconhecida nunca vira acusação; comunicação obrigatória ausente continua detectável", () => {
  it("proibição 'enviar para e-mail informado sem validação adicional': a revisora diz que a conclusão depende de validação que pode ter sido feita fora da fala → não confirma, fica fora da conversa, sem ajuste", () => {
    const ctx = context()
    const prohibited = lineOf(ctx, "Enviar a conta para e-mail")
    const result = run(ctx, model([criterion({ line: prohibited.handle, status: "NOT_MET", evidence: [Q.email], itemNature: "PROHIBITION" })]), reviewOf([verdict(prohibited.handle, { evidenceReading: "CONTRARY_ACTION_IN_CALL", outsideDependency: true, note: "A conversa não mostra se houve validação adicional." })], "V7"))
    const final = result.criteria.find((entry) => entry.lineHandle === prohibited.handle)!
    expect(final).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["EXECUTION_OUTSIDE_CONVERSATION"], observability: "OUTSIDE_CONVERSATION", executionClaim: "NONE" })
    expect(briefOf(result, ctx).developments).toHaveLength(0)
    expect(criterionPatternsOf(memoryRows(result)).find((pattern) => pattern.criterionKey === final.lineKey)).toMatchObject({ notMet: 0, eligible: 0 })
  })
  it("a análise já lê que a validação pode ter acontecido fora da fala → não observável desde a análise", () => {
    const ctx = context()
    const prohibited = lineOf(ctx, "Enviar a conta para e-mail")
    const result = run(ctx, model([criterion({ line: prohibited.handle, status: "NOT_MET", evidence: [Q.email], itemNature: "PROHIBITION", observability: "OUTSIDE_CONVERSATION" })]), reviewOf([], "V7"))
    expect(result.criteria.find((entry) => entry.lineHandle === prohibited.handle)).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"] })
  })
  it("'informar protocolo' antes de transferir: mencionar 'protocolo' não é informar o número — ausente na conversa inteira, confirmado como desvio", () => {
    const ctx = context()
    const protocol = lineOf(ctx, "Informar protocolo")
    const result = run(ctx, model([criterion({ line: protocol.handle, status: "NOT_MET", evidence: [Q.protocol], itemNature: "COMMUNICATION", rationale: "Citou o protocolo, mas não informou o número antes de transferir." })]), reviewOf([verdict(protocol.handle, { evidenceReading: "ABSENCE_IN_CALL", outsideDependency: false, listReading: "CUMULATIVE" })], "V7"))
    expect(result.criteria.find((entry) => entry.lineHandle === protocol.handle)).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(briefOf(result, ctx).developments.map((finding) => finding.title)).toEqual(["Informar protocolo"])
  })
  it("leitura da revisora incompatível com a conclusão (desvio com 'a ação aparece na conversa') ou ausente (contrato V7) → não confirma", () => {
    const ctx = context()
    const protocol = lineOf(ctx, "Informar protocolo")
    const analysis = model([criterion({ line: protocol.handle, status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T9", itemNature: "COMMUNICATION" })])
    expect(run(ctx, analysis, reviewOf([verdict(protocol.handle, { evidenceReading: "ACTION_IN_CALL", outsideDependency: false })], "V7")).criteria.find((entry) => entry.lineHandle === protocol.handle)).toMatchObject({ confirmationReasons: ["EVIDENCE_READING_MISMATCH"] })
    expect(run(ctx, analysis, reviewOf([verdict(protocol.handle)], "V7")).criteria.find((entry) => entry.lineHandle === protocol.handle)).toMatchObject({ confirmationReasons: ["REVIEW_INCOMPLETE"] })
  })
})

describe("5. argumentário aplicável: os itens recebem avaliação efetiva; o que não foi avaliado fica explicitamente não avaliado", () => {
  const ctx = context(true)
  const scriptDoc = ctx.documents.find((document) => document.kind === "ARGUMENT_SCRIPT")!
  const scriptLines = [...ctx.lines.values()].filter((line) => line.argument && line.documentHandle === scriptDoc.handle)
  const required = scriptLines.find((line) => line.argument!.field === "REQUIRED_POINT")!
  const applies = { argumentScripts: [{ script: scriptDoc.handle, applicability: "APPLIES" as const, situation: "Pediu a segunda via.", evidence: [{ turn: "T6", speaker: "CLIENTE", quote: "Manda a segunda via pro meu e-mail novo, ana.nova@exemplo.com." }], rationale: "Pediu a segunda via na ligação." }] }

  it("o contrato da análise exige disposição para cada item do argumentário aplicável", () => {
    expect(CALL_ANALYSIS_SYSTEM_PROMPT).toContain("reconhecer a situação do argumentário sem avaliar os itens dele não é avaliação")
    expect(CALL_REVIEW_SYSTEM_PROMPT).toContain("evidenceReading (obrigatório em cada proposta)")
  })
  it("reconhecer o gatilho sem avaliar os itens: os itens entram no pedido de cobertura à frente do resto (mesmo com teto)", () => {
    const analysis = model([], {}, applies)
    const missing = missingCoverageOf(analysis, ctx, "COMPLETE", projection, INTERACTION)
    expect(scriptLines.every((line) => missing.some((entry) => entry.handle === line.handle))).toBe(true)
    const padded = [...Array(10).keys()].map((index) => ({ handle: `LX${index}`, sectionHandle: "S99" }))
    expect(linesToAssessOf([...padded, ...missing.filter((line) => line.argument)], { closingSections: new Set(["S99"]), decidedSections: new Set(), max: scriptLines.length }).sent.every((line) => "argument" in line && line.argument)).toBe(true)
  })
  it("sem resposta: NÃO AVALIADO (análise parcial), nunca cumprido nem 'sem falha'; avaliado só pela revisão: não confirmado", () => {
    const analysis = model([], {}, applies)
    const unanswered = run(ctx, analysis, reviewOf([], "V7"))
    const item = unanswered.criteria.find((entry) => entry.lineHandle === required.handle)!
    expect(item).toMatchObject({ status: "NOT_ASSESSED", origin: "COVERAGE_GAP" })
    expect(unanswered.coverage.status).toBe("PARTIAL")
    const reviewed = mergeReviewedLines(analysis, [{ id: required.handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [], opportunityTurn: null, rationale: "x", applicability: "APPLIES", observability: "IN_CONVERSATION" }], [required.handle])
    const byReview = run(ctx, reviewed, reviewOf([], "V7"), { requested: [required.handle] })
    expect(byReview.criteria.find((entry) => entry.lineHandle === required.handle)!.status).not.toBe("MET")
  })
  it("item avaliado pela análise com a fala e confirmado pela revisora (a ação na conversa) → acerto confirmado do argumentário", () => {
    const transcript = `${TRANSCRIPT}\nOperador: Só pra confirmar: é a segunda via da fatura, não do parcelamento, certo?`
    const local = projectTranscript(transcript)
    const quote = { turn: "T11", speaker: "OPERADOR", quote: "Só pra confirmar: é a segunda via da fatura, não do parcelamento, certo?" }
    const analysis = model([criterion({ line: required.handle, status: "MET", evidence: [quote], itemNature: "INFORMATION_REQUEST" })], {}, applies)
    const result = verifyCallAnalysis({ model: analysis, context: ctx, projection: local, transcriptStatus: transcriptStatusOf(local), interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: true, review: { attempted: true, review: reviewOf([verdict(required.handle, { evidenceReading: "ACTION_IN_CALL", outsideDependency: false })], "V7"), error: null } })
    expect(result.criteria.find((entry) => entry.lineHandle === required.handle)).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })
})
