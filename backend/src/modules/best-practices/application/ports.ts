import type { CallOutcome, SignalValue } from "../../channel-flags/domain/call-outcome.js"
import type { BehaviorCandidate } from "../domain/candidates.js"
import type { ComparisonMode, GroupKind, OperatorQuartile } from "../domain/comparison.js"
import type { CodingStatus, ContextAssessment, EvidenceStrength } from "../domain/evidence-criteria.js"
import type { ObligationCheck, ObligationSourceSet } from "../domain/obligation-check.js"
import type { DataOrigin, ReviewStatus, StoredObligationStatus } from "../domain/pattern.js"
import type { CallMeta, CellPlan, ContextLevel, SamplingParameters } from "../domain/sampling.js"

/**
 * PORTAS da base de boas práticas. Produção = Postgres + gateway de IA; testes = memória + modelo roteirizado. A origem dos dados
 * (REAL × SYNTHETIC) é uma implementação do corpus — o pipeline é o MESMO, e nada sintético cruza para uma leitura de produção.
 */

// ---------------------------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------------------------
export type BestPracticeStage = "DISCOVERY" | "CODING" | "OBLIGATION_CHECK"
export type BestPracticeModelRequest = { stage: BestPracticeStage; systemPrompt: string; userText: string; responseSchema: Record<string, unknown>; tag?: string }
export type BestPracticeModelResponse = { text: string; model: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; durationMs: number | null }
export type BestPracticeModelPort = { generate(request: BestPracticeModelRequest): Promise<BestPracticeModelResponse> }

// ---------------------------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------------------------
export type ModelMode = "REAL" | "SIMULATED_ANSWER_KEY"
export type AnalysisParameters = SamplingParameters & { maxModelCalls: number; hypotheses: string[] }
export type AnalysisRequest = {
  id: string
  organizationId: string
  origin: DataOrigin
  syntheticDatasetId: string | null
  /** Resultado medido: o indicador (melhores = 1º quartil oficial) OU o sinal da chamada (`BEST_PRACTICE_ANALYSIS_V3`) — exatamente um. */
  indicatorDefinitionId: string | null
  channelFlagId: string | null
  /** Critério do sinal copiado no pedido (chamada boa × ruim). */
  callOutcome: CallOutcome | null
  teamId: string | null
  /** `BEST_PRACTICE_ANALYSIS_V2`: população = um Subgrupo do Grupo (os melhores do subgrupo × os demais do subgrupo); nulo = o Grupo. */
  subteamId: string | null
  referencePeriods: string[]
  contextLevel: ContextLevel
  channel: string | null
  comparison: AnalysisComparison
  modelMode: ModelMode
  parameters: AnalysisParameters
}
export type IndicatorInfo = { id: string; code: string; name: string; unit: string; direction: "HIGHER" | "LOWER" | "TARGET" }
/** Pelo sinal, os grupos são de CHAMADAS (boas × ruins), não de operadores pelo quartil. */
export type AnalysisComparison = ComparisonMode | "GOOD_VS_BAD_CALLS"
export type SignalInfo = { id: string; flagName: string; name: string; outcome: CallOutcome }

// ---------------------------------------------------------------------------------------------
// Corpus (REAL: interações da organização; SYNTHETIC: dataset fictício)
// ---------------------------------------------------------------------------------------------
export type CorpusOperator = { ref: string; personId: string | null; name: string }
export type CorpusCall = CallMeta & { interactionId: string | null; personId: string | null }
export type CallCorpus = {
  origin: DataOrigin
  populationLabel: string
  operators(): Promise<CorpusOperator[]>
  quartiles(indicatorDefinitionId: string, referencePeriods: readonly string[]): Promise<OperatorQuartile[]>
  /** Valor do sinal em cada chamada (chamada sem o sinal fica fora do mapa). */
  callSignals(callRefs: readonly string[], signal: Pick<SignalInfo, "id" | "flagName">): Promise<Map<string, SignalValue>>
  calls(operatorRefs: readonly string[], window: { start: string; endExclusive: string }, channel: string | null): Promise<CorpusCall[]>
  /** Texto para o modelo (PII mascarada) + checksum desse texto. Chamada sem transcrição utilizável fica fora do mapa. */
  transcripts(callRefs: readonly string[]): Promise<Map<string, { content: string; checksum: string }>>
  obligationSources(input: { cells: readonly { reason: string; subReason: string | null }[]; candidatesText: string; at: Date }): Promise<ObligationSourceSet>
}

