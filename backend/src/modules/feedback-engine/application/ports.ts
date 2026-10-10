import type { Database } from "../../../infrastructure/database/pool.js"
import type { AnalysisOutcome, VerifiedCallAnalysis } from "../domain/call-analysis.js"
import type { CriterionIdentity, PersistedCriterion } from "../domain/criteria-identity.js"
import type { IndicatorInvestigation } from "../domain/indicator-investigation.js"
import type { MemoryQuery, MemorySnapshot } from "../domain/memory-queries.js"
import type { ComposedMessage, FeedbackBrief } from "../domain/feedback-brief.js"
import type { CallAnalysisCheckpoint, StageResponses } from "../domain/analysis-recovery.js"
import type { CatalogPractice, PracticeIdentityResult } from "../domain/practice-identity.js"
import type { CatalogTheme, PracticeThemeResult, PracticeToTheme } from "../domain/practice-themes.js"
import type { DeliveredMonitoring } from "../domain/delivery-guards.js"

/**
 * PORTAS do motor de feedback. Produção = Postgres + gateway de IA; QA Lab e testes = memória + modelo falso. Toda leitura e
 * escrita é escopada à organização; nenhuma porta devolve dado de outra organização.
 */

// ---------------------------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------------------------
/** CALL_REVIEW = revisão independente das conclusões da análise; CALL_CONFIRMATION = confirmação FOCAL dos achados que só a revisão
 * encontrou; INVESTIGATION_PLANNING = escolha das ferramentas da investigação; PRACTICE_IDENTITY = organizar as regras da base e dos
 * argumentários em práticas (uma vez por linha nova). */
export type EngineModelStage = "CALL_ANALYSIS" | "CALL_REVIEW" | "CALL_CONFIRMATION" | "INVESTIGATION_PLANNING" | "PRACTICE_IDENTITY" | "PRACTICE_THEMES" | "COMPOSITION" | "VERIFICATION"
export type EngineModelRequest = {
  stage: EngineModelStage
  systemPrompt: string
  contents: { role: "user" | "model"; text: string }[]
  responseSchema: Record<string, unknown>
  /** Etapa fina para telemetria (ex.: "repair:coverage"). */
  tag?: string
}
export type EngineModelUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export type EngineModelResponse = { text: string; model: string | null; usage: EngineModelUsage | null; durationMs: number | null; costUsd: number | null; finishReason: string | null }
export type EngineModelPort = { generate(request: EngineModelRequest): Promise<EngineModelResponse> }

/** Uma chamada de modelo registrada na execução (custo/latência/volume — nunca prompt nem resposta). */
export type ModelCallMetric = { stage: EngineModelStage; tag: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; durationMs: number | null; costUsd: number | null; ok: boolean; error: string | null }

// ---------------------------------------------------------------------------------------------
// Memória
// ---------------------------------------------------------------------------------------------
export type AnalysisKind = "CALL_ANALYSIS" | "INDICATOR_INVESTIGATION"
export type AnalysisTrigger = {
  kind: "WORKFLOW_SOURCE_NODE" | "FEEDBACK_GENERATION" | "INDICATOR_INVESTIGATION" | "EVALUATION" | "LEGACY_HOLD_REPROCESS" | "DIAGNOSTIC_BOOTSTRAP"
  workflowId?: string | null
  workflowVersionId?: string | null
  enrollmentId?: string | null
  nodeId?: string | null
  selectionReason: string
  parentRunId?: string | null
}
export type AnalysisIdentity = {
  organizationId: string
  kind: AnalysisKind
  analysisKey: string
  personId: string
  interactionId: string | null
  indicatorDefinitionId: string | null
  periodStart: string | null
  periodEnd: string | null
  agentId: string | null
  trigger: AnalysisTrigger
  logicVersion: string
  asOf: Date
}
export type AnalysisRunRecord = AnalysisIdentity & {
  id: string
  status: "RUNNING" | "COMPLETED" | "FAILED"
  outcome: AnalysisOutcome | null
  outcomeReasons: string[]
  provenance: Record<string, unknown>
  result: unknown
  metrics: Record<string, unknown>
  completedAt: Date | null
}
export type AnalysisClaim = { kind: "CLAIMED"; runId: string } | { kind: "COMPLETED"; run: AnalysisRunRecord } | { kind: "IN_PROGRESS" }

