import { FeedbackWriterError, writerFailureCategoryOf, type WriterFailureCategory, type WriterProvenance } from "../../interaction-feedback/domain/feedback-writer-provenance.js"
import { personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { normalizeInvestigationResult, type FeedbackDomain, type FeedbackInvestigationResultV1, type InvestigationSourceType } from "../domain/feedback-investigation-result.js"
import { buildIndicatorItems } from "../domain/indicator-adapter.js"
import { periodLabelOf, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { buildMonitoringItems } from "../domain/monitoring-adapter.js"
import { isContractV5 } from "../../agents/domain/process-assessment-contract.js"
import { assessmentAuditView, verifyProcessAssessments, type ProcessAssessmentAuditView, type PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { buildProcessItems } from "../domain/process-items.js"
import { applicabilityWording, buildApplicabilityItems } from "../domain/applicability-items.js"
import { observationsFrom, type ProcessObservation } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { IndicatorDiagnosisOutcome } from "../../indicator-diagnosis/domain/diagnosis-outcome.js"
import { runIndicatorDiagnosisStep, type DiagnosisPlanLoader, type DiagnosticStrategyResolver, type PeerPracticeLoader } from "./indicator-diagnosis-step.js"
import { segmentFactText } from "../../indicator-diagnosis/domain/indicator-diagnosis.js"
import { decideReliableItem, holdForStrategy, isEmittableSection, isSystemRenderedProcessItem, structuralBlockOf, type ReliableFeedbackPolicy, type ReliableItemDraft, type ReliableWriterOutcome } from "../domain/reliable-feedback-item.js"
import { FEEDBACK_PRESENTATION_VERSION, presentationViolations } from "../domain/feedback-presentation.js"
import { confirmedProductsOf, currentDisposition, emittedItems, isProcessFeedback, findingsSummaryOf, nodeOutputOf, presentationContextOf, presentationOf, RELIABLE_FEEDBACK_ARTIFACT_CONTRACT, SECTION_LABELS, type ArtifactItem, type ArtifactReviewState, type ReliableFeedbackArtifactV1, type ReliableFeedbackNodeOutput } from "../domain/reliable-feedback-artifact.js"
import {
  buildIndicatorWriterInput,
  buildMonitoringWriterInput,
  indicatorFallbackWording,
  presentationBriefOf,
  presentationDraftOf,
  monitoringFallbackOf,
  monitoringFallbackWording,
  resolveSlots,
  toMonitoringWriterItem,
  validateIndicatorWording,
  validateMonitoringWording,
  type IndicatorWriterItem,
  type MonitoringWriterItem,
  type SlotResolution,
} from "../domain/reliable-writer.js"
import { INDICATOR_WRITER_PROMPT_VERSION, WORKFLOW_MONITORING_WRITER_PROMPT_VERSION } from "../domain/reliable-writer-prompts.js"
import { presentationLabelOf } from "../domain/behavior-presentation.js"
import { cardViolations, compositionOutcome, narrativeBriefOf, narrativeViolations, SUPERVISOR_NARRATIVE_VERSION } from "../domain/supervisor-narrative.js"
import { NARRATIVE_FACTUALITY_PROMPT_VERSION, NARRATIVE_FACTUALITY_VERSION, type StoredFactuality } from "../domain/narrative-factuality.js"
import { SUPERVISOR_NARRATIVE_PROMPT_VERSION } from "../domain/supervisor-narrative-prompt.js"
import type { ArtifactRecord, NewReliableReview, ReliableFeedbackStore, ReliableFeedbackWriterPort, ReliableReviewRecord, ReviewAnalysisContext } from "./ports.js"
import { completePrvClosingArtifact, type PrvGenerationDeps } from "./generate-prv-closing-feedback.js"
import { isPrvClosingSource, prvClosingKeyOf } from "./prv-closing-step.js"

/**
 * V1.5.12 — GERAR FEEDBACK CONFIÁVEL (caso de uso da ação de Workflow "Gerar feedback").
 *
 *   saída do nó de origem (Agent/Orquestrador) → normalização (identidade × matrícula, fail-closed)
 *     → adaptador do domínio: MONITORIA (transcrição real) | INDICADOR (contexto canônico do sistema)
 *     → redator (UMA chamada, zero retry; nada a escrever = nenhuma chamada) → validadores → fallback do item inteiro
 *     → política por item (READY | HOLD_FOR_QA | BLOCKED) → artefato + revisões de QA (uma transação)
 *
 * NÃO investiga de novo (nenhuma Fase A/B, nenhum Planner — a inteligência é a da origem), NÃO entrega, NÃO notifica.
 * IDEMPOTENTE pela chave matrícula × nó × origem: concluído = reaproveitado (sem redator de novo); em andamento por outro =
 * erro técnico (o motor tenta de novo); falha técnica = FAILED, retomável.
 */
export const RELIABLE_FEEDBACK_CONTRACT_VERSION = RELIABLE_FEEDBACK_ARTIFACT_CONTRACT
export const RELIABLE_FEEDBACK_LEASE_SECONDS = 180

export type ReliableGenerationRequest = {
  organizationId: string
  enrollmentId: string | null
  workflowId: string | null
  workflowVersionId: string | null
  nodeId: string
  sourceNodeId: string
  sourceType: InvestigationSourceType
  domain: FeedbackDomain
  sourceNodeOutput: unknown
  collaboratorId: string
  interactionId: string | null
  indicatorMeasurementId: string | null
  configuredAgentId: string | null
}

/** Interação DA organização e DO colaborador (senão null): transcrição vigente, rótulo exibível e nomes de outros operadores (privacidade do trecho). */
export type MonitoringContextLoader = (organizationId: string, interactionId: string, collaboratorId: string) => Promise<{ transcript: string; label: string; otherOperatorNames: string[]; /** V1.7.1g — nome do próprio colaborador (papel das menções). */ subjectOperatorName?: string | null } | null>
export type IndicatorContextLoader = (organizationId: string, measurementId: string, collaboratorId: string) => Promise<IndicatorCanonicalContext | null>
/** V1.7.1b — primeiro nome do colaborador, do CADASTRO (mesma organização); null = saudação sem nome. Nunca vai ao modelo. */
export type RecipientLoader = (organizationId: string, collaboratorId: string) => Promise<{ firstName: string } | null>
/** V1.6.0 — versão PUBLICADA atual de documentos DA organização (não excluídos). Id fora da organização = ausente. */
export type PublishedKnowledgeLoader = (organizationId: string, documentIds: readonly string[]) => Promise<Map<string, PublishedKnowledgeDocument>>

export type ReliableGenerationDeps = {
  enabled: boolean
  store: ReliableFeedbackStore
  writer: ReliableFeedbackWriterPort
  policy: ReliableFeedbackPolicy
  loadMonitoringContext: MonitoringContextLoader
  loadIndicatorContext: IndicatorContextLoader
  loadPublishedKnowledge: PublishedKnowledgeLoader
  /** V1.6.1 — diagnóstico do indicador (plano recalculado pelo sistema + dados agregados de pares). */
  loadIndicatorDiagnosisPlan: DiagnosisPlanLoader
  loadPeerPracticeData: PeerPracticeLoader
  resolveDiagnosticStrategy: DiagnosticStrategyResolver
  /** V1.7.1b — opcional: sem ele a saudação é "Olá!" (nunca um nome inventado). */
  loadRecipient?: RecipientLoader
  /** INDICATOR DIAGNOSIS V1 — diagnóstico do FECHAMENTO do PRV (plano determinístico + agregado do Subgrupo). Ausente = não suportado. */
  prv?: PrvGenerationDeps["prv"]
  now: () => Date
}

export class ReliableFeedbackDisabledError extends Error {
  constructor() {
    super("A camada de confiabilidade do feedback está desligada neste ambiente (INIA_INTERACTION_FEEDBACK_PIPELINE).")
    this.name = "RELIABLE_FEEDBACK_DISABLED"
  }
}
export class ReliableGenerationInProgressError extends Error {
  constructor() {
    super("A geração deste feedback está em andamento em outra execução — será retomada.")
    this.name = "RELIABLE_FEEDBACK_IN_PROGRESS"
  }
}

export const artifactKeyOf = (request: Pick<ReliableGenerationRequest, "enrollmentId" | "nodeId" | "sourceNodeId">) => `WORKFLOW_NODE:${request.enrollmentId ?? "SIMULATION"}:${request.nodeId}:${request.sourceNodeId}`

export type ReliableGenerationResult = { artifactId: string; reused: boolean; nodeOutput: ReliableFeedbackNodeOutput; record: ArtifactRecord; reviews: ReliableReviewRecord[] }

const reviewStates = (reviews: readonly ReliableReviewRecord[]): ArtifactReviewState[] => reviews.map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus, finalWording: review.finalWording }))