// ---------------------------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------------------------
export type KnownPattern = {
  id: string
  name: string
  description: string
  observableDefinition: string
  appliesWhen: string | null
  notApplicableWhen: string | null
  guidance: string
  suggestedPhrasing: string | null
  /** Contextos de onde a fala sugerida saiu (da versão vigente); nulo = qualquer contexto ou desconhecido. */
  phrasingContexts: string[] | null
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como ajuda no resultado (texto vigente da revisão); nulo = sem texto. */
  howItHelps?: string | null
  reviewStatus: ReviewStatus
  obligationStatus: StoredObligationStatus
  obligationConfirmedByReview: boolean
}
/** A população faz parte da identidade do padrão: o do Subgrupo e o do Grupo são padrões distintos (revisados separados). */
export type PatternScope = { organizationId: string; origin: DataOrigin; syntheticDatasetId: string | null; indicatorDefinitionId: string | null; channelFlagId: string | null; teamId: string | null; subteamId: string | null }

export type CodingRecord = {
  candidateKey: string
  definitionHash: string
  callRef: string
  interactionId: string | null
  personId: string | null
  operatorRef: string
  group: GroupKind
  cellKey: string
  status: CodingStatus
  turnRef: string | null
  quote: string | null
  quoteVerified: boolean
  unclearReason: string | null
  transcriptChecksum: string | null
  reusedFromAnalysisId: string | null
}
export type ReusableCoding = Pick<CodingRecord, "status" | "turnRef" | "quote" | "quoteVerified" | "unclearReason"> & { analysisId: string }

/** `level` = nível de contexto da análise que mediu (motivo × motivo › submotivo): "(sem submotivo)" no nível do submotivo não é o motivo inteiro. */
export type ContextResult = { cellKey: string; reason: string; subReason: string | null; level: ContextLevel; label: string; assessment: ContextAssessment }
export type EvidenceRecord = { callRef: string; interactionId: string | null; personId: string | null; operatorLabel: string; group: GroupKind; cellKey: string; reason: string; subReason: string | null; occurredAt: Date | null; turnRef: string; excerpt: string }
export type PatternWrite = {
  patternId: string | null
  candidate: BehaviorCandidate
  contexts: ContextResult[]
  strength: EvidenceStrength
  obligation: ObligationCheck | null
  /** OPTIONAL/DIFFERENTIATED_EXECUTION/UNDETERMINED; para padrão já existente que agora pareceu obrigação/conflito = UNDETERMINED sem confirmação. */
  obligationStatus: StoredObligationStatus
  resetObligationConfirmation: boolean
  evidence: EvidenceRecord[]
  limitations: string[]
  callsAnalyzed: number
  operatorsAnalyzed: number
  updateNote: string
}
export type AnalysisWrite = { codings: CodingRecord[]; patterns: PatternWrite[]; period: { start: string; end: string }; referencePeriods: string[] }

export type BestPracticeStore = {
  knownPatterns(scope: PatternScope): Promise<KnownPattern[]>
  reusableCodings(organizationId: string, analysisId: string, modelMode: ModelMode, keys: readonly { callRef: string; definitionHash: string; transcriptChecksum: string }[]): Promise<Map<string, ReusableCoding>>
  /**
   * Grava codificações, padrões, versões e evidências e — na MESMA transação — conclui a análise com o relatório que `complete`
   * monta a partir dos ids gravados (nova tentativa depois de uma gravação bem-sucedida nunca duplica versão).
   */
  saveAnalysis(scope: PatternScope, analysisId: string, write: AnalysisWrite, now: Date, complete: (saved: { created: string[]; updated: string[] }) => AnalysisCompletion): Promise<{ created: string[]; updated: string[]; completion: AnalysisCompletion }>
}

export type AnalysisCompletion = { outcome: string; report: unknown; provenance: Record<string, unknown> }

export const reuseKeyOf = (key: { callRef: string; definitionHash: string; transcriptChecksum: string }) => `${key.callRef}|${key.definitionHash}|${key.transcriptChecksum}`

export type { CellPlan }