/** Contexto da chamada gravado com a leitura (o que as agregações da liderança usam). */
export type CallSnapshot = {
  interactionId: string
  personId: string
  occurredAt: Date
  timeZone: string
  subjectRaw: string | null
  subjectCanonical: string | null
  channel: string | null
  teamId: string | null
  subteamId: string | null
  supervisorId: string | null
  transcriptChecksum: string | null
  selectionReason: string
}
export type CallAnalysisPersist = {
  snapshot: CallSnapshot
  analysis: VerifiedCallAnalysis
  /** Identidade estável de cada linha avaliada (lineKey → critério). */
  identities: ReadonlyMap<string, CriterionIdentity>
  documentVersions: ReadonlyMap<string, { version: number; perspective: string }>
  provenance: Record<string, unknown>
  metrics: Record<string, unknown>
}
export type StoredCallAssessment = {
  id: string
  analysisRunId: string
  isCurrent: boolean
  snapshot: CallSnapshot
  analysis: VerifiedCallAnalysis
  criterionKeys: Record<string, string>
}

export type CriterionHistory = { criterionKey: string; assessed: number; met: number; notMet: number; partial: number; inconclusive: number; lastDates: string[] }
export type DeliveredFinding = { findingKey: string; messageId: string; deliveredAt: Date | null }

/** `reusable: false` = investigação INTERROMPIDA (orçamento de modelo da execução): fica no histórico e serve à mensagem desta
 * execução, mas a chave de reuso é liberada — a próxima execução autorizada investiga de novo (e retoma o que ficou pendente). */
export type IndicatorInvestigationPersist = { investigation: IndicatorInvestigation; provenance: Record<string, unknown>; metrics: Record<string, unknown>; reusable?: boolean }
export type CallAnalysisSuspension = { error: string; checkpoint: CallAnalysisCheckpoint; provenance: Record<string, unknown>; metrics: Record<string, unknown> }

/**
 * MEMÓRIA VIGENTE num recorte (pessoas × janela, ou chamadas): a leitura primitiva sobre a qual a investigação calcula tudo
 * (chamadas já analisadas, padrões por critério, caminho, estado da evidência). Uma porta só — produção (Postgres), QA Lab/ensaio
 * (RAM) e a sobreposição RAM-sobre-banco enxergam a MESMA memória que acabaram de gravar.
 */
export type { MemoryAssessment, MemoryCriterionRow, MemoryQuery, MemorySnapshot, MemoryWindow } from "../domain/memory-queries.js"

