import { z } from "zod"

/** Base de boas práticas — contratos de `/api/v1/best-practices/*` (números e textos prontos do backend; a tela só exibe). */
export const dataOriginSchema = z.enum(["REAL", "SYNTHETIC"])
export const reviewStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "INACTIVE"])
export const storedObligationStatusSchema = z.enum(["OPTIONAL", "DIFFERENTIATED_EXECUTION", "UNDETERMINED"])
export const strengthSchema = z.enum(["STRONG", "MODERATE", "WEAK", "INSUFFICIENT"])
export const outcomeSchema = z.enum(["SUPPORTED", "WEAK_ASSOCIATION", "NO_DIFFERENCE", "MORE_FREQUENT_IN_REFERENCE", "COMMON_TO_BOTH", "ISOLATED", "CONCENTRATED", "INSUFFICIENT_DATA"])
export const reviewActionSchema = z.enum(["APPROVE", "REJECT", "DEACTIVATE", "REACTIVATE", "CONFIRM_NOT_OBLIGATION", "EDIT"])
export type DataOrigin = z.infer<typeof dataOriginSchema>
export type ReviewStatus = z.infer<typeof reviewStatusSchema>
export type EvidenceStrength = z.infer<typeof strengthSchema>
export type ReviewAction = z.infer<typeof reviewActionSchema>

export const supportedContextSchema = z.object({
  cellKey: z.string(),
  reason: z.string(),
  subReason: z.string().nullable(),
  level: z.enum(["REASON", "SUB_REASON"]).optional(),
  label: z.string(),
  strength: strengthSchema,
  topRatePercent: z.number().nullable(),
  referenceRatePercent: z.number().nullable(),
  topOperators: z.number(),
  referenceOperators: z.number(),
  topCalls: z.number(),
  referenceCalls: z.number(),
})

export const patternListItemSchema = z.object({
  id: z.string(),
  dataOrigin: dataOriginSchema,
  syntheticDatasetLabel: z.string().nullable(),
  /** Resultado do padrão: o indicador ou, pelo sinal (`CALL_SIGNAL`), o sinal da chamada — `indicatorName` é o nome de um ou de outro. */
  indicatorId: z.string().nullable(),
  channelFlagId: z.string().nullable().default(null),
  outcomeSource: z.enum(["INDICATOR", "CALL_SIGNAL"]).default("INDICATOR"),
  indicatorCode: z.string(),
  indicatorName: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable().default(null),
  subteamName: z.string().nullable().default(null),
  name: z.string(),
  description: z.string(),
  observableDefinition: z.string(),
  guidance: z.string(),
  suggestedPhrasing: z.string().nullable(),
  appliesWhen: z.string().nullable(),
  notApplicableWhen: z.string().nullable(),
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como a prática ajuda no resultado; `howItHelpsSource` diz se ainda é o rascunho da IA. */
  howItHelps: z.string().nullable().default(null),
  howItHelpsSource: z.enum(["AI_DRAFT", "REVIEWER"]).nullable().default(null),
  reviewStatus: reviewStatusSchema,
  obligationStatus: storedObligationStatusSchema,
  obligationConfirmedByReview: z.boolean(),
  currentStrength: strengthSchema,
  supportedContexts: z.array(supportedContextSchema),
  updatedAt: z.string(),
  currentVersion: z.number().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  callsAnalyzed: z.number().nullable(),
  operatorsAnalyzed: z.number().nullable(),
  available: z.boolean(),
})
export type PatternListItem = z.infer<typeof patternListItemSchema>
export const patternPageSchema = z.object({ items: z.array(patternListItemSchema), total: z.number(), page: z.number(), pageSize: z.number() })
export type PatternPage = z.infer<typeof patternPageSchema>

const groupStatsSchema = z.object({
  operatorsSampled: z.number(),
  operatorsApplicable: z.number(),
  callsSampled: z.number(),
  callsApplicable: z.number(),
  callsPresent: z.number(),
  callsNotApplicable: z.number(),
  callsUnclear: z.number(),
  operatorRatePercent: z.number().nullable(),
  callRatePercent: z.number().nullable(),
  adopters: z.number(),
  operatorsWithPresence: z.number(),
  topOperatorSharePercent: z.number().nullable(),
})
export const contextResultSchema = z.object({
  cellKey: z.string(),
  reason: z.string(),
  subReason: z.string().nullable(),
  label: z.string(),
  assessment: z.object({
    outcome: outcomeSchema,
    strength: strengthSchema,
    top: groupStatsSchema,
    reference: groupStatsSchema,
    differencePp: z.number().nullable(),
    consistencyPercent: z.number().nullable(),
    criteria: z.array(z.object({ key: z.string(), label: z.string(), met: z.boolean(), value: z.string(), level: z.enum(["SUPPORT", "STRONG"]) })),
    explanation: z.string(),
  }),
})
export type ContextResult = z.infer<typeof contextResultSchema>