/** Resultado atual de um artefato concluído (geração × QA) — o que o Workflow faz agora. */
export async function currentResultOf(store: ReliableFeedbackStore, record: ArtifactRecord, reused: boolean): Promise<ReliableGenerationResult> {
  const reviews = await store.listReviews(record.organizationId, record.id)
  return { artifactId: record.id, reused, record, reviews, nodeOutput: nodeOutputOf(record.id, record.artifact!, reviewStates(reviews)) }
}

/**
 * `compositionOnly` (MONITORING ARCHITECTURE V2 — fase 4): avaliação de processo no contrato V5. O especialista é a fonte factual e o
 * redator de COMPOSIÇÃO é o único que escreve para o colaborador: nenhuma chamada ao redator de itens; o texto de cada ponto (detalhes,
 * QA, fallback) é a projeção determinística do próprio assessment (regra verificada + falas verificadas + status).
 */
type DomainPreparation = { items: ReliableItemDraft[]; label: string; canonical: IndicatorCanonicalContext | null; blockedReason: string | null; processAssessment: ProcessAssessmentAuditView | null; excludedForMateriality: string[]; indicatorDiagnosis: IndicatorDiagnosisOutcome | null; observations: ProcessObservation[]; noDiagnosisHold?: boolean; compositionOnly?: boolean }

