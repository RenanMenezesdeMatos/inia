import { createHash } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { rawSubjectOf } from "../../interactions/domain/interaction-subject.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { mergeReviewedLines, missingCoverageOf, parseCallAnalysisResponse, sectionsInPlayOf, verifyCallAnalysis, type ConfirmationInput, type ModelCallAnalysis, type ReviewInput, type VerifiedCallAnalysis } from "../domain/call-analysis.js"
import { CALL_ANALYSIS_FORMAT_RETRY, renderCallAnalysisUserTurn } from "../domain/call-analysis-prompt.js"
import { obligationAnalysisContractFor } from "../domain/obligation-analysis-prompt.js"
import { productContextOf, scopeLabelFor, PRODUCT_APPLICABILITY_VERSION, type ProductContext } from "../domain/product-applicability.js"
import type { ProductCatalogSource } from "../../product-catalog/domain/product-catalog.js"
import { parseObligationAnalysisResponse, type ModelObligationAnalysis } from "../domain/obligation-analysis.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, obligationReviewContractFor } from "../domain/obligation-review.js"
import { reviewObligationAnalysis } from "./review-obligations.js"
import { callReviewResponseSchemaFor, CALL_REVIEW_PROMPT_VERSION, CALL_REVIEW_VERSION, CALL_REVIEW_SYSTEM_PROMPT, confirmationTargetsOf, exclusionTargetsOf, linesToAssessOf, parseCallReview, renderCallReviewUserTurn, reviewDiscoveriesOf, reviewTargetsOf, type ReviewPathClaim } from "../domain/call-review.js"
import { effectiveRuleText } from "../domain/criteria-identity.js"
import { organizePracticesOfAnalysis } from "./organize-practices.js"
import type { ArgumentScriptSource } from "../../argument-scripts/domain/argument-script.js"
import { selectDocumentsForCall, type CandidateDocument } from "../domain/document-selection.js"
import { buildProcedureContext, listContextOf, listOpeningsOf, transcriptStatusOf, type ProcedureContext, type SourceDocument, type TranscriptStatus } from "../domain/procedure.js"
import { CALL_ANALYSIS_LOGIC_VERSION, CALL_ANALYSIS_PROMPT_VERSION, CRITERIA_EXTRACTION_VERSION } from "../domain/versions.js"
import { CALL_ANALYSIS_CHECKPOINT_VERSION, checkpointOf, type CallAnalysisCheckpoint, type PendingReason, type StageResponse } from "../domain/analysis-recovery.js"
import { isBudgetExhausted } from "./engine-meter.js"
import type { TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import type { AgentProfile, InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import type { AnalysisTrigger, EngineModelPort, EngineModelRequest, EngineModelResponse, FeedbackMemoryStore, ModelCallMetric, StoredCallAssessment } from "./ports.js"
import type { CriterionIdentity } from "../domain/criteria-identity.js"

/**
 * CASO DE USO: ANALISAR UMA CHAMADA (a MESMA análise alimenta memória, diagnóstico e feedback).
 *
 *   interação da organização e do colaborador → transcrição por turnos (+ completude) → procedimentos INTEIROS vigentes na data
 *   → identidade dos critérios (reconciliada com a versão anterior, sem aprovação) → ANÁLISE (1 chamada; 1 nova tentativa só de
 *   formato) → integridade por código (proposta) → REVISÃO independente (1 chamada por chamada analisada: confirma, refuta ou
 *   deixa incerta cada conclusão e dá disposição às linhas que a análise deixou sem resposta; 1 nova tentativa só de formato) →
 *   decisão por código → MEMÓRIA gravada (independente de haver feedback; hipóteses não confirmadas ficam registradas como tais).
 * Sem revisão (falha do provedor, orçamento da execução esgotado, resposta fora do contrato) NADA vai para a memória: a execução
 * fica SUSPENSA com as propostas (`domain/analysis-recovery.ts`) e a próxima execução autorizada retoma só a revisão.
 *
 * Reuso por ETAPA: execução concluída com a mesma chave = devolvida sem modelo; senão, a resposta de análise já paga com a mesma
 * chave de PROPOSTA é reaproveitada, e a de revisão com o mesmo pedido também — mudou só a lógica ou o contrato da revisão, só a
 * revisão é refeita. Concorrência: a posse é atômica (uma execução por chave; duas retomadas nunca pagam a mesma revisão).
 */
export const ANALYSIS_LEASE_SECONDS = 300
export const TRANSCRIPT_MAX_CHARS = 40_000

export type AnalyzeCallDeps = {
  memory: FeedbackMemoryStore
  model: EngineModelPort
  loadInteraction: (organizationId: string, interactionId: string) => Promise<InteractionForAnalysis | null>
  loadAgent: (organizationId: string, agentId: string) => Promise<AgentProfile | null>
  loadDocuments: (organizationId: string, agentId: string, at: Date) => Promise<CandidateDocument[]>
  loadPreviousVersion: (organizationId: string, documentId: string, version: number) => Promise<{ version: number; content: string } | null>
  /** Argumentários vigentes NA DATA DA CHAMADA no escopo (Grupo/Subgrupo) do colaborador. Ausente = nenhum (testes antigos). */
  loadArgumentScripts?: (organizationId: string, person: { teamId: string | null; subteamId: string | null }, at: Date) => Promise<ArgumentScriptSource[]>
  /**
   * `PRODUCT_APPLICABILITY_V1`: cadastro de produtos como valia NA DATA DA CHAMADA (itens, critérios aprovados e vigentes, abrangência das
   * fontes apresentadas). Ausente ou sem nada vigente = análise sem modo produto (idêntica à de antes).
   */
  loadProductCatalog?: (organizationId: string, at: Date, sourceIds: readonly string[]) => Promise<ProductCatalogSource | null>
  now: () => Date
  /**
   * Trava de SUJEITO (ensaios/avaliações): só estes colaboradores podem ter chamadas analisadas. Checada antes de qualquer leitura
   * ou modelo — vale também para as análises que a investigação dispara indiretamente (pares, recortes).
   */
  allowCollaborator?: (collaboratorId: string) => boolean
  /**
   * `PRACTICE_IDENTITY_V1`: organizar em práticas as linhas das fontes apresentadas que ainda não foram organizadas (uma chamada por
   * lote de linhas novas, só na primeira vez). Produção liga (`createEngineDeps`); ausente = desligado (testes que não tratam disso).
   */
  organizePractices?: boolean
}

export class CollaboratorNotAllowedError extends DomainError {
  constructor(collaboratorId: string) {
    super(`Análise bloqueada: o colaborador ${collaboratorId} está fora do escopo permitido nesta execução.`, "FEEDBACK_ANALYSIS_COLLABORATOR_NOT_ALLOWED", 403)
    this.name = "CollaboratorNotAllowedError"
  }
}

export type AnalyzeCallRequest = {
  organizationId: string
  interactionId: string
  /** Colaborador esperado (identidade da execução): a interação precisa ser dele. */
  collaboratorId: string
  agentId: string | null
  trigger: AnalysisTrigger
}

export type AnalyzeCallResult = { runId: string; reused: boolean; assessment: StoredCallAssessment | null; outcome: VerifiedCallAnalysis["outcome"]; outcomeReasons: string[] }

export class InteractionNotAnalyzableError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code, 422)
    this.name = "InteractionNotAnalyzableError"
  }
}
export class AnalysisInProgressError extends DomainError {
  constructor() {
    super("A análise desta chamada está em andamento em outra execução — será retomada.", "FEEDBACK_ANALYSIS_IN_PROGRESS", 409, { category: "PROVIDER_ERROR" })
    this.name = "AnalysisInProgressError"
  }
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex")
const dateLabelOf = (at: Date, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(at).replace(",", " às")

export async function callModel(model: EngineModelPort, request: EngineModelRequest, metrics: ModelCallMetric[]): Promise<EngineModelResponse> {
  try {
    const response = await model.generate(request)
    metrics.push({ stage: request.stage, tag: request.tag ?? null, model: response.model, inputTokens: response.usage?.inputTokens ?? null, outputTokens: response.usage?.outputTokens ?? null, durationMs: response.durationMs, costUsd: response.costUsd, ok: true, error: null })
    return response
  } catch (error) {
    metrics.push({ stage: request.stage, tag: request.tag ?? null, model: null, inputTokens: null, outputTokens: null, durationMs: null, costUsd: null, ok: false, error: error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN" })
    throw error
  }
}

export const metricsSummaryOf = (metrics: readonly ModelCallMetric[]) => ({
  modelCalls: metrics.length,
  failedCalls: metrics.filter((metric) => !metric.ok).length,
  inputTokens: metrics.reduce((sum, metric) => sum + (metric.inputTokens ?? 0), 0),
  outputTokens: metrics.reduce((sum, metric) => sum + (metric.outputTokens ?? 0), 0),
  modelDurationMs: metrics.reduce((sum, metric) => sum + (metric.durationMs ?? 0), 0),
  costUsd: metrics.every((metric) => metric.costUsd === null) ? null : Math.round(metrics.reduce((sum, metric) => sum + (metric.costUsd ?? 0), 0) * 1e6) / 1e6,
  calls: metrics,
})

/** Linhas estruturais de UM documento (para reconciliar a identidade com a versão anterior). */
function documentLines(document: Pick<SourceDocument, "documentId" | "title" | "version" | "content">) {
  const context = buildProcedureContext([{ ...document, contentHash: "", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }])
  return [...context.lines.values()].map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line), position: line.position }))
}