export type FeedbackMemoryStore = {
  claimAnalysis(identity: AnalysisIdentity, now: Date, leaseSeconds: number): Promise<AnalysisClaim>
  completeCallAnalysis(organizationId: string, runId: string, data: CallAnalysisPersist, now: Date): Promise<{ callAssessmentId: string; current: boolean }>
  completeIndicatorInvestigation(organizationId: string, runId: string, data: IndicatorInvestigationPersist, now: Date): Promise<{ investigationId: string; current: boolean }>
  completeInsufficient(organizationId: string, runId: string, outcome: { outcomeReasons: string[]; result: unknown; provenance: Record<string, unknown>; metrics: Record<string, unknown> }, now: Date): Promise<void>
  failAnalysis(organizationId: string, runId: string, error: string, now: Date): Promise<void>
  /**
   * Revisão PENDENTE (falha técnica, orçamento, resposta fora do contrato): a execução fica suspensa (não concluída, retomável)
   * com as propostas e a proveniência — nada vai para a memória consultada pela investigação e pela liderança.
   */
  suspendCallAnalysis(organizationId: string, runId: string, data: CallAnalysisSuspension, now: Date): Promise<void>
  /** Respostas já pagas (análise/revisão) desta chamada com a mesma chave de PROPOSTA — ou da chave antiga equivalente. */
  findStageResponses(organizationId: string, query: { interactionId: string; proposalKey: string; legacyAnalysisKeys: readonly string[] }): Promise<StageResponses[]>
  /** Chamadas (entre estas) com revisão pendente: suspensa, ou gravada antes desta versão como `REVIEW_UNAVAILABLE`. */
  pendingReviewInteractions(organizationId: string, interactionIds: readonly string[]): Promise<Set<string>>
  getRun(organizationId: string, runId: string): Promise<AnalysisRunRecord | null>
  getCallAssessmentByRun(organizationId: string, runId: string): Promise<StoredCallAssessment | null>
  getIndicatorInvestigationByRun(organizationId: string, runId: string): Promise<{ id: string; investigation: IndicatorInvestigation } | null>
  /** Identidade dos critérios desta versão do documento: persistida ou reconciliada agora (idempotente). */
  resolveCriteria(organizationId: string, document: { documentId: string; version: number; lines: { lineKey: string; heading: string | null; text: string; position: number }[] }, previous: () => Promise<{ version: number; lines: { lineKey: string; heading: string | null; text: string; position: number }[] } | null>): Promise<Map<string, CriterionIdentity>>
  loadCriteria(organizationId: string, documentId: string, version: number): Promise<PersistedCriterion[] | null>
  /** Histórico VIGENTE do colaborador nestes critérios (exclui a chamada atual), com denominadores. */
  criterionHistory(organizationId: string, personId: string, criterionKeys: readonly string[], input: { excludeInteractionId: string | null; since: Date; until: Date }): Promise<CriterionHistory[]>
  /** Achados (interação × critério ou indicador × período × critério) que JÁ saíram numa mensagem publicada para a pessoa. */
  deliveredFindings(organizationId: string, personId: string, findingKeys: readonly string[]): Promise<DeliveredFinding[]>
  /**
   * `FEEDBACK_FIRMNESS_V1`: a ÚLTIMA entrega (antes de `before`) de uma mensagem publicada que COMUNICOU um ponto de desenvolvimento
   * desta prática (`practiceKeys` do ponto no brief; só pontos comunicados — `finding_keys` da mensagem). Mensagens anteriores ao
   * campo não têm prática registrada e não contam (nunca se presume orientação).
   */
  deliveredPractices(organizationId: string, personId: string, practiceKeys: readonly string[], before: Date): Promise<{ practiceKey: string; deliveredAt: Date }[]>
  /** `ONE_MONITORING_PER_CALL_V1`: a monitoria JÁ ENTREGUE desta chamada (mensagem do motor ou feedback publicado, qualquer Workflow), ou null. */
  deliveredMonitoringOf(organizationId: string, interactionId: string, options?: { excludeMessageId?: string }): Promise<DeliveredMonitoring | null>
  /** `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: indicador × período (`CODE|início|fim`) JÁ ENTREGUES à pessoa. */
  deliveredIndicatorPeriods(organizationId: string, personId: string, options?: { excludeMessageId?: string }): Promise<Set<string>>
  /** Leituras VIGENTES (chamada e critério) no recorte — sem regra em conflito. */
  currentMemory(organizationId: string, query: MemoryQuery): Promise<MemorySnapshot>
  /** Execução CONCLUÍDA cuja chave (ou chave de reuso registrada ao concluir) é esta — reuso sem nova execução. */
  findCompletedByReuseKey(organizationId: string, kind: AnalysisKind, key: string): Promise<AnalysisRunRecord | null>
  /**
   * `PRACTICE_IDENTITY_V1`: linhas (base/argumentário) que JÁ têm decisão de prática — `practiceKey` null = a linha não pede conduta.
   * Linha ausente do mapa = ainda não organizada.
   */
  practiceMemberships(organizationId: string, lineKeys: readonly string[]): Promise<Map<string, { practiceKey: string | null; title: string | null }>>
  /** Práticas da organização (ordem de criação), com até duas regras de exemplo cada — o que o modelo vê para reconhecer a mesma conduta. */
  practiceCatalog(organizationId: string): Promise<CatalogPractice[]>
  /** Grava a decisão (idempotente: linha já organizada por outra execução fica como estava; prática que ficou sem membro não é criada). */
  savePracticeAssignments(organizationId: string, result: PracticeIdentityResult, provenance: { identityVersion: string; model: string | null }, now: Date): Promise<{ members: number; practices: number }>
  /**
   * `PRACTICE_THEMES_V1`: práticas AINDA SEM TEMA (ordem de criação), com até duas regras de exemplo — todas, ou só estas chaves.
   */
  practicesWithoutTheme(organizationId: string, practiceKeys: readonly string[] | null): Promise<PracticeToTheme[]>
  /** Temas da organização (ordem de criação), com os pontos (nome curto) que já estão em cada um — o que o modelo vê para reconhecer o tema. */
  practiceThemeCatalog(organizationId: string): Promise<CatalogTheme[]>
  /** Grava tema + nome curto (idempotente: prática já agrupada por outra execução fica como estava; tema sem prática não é criado). */
  savePracticeThemes(organizationId: string, result: PracticeThemeResult, provenance: { themeVersion: string; model: string | null }, now: Date): Promise<{ practices: number; themes: number }>
}