async function prepareDomain(deps: ReliableGenerationDeps, request: ReliableGenerationRequest, result: FeedbackInvestigationResultV1): Promise<DomainPreparation> {
  const none = { processAssessment: null, excludedForMateriality: [], indicatorDiagnosis: null, observations: [] }
  if (request.domain === "MONITORING") {
    const context = request.interactionId ? await deps.loadMonitoringContext(request.organizationId, request.interactionId, request.collaboratorId) : null
    if (!context || context.transcript.trim().length === 0) return { items: [], label: "Atendimento", canonical: null, blockedReason: "INTERACTION_NOT_ANALYZABLE", ...none }
    // V1.7.1g — papel de cada primeiro nome (cliente × próprio colaborador × terceiro) pela estrutura da transcrição.
    const displayContext = { otherOperatorNames: context.otherOperatorNames, mentionRoles: personMentionRolesOf(context.transcript, context.subjectOperatorName ?? null) }
    // V1.6.0 — PROCESS-CENTRIC: com avaliação de processo na origem, o feedback nasce SÓ das etapas verificadas (a conclusão
    // solta da origem não vira item — seria o caminho sem regra da base).
    if (result.processAssessments.length > 0) {
      const documentIds = [...new Set(result.processAssessments.flatMap((source) => source.presented.map((excerpt) => excerpt.documentId)))]
      const published = documentIds.length > 0 ? await deps.loadPublishedKnowledge(request.organizationId, documentIds) : new Map()
      // V1.7.1 — o assunto estruturado da interação (parte do rótulo depois de " · ") é um dos sinais de aplicabilidade da omissão.
      const subject = context.label.includes(" · ") ? context.label.split(" · ").slice(1).join(" · ") : null
      // V1.7.1n — monitoria por Flag: o plano de cobertura do fechamento vale (etapas OBRIGATÓRIAS do catálogo).
      const verified = verifyProcessAssessments({ sources: result.processAssessments, interactionId: request.interactionId!, transcript: context.transcript, published, subject, coveragePlan: true })
      const processItems = buildProcessItems(verified, displayContext)
      // V1.7.1b — produto não confirmado: "Vale confirmar o produto" (sistema) depois dos pontos de desenvolvimento e fortes.
      const attention = buildApplicabilityItems(verified, displayContext, processItems.items.length).map((item, position) => ({ ...item, priority: { rank: processItems.items.length + position + 1, policy: "PROCESS_ITEM_ORDER_V1", basis: ["APPLICABILITY_ATTENTION"] } }))
      const items = [...processItems.items, ...attention]
      const excludedForMateriality = processItems.excludedForMateriality
      const compositionOnly = result.processAssessments.every((source) => isContractV5(source.assessment.validation))
      return { items, label: context.label, canonical: null, blockedReason: items.length === 0 ? "NO_EVIDENCED_PROCESS_CHECKPOINT" : null, processAssessment: assessmentAuditView(verified), excludedForMateriality, indicatorDiagnosis: null, observations: observationsFrom(request.collaboratorId, [{ interactionId: request.interactionId!, assessment: verified }]), compositionOnly }
    }
    const { items } = buildMonitoringItems({ result, interactionId: request.interactionId!, transcript: context.transcript, displayContext })
    return { items, label: context.label, canonical: null, blockedReason: items.length === 0 ? "SOURCE_HAS_NO_CLAIMS" : null, ...none }
  }
  const canonical = request.indicatorMeasurementId ? await deps.loadIndicatorContext(request.organizationId, request.indicatorMeasurementId, request.collaboratorId) : null
  if (!canonical) return { items: [], label: "Indicador", canonical: null, blockedReason: "NO_CANONICAL_INDICATOR_CONTEXT", ...none }
  const label = `${canonical.indicator.name} · ${periodLabelOf(canonical.measurement.periodStart, canonical.measurement.periodEnd)}`
  const factItems = buildIndicatorItems({ result, canonical })
  if (!result.indicatorDiagnosis) return { items: factItems, label, canonical, blockedReason: null, ...none }
  // V1.6.1 — DIAGNÓSTICO: o fato oficial continua sendo o item principal; os padrões sustentados na amostra vêm depois.
  const diagnosis = await runIndicatorDiagnosisStep(deps, { organizationId: request.organizationId, collaboratorId: request.collaboratorId, measurementId: request.indicatorMeasurementId!, enrollmentId: request.enrollmentId, agentId: request.configuredAgentId, canonical, source: result.indicatorDiagnosis, startIndex: factItems.length })
  // Onde o resultado se concentra (quando o sistema localizou): fato do SISTEMA no item do resultado oficial.
  const segmentText = diagnosis.plan ? segmentFactText(diagnosis.plan) : null
  const withSegment = factItems.map((item, position) => (position === 0 && segmentText && diagnosis.plan?.selectedSegment ? { ...item, facts: [...item.facts, { role: "ANALISE" as const, topic: "SEGMENT" as const, text: segmentText, truncated: false, masked: false }] } : item))
  const base = { label, canonical, processAssessment: null, excludedForMateriality: diagnosis.excludedForMateriality, indicatorDiagnosis: diagnosis.outcome, observations: diagnosis.observations }
  // V1.6.2 — SEM DIAGNÓSTICO ACIONÁVEL, a estratégia decide (nunca "sugestão genérica"): factual (padrão), QA ou nada.
  if (diagnosis.outcome.status === "NO_ACTIONABLE_DIAGNOSIS") {
    if (diagnosis.parameters.noDiagnosisBehavior === "NO_FEEDBACK") return { ...base, items: [], blockedReason: "NO_ACTIONABLE_DIAGNOSIS_NO_FEEDBACK" }
    if (diagnosis.parameters.noDiagnosisBehavior === "HOLD_FOR_QA") return { ...base, items: withSegment, blockedReason: null, noDiagnosisHold: true }
  }
  return { ...base, items: [...withSegment, ...diagnosis.items], blockedReason: null }
}