/** O que a revisão devolve: a análise verificada, a resposta bruta e — quando a revisão NÃO aconteceu — a pendência. */
export type ReviewPending = { reason: PendingReason; error: string; attempted: boolean; cause: unknown }
export type ReviewOutcome = { analysis: VerifiedCallAnalysis; review: ReviewInput; raw: StageResponse | null; reviewReused: boolean; pending: ReviewPending | null; /** Confirmação focal dos achados da revisão (resposta bruta, para reaproveitar). */ confirmationRaw?: StageResponse | null }

/**
 * REVISÃO da análise (uma chamada por chamada analisada): integridade por código → alvos (propostas determinadas, caminho, linhas
 * sem resposta) → revisão independente → decisão por código. Resposta de revisão JÁ PAGA com a mesma assinatura de pedido é
 * reaproveitada (nenhuma chamada). Falha técnica, orçamento esgotado ou resposta fora do contrato = PENDÊNCIA (nada confirmado;
 * quem chamou decide suspender — nunca vira resultado definitivo).
 */
export async function reviewAnalysis(deps: Pick<AnalyzeCallDeps, "model">, input: { model: ModelCallAnalysis; context: ProcedureContext; projection: TranscriptProjection; transcriptStatus: TranscriptStatus; interactionId: string; subject: string | null; anchored: readonly string[]; storedReviews?: readonly StageResponse[]; storedConfirmations?: readonly StageResponse[] }, metrics: ModelCallMetric[]): Promise<ReviewOutcome> {
  const base = { context: input.context, projection: input.projection, transcriptStatus: input.transcriptStatus, interactionId: input.interactionId, subjectAnchoredDocumentIds: input.anchored }
  const preliminary = verifyCallAnalysis({ ...base, model: { ...input.model, contractViolations: [...input.model.contractViolations] }, repairAttempted: false })
  const missing = missingCoverageOf(input.model, input.context, input.transcriptStatus, input.projection, input.interactionId)
  const proposedPath = preliminary.scenario.proposedPathAssessment
  const path: ReviewPathClaim | null = proposedPath === "CORRECT" || proposedPath === "INCORRECT" || proposedPath === "PARTIALLY_CORRECT"
    ? { assessment: proposedPath, correctPath: preliminary.scenario.correctPath, pathTaken: preliminary.scenario.pathTaken, analystReading: preliminary.scenario.pathRationale, evidence: preliminary.scenario.pathEvidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })) }
    : null
  const lists = listContextOf(input.context)
  const openings = listOpeningsOf(input.context)
  // V2: os DESCARTES das seções em jogo vão à MESMA revisão, com o cenário que a análise descreveu (para conferir contra ele).
  const inPlay = sectionsInPlayOf({ pathSections: preliminary.scenario.pathSections, closing: preliminary.coverage.closingSections.map((handle) => ({ handle })), criteria: preliminary.criteria })
  const exclusions = exclusionTargetsOf({ criteria: preliminary.criteria, notRequirementLines: preliminary.notRequirements.flatMap((handle) => {
    const line = input.context.lines.get(handle)
    return line ? [line] : []
  }), lists, inPlaySections: inPlay, openings })
  // V3: item englobado por uma conclusão dada à abertura da lista vai como alvo próprio (acima), não como linha sem disposição;
  // o resto do caminho sem disposição vai com teto e prioridade (encerramento → seções com etapa decidida → resto).
  const aggregatedIds = new Set(exclusions.filter((target) => target.excludedAs === "AGGREGATED").map((target) => target.id))
  const decidedSections = new Set(preliminary.criteria.filter((criterion) => (criterion.origin === "ANALYSIS" || criterion.origin === "GROUP") && ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map((criterion) => criterion.sectionHandle))
  const coverageRequest = linesToAssessOf(missing.filter((line) => !aggregatedIds.has(line.handle)), { closingSections: new Set(preliminary.coverage.closingSections), decidedSections })
  const requested = { linesToAssess: coverageRequest.sent.map((line) => line.handle), linesWithheld: coverageRequest.withheld.length, exclusions: exclusions.map((target) => target.id) }
  const scenario = { customerNeed: preliminary.scenario.customerNeed, conditions: preliminary.scenario.conditions.map((condition) => ({ text: condition.text, turns: condition.evidence.map((quote) => quote.turn) })), correctPath: preliminary.scenario.correctPath }
  const targets = reviewTargetsOf({ criteria: preliminary.criteria, lists, projection: input.projection, path, missing: coverageRequest.sent.map((line) => ({ handle: line.handle, heading: line.heading, text: line.text, lineKey: line.lineKey, ...(line.argument ? { argument: line.argument } : {}) })), exclusions, scenario, openings })
  // O que a revisora recebe é o que a decisão usa (`REVIEW_FOCUS_AS_SENT_V2`): foco, regra e lista de cada proposta como ENVIADOS.
  const sentClaims = targets.claims.map((claim) => ({ id: claim.id, status: claim.status, focus: [...claim.focus], rule: claim.rule }))
  let review: ReviewInput = { attempted: false, review: null, error: null }
  let raw: StageResponse | null = null
  let reviewReused = false
  let pending: ReviewPending | null = null
  if (targets.claims.length > 0 || targets.linesToAssess.length > 0 || targets.path || exclusions.length > 0) {
    const request: EngineModelRequest = { stage: "CALL_REVIEW", systemPrompt: CALL_REVIEW_SYSTEM_PROMPT, contents: [{ role: "user", text: renderCallReviewUserTurn({ projection: input.projection, transcriptStatus: input.transcriptStatus, subject: input.subject, targets }) }], responseSchema: callReviewResponseSchemaFor(targets), tag: "review" }
    const requestSha256 = sha(`${request.systemPrompt}\n${request.contents[0]!.text}`)
    // Mesma revisão já paga (mesmo pedido byte a byte): reaproveitada — só muda a decisão por código, se a lógica mudou.
    const stored = (input.storedReviews ?? []).find((entry) => entry.requestSha256 === requestSha256)
    const storedParsed = stored ? parseCallReview(stored.text, { contract: "V7" }) : null
    if (stored && storedParsed?.ok) {
      review = { attempted: true, review: storedParsed.review, error: null, requested, sentClaims }
      raw = stored
      reviewReused = true
    } else {
      review = { attempted: true, review: null, error: null, requested, sentClaims }
      try {
        const first = await callModel(deps.model, request, metrics)
        let parsed = parseCallReview(first.text, { contract: "V7" })
        raw = { requestSha256, text: first.text.slice(0, 60_000) }
        if (!parsed.ok) {
          const retry = await callModel(deps.model, { ...request, contents: [...request.contents, { role: "model", text: first.text.slice(0, 20_000) }, { role: "user", text: CALL_ANALYSIS_FORMAT_RETRY }], tag: "review:retry:format" }, metrics)
          parsed = parseCallReview(retry.text, { contract: "V7" })
          raw = { requestSha256, text: retry.text.slice(0, 60_000) }
        }
        if (parsed.ok) review = { attempted: true, review: parsed.review, error: null, requested, sentClaims }
        else pending = { reason: "CONTRACT", error: `REVIEW_CONTRACT:${parsed.error}`, attempted: true, cause: null }
      } catch (error) {
        const budget = isBudgetExhausted(error)
        // Sem revisão nada é confirmado — e a falta dela é PENDÊNCIA (técnica ou de orçamento), nunca "inconclusiva".
        pending = { reason: budget ? "BUDGET" : "TECHNICAL", error: error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN", attempted: !budget, cause: error }
      }
    }
  }
  if (pending) {
    review = { attempted: true, review: null, error: pending.error, requested, sentClaims }
    return { analysis: verifyCallAnalysis({ ...base, model: { ...input.model, contractViolations: [...input.model.contractViolations] }, repairAttempted: false, review }), review, raw: null, reviewReused, pending }
  }
  const merged = review.review ? mergeReviewedLines(input.model, review.review.lines, requested.linesToAssess) : input.model
  const verifyWith = (confirmation?: ConfirmationInput) => verifyCallAnalysis({ ...base, model: { ...merged, contractViolations: [...merged.contractViolations] }, repairAttempted: missing.length > 0 && review.attempted, review, ...(confirmation ? { confirmation } : {}) })
  const analysis = verifyWith()
  // CONFIRMAÇÃO FOCAL (`REVIEW_DISCOVERY_CONFIRMATION_V1`): desvios que só a revisão encontrou, íntegros e aplicáveis, vão a UMA leitura
  // independente só deles (nunca a análise inteira de novo). Sem orçamento ou com falha: inconclusivos com o motivo — a execução segue.
  const discoveries = reviewDiscoveriesOf(analysis.criteria)
  if (discoveries.length === 0) return { analysis, review, raw, reviewReused, pending: null, confirmationRaw: null }
  const targetsForConfirmation = confirmationTargetsOf({ pending: discoveries, criteria: analysis.criteria, lists, projection: input.projection, openings })
  const confirmationClaims = targetsForConfirmation.claims.map((claim) => ({ id: claim.id, status: claim.status, focus: [...claim.focus], rule: claim.rule }))
  const confirmationRequest: EngineModelRequest = { stage: "CALL_CONFIRMATION", systemPrompt: CALL_REVIEW_SYSTEM_PROMPT, contents: [{ role: "user", text: renderCallReviewUserTurn({ projection: input.projection, transcriptStatus: input.transcriptStatus, subject: input.subject, targets: targetsForConfirmation }) }], responseSchema: callReviewResponseSchemaFor(targetsForConfirmation), tag: "confirmation" }
  const confirmationSha = sha(`${confirmationRequest.systemPrompt}\n${confirmationRequest.contents[0]!.text}`)
  const storedConfirmation = (input.storedConfirmations ?? []).find((entry) => entry.requestSha256 === confirmationSha)
  const storedParsed = storedConfirmation ? parseCallReview(storedConfirmation.text, { contract: "V7" }) : null
  if (storedConfirmation && storedParsed?.ok) return { analysis: verifyWith({ attempted: true, review: storedParsed.review, error: null, reason: null, sentClaims: confirmationClaims }), review, raw, reviewReused, pending: null, confirmationRaw: storedConfirmation }
  try {
    const response = await callModel(deps.model, confirmationRequest, metrics)
    const parsed = parseCallReview(response.text, { contract: "V7" })
    const confirmationRaw = { requestSha256: confirmationSha, text: response.text.slice(0, 60_000) }
    if (!parsed.ok) return { analysis: verifyWith({ attempted: true, review: null, error: `CONFIRMATION_CONTRACT:${parsed.error}`, reason: "CONTRACT", sentClaims: confirmationClaims }), review, raw, reviewReused, pending: null, confirmationRaw }
    return { analysis: verifyWith({ attempted: true, review: parsed.review, error: null, reason: null, sentClaims: confirmationClaims }), review, raw, reviewReused, pending: null, confirmationRaw }
  } catch (error) {
    const budget = isBudgetExhausted(error)
    return { analysis: verifyWith({ attempted: true, review: null, error: error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN", reason: budget ? "BUDGET" : "TECHNICAL", sentClaims: confirmationClaims }), review, raw, reviewReused, pending: null, confirmationRaw: null }
  }
}

/** A revisão desta chamada ficou PENDENTE (falha técnica): a execução foi suspensa com as propostas e será retomada. */
export class CallReviewPendingError extends DomainError {
  constructor(readonly reason: PendingReason, readonly detail: string) {
    super("A revisão da análise da chamada não pôde ser concluída agora — a análise está guardada e só a revisão será retomada.", "FEEDBACK_CALL_REVIEW_PENDING", 503, { category: "PROVIDER_ERROR", reason, detail })
    this.name = "CallReviewPendingError"
  }
}

/** Chave da execução ANTES desta correção (mesma fórmula da V4 pré-recuperação) — só para reencontrar propostas já pagas. */
export function legacyAnalysisKeyOf(interaction: InteractionForAnalysis, agent: AgentProfile | null, documents: readonly { documentId: string; version: number; contentHash: string }[]): string {
  return sha(["CALL_ANALYSIS_LOGIC_V4", "CALL_ANALYSIS_PROMPT_V2", "CALL_REVIEW_PROMPT_V1", "KNOWLEDGE_CRITERIA_V3", interaction.id, interaction.transcript?.checksum ?? "none", agent ? `${agent.id}@${agent.updatedAt.toISOString()}` : "none", ...documents.map((document) => `${document.documentId}@${document.version}@${document.contentHash}`)].join("|"))
}

/** Proposta da análise em um dos contratos: `OBLIGATIONS_V1` (atual) ou o formulário por linha (`LINES_V7`, respostas anteriores). */
export type AnalysisProposals = { contract: "OBLIGATIONS_V1"; value: ModelObligationAnalysis } | { contract: "LINES_V7"; value: ModelCallAnalysis }
/** A resposta diz o contrato pela FORMA (o schema enviado garante o atual): obrigações primeiro; senão, o formulário por linha. */
export function parseAnalysisProposals(text: string): { ok: true; value: AnalysisProposals } | { ok: false; error: string } {
  const obligations = parseObligationAnalysisResponse(text)
  if (obligations.ok) return { ok: true, value: { contract: "OBLIGATIONS_V1", value: obligations.value } }
  const lines = parseCallAnalysisResponse(text)
  if (lines.ok) return { ok: true, value: { contract: "LINES_V7", value: lines.value } }
  return { ok: false, error: obligations.error }
}

/** O motivo de seleção não é evidência: fora da chave da proposta (a mesma análise serve a monitoria, investigação e mensagem). */
const PROPOSAL_SELECTION_PLACEHOLDER = "(motivo de seleção fora da chave da proposta)"

/**
 * CHAVES POR ETAPA. Proposta = o que o analisador VIU (sem o motivo de seleção) + versões do contrato e da extração; a execução
 * completa = proposta + lógica de verificação + contrato da revisão. Mudou só a revisão/lógica → só a revisão é refeita.
 */
export function analysisKeysOf(input: { interaction: InteractionForAnalysis; agent: AgentProfile | null; documents: readonly { documentId: string; version: number; contentHash: string }[]; context: ProcedureContext; projection: TranscriptProjection; transcriptStatus: TranscriptStatus; subject: string | null; products?: ProductContext | null }) {
  const { interaction, agent } = input
  const specialist = agent ? { name: agent.name, guidance: [agent.objective, agent.contextPrompt].filter(Boolean).join("\n\n") || null } : null
  const interactionView = (selectionReason: string) => ({ dateLabel: dateLabelOf(interaction.startedAt, interaction.timeZone), channel: interaction.channel, subject: input.subject, durationSeconds: interaction.endedAt ? (interaction.endedAt.getTime() - interaction.startedAt.getTime()) / 1000 : null, signals: interaction.flags.map((flag) => `${flag.name} = ${flag.value}`), selectionReason })
  const products = input.products ?? null
  const proposalTurn = renderCallAnalysisUserTurn({ specialist, interaction: interactionView(PROPOSAL_SELECTION_PLACEHOLDER), projection: input.projection, transcriptStatus: input.transcriptStatus, context: input.context, products })
  const scripts = input.context.documents.filter((document) => document.kind === "ARGUMENT_SCRIPT").map((document) => `G:${document.documentId}@${document.version}@${document.contentHash}`)
  // Modo produto: o contrato com produto e a fotografia do cadastro (o texto do catálogo já está na mensagem) mudam a proposta; sem
  // catálogo, a chave é exatamente a de antes (nenhuma análise anterior deixa de ser reaproveitada por causa do modo produto).
  const contract = obligationAnalysisContractFor(Boolean(products))
  const proposalKey = sha([CALL_ANALYSIS_PROMPT_VERSION, CRITERIA_EXTRACTION_VERSION, interaction.id, interaction.transcript?.checksum ?? "none", agent ? `${agent.id}@${agent.updatedAt.toISOString()}` : "none", ...input.documents.map((document) => `${document.documentId}@${document.version}@${document.contentHash}`), ...scripts, ...(products ? [`PRODUCTS:${products.fingerprint}`] : []), sha(`${contract.systemPrompt}\n${proposalTurn}`)].join("|"))
  return { proposalKey, analysisKey: sha([CALL_ANALYSIS_LOGIC_VERSION, CALL_REVIEW_PROMPT_VERSION, obligationReviewContractFor(Boolean(products)).promptVersion, proposalKey].join("|")), specialist, interactionView, contract }
}

export async function analyzeCall(deps: AnalyzeCallDeps, request: AnalyzeCallRequest): Promise<AnalyzeCallResult> {
  if (deps.allowCollaborator && !deps.allowCollaborator(request.collaboratorId)) throw new CollaboratorNotAllowedError(request.collaboratorId)
  const startedAt = deps.now()
  const interaction = await deps.loadInteraction(request.organizationId, request.interactionId)
  if (!interaction) throw new InteractionNotAnalyzableError("Interação não encontrada nesta organização.", "FEEDBACK_INTERACTION_NOT_FOUND")
  if (interaction.operatorId !== request.collaboratorId) throw new InteractionNotAnalyzableError("A interação não pertence ao colaborador desta execução.", "FEEDBACK_INTERACTION_NOT_OF_COLLABORATOR")
  const agent = request.agentId ? await deps.loadAgent(request.organizationId, request.agentId) : null
  const projection = projectTranscript(interaction.transcript?.content ?? "", { maxChars: TRANSCRIPT_MAX_CHARS })
  const transcriptStatus = interaction.transcript ? transcriptStatusOf(projection) : "UNAVAILABLE"
  // `SUBJECT_RESOLUTION_V2`: o assunto é o canônico do nível preferencial, senão o submotivo (sem submotivo, o motivo).
  const subject = interaction.subjectCanonical?.name ?? rawSubjectOf(interaction)
  const candidates = agent ? await deps.loadDocuments(request.organizationId, agent.id, interaction.startedAt) : []
  // Argumentários: vigentes na DATA DA CHAMADA no escopo do colaborador (a mesma versão vale para análise, revisão e composição).
  const scripts = deps.loadArgumentScripts ? await deps.loadArgumentScripts(request.organizationId, { teamId: interaction.teamId, subteamId: interaction.subteamId }, interaction.startedAt) : []
  // `PRODUCT_APPLICABILITY_V1`: o cadastro vigente NA DATA DA CHAMADA (antes da seleção: variantes de produto não competem pela relevância).
  const catalog = deps.loadProductCatalog ? await deps.loadProductCatalog(request.organizationId, interaction.startedAt, [...candidates.map((document) => document.documentId), ...scripts.map((script) => script.scriptId)]) : null
  const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript?.content ?? "", productScoped: new Set((catalog?.scopes ?? []).map((scope) => scope.sourceId)) })
  const context = buildProcedureContext(selection.selected, scripts)
  context.omitted = selection.omitted
  const presentedScripts = context.documents.filter((document) => document.kind === "ARGUMENT_SCRIPT")
  const products = productContextOf(catalog, { presentedSourceIds: context.documents.map((document) => document.documentId), metadata: interactionMetadataOf(interaction, subject) })
  if (products) for (const document of context.documents) document.productScopeLabel = scopeLabelFor(products, document.documentId)

  const { proposalKey, analysisKey, specialist, interactionView, contract } = analysisKeysOf({ interaction, agent, documents: selection.selected, context, projection, transcriptStatus, subject, products })
  const claim = await deps.memory.claimAnalysis({
    organizationId: request.organizationId,
    kind: "CALL_ANALYSIS",
    analysisKey,
    personId: interaction.operatorId,
    interactionId: interaction.id,
    indicatorDefinitionId: null,
    periodStart: null,
    periodEnd: null,
    agentId: agent?.id ?? null,
    trigger: request.trigger,
    logicVersion: CALL_ANALYSIS_LOGIC_VERSION,
    asOf: startedAt,
  }, startedAt, ANALYSIS_LEASE_SECONDS)
  if (claim.kind === "IN_PROGRESS") throw new AnalysisInProgressError()
  if (claim.kind === "COMPLETED") {
    const assessment = await deps.memory.getCallAssessmentByRun(request.organizationId, claim.run.id)
    return { runId: claim.run.id, reused: true, assessment, outcome: claim.run.outcome ?? "INSUFFICIENT_EVIDENCE", outcomeReasons: claim.run.outcomeReasons }
  }
  const runId = claim.runId
  const metrics: ModelCallMetric[] = []
  try {
    // Esta MESMA execução pode estar sendo retomada (estava suspensa com a revisão pendente).
    const previousCheckpoint = checkpointOf((await deps.memory.getRun(request.organizationId, runId))?.result)
    const provenance: Record<string, unknown> = {
      logicVersion: CALL_ANALYSIS_LOGIC_VERSION,
      promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
      reviewPromptVersion: CALL_REVIEW_PROMPT_VERSION,
      obligationReviewPromptVersion: OBLIGATION_REVIEW_PROMPT_VERSION,
      criteriaExtraction: CRITERIA_EXTRACTION_VERSION,
      proposalKey,
      transcriptChecksum: interaction.transcript?.checksum ?? null,
      transcriptTurns: projection.turns.length,
      transcriptStatus,
      agent: agent ? { id: agent.id, name: agent.name, configuredAt: agent.updatedAt.toISOString() } : null,
      documents: selection.selected.map((document) => ({ documentId: document.documentId, title: document.title, version: document.version, contentHash: document.contentHash, perspective: document.perspective, selection: document.selection })),
      omittedDocuments: selection.omitted,
      argumentScripts: presentedScripts.map((document) => ({ scriptId: document.documentId, versionId: document.argument?.versionId ?? null, name: document.title, version: document.version, contentHash: document.contentHash, scope: document.argument?.scopeLabel ?? null, sourceDocumentId: document.argument?.sourceDocumentId ?? null, perspective: document.perspective })),
      omittedArgumentScripts: context.omittedScripts ?? [],
      // Coincidências de TEXTO entre argumentário e base (nunca decisão; a equivalência é da leitura — `analysis.duplicates`).
      argumentSameText: context.sameText ?? [],
      evidenceAvailability: { transcript: transcriptStatus, operationalRecords: "NOT_INTEGRATED" },
      productApplicability: products ? { version: PRODUCT_APPLICABILITY_VERSION, fingerprint: products.fingerprint, analysisPromptVersion: contract.promptVersion, reviewPromptVersion: obligationReviewContractFor(true).promptVersion, nodes: products.nodes.length, criteria: products.criteria.map((criterion) => ({ handle: criterion.handle, versionId: criterion.versionId, version: criterion.version })), scopes: [...products.scopes.entries()].map(([sourceId, scope]) => ({ sourceId, assignmentId: scope.assignmentId, handles: scope.handles })) } : null,
      subjectAnchoredDocumentIds: selection.anchoredDocumentIds,
      procedureChars: context.renderedChars,
    }
    const snapshot = {
      interactionId: interaction.id,
      personId: interaction.operatorId,
      occurredAt: interaction.startedAt,
      timeZone: interaction.timeZone,
      subjectRaw: rawSubjectOf(interaction),
      subjectCanonical: interaction.subjectCanonical?.code ?? null,
      channel: interaction.channel,
      teamId: interaction.teamId,
      subteamId: interaction.subteamId,
      supervisorId: interaction.supervisorId,
      transcriptChecksum: interaction.transcript?.checksum ?? null,
      selectionReason: request.trigger.selectionReason,
    }
    // Sem base autorizada ou sem transcrição não há o que confrontar: insuficiência REAL, registrada como tal, sem modelo.
    if ((selection.selected.length === 0 && presentedScripts.length === 0) || transcriptStatus === "UNAVAILABLE") {
      const reason = transcriptStatus === "UNAVAILABLE" ? "TRANSCRIPT_UNAVAILABLE" : agent ? "NO_AUTHORIZED_KNOWLEDGE" : "NO_SPECIALIST"
      const analysis = emptyAnalysis(transcriptStatus, reason)
      await deps.memory.completeCallAnalysis(request.organizationId, runId, { snapshot, analysis, identities: new Map(), documentVersions: new Map(), provenance, metrics: { ...metricsSummaryOf(metrics), durationMs: deps.now().getTime() - startedAt.getTime() } }, deps.now())
      const assessment = await deps.memory.getCallAssessmentByRun(request.organizationId, runId)
      return { runId, reused: false, assessment, outcome: analysis.outcome, outcomeReasons: analysis.outcomeReasons }
    }

    // Identidade dos critérios desta versão de cada documento (reconciliada com a versão anterior, persistida uma vez).
    const identities = new Map<string, CriterionIdentity>()
    for (const document of selection.selected) {
      const lines = [...context.lines.values()].filter((line) => line.documentId === document.documentId).map((line) => ({ lineKey: line.lineKey, heading: line.heading, text: effectiveRuleText(line), position: line.position }))
      const resolved = await deps.memory.resolveCriteria(request.organizationId, { documentId: document.documentId, version: document.version, lines }, async () => {
        const previous = await deps.loadPreviousVersion(request.organizationId, document.documentId, document.version)
        return previous ? { version: previous.version, lines: documentLines({ documentId: document.documentId, title: document.title, version: previous.version, content: previous.content }) } : null
      })
      for (const [lineKey, identity] of resolved) identities.set(lineKey, identity)
    }
    // Itens de argumentário: identidade determinística do cadastro (argumentário + item + campo + modo + condição + texto).
    for (const line of context.lines.values()) {
      if (!line.argument) continue
      identities.set(line.lineKey, { lineKey: line.lineKey, criterionKey: line.argument.criterionKey, basis: line.argument.identityBasis, previousCriterionKey: line.argument.previousCriterionKey })
    }

    // ETAPA 1 — análise: a resposta JÁ PAGA com as mesmas propostas (mesma chave de proposta, ou a execução anterior a esta
    // correção com a mesma chave antiga) é reaproveitada; senão, uma chamada (+1 só de formato).
    const prior = await deps.memory.findStageResponses(request.organizationId, { interactionId: interaction.id, proposalKey, legacyAnalysisKeys: [legacyAnalysisKeyOf(interaction, agent, selection.selected)] })
    let proposals: AnalysisProposals | null = null
    let analysisResponse: StageResponse | null = null
    let resumedFrom: { runId: string; status: string } | null = null
    for (const entry of prior) {
      if (!entry.analysis) continue
      const parsed = parseAnalysisProposals(entry.analysis.text)
      if (!parsed.ok) continue
      proposals = parsed.value
      analysisResponse = entry.analysis
      resumedFrom = { runId: entry.runId, status: entry.status }
      break
    }
    if (!proposals) {
      // CONTRATO DA ANÁLISE (`CALL_ANALYSIS_PROMPT_V8` = `OBLIGATIONS_V1`): orientado ao caso — obrigações completas, não um
      // formulário por linha do documento. A mesma mensagem do usuário do contrato anterior (fontes, transcrição, argumentários).
      const userTurn = renderCallAnalysisUserTurn({ specialist, interaction: interactionView(request.trigger.selectionReason), projection, transcriptStatus, context, products })
      const base: EngineModelRequest = { stage: "CALL_ANALYSIS", systemPrompt: contract.systemPrompt, contents: [{ role: "user", text: userTurn }], responseSchema: contract.schema, tag: "analysis" }
      const first = await callModel(deps.model, base, metrics)
      let parsed = parseAnalysisProposals(first.text)
      let lastText = first.text
      if (!parsed.ok) {
        const retry = await callModel(deps.model, { ...base, contents: [...base.contents, { role: "model", text: first.text.slice(0, 20_000) }, { role: "user", text: CALL_ANALYSIS_FORMAT_RETRY }], tag: "retry:format" }, metrics)
        parsed = parseAnalysisProposals(retry.text)
        lastText = retry.text
        if (!parsed.ok) throw new ModelOutputContractError(`A análise da chamada não respeitou o contrato (${parsed.error}).`, "FEEDBACK_CALL_ANALYSIS_INVALID", { contract: "CALL_ANALYSIS", contractVersion: CALL_ANALYSIS_PROMPT_VERSION, violations: [{ path: "", code: parsed.error, message: "resposta fora do contrato" }], rawResponse: retry.text.slice(0, 60_000) })
      }
      proposals = parsed.value
      analysisResponse = { requestSha256: sha(`${base.systemPrompt}\n${base.contents[0]!.text}`), text: lastText.slice(0, 60_000) }
    }
    provenance.analysisContract = proposals.contract

    // ETAPA 2 — revisão (a já paga com o mesmo pedido é reaproveitada) e confirmação focal do que só a revisão encontrou.
    const reviewInputs = { context, projection, transcriptStatus, interactionId: interaction.id, subject, anchored: selection.anchoredDocumentIds, storedReviews: prior.flatMap((entry) => (entry.review ? [entry.review] : [])), storedConfirmations: prior.flatMap((entry) => (entry.confirmation ? [entry.confirmation] : [])) }
    const reviewed = proposals.contract === "OBLIGATIONS_V1" ? await reviewObligationAnalysis(deps, { model: proposals.value, ...reviewInputs, products }, metrics) : await reviewAnalysis(deps, { model: proposals.value, ...reviewInputs }, metrics)
    // Respostas BRUTAS (com a assinatura do pedido): permitem retomar/reaproveitar uma etapa paga — nunca vão a nenhuma tela.
    provenance.modelResponses = { analysis: analysisResponse, review: reviewed.raw, ...(reviewed.confirmationRaw ? { confirmation: reviewed.confirmationRaw } : {}) }
    provenance.stageReuse = { analysis: resumedFrom ? { reused: true, fromRunId: resumedFrom.runId, fromStatus: resumedFrom.status } : { reused: false }, review: { reused: reviewed.reviewReused } }
    const metricsNow = () => ({ ...metricsSummaryOf(metrics), durationMs: deps.now().getTime() - startedAt.getTime() })

    if (reviewed.pending) {
      // REVISÃO PENDENTE: a execução é SUSPENSA (não concluída) com as propostas — nada vai para a memória; a próxima execução
      // autorizada retoma só a revisão. Falha técnica segue a política de nova tentativa do motor; orçamento interrompe esta
      // execução; resposta fora do contrato encerra esta execução (outra execução pode tentar de novo).
      const at = deps.now().toISOString()
      const checkpoint: CallAnalysisCheckpoint = { version: CALL_ANALYSIS_CHECKPOINT_VERSION, stage: "REVIEW_PENDING", proposalKey, reason: reviewed.pending.reason, error: reviewed.pending.error, reviewAttempts: (previousCheckpoint?.reviewAttempts ?? 0) + (reviewed.pending.attempted ? 1 : 0), since: previousCheckpoint?.since ?? at, lastAttemptAt: at }
      await deps.memory.suspendCallAnalysis(request.organizationId, runId, { error: `REVIEW_PENDING:${reviewed.pending.reason}:${reviewed.pending.error}`, checkpoint, provenance, metrics: metricsNow() }, deps.now())
      if (reviewed.pending.reason === "BUDGET") throw reviewed.pending.cause
      if (reviewed.pending.reason === "CONTRACT") throw new ModelOutputContractError("A revisão da análise não respeitou o contrato — a análise ficou guardada para ser revisada de novo.", "FEEDBACK_CALL_REVIEW_INVALID", { contract: "CALL_REVIEW", contractVersion: CALL_REVIEW_PROMPT_VERSION, violations: [{ path: "", code: reviewed.pending.error, message: "resposta fora do contrato" }], rawResponse: "" })
      throw new CallReviewPendingError(reviewed.pending.reason, reviewed.pending.error)
    }

    // PRÁTICAS (`PRACTICE_IDENTITY_V1`) e TEMAS (`PRACTICE_THEMES_V1`): as linhas das regras avaliadas que ainda não foram organizadas
    // (uma vez por linha), as obrigações compostas sem linha de conduta e o tema dos pontos novos. Nunca derruba a análise — sem
    // orçamento ou com falha, o que faltou fica com a própria identidade e volta na próxima vez.
    if (deps.organizePractices) {
      const organized = await organizePracticesOfAnalysis({ memory: deps.memory, call: (request) => callModel(deps.model, request, metrics), now: deps.now }, request.organizationId, context, reviewed.analysis.criteria)
      provenance.practices = organized.lines
      if (organized.combined) provenance.practiceCombined = organized.combined
      if (organized.themes) provenance.practiceThemes = organized.themes
    }

    const analysis = reviewed.analysis
    const documentVersions = new Map([...selection.selected.map((document) => [document.documentId, { version: document.version, perspective: document.perspective }] as const), ...presentedScripts.map((document) => [document.documentId, { version: document.version, perspective: document.perspective }] as const)])
    await deps.memory.completeCallAnalysis(request.organizationId, runId, { snapshot, analysis, identities, documentVersions, provenance, metrics: metricsNow() }, deps.now())
    const assessment = await deps.memory.getCallAssessmentByRun(request.organizationId, runId)
    return { runId, reused: false, assessment, outcome: analysis.outcome, outcomeReasons: analysis.outcomeReasons }
  } catch (error) {
    // Suspensa (revisão pendente) já não está RUNNING: isto só marca falhas das outras etapas.
    await deps.memory.failAnalysis(request.organizationId, runId, error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2_000) : "erro desconhecido", deps.now()).catch(() => undefined)
    throw error
  }
}

/**
 * METADADOS da chamada que a identificação pode citar (M-n): registros do sistema gravados com a interação — nunca falas. O que cada
 * um diz sobre o produto é leitura do modelo (um assunto registrado pode nomear o motivo e não o produto).
 */
export function interactionMetadataOf(interaction: InteractionForAnalysis, subject: string | null): { label: string; value: string }[] {
  return [
    ...(subject ? [{ label: "Assunto registrado", value: subject }] : []),
    ...(interaction.reason && interaction.reason !== subject ? [{ label: "Motivo registrado", value: interaction.reason }] : []),
    ...(interaction.subReason && interaction.subReason !== subject ? [{ label: "Submotivo registrado", value: interaction.subReason }] : []),
    ...(interaction.channel ? [{ label: "Canal", value: interaction.channel }] : []),
    ...interaction.flags.map((flag) => ({ label: `Sinal ${flag.name}`, value: flag.value })),
  ]
}

function emptyAnalysis(transcriptStatus: VerifiedCallAnalysis["transcriptStatus"], reason: string): VerifiedCallAnalysis {
  return {
    logicVersion: CALL_ANALYSIS_LOGIC_VERSION,
    transcriptStatus,
    scenario: { customerNeed: "", conditions: [], procedureHandle: null, procedureDocumentId: null, procedureTitle: null, procedureVersion: null, rulePerspective: null, procedureRationale: null, pathSections: [], correctPath: "", pathTaken: "", declaredPathAssessment: "UNDETERMINED", proposedPathAssessment: "NO_PROCEDURE", pathAssessment: "NO_PROCEDURE", pathConfirmation: "NOT_A_CLAIM", pathRationale: "", pathEvidence: [] },
    criteria: [],
    notRequirements: [],
    sectionDispositions: [],
    coverage: { requiredLines: [], closingSections: [], missing: [], repairAttempted: false, status: "PARTIAL" },
    sourceConflicts: [],
    limitations: [reason === "TRANSCRIPT_UNAVAILABLE" ? "A chamada não tem transcrição disponível." : reason === "NO_AUTHORIZED_KNOWLEDGE" ? "O especialista não tem base de conhecimento publicada para confrontar a condução." : "Nenhum especialista configurado para esta análise."],
    checks: { procedureSelection: "NO_PROCEDURE", evidenceRejected: 0, downgraded: 0, contractViolations: [], review: { version: CALL_REVIEW_VERSION, attempted: false, available: false, error: null, claims: 0, confirmed: 0, unconfirmed: 0, refuted: 0, linesAssessed: 0, path: null, violations: [] } },
    outcome: "INSUFFICIENT_EVIDENCE",
    outcomeReasons: [reason],
  }
}

/** Texto legível do diagnóstico (nó do Workflow, Revisão humana, QA Lab) — frases do sistema. */
export function describeCallAnalysis(analysis: VerifiedCallAnalysis): string {
  if (analysis.outcome === "INSUFFICIENT_EVIDENCE") return `Análise da chamada sem conclusão: ${analysis.limitations[0] ?? analysis.outcomeReasons.join(", ")}`
  const count = (status: string) => analysis.criteria.filter((criterion) => criterion.status === status && !criterion.ruleConflict).length
  const pathLabel = { CORRECT: "caminho correto", INCORRECT: "caminho inadequado para o cenário", PARTIALLY_CORRECT: "caminho certo com etapas faltando", UNDETERMINED: "caminho não determinado", NO_PROCEDURE: "sem procedimento" }[analysis.scenario.pathAssessment]
  return [
    `Procedimento: ${analysis.scenario.procedureTitle ?? "—"} (${pathLabel}).`,
    `Necessidade do cliente: ${analysis.scenario.customerNeed}`,
    `Critérios confirmados: ${count("MET")} cumprido(s), ${count("NOT_MET")} não cumprido(s), ${count("PARTIAL")} parcial(is); ${analysis.criteria.filter((criterion) => criterion.confirmation === "UNCONFIRMED" || criterion.confirmation === "REFUTED").length} conclusão(ões) da análise não confirmada(s) pela revisão.`,
    // Regras × ocorrências (`CONDUCT_OCCURRENCE_V1`): a mesma conduta julgada por duas regras é UM desvio, com as duas bases.
    ...(analysis.coverage.occurrences && analysis.coverage.occurrences.adverseOccurrences < analysis.coverage.occurrences.adverseRules ? [`Desvios: ${analysis.coverage.occurrences.adverseOccurrences} ocorrência(s) de conduta, em ${analysis.coverage.occurrences.adverseRules} regra(s).`] : []),
    ...analysis.criteria.filter((criterion) => (criterion.status === "NOT_MET" || criterion.status === "PARTIAL") && !criterion.ruleConflict && criterion.materiality !== "LOW").slice(0, 5).map((criterion) => `- ${criterion.text}: ${criterion.rationale ?? "não cumprido"}`),
    ...(analysis.coverage.status === "PARTIAL" ? ["Cobertura parcial do caminho do procedimento."] : []),
  ].join("\n")
}