// ---------------------------------------------------------------------------------------------
// Mensagens (identidade da entrega ≠ identidade da análise)
// ---------------------------------------------------------------------------------------------
export type MessageIdentity = {
  organizationId: string
  messageKey: string
  enrollmentId: string | null
  workflowId: string | null
  workflowVersionId: string | null
  nodeId: string | null
  sourceNodeId: string | null
  personId: string
  domain: "MONITORING" | "INDICATOR"
}
export type MessageStatus = "RUNNING" | "PUBLISHABLE" | "ABSTAINED" | "FAILED"
export type MessageRecord = MessageIdentity & {
  id: string
  status: MessageStatus
  analysisRunIds: string[]
  abstainReason: string | null
  findingKeys: string[]
  brief: FeedbackBrief | null
  message: ComposedMessage | null
  composition: Record<string, unknown> | null
  suppressed: unknown[]
  metrics: Record<string, unknown>
  completedAt: Date | null
}
export type MessageClaim = { kind: "CLAIMED"; messageId: string } | { kind: "COMPLETED"; record: MessageRecord } | { kind: "IN_PROGRESS" }
export type MaterialRecommendation = { documentId: string; documentVersion: number | null; criterionKeys: string[]; reason: string }
export type MessageCompletion = {
  status: "PUBLISHABLE" | "ABSTAINED"
  analysisRunIds: string[]
  abstainReason: string | null
  findingKeys: string[]
  brief: FeedbackBrief | null
  message: ComposedMessage | null
  composition: Record<string, unknown> | null
  suppressed: unknown[]
  metrics: Record<string, unknown>
  materials: MaterialRecommendation[]
}
export type FeedbackMessageStore = {
  claimMessage(identity: MessageIdentity, now: Date, leaseSeconds: number): Promise<MessageClaim>
  completeMessage(organizationId: string, messageId: string, data: MessageCompletion, now: Date): Promise<MessageRecord>
  failMessage(organizationId: string, messageId: string, error: string, now: Date): Promise<void>
  getMessage(organizationId: string, messageId: string): Promise<MessageRecord | null>
}

export type EngineDb = Pick<Database, "query">