type WriterRun = { resolutions: SlotResolution[]; slots: Map<number, string>; writerInput: unknown; effectClaimMode: string | null; rawOutput: unknown; error: string | null; provenance: WriterProvenance | null; invoked: boolean; promptVersion: string | null; writerItems: Map<number, MonitoringWriterItem | IndicatorWriterItem>; /** V1.7.1d — o que fica em `writer_raw_output`: a saída válida ou a resposta REJEITADA com o diagnóstico. */ storedRawOutput: unknown; failureCategory: WriterFailureCategory | null }

/**
 * V1.7.1d — RESPOSTA REJEITADA DO REDATOR, guardada no próprio artefato (`writer_raw_output`, caminho administrativo — nunca
 * exibida ao colaborador nem ao QA): código, caminhos, hash, motivo de término do provedor e o texto de aplicação devolvido.
 */
export type RejectedWriterOutput = { kind: "REJECTED_WRITER_OUTPUT"; code: string; category: WriterFailureCategory; detail: string | null; responseSha256: string | null; finishReason: string | null; model: string | null; schemaVersion: string | null; attempt: 1; rejectedAt: string; text: string | null }

/** V1.7.1d — falha TRANSITÓRIA do redator: o nó falha e o motor aplica a política de retry por categoria (nada é gravado). */
export class WriterTransientError extends DomainError {
  constructor(code: string) {
    super(`O redator do feedback não respondeu (${code}) — nova tentativa pela política de retry.`, "WRITER_TRANSIENT_PROVIDER_ERROR", 503, { category: "PROVIDER_ERROR", writerCode: code })
    this.name = "WriterTransientError"
  }
}