export const obligationCheckSchema = z.object({
  status: z.enum(["OPTIONAL", "DIFFERENTIATED_EXECUTION", "UNDETERMINED", "OBLIGATION", "CONFLICT"]).optional(),
  reasonCode: z.string().optional(),
  explanation: z.string().optional(),
  sources: z.array(z.object({ handle: z.string(), title: z.string(), text: z.string() })).default([]),
  ruleQuote: z.string().nullable().optional(),
  ruleQuoteVerified: z.boolean().optional(),
  additionalBehavior: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  consulted: z.object({ documents: z.number(), argumentScripts: z.number(), practices: z.number(), omitted: z.array(z.string()) }).optional(),
  checked: z.boolean().optional(),
  reason: z.string().optional(),
})
export type ObligationCheck = z.infer<typeof obligationCheckSchema>

export const evidenceSchema = z.object({ id: z.string(), callRef: z.string().nullable(), interactionId: z.string().nullable(), operatorLabel: z.string(), context: z.string().nullable(), occurredAt: z.string().nullable(), turnRef: z.string(), excerpt: z.string() })
export type PatternEvidence = z.infer<typeof evidenceSchema>

export const patternDetailSchema = patternListItemSchema.extend({
  unavailabilityReasons: z.array(z.string()),
  canManage: z.boolean(),
  current: z
    .object({
      id: z.string(),
      version: z.number(),
      analysisId: z.string(),
      contexts: z.array(contextResultSchema),
      strength: strengthSchema,
      obligationCheck: obligationCheckSchema,
      limitations: z.array(z.string()),
      periodStart: z.string(),
      periodEnd: z.string(),
      referencePeriods: z.array(z.string()),
      callsAnalyzed: z.number(),
      operatorsAnalyzed: z.number(),
      createdAt: z.string(),
    })
    .nullable(),
  evidence: z.array(evidenceSchema),
  versions: z.array(z.object({ id: z.string(), version: z.number(), analysisId: z.string(), strength: strengthSchema, supported: z.number(), createdAt: z.string(), periodStart: z.string(), periodEnd: z.string(), callsAnalyzed: z.number(), modelMode: z.string() })),
  reviews: z.array(z.object({ id: z.string(), action: z.string(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), reason: z.string().nullable(), analysisId: z.string().nullable(), createdAt: z.string(), actorName: z.string().nullable() })),
})
export type PatternDetail = z.infer<typeof patternDetailSchema>

export const evidenceCallSchema = z.object({ operatorLabel: z.string(), context: z.string().nullable(), occurredAt: z.string().nullable(), turnRef: z.string(), excerpt: z.string(), synthetic: z.boolean(), turns: z.array(z.object({ handle: z.string(), speaker: z.string().nullable(), text: z.string() })) })
export type EvidenceCall = z.infer<typeof evidenceCallSchema>

const labelsSchema = z.record(z.string(), z.string())
const teamWithSubteamsSchema = z.object({ id: z.string(), name: z.string(), subteams: z.array(z.object({ id: z.string(), name: z.string() })).default([]) })
export const metaSchema = z.object({
  indicators: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), unit: z.string(), direction: z.string() })),
  /** Sinais da chamada com chamada boa × ruim cadastrada (podem ser o resultado da análise). */
  signals: z.array(z.object({ id: z.string(), name: z.string(), good: z.string(), bad: z.string() })).default([]),
  teams: z.array(teamWithSubteamsSchema),
  /** `wholeTeam` = administra o Grupo inteiro (pede análise do Grupo ou de qualquer Subgrupo); senão, só dos Subgrupos listados. */
  manageableTeams: z.array(teamWithSubteamsSchema.extend({ wholeTeam: z.boolean().default(true) })),
  datasets: z.array(z.object({ id: z.string(), key: z.string(), label: z.string(), description: z.string(), version: z.number(), hasAnswerKey: z.boolean(), calls: z.number(), operators: z.number(), operatorList: z.array(z.object({ ref: z.string(), name: z.string() })).default([]), periods: z.array(z.string()).default([]) })),
  periods: z.array(z.string()),
  capabilities: z.object({ canManage: z.boolean(), canRunSynthetic: z.boolean() }),
  comparisonModes: z.array(z.object({ mode: z.string(), top: z.string(), reference: z.string(), method: z.string() })),
  method: z.array(z.string()),
  labels: z.object({ outcome: labelsSchema, strength: labelsSchema, obligation: labelsSchema, review: labelsSchema }),
})
export type BestPracticesMeta = z.infer<typeof metaSchema>

