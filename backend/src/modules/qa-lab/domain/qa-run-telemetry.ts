import { LLM_PHASES, type LlmCacheRecord, type LlmCallRecord, type LlmContextBreakdown, type LlmPhase, type LlmRequestClassification, type LlmRouteRecord } from "../../../shared/application/llm-telemetry.js"
import { addCost, type CostEstimate } from "../../../shared/application/model-routing/model-pricing.js"
import type { PromptComponentUsage } from "../../../shared/application/prompting/prompt-components.js"
import { CLAIM_SCOPE_LABELS } from "../../investigation/domain/evidence-gating.js"
import type { ClaimScope, EvidenceGatingResult, InvestigationSummary, TokenBudgetStatus, ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"
import type { QaStep, QaTrace } from "./qa-run-schema.js"
import { compareFingerprints, datasetLabelOf, type BenchmarkCompatibility, type DatasetLabel, type DatasetStamp } from "./dataset-fingerprint.js"
import { STOP_REASON_LABELS, type StopReason } from "../../investigation/domain/evidence-sufficiency.js"
import { INVESTIGATION_OBJECTIVE_LABELS } from "../../investigation/domain/investigation-objective.js"

/**
 * TELEMETRIA DE EFICIÊNCIA de um QA Run (V1.1): agregada POR CÓDIGO a partir do que o provider
 * informou em cada request (`trace.aiCalls`) e do que as Tools registraram (`toolTrace`/
 * `investigation` nos outputs dos steps). Persistida em `trace.telemetry` a cada insert/update —
 * uma execução normal do QA Lab preenche tudo, sem script. Campos que o provider não informou
 * ficam `null` ("Não informado"); NUNCA estimados. Runs antigos (sem `telemetry`) continuam
 * legíveis: a UI mostra o que existe (totais das colunas) e "Não informado" no resto.
 */
export type QaTokenTotals = {
  input: number | null
  /** Só quando alguma request informou cache (Gemini `cachedContentTokenCount`). */
  cached: number | null
  /** input − cached, derivado só quando os dois foram informados. */
  uncached: number | null
  output: number | null
  reasoning: number | null
  total: number | null
}

export type QaRequestTelemetry = {
  sequence: number
  phase: LlmPhase | null
  role: LlmCallRecord["role"]
  agentName: string | null
  model: string
  provider: "gemini"
  tokens: QaTokenTotals
  durationMs: number
  /** Tools solicitadas pelo modelo nesta request (rodada de planejamento). */
  toolCalls: string[]
  promptBreakdown: LlmCallRecord["promptBreakdown"] | null
  /** V1.2: decisão de roteamento (tier/razão/escalação), breakdown de contexto e UUIDs que chegaram ao modelo. */
  route: LlmRouteRecord | null
  contextBreakdown: LlmContextBreakdown | null
  technicalIds: number | null
  /** V1.3: classificação (propósito/origem), cache observado/explícito, custo estimado e componentes de prompt (id + chars). */
  classification: LlmRequestClassification | null
  cache: LlmCacheRecord | null
  cost: CostEstimate | null
  promptComponents: PromptComponentUsage[] | null
}

export type QaPhaseTelemetry = { phase: LlmPhase | "UNASSIGNED"; requests: number; tokens: QaTokenTotals; durationMs: number; toolCallsRequested: number }

export type QaToolBudgetTelemetry = {
  /** Chamadas executadas (COMPLETED/FAILED) — o que de fato consultou dados (preflight + investigação). */
  executed: number
  cached: number
  rejected: number
  preflight: number | null
  /** Só as escolhidas pelo Agent (V1.2) — as que consomem o orçamento. */
  investigation: number | null
  budget: number | null
  /** Pior resultado entre as investigações do run. */
  outcome: InvestigationSummary["outcome"] | null
  planningRounds: number | null
  parallelWaves: number | null
}

/** Run de referência compatível (mesmo recurso + mesmo colaborador/interação), anterior a este. */
export type QaReferenceRun = {
  runId: string
  createdAt: string
  requests: number
  toolCalls: number | null
  tokens: { input: number | null; output: number | null; total: number | null; cached: number | null }
  durationMs: number
  /** V1.3 — ausentes em referências anteriores. */
  staticPromptChars?: number | null
  toolSchemaChars?: number | null
  cost?: CostEstimate | null
  /** V1.3.1 — hash da massa da referência (compatibilidade do benchmark) e rodadas. */
  datasetFingerprint?: { hash: string; dataset?: DatasetStamp | null } | null
  planningRounds?: number | null
}

/** INVESTIGATION OUTCOME (V1.3.1 — §38/39): objetivo, escopo exigido, motivo da parada, suficiência, necessidades, hipóteses, contradições. */
export type QaSufficiencyTelemetry = {
  objective: string | null
  objectiveLabel: string | null
  requiredScope: string | null
  stopReason: StopReason | null
  stopReasonLabel: string | null
  status: string | null
  stopProposed: boolean | null
  stopAccepted: boolean | null
  rejections: { round: number; reasons: string[] }[]
  needs: { satisfied: number; open: number; blocked: number; notNeeded: number; items: { id: string; question: string; status: string; material: boolean; candidateTools: string[]; blockedBy?: string | undefined }[] }
  hypotheses: { supported: number; refuted: number; open: number; blocked: number; material: number }
  contradictoryEvidence: boolean
  additionalEvidenceCouldChangeConclusion: boolean | null
  additionalEvidenceCouldIncreaseRequiredScope: boolean | null
  criticalFacts: { ref: string; kind: string; label: string }[]
  // --- V1.3.2 (§51/§52) — ausentes em runs anteriores ---
  /** Recusa do STOP na última rodada (lacuna material com caminho, sem rodada para reagir). */
  stopRejectedAtFinalRound?: boolean | null
  remainingMaterialNeeds?: string[]
  candidateToolsAvailable?: string[]
  /** Fontes de evidência disponíveis × consultadas (rastreabilidade, nunca score). */
  evidenceSources?: { available: string[]; used: string[] } | null
  samplingStrategy?: string | null
  periodIntent?: string | null
  /** V1.3.4: semântica temporal — comparação exigida × realizada, blocos, claims temporais propostas/aceitas/rejeitadas (motivos). */
  temporal?: { temporalComparisonRequired: boolean; temporalComparisonStatus: string; availableBuckets: number; analyzedBuckets: number; comparedBuckets: string[]; temporalClaimsProposed: number; temporalClaimsAccepted: number; temporalClaimsRejected: number; rejectionReasons: Record<string, number>; sampleDifferenceDetected?: boolean; absenceEstablished?: boolean; /** V1.3.4.2: conclusão temporal autorizada. */ conclusion?: { kind: string; safeMeaning: string; allowedRelations: string[] } } | null
  /** Análise de interações: analisadas × universo × achados (contagem por trecho verificado — limite inferior). */
  interactionAnalysis?: { analyzedTranscriptCount: number; recordedUniverseCount: number | null; universeRelationship: string | null; findings: number; verifiedExcerpts: number; temporalBucketsCovered: number | null; temporalBuckets: number | null; evidenceVerification?: { candidateExcerptCount: number; verifiedExcerptCount: number; rejectedExcerptCount: number; findingsBeforeVerification: number; findingsAfterVerification: number; rejectionReasons: Record<string, number>; turnRefMismatchResolved?: number; ordinalResolvedCount?: number; ordinalResolutionRejectedCount?: number } | null }[]
  /** V1.4.0 (§70): resumo da camada semântica — frames, findings por tipo, necessidades não resolvidas, patterns por suporte. */
  semantic?: { analysisCalls: number; semanticFramesCreated: number; framesNotReturned: number; framesEmpty: number; interactionsWithFindings: number; strengthFindingsCount: number; riskFindingsCount: number; unresolvedNeedsCount: number; partialNeedsCount: number; proceduralQuestionsCount: number; procedureAssertionsCount: number; crossInteractionPatternsCount: number; patternsBySupport: Record<string, number>; patternsByKind: Record<string, number>; contractViolations: number; /** V1.4.1 */ phaseAFindings?: number; phaseBPromotedFindings?: number; promotionRejectedCount?: number; interactionFrictionFindingsCount?: number; findingKindDowngraded?: number; interactionEventsCount?: number; /** V1.4.5 */ questionsWithComponents?: number; answerCompletenessDowngraded?: number; needStatusDowngraded?: number; frictionDowngradedByCompleteAnswer?: number; contradictionDowngradedByCorrection?: number; proceduralConsistencyFindings?: number; proceduralDivergenceFindings?: number; proceduralQuestionFindings?: number; /** V1.4.6 */ patternsByOwnership?: Record<string, number>; patternsScopeCappedByOwnership?: number; /** V1.4.6.8 — completude estrutural da Fase A */ frameContract?: { calls: number; initialComplete: number; finalComplete: number; retries: number; expectedFrames: number; initialMissingFrames: number; finalMissingFrames: number; emptyFrames: number; duplicateFrames: number; duplicateFrameObservationsDropped: number; unexpectedFrames: number; exampleRefEchoed: number } } | null
  /** V1.4.6 (§39): RESULTADO × ATRIBUIÇÃO — necessidades abertas, de quê dependem, falsa atribuição recusada, dono dos patterns. */
  outcomeAttribution?: { analysisCalls: number; needsTotal: number; needsOpen: number; attributionsDeclared: number; attributionsAccepted: number; byAttribution: Record<string, number>; agentAttributionRejected: number; bridges: Record<string, number>; findingsNeutralized: number; findingsAgentAttributed: number; patternsByOwnership: Record<string, number>; patternsScopeCappedByOwnership: number; sidecarStatus: string } | null
  /** V1.4.5 (§48): funil procedimental — afirmação normativa → regra da base com trecho literal → comparação → estado. */
  procedural?: { analysisCalls: number; assertionsDeclared: number; quantitiesParsedAssertion: number; knowledgeExcerptsAvailable: number; rulesDeclared: number; rulesVerified: number; rulesRejected: number; evaluations: number; byStatus: Record<string, number>; coverage: string; knowledgeSource: string } | null
}

/** CACHE do run (V1.3 — §27): modo predominante, tokens servidos e taxa. */
export type QaCacheTelemetry = { mode: "NONE" | "IMPLICIT" | "EXPLICIT" | "MIXED"; cachedTokens: number | null; hitRate: number | null; explicitRequests: number; implicitRequests: number; cacheKeyVersions: string[] }

/** CUSTO estimado do run (V1.3 — §29/30): total e por fase; NOT_CONFIGURED quando não há pricing. */
export type QaCostTelemetry = { total: CostEstimate; byPhase: { phase: LlmPhase | "UNASSIGNED"; cost: CostEstimate }[] }

/** COBERTURA/representatividade (V1.3 — §8): dois universos, nunca inferidos um do outro. */
export type QaCoverageTelemetry = {
  recordedInteractions: number | null
  analyzedInteractions: number | null
  recordedCoverage: number | null
  operationalUniverse: number | null
  operationalCoverage: number | null
  universeRelationship: "EXACT" | "PARTIAL" | "UNKNOWN" | null
  representativeness: "INSUFFICIENT" | "ANECDOTAL" | "REPRESENTATIVE" | null
  /** Escopo máximo que a evidência autoriza (por código). */
  allowedScope: ClaimScope | null
  allowedScopeLabel: string | null
}

/** QUALIDADE (V1.3 — §46): gating fail-closed, correções, fallback, escopos das claims. */
export type QaQualityTelemetry = {
  gatingStatus: "PASSED" | "CORRECTED" | "FALLBACK" | "DISCARDED" | "NOT_APPLICABLE"
  envelopePresent: boolean | null
  correctionAttempted: boolean
  correctionSucceeded: boolean | null
  fallbackUsed: boolean
  fallbackReason: EvidenceGatingResult["fallbackReason"] | null
  rejectedClaims: number
  claimScopes: { scope: ClaimScope; label: string; count: number }[]
  limitations: number
  /** V1.3.2 (§6): framing do marcador de evidência — prova de que INVALID não veio de outro marcador engolido. */
  markerStatus?: string | null
  firstAttemptMarkerStatus?: string | null
  /** V1.4.2 (§20): categorias das rejeições que motivaram a correção (BINDING_FORMAT / SEMANTIC / TEMPORAL / ENVELOPE) e das que persistiram. */
  correctionCategories?: string[] | null
  persistentCategories?: string[] | null
  /** V1.4.3 (§16/§17): destino das afirmações — propostas × aceitas × corrigidas × descartadas, e se houve salvamento parcial. */
  claims?: { proposed: number; acceptedFirstPass: number; correctionRequired: number; corrected: number; dropped: number; preservedAfterSiblingFailure: number; recommendationsDropped: number } | null
  /** V1.4.4 (§43): candidatos projetados × selecionados × entregues e os erros de TEXTO que sobraram. */
  candidates?: { available: number; selected: number; delivered: number; textPolarityMismatch: number; textScopeMismatch: number; swapRejected: number; duplicateSelection: number } | null
  salvage?: "NONE" | "PARTIAL" | "FULL_FALLBACK" | null
}

export type QaRunTelemetry = {
  version: 1
  requests: number
  tokens: QaTokenTotals
  /** Cache do provider: cached / input, só quando informado. */
  cacheHitRate: number | null
  toolBudget: QaToolBudgetTelemetry | null
  tokenBudget: TokenBudgetStatus | null
  phases: QaPhaseTelemetry[]
  perRequest: QaRequestTelemetry[]
  reference: QaReferenceRun | null
  /** V1.2: UUIDs enviados ao modelo somados nas requests (ideal 0) e o contexto lógico por categoria (chars). null = requests sem essa telemetria. */
  technicalIdsInPrompts: number | null
  contextBreakdown: LlmContextBreakdown | null
  /** V1.3 — ausentes em runs anteriores. */
  cache?: QaCacheTelemetry | null | undefined
  cost?: QaCostTelemetry | null | undefined
  coverage?: QaCoverageTelemetry | null | undefined
  quality?: QaQualityTelemetry | null | undefined
  /** Componentes de prompt somados no run (id → chars, estático/dinâmico), para medir cada bloco. */
  promptComponents?: { id: string; static: boolean; chars: number; requests: number }[] | null | undefined
  /** V1.3.1 — suficiência da investigação e compatibilidade do benchmark (fingerprint da massa). */
  sufficiency?: QaSufficiencyTelemetry | null | undefined
  comparison?: BenchmarkCompatibility | null | undefined
  /** Dataset de diagnóstico do run (versão + fingerprint resumido); NOT_APPLICABLE fora da massa; NOT_INFORMED em runs antigos. */
  dataset?: DatasetLabel | null | undefined
}

const sum = (left: number | null, right: number | null): number | null => (left === null && right === null ? null : (left ?? 0) + (right ?? 0))

export const EMPTY_TOTALS: QaTokenTotals = { input: null, cached: null, uncached: null, output: null, reasoning: null, total: null }

export function tokensOfCall(call: LlmCallRecord): QaTokenTotals {
  const input = call.promptTokens ?? null
  const cached = call.cachedInputTokens ?? null
  return {
    input,
    cached,
    uncached: input !== null && cached !== null ? Math.max(0, input - cached) : null,
    output: call.outputTokens ?? null,
    reasoning: call.reasoningTokens ?? null,
    total: call.totalTokens ?? null,
  }
}

export function addTotals(acc: QaTokenTotals, tokens: QaTokenTotals): QaTokenTotals {
  return {
    input: sum(acc.input, tokens.input),
    cached: sum(acc.cached, tokens.cached),
    uncached: sum(acc.uncached, tokens.uncached),
    output: sum(acc.output, tokens.output),
    reasoning: sum(acc.reasoning, tokens.reasoning),
    total: sum(acc.total, tokens.total),
  }
}

/** Percorre os outputs dos steps (inclusive fan-out) atrás de trace de Tools e resumos de investigação. */
export function collectInvestigations(trace: Pick<QaTrace, "steps" | "employeeRuns">): { toolTraces: ToolInvocationTrace[]; summaries: InvestigationSummary[] } {
  const toolTraces: ToolInvocationTrace[] = []
  const summaries: InvestigationSummary[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (Array.isArray(record.toolTrace)) toolTraces.push(...(record.toolTrace as ToolInvocationTrace[]))
    if (record.investigation && typeof record.investigation === "object" && "toolCalls" in (record.investigation as object)) summaries.push(record.investigation as InvestigationSummary)
    if (Array.isArray(record.results)) for (const result of record.results) visit(result)
  }
  const steps: QaStep[] = [...trace.steps, ...(trace.employeeRuns ?? []).flatMap((run) => run.steps)]
  for (const step of steps) visit(step.nodeOutput)
  return { toolTraces, summaries }
}

const OUTCOME_SEVERITY: Record<InvestigationSummary["outcome"], number> = { ANSWERED: 0, NO_TOOLS: 1, BUDGET_EXHAUSTED: 2, TIMEOUT: 3 }

export function buildToolBudget(toolTraces: ToolInvocationTrace[], summaries: InvestigationSummary[]): QaToolBudgetTelemetry | null {
  if (toolTraces.length === 0 && summaries.length === 0) return null
  const executed = toolTraces.filter((item) => item.status === "COMPLETED" || item.status === "FAILED").length
  const cached = toolTraces.filter((item) => item.status === "CACHED").length
  const rejected = toolTraces.filter((item) => item.status === "REJECTED" || item.status === "BUDGET_EXCEEDED").length
  const numberOrNull = (values: (number | undefined)[]) => (values.some((value) => typeof value === "number") ? values.reduce<number>((acc, value) => acc + (value ?? 0), 0) : null)
  return {
    executed,
    cached,
    rejected,
    preflight: numberOrNull(summaries.map((summary) => summary.preflightCalls)),
    investigation: numberOrNull(summaries.map((summary) => summary.investigationToolCalls)),
    budget: numberOrNull(summaries.map((summary) => summary.budget)),
    outcome: summaries.length > 0 ? summaries.reduce<InvestigationSummary["outcome"]>((worst, summary) => (OUTCOME_SEVERITY[summary.outcome] > OUTCOME_SEVERITY[worst] ? summary.outcome : worst), "ANSWERED") : null,
    planningRounds: numberOrNull(summaries.map((summary) => summary.planningRounds)),
    parallelWaves: numberOrNull(summaries.map((summary) => summary.parallelWaves)),
  }
}

/** Token Budget do run = pior status entre as investigações (os limiares vêm do runtime). */
function worstTokenBudget(summaries: InvestigationSummary[]): TokenBudgetStatus | null {
  const budgets = summaries.map((summary) => summary.tokenBudget).filter((budget): budget is TokenBudgetStatus => Boolean(budget))
  if (budgets.length === 0) return null
  return budgets.find((budget) => budget.status === "WARNING") ?? budgets.find((budget) => budget.status === "OK") ?? budgets[0]!
}

export function buildQaRunTelemetry(trace: Pick<QaTrace, "aiCalls" | "steps" | "employeeRuns"> & { datasetFingerprint?: QaTrace["datasetFingerprint"] }, reference: QaReferenceRun | null): QaRunTelemetry {
  const perRequest: QaRequestTelemetry[] = trace.aiCalls.map((call) => ({
    sequence: call.sequence,
    phase: call.phase ?? null,
    role: call.role,
    agentName: (call as { agentName?: string | null }).agentName ?? null,
    model: call.model,
    provider: "gemini",
    tokens: tokensOfCall(call),
    durationMs: call.durationMs,
    toolCalls: call.toolCalls ?? [],
    promptBreakdown: call.promptBreakdown ?? null,
    route: call.route ?? null,
    contextBreakdown: call.contextBreakdown ?? null,
    technicalIds: call.promptBreakdown?.technicalIds ?? null,
    classification: call.classification ?? null,
    cache: call.cache ?? null,
    cost: call.cost ?? null,
    promptComponents: call.promptComponents ?? null,
  }))
  const withIds = perRequest.filter((request) => request.technicalIds !== null)
  const withContext = perRequest.filter((request) => request.contextBreakdown !== null)
  const contextBreakdown: LlmContextBreakdown | null =
    withContext.length === 0
      ? null
      : withContext.reduce<LlmContextBreakdown>(
          (acc, request) => {
            const item = request.contextBreakdown!
            return {
              staticPromptChars: acc.staticPromptChars + item.staticPromptChars,
              dynamicPromptChars: (acc.dynamicPromptChars ?? 0) + (item.dynamicPromptChars ?? 0),
              toolSchemaChars: acc.toolSchemaChars + item.toolSchemaChars,
              evidenceLedgerChars: acc.evidenceLedgerChars + item.evidenceLedgerChars,
              interactionContentChars: acc.interactionContentChars + item.interactionContentChars,
              knowledgeContentChars: acc.knowledgeContentChars + item.knowledgeContentChars,
              structuredSchemaChars: acc.structuredSchemaChars + item.structuredSchemaChars,
              objectiveChars: acc.objectiveChars + item.objectiveChars,
            }
          },
          { staticPromptChars: 0, dynamicPromptChars: 0, toolSchemaChars: 0, evidenceLedgerChars: 0, interactionContentChars: 0, knowledgeContentChars: 0, structuredSchemaChars: 0, objectiveChars: 0 },
        )
  const tokens = perRequest.reduce((acc, request) => addTotals(acc, request.tokens), EMPTY_TOTALS)
  const phaseKeys: (LlmPhase | "UNASSIGNED")[] = [...LLM_PHASES, "UNASSIGNED"]
  const phases = phaseKeys
    .map((phase) => {
      const requests = perRequest.filter((request) => (request.phase ?? "UNASSIGNED") === phase)
      return {
        phase,
        requests: requests.length,
        tokens: requests.reduce((acc, request) => addTotals(acc, request.tokens), EMPTY_TOTALS),
        durationMs: requests.reduce((acc, request) => acc + request.durationMs, 0),
        toolCallsRequested: requests.reduce((acc, request) => acc + request.toolCalls.length, 0),
      }
    })
    .filter((phase) => phase.requests > 0)
  const { toolTraces, summaries } = collectInvestigations(trace)
  const costByPhase = phases.map((phase) => ({ phase: phase.phase, cost: perRequest.filter((request) => (request.phase ?? "UNASSIGNED") === phase.phase).reduce<CostEstimate>((acc, request) => addCost(acc, request.cost ?? { status: "NOT_CONFIGURED" }), { status: "NOT_CONFIGURED" }) }))
  return {
    version: 1,
    cache: buildCacheTelemetry(perRequest, tokens),
    cost: { total: perRequest.reduce<CostEstimate>((acc, request) => addCost(acc, request.cost ?? { status: "NOT_CONFIGURED" }), { status: "NOT_CONFIGURED" }), byPhase: costByPhase },
    coverage: buildCoverageTelemetry(summaries),
    quality: buildQualityTelemetry(summaries),
    promptComponents: buildPromptComponentTotals(perRequest),
    sufficiency: buildSufficiencyTelemetry(summaries, toolTraces),
    comparison: reference ? compareFingerprints(trace.datasetFingerprint ?? null, reference.datasetFingerprint ?? null) : null,
    dataset: datasetLabelOf(trace.datasetFingerprint ?? null),
    requests: perRequest.length,
    tokens,
    cacheHitRate: tokens.input !== null && tokens.cached !== null && tokens.input > 0 ? Math.round((tokens.cached / tokens.input) * 1000) / 1000 : null,
    toolBudget: buildToolBudget(toolTraces, summaries),
    tokenBudget: worstTokenBudget(summaries),
    phases,
    perRequest,
    reference,
    technicalIdsInPrompts: withIds.length > 0 ? withIds.reduce((sum, request) => sum + (request.technicalIds ?? 0), 0) : null,
    contextBreakdown,
  }
}

function buildCacheTelemetry(perRequest: QaRequestTelemetry[], tokens: QaTokenTotals): QaCacheTelemetry {
  const explicitRequests = perRequest.filter((request) => request.cache?.mode === "EXPLICIT").length
  const implicitRequests = perRequest.filter((request) => request.cache?.mode === "IMPLICIT").length
  const mode: QaCacheTelemetry["mode"] = explicitRequests > 0 && implicitRequests > 0 ? "MIXED" : explicitRequests > 0 ? "EXPLICIT" : implicitRequests > 0 ? "IMPLICIT" : "NONE"
  return {
    mode,
    cachedTokens: tokens.cached,
    hitRate: tokens.input !== null && tokens.cached !== null && tokens.input > 0 ? Math.round((tokens.cached / tokens.input) * 1000) / 1000 : null,
    explicitRequests,
    implicitRequests,
    cacheKeyVersions: [...new Set(perRequest.map((request) => request.cache?.cacheKeyVersion).filter((value): value is string => Boolean(value)))],
  }
}

const SCOPE_ORDER: ClaimScope[] = ["INTERACTION_SPECIFIC", "PERIOD_PATTERN", "EMPLOYEE_PATTERN", "POPULATION_PATTERN"]

/** Cobertura do run = a investigação com mais interações analisadas (uma execução costuma ter uma só). */
export function buildCoverageTelemetry(summaries: InvestigationSummary[]): QaCoverageTelemetry | null {
  const withSynthesis = summaries.filter((summary) => summary.synthesis)
  if (withSynthesis.length === 0) return null
  let best: QaCoverageTelemetry | null = null
  for (const summary of withSynthesis) {
    const assessments = (summary.synthesis?.evidenceRepresentativeness ?? []).filter((item) => item.tool !== "analyze_peer_patterns" && item.tool !== "find_comparable_interactions")
    const top = [...assessments].sort((left, right) => (right.analyzedCount ?? right.analyzed) - (left.analyzedCount ?? left.analyzed))[0]
    const peers = (summary.synthesis?.evidenceRepresentativeness ?? []).filter((item) => item.tool === "analyze_peer_patterns")
    const level = top ? (top.classification ?? top.level) : (summary.interactionsInPeriod === 0 ? "INSUFFICIENT" : null)
    const peersRepresentative = peers.some((item) => (item.classification ?? item.level) === "REPRESENTATIVE")
    const allowedScope: ClaimScope | null = level === null ? null : level === "REPRESENTATIVE" ? "EMPLOYEE_PATTERN" : level === "ANECDOTAL" ? "INTERACTION_SPECIFIC" : peersRepresentative ? "POPULATION_PATTERN" : null
    const coverage: QaCoverageTelemetry = {
      recordedInteractions: summary.interactionsInPeriod ?? null,
      analyzedInteractions: top ? (top.analyzedCount ?? top.analyzed) : summary.interactionsInPeriod === 0 ? 0 : null,
      recordedCoverage: top?.recordedCoverage ?? null,
      operationalUniverse: summary.operationalUniverse?.count ?? top?.operationalUniverseCount ?? null,
      operationalCoverage: top?.operationalCoverage ?? null,
      universeRelationship: top?.universeRelationship ?? (summary.operationalUniverse ? "UNKNOWN" : null),
      representativeness: level,
      allowedScope,
      allowedScopeLabel: allowedScope ? CLAIM_SCOPE_LABELS[allowedScope] : null,
    }
    if (!best || (coverage.analyzedInteractions ?? -1) > (best.analyzedInteractions ?? -1)) best = coverage
  }
  return best
}

export function buildQualityTelemetry(summaries: InvestigationSummary[]): QaQualityTelemetry | null {
  const withGating = summaries.filter((summary) => summary.evidenceGating)
  if (withGating.length === 0) return null
  const gatings = withGating.map((summary) => summary.evidenceGating!)
  const fallbackUsed = gatings.some((gating) => gating.fallbackUsed === true)
  const discarded = gatings.some((gating) => gating.correctionAttempted === true && gating.correctionSucceeded === false && gating.fallbackUsed !== true)
  const corrected = gatings.some((gating) => gating.corrected)
  const claims = withGating.flatMap((summary) => summary.synthesis?.behavioralClaims ?? [])
  const scopeCounts = SCOPE_ORDER.map((scope) => ({ scope, label: CLAIM_SCOPE_LABELS[scope], count: claims.filter((claim) => (claim.scope ?? "INTERACTION_SPECIFIC") === scope).length })).filter((item) => item.count > 0)
  return {
    gatingStatus: fallbackUsed ? "FALLBACK" : discarded ? "DISCARDED" : corrected ? "CORRECTED" : "PASSED",
    envelopePresent: gatings.every((gating) => gating.envelopePresent === undefined) ? null : gatings.every((gating) => gating.envelopePresent !== false),
    correctionAttempted: gatings.some((gating) => gating.correctionAttempted === true || gating.corrected),
    correctionSucceeded: gatings.some((gating) => gating.correctionAttempted === true || gating.corrected) ? gatings.every((gating) => gating.correctionAttempted !== true || gating.correctionSucceeded === true) : null,
    fallbackUsed,
    fallbackReason: gatings.find((gating) => gating.fallbackReason)?.fallbackReason ?? null,
    rejectedClaims: gatings.reduce((sum, gating) => sum + gating.rejectedClaims.length, 0),
    markerStatus: gatings.find((gating) => gating.markerStatus)?.markerStatus ?? null,
    firstAttemptMarkerStatus: gatings.find((gating) => gating.firstAttemptMarkerStatus)?.firstAttemptMarkerStatus ?? null,
    claims: gatings.some((gating) => typeof gating.claimsProposed === "number")
      ? {
          proposed: gatings.reduce((sum, gating) => sum + (gating.claimsProposed ?? 0), 0),
          acceptedFirstPass: gatings.reduce((sum, gating) => sum + (gating.claimsAcceptedFirstPass ?? 0), 0),
          correctionRequired: gatings.reduce((sum, gating) => sum + (gating.claimsCorrectionRequired ?? 0), 0),
          corrected: gatings.reduce((sum, gating) => sum + (gating.claimsCorrected ?? 0), 0),
          dropped: gatings.reduce((sum, gating) => sum + (gating.claimsDropped ?? 0), 0),
          preservedAfterSiblingFailure: gatings.reduce((sum, gating) => sum + (gating.claimsPreservedAfterSiblingFailure ?? 0), 0),
          recommendationsDropped: gatings.reduce((sum, gating) => sum + (gating.recommendationsDropped ?? 0), 0),
        }
      : null,
    candidates: gatings.some((gating) => typeof gating.claimCandidatesAvailable === "number")
      ? {
          available: gatings.reduce((sum, gating) => sum + (gating.claimCandidatesAvailable ?? 0), 0),
          selected: gatings.reduce((sum, gating) => sum + (gating.claimCandidatesSelected ?? 0), 0),
          delivered: gatings.reduce((sum, gating) => sum + (gating.claimCandidatesDelivered ?? 0), 0),
          textPolarityMismatch: gatings.reduce((sum, gating) => sum + (gating.textPolarityMismatch ?? 0), 0),
          textScopeMismatch: gatings.reduce((sum, gating) => sum + (gating.textScopeMismatch ?? 0), 0),
          swapRejected: gatings.reduce((sum, gating) => sum + (gating.candidateSwapRejected ?? 0), 0),
          duplicateSelection: gatings.reduce((sum, gating) => sum + (gating.duplicateCandidateSelection ?? 0), 0),
        }
      : null,
    salvage: gatings.some((gating) => gating.salvage === "FULL_FALLBACK") ? "FULL_FALLBACK" : gatings.some((gating) => gating.salvage === "PARTIAL") ? "PARTIAL" : gatings.some((gating) => gating.salvage) ? "NONE" : null,
    correctionCategories: gatings.some((gating) => gating.correctionCategories) ? [...new Set(gatings.flatMap((gating) => gating.correctionCategories ?? []))] : null,
    persistentCategories: gatings.some((gating) => gating.persistentCategories) ? [...new Set(gatings.flatMap((gating) => gating.persistentCategories ?? []))] : null,
    claimScopes: scopeCounts,
    limitations: withGating.reduce((sum, summary) => sum + (summary.synthesis?.limitations.length ?? 0), 0),
  }
}

function buildPromptComponentTotals(perRequest: QaRequestTelemetry[]): QaRunTelemetry["promptComponents"] {
  const byId = new Map<string, { id: string; static: boolean; chars: number; requests: number }>()
  for (const request of perRequest) {
    for (const component of request.promptComponents ?? []) {
      const current = byId.get(component.id) ?? { id: component.id, static: component.static, chars: 0, requests: 0 }
      current.chars += component.chars
      current.requests += 1
      byId.set(component.id, current)
    }
  }
  return byId.size > 0 ? [...byId.values()].sort((left, right) => right.chars - left.chars) : null
}

/** Suficiência do run = a investigação principal (a de mais Tools) — uma execução costuma ter uma só. */
export function buildSufficiencyTelemetry(summaries: InvestigationSummary[], toolTraces: ToolInvocationTrace[] = []): QaSufficiencyTelemetry | null {
  const candidates = summaries.filter((summary) => summary.objective || summary.stopReason || summary.sufficiency)
  if (candidates.length === 0) return null
  const summary = [...candidates].sort((left, right) => right.toolCalls - left.toolCalls)[0]!
  const sufficiency = summary.sufficiency
  const needs = sufficiency?.evidenceNeeds ?? []
  const hypotheses = sufficiency?.hypotheses ?? []
  return {
    objective: summary.objective?.kind ?? null,
    objectiveLabel: summary.objective ? INVESTIGATION_OBJECTIVE_LABELS[summary.objective.kind] : null,
    requiredScope: sufficiency?.requiredScope ?? summary.objective?.requiredScope ?? null,
    stopReason: summary.stopReason ?? null,
    stopReasonLabel: summary.stopReason ? STOP_REASON_LABELS[summary.stopReason] : null,
    status: sufficiency?.status ?? null,
    stopProposed: sufficiency?.stopProposed ?? null,
    stopAccepted: sufficiency?.stopAccepted ?? null,
    rejections: sufficiency?.rejections ?? [],
    needs: {
      satisfied: needs.filter((need) => need.status === "SATISFIED").length,
      open: needs.filter((need) => need.status === "OPEN").length,
      blocked: needs.filter((need) => need.status === "BLOCKED").length,
      notNeeded: needs.filter((need) => need.status === "NOT_NEEDED").length,
      items: needs.map((need) => ({ id: need.id, question: need.question, status: need.status, material: need.material, candidateTools: need.candidateTools, blockedBy: need.blockedBy })),
    },
    hypotheses: { supported: hypotheses.filter((item) => item.status === "SUPPORTED").length, refuted: hypotheses.filter((item) => item.status === "REFUTED").length, open: hypotheses.filter((item) => item.status === "OPEN").length, blocked: hypotheses.filter((item) => item.status === "BLOCKED_BY_DATA").length, material: hypotheses.filter((item) => item.material).length },
    contradictoryEvidence: (sufficiency?.contradictoryEvidence ?? []).length > 0,
    additionalEvidenceCouldChangeConclusion: sufficiency?.additionalEvidenceCouldChangeConclusion ?? null,
    additionalEvidenceCouldIncreaseRequiredScope: sufficiency?.additionalEvidenceCouldIncreaseRequiredScope ?? null,
    criticalFacts: sufficiency?.criticalFacts ?? [],
    stopRejectedAtFinalRound: sufficiency?.stopRejectedAtFinalRound ?? null,
    remainingMaterialNeeds: sufficiency?.remainingMaterialNeeds ?? [],
    candidateToolsAvailable: sufficiency?.candidateToolsAvailable ?? [],
    evidenceSources: summary.evidenceSources ?? null,
    samplingStrategy: summary.samplingStrategy ?? null,
    periodIntent: summary.periodIntent ?? null,
    temporal: summary.temporal ? { temporalComparisonRequired: summary.temporal.temporalComparisonRequired, temporalComparisonStatus: summary.temporal.temporalComparisonStatus, availableBuckets: summary.temporal.availableBuckets, analyzedBuckets: summary.temporal.analyzedBuckets, comparedBuckets: summary.temporal.comparedBuckets, temporalClaimsProposed: summary.temporal.temporalClaimsProposed, temporalClaimsAccepted: summary.temporal.temporalClaimsAccepted, temporalClaimsRejected: summary.temporal.temporalClaimsRejected, rejectionReasons: summary.temporal.rejectionReasons, ...(typeof summary.temporal.sampleDifferenceDetected === "boolean" ? { sampleDifferenceDetected: summary.temporal.sampleDifferenceDetected } : {}), ...(typeof summary.temporal.absenceEstablished === "boolean" ? { absenceEstablished: summary.temporal.absenceEstablished } : {}), ...(summary.temporal.conclusion ? { conclusion: { kind: summary.temporal.conclusion.kind, safeMeaning: summary.temporal.conclusion.safeMeaning, allowedRelations: summary.temporal.conclusion.allowedRelations } } : {}) } : null,
    interactionAnalysis: toolTraces
      .filter((item) => item.tool === "analyze_interactions" && item.signals?.interactionAnalysis)
      .map((item) => { const analysis = item.signals!.interactionAnalysis!; return { analyzedTranscriptCount: analysis.analyzedTranscriptCount, recordedUniverseCount: analysis.recordedUniverseCount, universeRelationship: analysis.universeRelationship, findings: analysis.findings, verifiedExcerpts: analysis.verifiedExcerpts, temporalBucketsCovered: item.signals?.temporalCoverage?.bucketsCovered ?? null, temporalBuckets: item.signals?.temporalCoverage?.buckets ?? null, evidenceVerification: analysis.evidenceVerification ?? null } }),
    semantic: summary.semantic ? { analysisCalls: summary.semantic.analysisCalls, semanticFramesCreated: summary.semantic.semanticFramesCreated, framesNotReturned: summary.semantic.framesNotReturned, framesEmpty: summary.semantic.framesEmpty, interactionsWithFindings: summary.semantic.interactionsWithFindings, strengthFindingsCount: summary.semantic.strengthFindingsCount, riskFindingsCount: summary.semantic.riskFindingsCount, unresolvedNeedsCount: summary.semantic.unresolvedNeedsCount, partialNeedsCount: summary.semantic.partialNeedsCount, proceduralQuestionsCount: summary.semantic.proceduralQuestionsCount, procedureAssertionsCount: summary.semantic.procedureAssertionsCount, crossInteractionPatternsCount: summary.semantic.crossInteractionPatternsCount, patternsBySupport: summary.semantic.patternsBySupport, patternsByKind: summary.semantic.patternsByKind, contractViolations: summary.semantic.contractViolations, ...(typeof summary.semantic.phaseAFindings === "number" ? { phaseAFindings: summary.semantic.phaseAFindings, phaseBPromotedFindings: summary.semantic.phaseBPromotedFindings ?? 0, promotionRejectedCount: summary.semantic.promotionRejectedCount ?? 0, interactionFrictionFindingsCount: summary.semantic.interactionFrictionFindingsCount ?? 0, findingKindDowngraded: summary.semantic.findingKindDowngraded ?? 0, interactionEventsCount: summary.semantic.interactionEventsCount ?? 0 } : {}), ...(typeof summary.semantic.questionsWithComponents === "number" || typeof summary.semantic.proceduralDivergenceFindings === "number" ? { questionsWithComponents: summary.semantic.questionsWithComponents ?? 0, answerCompletenessDowngraded: summary.semantic.answerCompletenessDowngraded ?? 0, needStatusDowngraded: (summary.semantic.needStatusDowngradedByAnswer ?? 0) + (summary.semantic.needStatusDowngradedByOpenPoint ?? 0), frictionDowngradedByCompleteAnswer: summary.semantic.frictionDowngradedByCompleteAnswer ?? 0, contradictionDowngradedByCorrection: summary.semantic.contradictionDowngradedByCorrection ?? 0, proceduralConsistencyFindings: summary.semantic.proceduralConsistencyFindings ?? 0, proceduralDivergenceFindings: summary.semantic.proceduralDivergenceFindings ?? 0, proceduralQuestionFindings: summary.semantic.proceduralQuestionFindings ?? 0 } : {}), ...(summary.semantic.patternsByOwnership ? { patternsByOwnership: summary.semantic.patternsByOwnership, patternsScopeCappedByOwnership: summary.semantic.patternsScopeCappedByOwnership ?? 0 } : {}), ...(summary.semantic.frameContract ? { frameContract: { ...summary.semantic.frameContract } } : {}) } : null,
    outcomeAttribution: summary.outcomeAttribution ? { analysisCalls: summary.outcomeAttribution.analysisCalls, needsTotal: summary.outcomeAttribution.needsTotal, needsOpen: summary.outcomeAttribution.needsOpen, attributionsDeclared: summary.outcomeAttribution.attributionsDeclared, attributionsAccepted: summary.outcomeAttribution.attributionsAccepted, byAttribution: summary.outcomeAttribution.byAttribution, agentAttributionRejected: summary.outcomeAttribution.agentAttributionRejected, bridges: summary.outcomeAttribution.bridges, findingsNeutralized: summary.outcomeAttribution.findingsNeutralized, findingsAgentAttributed: summary.outcomeAttribution.findingsAgentAttributed, patternsByOwnership: summary.outcomeAttribution.patternsByOwnership, patternsScopeCappedByOwnership: summary.outcomeAttribution.patternsScopeCappedByOwnership, sidecarStatus: summary.outcomeAttribution.sidecarStatus } : null,
    procedural: summary.procedural ? { analysisCalls: summary.procedural.analysisCalls, assertionsDeclared: summary.procedural.assertionsDeclared, quantitiesParsedAssertion: summary.procedural.quantitiesParsedAssertion, knowledgeExcerptsAvailable: summary.procedural.knowledgeExcerptsAvailable, rulesDeclared: summary.procedural.rulesDeclared, rulesVerified: summary.procedural.rulesVerified, rulesRejected: summary.procedural.rulesRejected, evaluations: summary.procedural.evaluations, byStatus: summary.procedural.byStatus, coverage: summary.procedural.coverage, knowledgeSource: summary.procedural.knowledgeSource } : null,
  }
}