async function runWriter(deps: ReliableGenerationDeps, request: ReliableGenerationRequest, prepared: DomainPreparation): Promise<WriterRun> {
  // V1.7.1b — ponto de aplicabilidade é texto do SISTEMA: nunca vai ao redator.
  // V1.7.1i — etapa composta PARCIAL também: o texto é do sistema (o redator não sabe quais itens foram verificados).
  const writable = prepared.items.filter((item) => structuralBlockOf(item) === null && item.section !== "ATTENTION" && !isSystemRenderedProcessItem(item))
  const slots = new Map(writable.map((item, position) => [item.index, `ITEM_${position + 1}`]))
  const empty: WriterRun = { resolutions: [], slots, writerInput: null, effectClaimMode: null, rawOutput: null, error: null, provenance: null, invoked: false, promptVersion: null, writerItems: new Map(), storedRawOutput: null, failureCategory: null }
  // MONITORING V2 — contrato V5: um único redator (composição). O redator de itens nunca é chamado.
  if (writable.length === 0 || prepared.compositionOnly) return { ...empty, slots: new Map() }
  const entries = writable.map((item) => ({ item, slot: slots.get(item.index)! }))
  let rawOutput: unknown = null
  let error: string | null = null
  let provenance: WriterProvenance | null = null
  let storedRawOutput: unknown = null
  let failureCategory: WriterFailureCategory | null = null
  const call = async (write: () => Promise<{ rawOutput: unknown; provenance?: WriterProvenance | null }>) => {
    try {
      const written = await write()
      rawOutput = written.rawOutput
      storedRawOutput = written.rawOutput
      provenance = written.provenance ?? null
    } catch (caught) {
      error = caught instanceof Error ? caught.name : "WRITER_ERROR"
      provenance = caught instanceof FeedbackWriterError ? caught.provenance : null
      failureCategory = caught instanceof FeedbackWriterError ? writerFailureCategoryOf(caught) : "WRITER_UNAVAILABLE"
      // Transitório: não vira texto de segurança — o nó falha e o motor tenta de novo pela política (sem gravar o artefato).
      if (failureCategory === "TRANSIENT_PROVIDER_ERROR") throw new WriterTransientError(error)
      if (caught instanceof FeedbackWriterError) {
        const answered = caught.provenance
        storedRawOutput = { kind: "REJECTED_WRITER_OUTPUT", code: caught.code, category: failureCategory, detail: answered?.validation.detail ?? null, responseSha256: answered?.responseSha256 ?? null, finishReason: answered?.finishReason ?? null, model: answered?.responseModel ?? null, schemaVersion: answered?.schemaVersion ?? null, attempt: 1, rejectedAt: deps.now().toISOString(), text: caught.rejectedResponse } satisfies RejectedWriterOutput
      }
    }
  }
  // V1.7.1b — resumo para a abertura/fechamento (sem nome): etapas, pontos a confirmar, produtos confirmados, indicador.
  const confirmed = confirmedProductsOf(prepared.processAssessment?.applicability as Parameters<typeof confirmedProductsOf>[0]).map((entry) => entry.product)
  if (request.domain === "MONITORING") {
    const input = buildMonitoringWriterInput(prepared.label, entries, presentationBriefOf(prepared.label, prepared.items, { confirmedProducts: confirmed }))
    await call(() => deps.writer.writeMonitoring(input))
    const resolutions = resolveSlots(input.items, rawOutput, (wording, item) => validateMonitoringWording(wording, item, input.interactionLabel), monitoringFallbackWording, (item) => monitoringFallbackOf(item).specific)
    return { resolutions, slots, writerInput: input, effectClaimMode: input.effectClaimMode, rawOutput, error, provenance, invoked: true, promptVersion: WORKFLOW_MONITORING_WRITER_PROMPT_VERSION, writerItems: new Map(input.items.map((item, position) => [writable[position]!.index, item])), storedRawOutput, failureCategory }
  }
  const canonical = prepared.canonical!
  const facts = prepared.canonical ? { name: canonical.indicator.name, period: prepared.label.split(" · ").slice(1).join(" · "), comparison: prepared.items.find((item) => item.kind === "INDICATOR_TARGET_MET") ? "dentro da meta" : "fora da meta", sampleAnalyzed: prepared.items.some((item) => item.kind === "INDICATOR_DEVELOPMENT_PATTERN" || item.kind === "INDICATOR_STRENGTH_PATTERN" || item.kind === "INDICATOR_APPLICABILITY_POINT") } : null
  const input = buildIndicatorWriterInput(entries, canonical, presentationBriefOf(prepared.label, prepared.items, { indicator: facts }))
  await call(() => deps.writer.writeIndicator(input))
  const resolutions = resolveSlots(input.items, rawOutput, (wording, item) => validateIndicatorWording(wording, item, canonical), indicatorFallbackWording)
  return { resolutions, slots, writerInput: input, effectClaimMode: input.effectClaimMode, rawOutput, error, provenance, invoked: true, promptVersion: INDICATOR_WRITER_PROMPT_VERSION, writerItems: new Map(input.items.map((item, position) => [writable[position]!.index, item])), storedRawOutput, failureCategory }
}