export const analysisStatusSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"])
export const analysisListItemSchema = z.object({
  id: z.string(),
  dataOrigin: dataOriginSchema,
  datasetLabel: z.string().nullable(),
  indicatorName: z.string(),
  channelFlagId: z.string().nullable().default(null),
  teamName: z.string().nullable(),
  subteamName: z.string().nullable().default(null),
  referencePeriods: z.array(z.string()),
  contextLevel: z.string(),
  modelMode: z.string(),
  status: analysisStatusSchema,
  outcome: z.string().nullable(),
  errorMessage: z.string().nullable(),
  summary: z.string().nullable(),
  modelCalls: z.number().nullable(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  requestedBy: z.string().nullable(),
})
export type AnalysisListItem = z.infer<typeof analysisListItemSchema>

const candidateReportSchema = z.object({ key: z.string(), name: z.string(), origin: z.string(), patternId: z.string().nullable(), observableDefinition: z.string(), contexts: z.array(contextResultSchema), strength: strengthSchema, obligation: obligationCheckSchema.nullable(), decision: z.string(), decisionNote: z.string() })
export const analysisReportSchema = z.object({
  outcome: z.string(),
  summary: z.string(),
  population: z.object({ label: z.string(), origin: dataOriginSchema }),
  period: z.object({ start: z.string(), end: z.string(), referencePeriods: z.array(z.string()) }),
  comparison: z.object({ top: z.string(), reference: z.string(), method: z.string() }),
  groups: z.object({ top: z.number(), reference: z.number(), excluded: z.array(z.object({ reason: z.string(), count: z.number() })) }),
  cells: z.array(z.object({ cellKey: z.string(), label: z.string(), status: z.string(), note: z.string().nullable(), groups: z.object({ TOP: z.object({ operators: z.number(), evaluable: z.number(), fewCalls: z.number(), sampled: z.number() }), REFERENCE: z.object({ operators: z.number(), evaluable: z.number(), fewCalls: z.number(), sampled: z.number() }) }) })),
  discovery: z.object({ calls: z.number(), proposed: z.number(), rejected: z.array(z.object({ name: z.string().nullable(), reason: z.string() })), recognizedKnown: z.array(z.string()), noCandidateReason: z.string().nullable(), failed: z.boolean() }),
  candidates: z.array(candidateReportSchema),
  codings: z.object({ total: z.number(), reused: z.number(), unclear: z.number(), unverifiedQuotes: z.number(), fromCustomer: z.number(), modelFailures: z.number() }),
  limitations: z.array(z.string()),
  method: z.array(z.string()),
  usage: z.object({ calls: z.number(), costUsd: z.number(), models: z.array(z.string()) }),
})
export type AnalysisReport = z.infer<typeof analysisReportSchema>
export const analysisDetailSchema = z.object({ id: z.string(), dataOrigin: dataOriginSchema, status: analysisStatusSchema, outcome: z.string().nullable(), modelMode: z.string(), report: analysisReportSchema.nullable(), errorMessage: z.string().nullable(), createdAt: z.string(), finishedAt: z.string().nullable() })
export type AnalysisDetail = z.infer<typeof analysisDetailSchema>

export const guidanceItemSchema = z.object({
  patternId: z.string(),
  name: z.string(),
  description: z.string(),
  contexts: z.array(z.string()),
  association: z.string(),
  strength: z.string(),
  you: z.string(),
  youKind: z.enum(["OFTEN", "SOMETIMES", "RARELY", "NO_SITUATION", "NOT_ANALYZED"]),
  howTo: z.string(),
  suggestedPhrasing: z.string().nullable(),
  notApplicableWhen: z.string().nullable(),
  howItHelps: z.string().nullable().optional(),
  synthetic: z.boolean(),
})
export type GuidanceItem = z.infer<typeof guidanceItemSchema>
export const relevantPracticeSchema = guidanceItemSchema.extend({ indicatorName: z.string() })
export type RelevantPractice = z.infer<typeof relevantPracticeSchema>
export const previewSchema = z.object({ items: z.array(guidanceItemSchema), text: z.string() })
export type GuidancePreview = z.infer<typeof previewSchema>

export const patternFiltersSchema = z.object({ indicatorId: z.string().optional(), teamId: z.string().optional(), origin: dataOriginSchema.optional(), reviewStatus: reviewStatusSchema.optional(), available: z.boolean().optional(), context: z.string().optional(), search: z.string().optional(), page: z.number(), pageSize: z.number() })
export type PatternFilters = z.infer<typeof patternFiltersSchema>
export const createAnalysisInputSchema = z.object({ origin: dataOriginSchema, syntheticDatasetId: z.string().nullable().optional(), teamId: z.string().nullable().optional(), subteamId: z.string().nullable().optional(), outcomeSource: z.enum(["INDICATOR", "CALL_SIGNAL"]).optional(), indicatorDefinitionId: z.string().nullable().optional(), channelFlagId: z.string().nullable().optional(), referencePeriods: z.array(z.string()).min(1), contextLevel: z.enum(["REASON", "SUB_REASON"]), comparison: z.string(), modelMode: z.enum(["REAL", "SIMULATED_ANSWER_KEY"]) })
export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>
export const reviewInputSchema = z.object({ action: reviewActionSchema, reason: z.string().nullable().optional(), changes: z.object({ name: z.string().optional(), description: z.string().optional(), guidance: z.string().optional(), suggestedPhrasing: z.string().nullable().optional(), notApplicableWhen: z.string().nullable().optional(), howItHelps: z.string().nullable().optional() }).optional() })
export type ReviewInput = z.infer<typeof reviewInputSchema>