export async function generateReliableFeedback(deps: ReliableGenerationDeps, request: ReliableGenerationRequest): Promise<ReliableGenerationResult> {
  if (!deps.enabled) throw new ReliableFeedbackDisabledError()
  const now = deps.now()
  const prvClosing = request.domain === "INDICATOR" && isPrvClosingSource(request.sourceNodeOutput)
  const identity = {
    organizationId: request.organizationId,
    artifactKey: artifactKeyOf(request),
    enrollmentId: request.enrollmentId,
    workflowId: request.workflowId,
    workflowVersionId: request.workflowVersionId,
    nodeId: request.nodeId,
    sourceNodeId: request.sourceNodeId,
    sourceType: request.sourceType,
    domain: request.domain,
    collaboratorId: request.collaboratorId,
    interactionId: request.domain === "MONITORING" ? request.interactionId : null,
    indicatorMeasurementId: request.domain === "INDICATOR" ? request.indicatorMeasurementId : null,
    contractVersion: RELIABLE_FEEDBACK_CONTRACT_VERSION,
    // INDICATOR DIAGNOSIS V1 — feedback do FECHAMENTO: a chave do diagnóstico identifica o sujeito (não há medição diária).
    prvClosingKey: prvClosing ? prvClosingKeyOf(request.sourceNodeOutput) : null,
  }
  const claim = await deps.store.claim(identity, now, RELIABLE_FEEDBACK_LEASE_SECONDS)
  if (claim.kind === "COMPLETED") return currentResultOf(deps.store, claim.record, true)
  if (claim.kind === "IN_PROGRESS") throw new ReliableGenerationInProgressError()
  const artifactId = claim.artifactId
  try {
    if (prvClosing) return currentResultOf(deps.store, await completePrvClosingArtifact(deps, request, artifactId), false)
    const normalization = normalizeInvestigationResult({ sourceNodeOutput: request.sourceNodeOutput, sourceType: request.sourceType, sourceNodeId: request.sourceNodeId, domain: request.domain, organizationId: request.organizationId, collaboratorId: request.collaboratorId, enrollment: { interactionId: request.interactionId, indicatorMeasurementId: request.indicatorMeasurementId }, configuredAgentId: request.configuredAgentId })
    const subject = { collaboratorId: request.collaboratorId, interactionId: identity.interactionId, indicatorMeasurementId: identity.indicatorMeasurementId }
    const base = { contract: RELIABLE_FEEDBACK_ARTIFACT_CONTRACT, domain: request.domain, sourceNodeId: request.sourceNodeId, sourceType: request.sourceType, subject, policyVersion: deps.policy.version }
    if (!normalization.ok) {
      // Origem incompatível/identidade divergente = resultado FUNCIONAL bloqueado (fail-closed), nunca emitido.
      const artifact: ReliableFeedbackArtifactV1 = { ...base, label: request.domain === "MONITORING" ? "Atendimento" : "Indicador", items: [], uncertainties: [], blockedReason: normalization.reason, writer: { invoked: false, skippedReason: normalization.reason, error: null, promptVersion: null } }
      const record = await deps.store.complete(request.organizationId, artifactId, { disposition: "BLOCKED", policyVersion: deps.policy.version, normalizedInput: { failure: normalization.reason }, canonicalContext: null, artifact, writerInput: null, writerRawOutput: null, writerError: null, writerProvenance: null, reviews: [] }, deps.now())
      return currentResultOf(deps.store, record, false)
    }
    const prepared = await prepareDomain(deps, request, normalization.result)
    const writer = await runWriter(deps, request, prepared)
    const items: ArtifactItem[] = prepared.items.map((item) => {
      const slot = writer.slots.get(item.index) ?? null
      const resolution = slot ? writer.resolutions.find((entry) => entry.slot === slot) ?? null : null
      const writerItem = writer.writerItems.get(item.index)
      const claimModes = writerItem ? { effect: writer.effectClaimMode ?? "", action: "actionClaimMode" in writerItem ? writerItem.actionClaimMode ?? null : null } : null
      const outcome: ReliableWriterOutcome | null = resolution ? { invoked: writer.invoked, writerError: writer.error, source: resolution.source, violations: resolution.violations, wording: resolution.wording, claimModes, ...(resolution.fallbackCheck ? { fallbackCheck: resolution.fallbackCheck } : {}) } : null
      const { analysis, ...rest } = item
      if (item.section === "ATTENTION" && item.applicability) return { ...rest, analysisUsed: false, slot: null, proposedWording: applicabilityWording(item.applicability), wordingSource: "SYSTEM" as const, writerViolations: [], decision: decideReliableItem(item, null, deps.policy) }
      if (request.domain === "MONITORING" && (prepared.compositionOnly || isSystemRenderedProcessItem(item))) {
        const wording = monitoringFallbackWording(toMonitoringWriterItem(item, "SYSTEM"))
        const system: ReliableWriterOutcome = { invoked: false, writerError: null, source: "SYSTEM", violations: [], wording, claimModes: null }
        return { ...rest, analysisUsed: false, slot: null, proposedWording: wording, wordingSource: "SYSTEM" as const, writerViolations: [], decision: decideReliableItem(item, structuralBlockOf(item) ? null : system, deps.policy) }
      }
      return { ...rest, analysisUsed: analysis !== null, slot, proposedWording: resolution?.wording ?? null, wordingSource: resolution?.source ?? null, writerViolations: resolution?.violations ?? [], ...(resolution && resolution.fields.length > 0 ? { writerFieldValidation: resolution.fields } : {}), decision: prepared.noDiagnosisHold ? holdForStrategy(decideReliableItem(item, outcome, deps.policy)) : decideReliableItem(item, outcome, deps.policy) }
    })
    const artifact: ReliableFeedbackArtifactV1 = {
      ...base,
      label: prepared.label,
      items,
      uncertainties: normalization.result.uncertainties,
      blockedReason: prepared.blockedReason,
      processAssessment: prepared.processAssessment,
      excludedForMateriality: prepared.excludedForMateriality,
      indicatorDiagnosis: prepared.indicatorDiagnosis,
      writer: { invoked: writer.invoked, skippedReason: writer.invoked ? null : prepared.blockedReason ?? (prepared.compositionOnly ? "COMPOSITION_WRITER_ONLY" : "NO_EMITTABLE_ITEM"), error: writer.error, promptVersion: writer.promptVersion, ...(writer.failureCategory ? { failureCategory: writer.failureCategory } : {}) },
    }
    // V1.7.1b — APRESENTAÇÃO: nome do cadastro (nunca do modelo) + rascunho do redator conferido contra os itens que sairiam se
    // o QA aprovasse tudo o que está retido. Na emissão ele é conferido de novo contra os itens que REALMENTE saem.
    const recipient = deps.loadRecipient ? await deps.loadRecipient(request.organizationId, request.collaboratorId) : null
    const writerDraft = presentationDraftOf(writer.rawOutput)
    artifact.presentation = { version: FEEDBACK_PRESENTATION_VERSION, recipient, writerDraft, writerViolations: [] }
    const prospective = emittedItems(artifact, items.filter((item) => item.decision.disposition === "HOLD_FOR_QA").map((item): ArtifactReviewState => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED", finalWording: null })))
    artifact.presentation.writerViolations = writerDraft ? presentationViolations(writerDraft, prospective, presentationContextOf(artifact)) : []
    // FEEDBACK POR FLAG V2 — NARRATIVA DE SUPERVISOR (monitoria de processo): o redator próprio escreve a mensagem e o card a
    // partir do brief (fatos já decididos). Nunca decide nada do diagnóstico e nunca segura o feedback: falha = narrativa do
    // sistema. Na emissão o rascunho é conferido de novo contra os itens que REALMENTE saem (QA pode ter mudado algo).
    if (request.domain === "MONITORING" && prospective.length > 0 && isProcessFeedback(prospective) && deps.writer.writeNarrative) {
      const context = presentationContextOf(artifact)
      // MONITORING V2 — composição: o brief leva o contexto da chamada declarado pelo especialista (V5).
      const brief = narrativeBriefOf(prospective, artifact.label, { interaction: artifact.processAssessment?.interaction ?? null })
      const written = await deps.writer.writeNarrative(brief).catch((error: unknown) => ({ draft: null, error: `NARRATIVE_WRITER_ERROR:${error instanceof Error ? error.name : "UNKNOWN"}`, provenance: null }))
      // FEEDBACK EXPERIENCE V2.1 — verificação SEMÂNTICA (uma chamada): cada frase/card × os fatos dos pontos a que se refere. Sem
      // ela, nada do redator é entregue; frase recusada sai ou volta pela reescrita contida do próprio verificador (sem laço).
      const factuality = written.draft?.sentences && deps.writer.verifyNarrativeFactuality
        ? await deps.writer.verifyNarrativeFactuality(written.draft, brief, prospective).catch((error: unknown): StoredFactuality => ({ version: NARRATIVE_FACTUALITY_VERSION, promptVersion: NARRATIVE_FACTUALITY_PROMPT_VERSION, status: "ERROR", verdicts: [], error: `FACTUALITY_ERROR:${error instanceof Error ? error.name : "UNKNOWN"}` }))
        : null
      const stored = { promptVersion: SUPERVISOR_NARRATIVE_PROMPT_VERSION, factuality }
      artifact.presentation.narrative = {
        version: SUPERVISOR_NARRATIVE_VERSION,
        promptVersion: SUPERVISOR_NARRATIVE_PROMPT_VERSION,
        itemsKey: brief.itemsKey,
        draft: written.draft,
        violations: written.draft ? (written.draft.sentences ? compositionOutcome(written.draft, stored, brief, prospective, context).violations : { narrative: narrativeViolations(written.draft.paragraphs, brief, prospective, context), card: cardViolations(written.draft.card, brief, prospective, context) }) : { narrative: [], card: [] },
        error: written.error,
        provenance: written.provenance,
        factuality,
      }
    }
    const proposedPresentation = presentationOf(artifact, prospective)
    // V1.7.1a — o QA vê o item DENTRO da análise completa (posição, base da ordem e os outros pontos) — nada some.
    const DISPOSITION_LABELS = { READY: "segue no feedback", HOLD_FOR_QA: "aguarda QA", BLOCKED: "bloqueado pela estrutura (não entra no feedback)" } as const
    const analysisOf = (item: ArtifactItem): ReviewAnalysisContext => ({
      position: items.indexOf(item) + 1,
      total: items.length,
      priorityBasis: item.priority?.basis ?? [],
      others: items.filter((other) => other !== item).map((other) => ({ position: items.indexOf(other) + 1, sectionLabel: isEmittableSection(other.section) ? SECTION_LABELS[other.section] : "Contexto", stepTitle: presentationLabelOf(other) ?? other.process?.stepTitle ?? other.process?.requirement ?? null, dispositionLabel: DISPOSITION_LABELS[other.decision.disposition] })),
      // V1.7.1b — abertura/fechamento propostos para o feedback inteiro (o revisor lê o item no contexto em que vai sair).
      presentation: proposedPresentation ? { greeting: proposedPresentation.greeting, introduction: proposedPresentation.introduction, closing: proposedPresentation.closing, source: proposedPresentation.source } : null,
    })
    const reviews: NewReliableReview[] = items.flatMap((item): NewReliableReview[] => {
      if (item.decision.disposition !== "HOLD_FOR_QA" || !item.proposedWording || (item.section !== "STRENGTH" && item.section !== "OPPORTUNITY")) return []
      // Texto do SISTEMA (contrato V5 ou etapa composta parcial): o QA confere a edição contra a projeção do próprio item.
      const writerItem = writer.writerItems.get(item.index) ?? (request.domain === "MONITORING" ? toMonitoringWriterItem({ ...item, analysis: null }, "SYSTEM") : undefined)!
      return [{
        itemIndex: item.index,
        section: item.section,
        itemKind: item.kind,
        subjectLabel: prepared.label,
        reviewItem: request.domain === "MONITORING" ? { domain: "MONITORING", writerItem: writerItem as MonitoringWriterItem, knowledge: item.knowledge, process: item.process, analysis: analysisOf(item) } : { domain: "INDICATOR", writerItem: writerItem as IndicatorWriterItem, canonical: prepared.canonical!, knowledge: item.knowledge, process: item.process, analysis: analysisOf(item) },
        // Texto do sistema (etapa composta parcial) é gravado como FALLBACK: a tabela de revisão só conhece redator × determinístico.
        wordingSource: item.wordingSource === "WRITER" ? "WRITER" : "FALLBACK",
        writerViolations: item.writerViolations,
        proposedWording: item.proposedWording,
        reviewRequiredBy: [item.decision.policyVersion, ...item.decision.reasons],
      }]
    })
    const pending = reviews.map((review): ArtifactReviewState => ({ itemIndex: review.itemIndex, status: "PENDING_REVIEW", finalWording: null }))
    artifact.findings = findingsSummaryOf(artifact, pending)
    const disposition = currentDisposition(artifact, pending)
    const record = await deps.store.complete(request.organizationId, artifactId, { disposition, policyVersion: deps.policy.version, normalizedInput: normalization.result, canonicalContext: prepared.canonical, artifact, writerInput: writer.writerInput, writerRawOutput: writer.storedRawOutput, writerError: writer.error, writerProvenance: writer.provenance, reviews, observations: prepared.observations }, deps.now())
    return currentResultOf(deps.store, record, false)
  } catch (error) {
    await deps.store.fail(request.organizationId, artifactId, error instanceof Error ? `${error.name}: ${error.message}` : "erro desconhecido", deps.now()).catch(() => undefined)
    throw error
  }
}
