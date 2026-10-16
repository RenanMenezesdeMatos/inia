import { z } from "zod"
import { reviewPresentationSchema } from "@/schemas/pending-actions/review-presentation.schema"
import { structureAnchorSchema, type StructureAnchor } from "./structure-anchor-schema"
import { humanReviewDecisionSchema } from "./workflow-graph.schema"

/**
 * Espelho do contrato do QA Lab (backend: modules/qa-lab/domain/qa-run-schema.ts). Ferramenta
 * EXCLUSIVA do administrador global — "UM RECURSO + UM CONTEXTO + UMA EXECUÇÃO", nunca fan-out.
 */
export const aiPolicySchema = z.enum(["REAL", "STOP_BEFORE_AI"])
export type AiPolicy = z.infer<typeof aiPolicySchema>
export const AI_POLICY_LABELS: Record<AiPolicy, string> = { REAL: "IA real", STOP_BEFORE_AI: "Parar antes da IA" }

export const workflowRunModeSchema = z.enum(["RUN_ALL", "STEP", "UNTIL_NODE"])
export type WorkflowRunMode = z.infer<typeof workflowRunModeSchema>
export const RUN_MODE_LABELS: Record<WorkflowRunMode, string> = { RUN_ALL: "Executar tudo", STEP: "Passo a passo", UNTIL_NODE: "Executar até um node" }

export { structureAnchorSchema, type StructureAnchor }

export const workflowSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interaction"), interactionId: z.string() }),
  z.object({ kind: z.literal("measurement"), measurementId: z.string() }),
  z.object({ kind: z.literal("operator"), operatorId: z.string() }),
  z.object({ kind: z.literal("unit"), consolidatedStructure: structureAnchorSchema }),
])
export type WorkflowSubject = z.infer<typeof workflowSubjectSchema>

const aiControlFields = {
  aiPolicy: aiPolicySchema,
  maxAiCalls: z.number().int().min(1).max(50).nullable().optional(),
}

export const workflowSimulationInputSchema = z.object({
  workflowId: z.string(),
  graphSource: z.enum(["PUBLISHED", "DRAFT"]).optional(),
  subject: workflowSubjectSchema,
  simulatedNow: z.string().optional(),
  scheduledFor: z.string().optional(),
  mode: workflowRunModeSchema,
  untilNodeId: z.string().optional(),
  ...aiControlFields,
})
export type WorkflowSimulationInput = z.infer<typeof workflowSimulationInputSchema>

export const agentSimulationInputSchema = z.object({
  agentId: z.string(),
  input: z.string().trim().min(1),
  operatorId: z.string().nullable().optional(),
  ...aiControlFields,
})
export type AgentSimulationInput = z.infer<typeof agentSimulationInputSchema>

export const orchestratorSimulationInputSchema = z.object({
  orchestratorId: z.string(),
  operatorId: z.string(),
  instruction: z.string().trim().min(1),
  extraContext: z.string().trim().optional(),
  invocationContext: z.enum(["INTERACTIVE", "WORKFLOW"]),
  ...aiControlFields,
})
export type OrchestratorSimulationInput = z.infer<typeof orchestratorSimulationInputSchema>

export const qaRunResumeInputSchema = z.object({
  aiPolicy: aiPolicySchema.optional(),
  maxAiCalls: z.number().int().min(1).max(50).nullable().optional(),
  mode: workflowRunModeSchema.optional(),
  untilNodeId: z.string().nullable().optional(),
  // Ausente = retoma o trace principal. Presente = retoma só o sub-trace daquele colaborador
  // dentro de um fan-out simulado (EMPLOYEE_COLLECTION) — cada um pausa/retoma independentemente.
  employeeId: z.string().optional(),
})
export type QaRunResumeInput = z.infer<typeof qaRunResumeInputSchema>

export { humanReviewDecisionSchema }

// ---------------------------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------------------------

export const qaPersonSchema = z.object({ id: z.string(), name: z.string(), role: z.string(), teamName: z.string().nullable() })
export type QaPerson = z.infer<typeof qaPersonSchema>

export const qaEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ALERT"),
    id: z.number(),
    nodeId: z.string().nullable(),
    alertType: z.string(),
    recipientId: z.string(),
    title: z.string(),
    description: z.string(),
    severity: z.string(),
    caseId: z.string().nullable(),
    surfaces: z.array(z.string()),
  }),
  z.object({ kind: z.literal("WORKFLOW_OUTPUT"), id: z.number(), nodeId: z.string().nullable(), surface: z.string(), recipientId: z.string(), interactionMode: z.string(), content: z.unknown() }),
  z.object({
    kind: z.literal("FEEDBACK"),
    id: z.number(),
    nodeId: z.string().nullable(),
    feedbackKind: z.enum(["monitoring", "indicator", "orchestrator"]),
    operatorId: z.string(),
    teamId: z.string(),
    caseId: z.string(),
    feedbackId: z.string(),
    title: z.string().nullable(),
    recommendation: z.string().nullable(),
    evidenceFound: z.string().nullable(),
    /** Materiais de apoio que a IA recomendou e o código aceitou (título real + motivo). */
    supportMaterials: z.array(z.object({ materialId: z.string(), title: z.string(), reason: z.string() })).optional(),
    input: z.unknown(),
  }),
  z.object({ kind: z.literal("CONFIG_VALUE"), id: z.number(), nodeId: z.string().nullable(), configKey: z.string(), valueType: z.string(), value: z.unknown(), scopeType: z.string(), teamId: z.string().nullable(), subteamId: z.string().nullable() }),
  z.object({ kind: z.literal("AGENT_RUN"), id: z.number(), nodeId: z.string().nullable(), runId: z.string(), agentId: z.string(), status: z.enum(["PENDING", "COMPLETED", "FAILED"]), outputText: z.string().nullable(), errorMessage: z.string().nullable() }),
  // V1.5.10 — "Gerar feedback de atendimento" simulado: o que a política decidiria (nada gravado/entregue/notificado).
  z.object({
    kind: z.literal("INTERACTION_FEEDBACK"),
    id: z.number(),
    nodeId: z.string().nullable(),
    interactionId: z.string(),
    status: z.enum(["GENERATED", "NOT_ANALYZABLE"]),
    notAnalyzableReason: z.string().nullable(),
    feedbackStatus: z.string().nullable(),
    writerInvoked: z.boolean(),
    dispositions: z.object({ AUTO_DELIVER: z.number(), HOLD_FOR_QA: z.number(), BLOCKED: z.number() }),
    reasons: z.array(z.string()),
    policyVersion: z.string().nullable(),
  }),
  // V1.5.12 — "Gerar feedback" (confiável) simulado: o artefato e o que seguiria no Workflow (nada gravado/entregue).
  z.object({
    kind: z.literal("RELIABLE_FEEDBACK"),
    id: z.number(),
    nodeId: z.string().nullable(),
    domain: z.enum(["MONITORING", "INDICATOR"]),
    sourceNodeId: z.string(),
    sourceType: z.enum(["AGENT", "ORCHESTRATOR"]),
    disposition: z.enum(["READY", "HOLD_FOR_QA", "BLOCKED", "REJECTED"]),
    itemCount: z.number(),
    emittableCount: z.number(),
    reasons: z.array(z.string()),
    policyVersion: z.string(),
    writerInvoked: z.boolean(),
    text: z.string(),
  }),
  z.object({ kind: z.literal("RELIABLE_FEEDBACK_EMISSION"), id: z.number(), nodeId: z.string().nullable(), surface: z.literal("FOLLOW_UP"), recipientId: z.string(), artifactId: z.string(), caseId: z.string(), feedbackId: z.string(), reused: z.boolean() }),
  // "Avaliar política de acompanhamento" simulado: avaliação e decisões por ação que seriam gravadas (nada gravado nem avisado).
  z.object({
    kind: z.literal("INTERVENTION_POLICY"),
    id: z.number(),
    nodeId: z.string().nullable(),
    policyId: z.string(),
    policyName: z.string(),
    policyVersion: z.number().nullable(),
    personId: z.string(),
    outcome: z.string(),
    decisions: z.array(z.object({ typeKey: z.string(), typeName: z.string(), status: z.string(), ruleKey: z.string(), responsibleName: z.string().nullable(), approverName: z.string().nullable(), dueAt: z.string().nullable() })),
    justification: z.string(),
    reportWouldBeCreated: z.boolean(),
    narrativeWouldBeGenerated: z.boolean(),
  }),
])
export type QaEffect = z.infer<typeof qaEffectSchema>

export const qaStepStatusSchema = z.enum(["completed", "waiting", "paused_before_ai", "failed", "stopped_here"])
export type QaStepStatus = z.infer<typeof qaStepStatusSchema>
export const QA_STEP_STATUS_LABELS: Record<QaStepStatus, string> = {
  completed: "Concluído",
  waiting: "Aguardando",
  paused_before_ai: "Pausado antes da IA",
  failed: "Erro",
  stopped_here: "Parou aqui",
}

export const qaStepSchema = z.object({
  index: z.number(),
  nodeId: z.string(),
  nodeType: z.string(),
  label: z.string(),
  status: qaStepStatusSchema,
  startedAt: z.string(),
  simulatedNow: z.string(),
  durationMs: z.number(),
  outcome: z
    .object({ kind: z.string(), branch: z.string().optional(), eventType: z.string().optional(), nextNodeId: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional() })
    .nullable(),
  nodeOutput: z.unknown().optional(),
  aiCalls: z.number(),
  totalTokens: z.number(),
  error: z.string().optional(),
})
export type QaStep = z.infer<typeof qaStepSchema>

/** Rastro de retrieval de KB por request (espelha KnowledgeTrace de retrieve-knowledge.ts). */
export const qaKnowledgeTraceSchema = z.object({
  mode: z.enum(["NONE", "FULL", "RETRIEVAL", "NO_MATCH"]),
  authorizedDocuments: z.array(z.object({ id: z.string(), title: z.string(), chars: z.number() })),
  retrieved: z.array(z.object({ documentId: z.string(), documentTitle: z.string(), heading: z.string(), excerpt: z.string(), score: z.number() })),
  injectedChars: z.number(),
  estimatedTokens: z.number(),
  authorizedChars: z.number(),
  budget: z.object({ maxChunks: z.number(), maxTotalChars: z.number(), minRelativeScore: z.number() }),
})
export type QaKnowledgeTrace = z.infer<typeof qaKnowledgeTraceSchema>
export const KNOWLEDGE_TRACE_MODE_LABELS: Record<QaKnowledgeTrace["mode"], string> = {
  NONE: "Sem base de conhecimento associada",
  FULL: "Bases pequenas — entraram inteiras",
  RETRIEVAL: "Retrieval — só os trechos pertinentes entraram",
  NO_MATCH: "Nenhum trecho pertinente — nada foi injetado",
}

export const LLM_PHASES = ["PREFLIGHT", "PLANNING", "SEMANTIC_ANALYSIS", "KNOWLEDGE", "SYNTHESIS"] as const
export const llmPhaseSchema = z.enum(LLM_PHASES)
export type LlmPhase = z.infer<typeof llmPhaseSchema>
export const LLM_PHASE_LABELS: Record<LlmPhase | "UNASSIGNED", string> = {
  PREFLIGHT: "Preflight",
  PLANNING: "Planejamento",
  SEMANTIC_ANALYSIS: "Análise semântica",
  KNOWLEDGE: "Conhecimento",
  SYNTHESIS: "Síntese",
  UNASSIGNED: "Sem fase (execução anterior)",
}

export const llmPromptBreakdownSchema = z.object({ systemPromptChars: z.number(), toolSchemaChars: z.number(), inputChars: z.number(), declaredTools: z.number(), technicalIds: z.number().optional() })
export const llmContextBreakdownSchema = z.object({ staticPromptChars: z.number(), dynamicPromptChars: z.number().optional(), toolSchemaChars: z.number(), evidenceLedgerChars: z.number(), interactionContentChars: z.number(), knowledgeContentChars: z.number(), structuredSchemaChars: z.number(), objectiveChars: z.number() })
export type LlmContextBreakdown = z.infer<typeof llmContextBreakdownSchema>
// V1.3 — classificação da request, cache observado/explícito, custo estimado (só com pricing) e componentes de prompt.
export const llmClassificationSchema = z.object({ phase: z.string(), purpose: z.string(), source: z.string(), semanticType: z.string(), tags: z.array(z.string()).optional() })
export const CACHE_MODES = ["NONE", "IMPLICIT", "EXPLICIT", "MIXED"] as const
export const llmCacheSchema = z.object({ mode: z.enum(["NONE", "IMPLICIT", "EXPLICIT"]), cacheKeyVersion: z.string().nullable(), cachedTokens: z.number().nullable(), hitRate: z.number().nullable() })
export const costEstimateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_CONFIGURED") }),
  z.object({ status: z.literal("ESTIMATED_PROVIDER_COST"), currency: z.string(), inputCost: z.number(), cachedInputCost: z.number(), outputCost: z.number(), reasoningCost: z.number(), totalEstimatedCost: z.number() }),
])
export type CostEstimate = z.infer<typeof costEstimateSchema>
export const promptComponentUsageSchema = z.object({ id: z.string(), version: z.number(), chars: z.number(), static: z.boolean(), placement: z.enum(["SYSTEM", "USER"]) })
export const CACHE_MODE_LABELS: Record<(typeof CACHE_MODES)[number], string> = { NONE: "Sem cache", IMPLICIT: "Implícito (provider)", EXPLICIT: "Explícito (prefixo em cache)", MIXED: "Misto" }
export const STOP_REASONS = ["ANSWER_SUFFICIENT", "INSUFFICIENT_DATA", "NO_MORE_SUPPORTED_PATHS", "MAX_PLANNING_ROUNDS", "INVESTIGATION_TOOL_BUDGET", "TOKEN_WARNING_STOP", "SAFETY_STOP"] as const
export const SUFFICIENCY_STATUS_LABELS: Record<string, string> = { SUFFICIENT: "Suficiente", INSUFFICIENT_DATA: "Dados insuficientes", NO_PATH: "Sem caminho", LIMITED: "Limitada por orçamento/rodadas" }
export const NEED_STATUS_LABELS: Record<string, string> = { OPEN: "Aberta", SATISFIED: "Satisfeita", BLOCKED: "Bloqueada", NOT_NEEDED: "Não necessária" }
export const GATING_STATUS_LABELS = { PASSED: "Aprovado", CORRECTED: "Corrigido em 1 re-request", FALLBACK: "Fallback factual", DISCARDED: "Descartado", NOT_APPLICABLE: "Não se aplica" } as const
export const UNIVERSE_RELATIONSHIP_LABELS = { EXACT: "Mesmo universo", PARTIAL: "Subconjunto vinculado", UNKNOWN: "Não determinado" } as const
export const MODEL_TIERS = ["BASIC", "STANDARD", "DEEP"] as const
export const llmRouteSchema = z.object({ provider: z.string(), tier: z.enum(MODEL_TIERS), reason: z.string(), mode: z.enum(["CURRENT", "EFFICIENCY"]), escalated: z.boolean(), fallback: z.boolean() })
export type LlmRoute = z.infer<typeof llmRouteSchema>
export const CONTEXT_BREAKDOWN_LABELS: Record<keyof LlmContextBreakdown, string> = {
  staticPromptChars: "Prompt estático",
  dynamicPromptChars: "Prompt dinâmico (sujeito/KB/materiais)",
  toolSchemaChars: "Schemas de ferramentas",
  evidenceLedgerChars: "Evidence Ledger",
  interactionContentChars: "Conteúdo de interações",
  knowledgeContentChars: "Conhecimento",
  structuredSchemaChars: "Schema estruturado",
  objectiveChars: "Objetivo/entrada",
}

export const qaAiCallSchema = z.object({
  sequence: z.number(),
  role: z.enum(["agent", "orchestrator_routing", "orchestrator_synthesis", "specialist", "agent_synthesis"]),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  model: z.string(),
  promptTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  // V1.1 — só quando o provider informou (nunca estimados); ausentes em requests antigas.
  cachedInputTokens: z.number().nullable().optional(),
  reasoningTokens: z.number().nullable().optional(),
  phase: llmPhaseSchema.optional(),
  toolCalls: z.array(z.string()).optional(),
  promptBreakdown: llmPromptBreakdownSchema.optional(),
  contextBreakdown: llmContextBreakdownSchema.optional(),
  route: llmRouteSchema.optional(),
  classification: llmClassificationSchema.optional(),
  promptComponents: z.array(promptComponentUsageSchema).optional(),
  cache: llmCacheSchema.optional(),
  cost: costEstimateSchema.optional(),
  durationMs: z.number(),
  startedAt: z.string(),
  systemPrompt: z.string(),
  input: z.string(),
  outputText: z.string().nullable(),
  knowledge: qaKnowledgeTraceSchema.optional(),
})
export type QaAiCall = z.infer<typeof qaAiCallSchema>

// ---------------------------------------------------------------------------------------------
// Telemetria de eficiência (V1.1) — espelho de qa-lab/domain/qa-run-telemetry.ts. Campo null =
// "Não informado" pelo provider. `perRequest` só vem no detalhe (a listagem leve o omite).
// ---------------------------------------------------------------------------------------------
export const qaTokenTotalsSchema = z.object({
  input: z.number().nullable(),
  cached: z.number().nullable(),
  uncached: z.number().nullable(),
  output: z.number().nullable(),
  reasoning: z.number().nullable(),
  total: z.number().nullable(),
})
export type QaTokenTotals = z.infer<typeof qaTokenTotalsSchema>

export const qaTokenBudgetSchema = z.object({
  status: z.enum(["OK", "WARNING", "NOT_INFORMED"]),
  thresholds: z.object({ total: z.number().nullable(), input: z.number().nullable(), output: z.number().nullable() }),
  exceeded: z.array(z.enum(["total", "input", "output"])),
})

export const qaRunTelemetrySchema = z.object({
  version: z.literal(1),
  requests: z.number(),
  tokens: qaTokenTotalsSchema,
  cacheHitRate: z.number().nullable(),
  toolBudget: z
    .object({
      executed: z.number(),
      cached: z.number(),
      rejected: z.number(),
      preflight: z.number().nullable(),
      investigation: z.number().nullable().optional(),
      budget: z.number().nullable(),
      outcome: z.enum(["ANSWERED", "BUDGET_EXHAUSTED", "NO_TOOLS", "TIMEOUT"]).nullable(),
      planningRounds: z.number().nullable(),
      parallelWaves: z.number().nullable(),
    })
    .nullable(),
  tokenBudget: qaTokenBudgetSchema.nullable(),
  phases: z.array(z.object({ phase: z.enum([...LLM_PHASES, "UNASSIGNED"]), requests: z.number(), tokens: qaTokenTotalsSchema, durationMs: z.number(), toolCallsRequested: z.number() })),
  perRequest: z
    .array(
      z.object({
        sequence: z.number(),
        phase: llmPhaseSchema.nullable(),
        role: z.enum(["agent", "orchestrator_routing", "orchestrator_synthesis", "specialist", "agent_synthesis"]),
        agentName: z.string().nullable(),
        model: z.string(),
        provider: z.string(),
        tokens: qaTokenTotalsSchema,
        durationMs: z.number(),
        toolCalls: z.array(z.string()),
        promptBreakdown: llmPromptBreakdownSchema.nullable(),
        route: llmRouteSchema.nullable().optional(),
        contextBreakdown: llmContextBreakdownSchema.nullable().optional(),
        technicalIds: z.number().nullable().optional(),
        classification: llmClassificationSchema.nullable().optional(),
        cache: llmCacheSchema.nullable().optional(),
        cost: costEstimateSchema.nullable().optional(),
        promptComponents: z.array(promptComponentUsageSchema).nullable().optional(),
      }),
    )
    .optional(),
  reference: z
    .object({
      runId: z.string(),
      createdAt: z.coerce.string(),
      requests: z.number(),
      toolCalls: z.number().nullable(),
      tokens: z.object({ input: z.number().nullable(), output: z.number().nullable(), total: z.number().nullable(), cached: z.number().nullable() }),
      durationMs: z.number(),
      staticPromptChars: z.number().nullable().optional(),
      toolSchemaChars: z.number().nullable().optional(),
      cost: costEstimateSchema.nullable().optional(),
      datasetFingerprint: z.object({ hash: z.string() }).nullable().optional(),
      planningRounds: z.number().nullable().optional(),
    })
    .nullable(),
  technicalIdsInPrompts: z.number().nullable().optional(),
  contextBreakdown: llmContextBreakdownSchema.nullable().optional(),
  // V1.3 — ausentes em runs anteriores.
  cache: z.object({ mode: z.enum(CACHE_MODES), cachedTokens: z.number().nullable(), hitRate: z.number().nullable(), explicitRequests: z.number(), implicitRequests: z.number(), cacheKeyVersions: z.array(z.string()) }).nullable().optional(),
  cost: z.object({ total: costEstimateSchema, byPhase: z.array(z.object({ phase: z.enum([...LLM_PHASES, "UNASSIGNED"]), cost: costEstimateSchema })) }).nullable().optional(),
  coverage: z
    .object({
      recordedInteractions: z.number().nullable(),
      analyzedInteractions: z.number().nullable(),
      recordedCoverage: z.number().nullable(),
      operationalUniverse: z.number().nullable(),
      operationalCoverage: z.number().nullable(),
      universeRelationship: z.enum(["EXACT", "PARTIAL", "UNKNOWN"]).nullable(),
      representativeness: z.enum(["INSUFFICIENT", "ANECDOTAL", "REPRESENTATIVE"]).nullable(),
      allowedScope: z.string().nullable(),
      allowedScopeLabel: z.string().nullable(),
    })
    .nullable()
    .optional(),
  quality: z
    .object({
      gatingStatus: z.enum(["PASSED", "CORRECTED", "FALLBACK", "DISCARDED", "NOT_APPLICABLE"]),
      envelopePresent: z.boolean().nullable(),
      correctionAttempted: z.boolean(),
      correctionSucceeded: z.boolean().nullable(),
      fallbackUsed: z.boolean(),
      fallbackReason: z.string().nullable(),
      rejectedClaims: z.number(),
      claimScopes: z.array(z.object({ scope: z.string(), label: z.string(), count: z.number() })),
      limitations: z.number(),
      // V1.3.2 — framing do marcador de evidência (prova de que INVALID não veio de outro marcador engolido).
      markerStatus: z.string().nullable().optional(),
      // V1.4.2 — categorias da correção (BINDING_FORMAT = perda por contrato; SEMANTIC; TEMPORAL; ENVELOPE).
      correctionCategories: z.array(z.string()).nullable().optional(),
      persistentCategories: z.array(z.string()).nullable().optional(),
      // V1.4.3 — destino das afirmações (salvamento parcial: uma inválida não apaga as válidas).
      claims: z.object({ proposed: z.number(), acceptedFirstPass: z.number(), correctionRequired: z.number(), corrected: z.number(), dropped: z.number(), preservedAfterSiblingFailure: z.number(), recommendationsDropped: z.number() }).nullable().optional(),
      salvage: z.enum(["NONE", "PARTIAL", "FULL_FALLBACK"]).nullable().optional(),
      // V1.4.4 — candidatos de afirmação projetados pela aplicação (o modelo seleciona e redige).
      candidates: z.object({ available: z.number(), selected: z.number(), delivered: z.number(), textPolarityMismatch: z.number(), textScopeMismatch: z.number(), swapRejected: z.number(), duplicateSelection: z.number() }).nullable().optional(),
      firstAttemptMarkerStatus: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  promptComponents: z.array(z.object({ id: z.string(), static: z.boolean(), chars: z.number(), requests: z.number() })).nullable().optional(),
  // V1.3.1 — suficiência da investigação (objetivo, escopo, motivo da parada, necessidades, hipóteses) e compatibilidade do benchmark.
  sufficiency: z
    .object({
      objective: z.string().nullable(),
      objectiveLabel: z.string().nullable(),
      requiredScope: z.string().nullable(),
      stopReason: z.enum(STOP_REASONS).nullable(),
      stopReasonLabel: z.string().nullable(),
      status: z.string().nullable(),
      stopProposed: z.boolean().nullable(),
      stopAccepted: z.boolean().nullable(),
      rejections: z.array(z.object({ round: z.number(), reasons: z.array(z.string()) })),
      needs: z.object({ satisfied: z.number(), open: z.number(), blocked: z.number(), notNeeded: z.number(), items: z.array(z.object({ id: z.string(), question: z.string(), status: z.string(), material: z.boolean(), candidateTools: z.array(z.string()), blockedBy: z.string().optional() })) }),
      hypotheses: z.object({ supported: z.number(), refuted: z.number(), open: z.number(), blocked: z.number(), material: z.number() }),
      contradictoryEvidence: z.boolean(),
      additionalEvidenceCouldChangeConclusion: z.boolean().nullable(),
      additionalEvidenceCouldIncreaseRequiredScope: z.boolean().nullable(),
      criticalFacts: z.array(z.object({ ref: z.string(), kind: z.string(), label: z.string() })),
      // V1.3.2 — recusa na última rodada, fontes de evidência, amostragem e análise de interações (ausentes em runs anteriores).
      stopRejectedAtFinalRound: z.boolean().nullable().optional(),
      remainingMaterialNeeds: z.array(z.string()).optional(),
      candidateToolsAvailable: z.array(z.string()).optional(),
      evidenceSources: z.object({ available: z.array(z.string()), used: z.array(z.string()) }).nullable().optional(),
      samplingStrategy: z.string().nullable().optional(),
      periodIntent: z.string().nullable().optional(),
      temporal: z.object({ temporalComparisonRequired: z.boolean(), temporalComparisonStatus: z.string(), availableBuckets: z.number(), analyzedBuckets: z.number(), comparedBuckets: z.array(z.string()), temporalClaimsProposed: z.number(), temporalClaimsAccepted: z.number(), temporalClaimsRejected: z.number(), rejectionReasons: z.record(z.string(), z.number()), sampleDifferenceDetected: z.boolean().optional(), absenceEstablished: z.boolean().optional(), conclusion: z.object({ kind: z.string(), safeMeaning: z.string(), allowedRelations: z.array(z.string()) }).optional() }).nullable().optional(),
      interactionAnalysis: z.array(z.object({ analyzedTranscriptCount: z.number(), recordedUniverseCount: z.number().nullable(), universeRelationship: z.string().nullable(), findings: z.number(), verifiedExcerpts: z.number(), temporalBucketsCovered: z.number().nullable(), temporalBuckets: z.number().nullable(), evidenceVerification: z.object({ candidateExcerptCount: z.number(), verifiedExcerptCount: z.number(), rejectedExcerptCount: z.number(), findingsBeforeVerification: z.number(), findingsAfterVerification: z.number(), rejectionReasons: z.record(z.string(), z.number()), turnRefMismatchResolved: z.number().optional() }).nullable().optional() })).optional(),
      // V1.4.0: resumo da camada semântica (frames → findings → patterns por suporte).
      semantic: z.object({ analysisCalls: z.number(), semanticFramesCreated: z.number(), framesNotReturned: z.number(), framesEmpty: z.number(), interactionsWithFindings: z.number(), strengthFindingsCount: z.number(), riskFindingsCount: z.number(), unresolvedNeedsCount: z.number(), partialNeedsCount: z.number(), proceduralQuestionsCount: z.number(), procedureAssertionsCount: z.number(), crossInteractionPatternsCount: z.number(), patternsBySupport: z.record(z.string(), z.number()), patternsByKind: z.record(z.string(), z.number()), contractViolations: z.number(), phaseAFindings: z.number().optional(), phaseBPromotedFindings: z.number().optional(), promotionRejectedCount: z.number().optional(), interactionFrictionFindingsCount: z.number().optional(), findingKindDowngraded: z.number().optional(), interactionEventsCount: z.number().optional(), patternsByScope: z.record(z.string(), z.number()).optional(), questionsWithComponents: z.number().optional(), answerCompletenessDowngraded: z.number().optional(), needStatusDowngraded: z.number().optional(), frictionDowngradedByCompleteAnswer: z.number().optional(), contradictionDowngradedByCorrection: z.number().optional(), proceduralConsistencyFindings: z.number().optional(), proceduralDivergenceFindings: z.number().optional(), proceduralQuestionFindings: z.number().optional(), patternsByOwnership: z.record(z.string(), z.number()).optional(), patternsScopeCappedByOwnership: z.number().optional(), /** V1.4.6.8 */ frameContract: z.object({ calls: z.number(), initialComplete: z.number(), finalComplete: z.number(), retries: z.number(), expectedFrames: z.number(), initialMissingFrames: z.number(), finalMissingFrames: z.number(), emptyFrames: z.number(), duplicateFrames: z.number(), duplicateFrameObservationsDropped: z.number(), unexpectedFrames: z.number(), exampleRefEchoed: z.number() }).optional() }).nullable().optional(),
      /** V1.4.6: resultado × atribuição (necessidade aberta ≠ falha do operador). */
      outcomeAttribution: z.object({ analysisCalls: z.number(), needsTotal: z.number(), needsOpen: z.number(), attributionsDeclared: z.number(), attributionsAccepted: z.number(), byAttribution: z.record(z.string(), z.number()), agentAttributionRejected: z.number(), bridges: z.record(z.string(), z.number()), findingsNeutralized: z.number(), findingsAgentAttributed: z.number(), patternsByOwnership: z.record(z.string(), z.number()), patternsScopeCappedByOwnership: z.number(), sidecarStatus: z.string() }).nullable().optional(),
      /** V1.4.5: funil procedimental (afirmação normativa → regra da base com trecho literal → comparação determinística). */
      procedural: z.object({ analysisCalls: z.number(), assertionsDeclared: z.number(), quantitiesParsedAssertion: z.number(), knowledgeExcerptsAvailable: z.number(), rulesDeclared: z.number(), rulesVerified: z.number(), rulesRejected: z.number(), evaluations: z.number(), byStatus: z.record(z.string(), z.number()), coverage: z.string(), knowledgeSource: z.string() }).nullable().optional(),
    })
    .nullable()
    .optional(),
  comparison: z.object({ status: z.enum(["COMPATIBLE", "DATASET_CHANGED", "UNKNOWN"]), current: z.string().nullable(), reference: z.string().nullable(), message: z.string(), currentDataset: z.string().nullable().optional(), referenceDataset: z.string().nullable().optional() }).nullable().optional(),
  /** Dataset de diagnóstico do run (hotfix 2026-09-18): versão + fingerprint resumido; NOT_APPLICABLE fora da massa; NOT_INFORMED em runs antigos. */
  dataset: z.object({ status: z.enum(["APPLIED", "NOT_APPLICABLE", "NOT_INFORMED"]), version: z.string().nullable(), fingerprint: z.string().nullable(), shortFingerprint: z.string().nullable(), hash: z.string().nullable() }).nullable().optional(),
})
export type QaRunTelemetry = z.infer<typeof qaRunTelemetrySchema>

/** V1.3.2 — rótulos das fontes de evidência (rastreabilidade no QA Lab; nunca score). */
export const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  INTERACTION_CONTENT: "Conteúdo das interações",
  INTERACTION_EVENTS: "Eventos por interação",
  TEMPORAL_HISTORY: "Histórico/evolução",
  SEGMENTATION: "Segmentação",
  POPULATION_COMPARISON: "População",
  INDICATOR_STATE: "Indicador",
  DATA_QUALITY: "Qualidade do dado",
  WORK_CONTEXT: "Jornada",
  KNOWLEDGE: "Conhecimento",
}
export const SAMPLING_STRATEGY_LABELS: Record<string, string> = {
  RECENT: "mais recentes",
  TEMPORAL_STRATIFIED: "distribuída no tempo",
  SUBJECT_STRATIFIED: "distribuída por assunto",
  FLAG_STRATIFIED: "com/sem flag",
}
export const AI_CALL_ROLE_LABELS: Record<QaAiCall["role"], string> = {
  agent: "Agente",
  orchestrator_routing: "Orquestrador — roteamento",
  orchestrator_synthesis: "Orquestrador — síntese",
  specialist: "Especialista",
  // Agent de síntese pós-JOIN (Chamar agente depois de Consolidar resultados) — nunca "roteamento".
  agent_synthesis: "Agente — síntese consolidada",
}

const qaPendingReviewSchema = z.object({ nodeId: z.string(), reviewerIds: z.array(z.string()), instruction: z.string().nullable(), content: z.unknown(), presentation: reviewPresentationSchema.nullable().optional() }).nullable().optional()

export const qaKnowledgeRetrievalSchema = qaKnowledgeTraceSchema.extend({
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  role: z.enum(["agent", "orchestrator_routing", "orchestrator_synthesis", "specialist", "agent_synthesis"]),
})
export type QaKnowledgeRetrieval = z.infer<typeof qaKnowledgeRetrievalSchema>

export const qaTraceSchema = z.object({
  steps: z.array(qaStepSchema),
  effects: z.array(qaEffectSchema),
  aiCalls: z.array(qaAiCallSchema),
  // Retrievals de KB da execução — inclusive antes de uma request bloqueada ("Parar antes da IA").
  knowledgeRetrievals: z.array(qaKnowledgeRetrievalSchema).optional(),
  people: z.record(z.string(), qaPersonSchema),
  context: z.record(z.string(), z.unknown()),
  pendingReview: qaPendingReviewSchema,
  // Telemetria de eficiência (V1.1) — ausente em runs anteriores.
  telemetry: qaRunTelemetrySchema.optional(),
  // Fan-out simulado (EMPLOYEE_COLLECTION) — 1 sub-trace por colaborador dentro do MESMO QA Run,
  // nunca N qa_runs independentes (espelha QaTrace.employeeRuns do backend, qa-run-schema.ts).
  employeeRuns: z
    .array(
      z.object({
        employeeId: z.string(),
        steps: z.array(qaStepSchema),
        status: z.enum(["active", "waiting", "completed", "failed", "paused"]),
        pendingReview: qaPendingReviewSchema,
      }),
    )
    .optional(),
})
export type QaTrace = z.infer<typeof qaTraceSchema>

export const workflowSimulationStateSchema = z.object({
  currentNodeId: z.string(),
  status: z.enum(["active", "waiting", "completed", "failed", "paused"]),
  // FAN_IN: execução pai aguardando os filhos do fan-out convergirem no Join (run-workflow-simulation.ts).
  pauseReason: z.enum(["WAIT", "HUMAN_REVIEW", "AI_BLOCKED", "AI_BUDGET", "STEP", "UNTIL_NODE", "FAN_IN"]).nullable(),
  resumeAt: z.string().nullable(),
  nodeOutputs: z.record(z.string(), z.unknown()),
  variables: z.record(z.string(), z.unknown()),
  simulatedNow: z.string(),
  revision: z.number(),
})
export type WorkflowSimulationState = z.infer<typeof workflowSimulationStateSchema>

export const qaRunStatusSchema = z.enum(["RUNNING", "COMPLETED", "WAITING", "PAUSED", "FAILED"])
export type QaRunStatus = z.infer<typeof qaRunStatusSchema>
export const QA_RUN_STATUS_LABELS: Record<QaRunStatus, string> = {
  RUNNING: "Em execução",
  COMPLETED: "Concluído",
  WAITING: "Aguardando",
  PAUSED: "Pausado",
  FAILED: "Falhou",
}

export const qaResourceTypeSchema = z.enum(["WORKFLOW", "AGENT", "ORCHESTRATOR"])
export type QaResourceType = z.infer<typeof qaResourceTypeSchema>
export const QA_RESOURCE_TYPE_LABELS: Record<QaResourceType, string> = { WORKFLOW: "Workflow", AGENT: "Agent", ORCHESTRATOR: "Orchestrator" }

export const qaRunSchema = z.object({
  id: z.string(),
  executedBy: z.string(),
  executedByName: z.string().nullable(),
  resourceType: qaResourceTypeSchema,
  resourceId: z.string(),
  resourceName: z.string(),
  status: qaRunStatusSchema,
  input: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()),
  // `state` persistido inclui `session` (grafo congelado etc.) — só o estado visível importa aqui.
  state: workflowSimulationStateSchema.loose().nullable(),
  trace: qaTraceSchema,
  aiCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  durationMs: z.number(),
  errorMessage: z.string().nullable(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string(),
})
export type QaRun = z.infer<typeof qaRunSchema>

// Listagem leve (sem trace/context/state pesados — o backend devolve vazios), com um resumo
// mínimo de contexto (colaborador/interação) pro histórico dizer o que foi testado.
export const qaRunSummarySchema = qaRunSchema.omit({ trace: true, context: true, state: true }).extend({
  contextSummary: z
    .object({
      operatorName: z.string().nullable(),
      interactionId: z.string().nullable(),
      interactionExternalId: z.string().nullable(),
      interactionStartedAt: z.coerce.string().nullable(),
      workflowState: z.string().nullable(),
    })
    .nullable()
    .optional(),
  // Listagem leve: telemetria sem `perRequest`; null/ausente = run anterior à telemetria.
  telemetry: qaRunTelemetrySchema.nullable().optional(),
})
export type QaRunSummary = z.infer<typeof qaRunSummarySchema>

// ---------------------------------------------------------------------------------------------
// Massa de teste
// ---------------------------------------------------------------------------------------------

export const qaInteractionSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  reason: z.string(),
  /** Submotivo da interação; null = a fonte não informou. */
  subReason: z.string().nullable().optional(),
  channel: z.string(),
  startedAt: z.coerce.string(),
  endedAt: z.coerce.string(),
  durationSeconds: z.number(),
  operatorId: z.string(),
  operatorName: z.string(),
  teamName: z.string().nullable(),
  /** null = gatilho Manual com interação (nenhuma flag disparou; a interação é escolhida). */
  flagName: z.string().nullable(),
  value: z.union([z.boolean(), z.number()]).nullable(),
  hasTranscript: z.boolean(),
  matches: z.boolean().nullable().optional(),
})
export type QaInteraction = z.infer<typeof qaInteractionSchema>

/** Interações que REALMENTE poderiam disparar o Workflow (flag + canal + Abrangência + Filtro
 * Populacional) — paginado, mais recentes primeiro. */
export const qaCompatibleInteractionsSchema = z.object({
  flag: z.object({ channelFlagId: z.string(), channel: z.string(), name: z.string(), valueType: z.enum(["BOOLEAN", "NUMERIC"]), label: z.string() }).nullable(),
  rows: z.array(qaInteractionSchema),
  hasMore: z.boolean(),
})
export type QaCompatibleInteractions = z.infer<typeof qaCompatibleInteractionsSchema>

/** Detalhe da interação — só dado persistido. A transcrição é texto puro (não existe speaker/
 * timestamp estruturado na base; a UI nunca inventa essa estrutura). */
export const qaInteractionDetailSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  teamName: z.string().nullable(),
  channel: z.string(),
  reason: z.string(),
  subReason: z.string().nullable().optional(),
  startedAt: z.coerce.string(),
  endedAt: z.coerce.string(),
  durationSeconds: z.number(),
  flags: z.array(z.object({ channelFlagId: z.string(), name: z.string(), valueType: z.string(), value: z.union([z.boolean(), z.number()]).nullable(), receivedAt: z.coerce.string() })),
  transcript: z.object({ content: z.string(), version: z.number(), language: z.string(), confidence: z.number().nullable(), checksum: z.string() }).nullable(),
})
export type QaInteractionDetail = z.infer<typeof qaInteractionDetailSchema>

/** Evidência registrada no QA Run (context.interaction) — identidade + checksum, nunca a
 * transcrição inteira. Runs anteriores só têm o subconjunto básico. */
export const qaInteractionEvidenceSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  reason: z.string().optional(),
  subReason: z.string().nullable().optional(),
  channel: z.string(),
  startedAt: z.coerce.string(),
  endedAt: z.coerce.string().optional(),
  durationSeconds: z.number().optional(),
  operatorId: z.string().optional(),
  operatorName: z.string().optional(),
  flag: z.object({ name: z.string(), valueType: z.string(), value: z.union([z.boolean(), z.number()]).nullable() }).nullable().optional(),
  hasTranscript: z.boolean().optional(),
  transcript: z.object({ available: z.boolean(), version: z.number().nullable(), checksum: z.string().nullable(), length: z.number() }).optional(),
  transcriptChangedSinceOriginalRun: z.boolean().optional(),
})
export type QaInteractionEvidence = z.infer<typeof qaInteractionEvidenceSchema>

export const qaMeasurementSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  teamName: z.string().nullable(),
  value: z.number(),
  unit: z.string(),
  periodStart: z.coerce.string(),
  periodEnd: z.coerce.string(),
  targetValue: z.number().nullable(),
  matches: z.boolean().nullable(),
})
export type QaMeasurement = z.infer<typeof qaMeasurementSchema>

export const qaPersonOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  hasShift: z.boolean(),
})
export type QaPersonOption = z.infer<typeof qaPersonOptionSchema>

export const conditionBranchSchema = z.enum(["true", "false", "no_data"])
export type ConditionBranch = z.infer<typeof conditionBranchSchema>

/** Uma linha da prévia de massa — calculada pelo MESMO evaluator da execução (backend:
 * condition-evaluator.ts); `evaluation` é o mesmo payload de debug do evento condition_evaluated. */
export const conditionPreviewRowSchema = z.object({
  subjectKind: z.enum(["EMPLOYEE", "STRUCTURE"]),
  subjectId: z.string(),
  label: z.string(),
  teamName: z.string().nullable(),
  memberCount: z.number(),
  branch: conditionBranchSchema,
  summary: z.string(),
  reason: z.string().nullable(),
  reasonText: z.string().nullable(),
  evaluation: z.record(z.string(), z.unknown()),
  subject: workflowSubjectSchema,
})
export const conditionPreviewSchema = z.object({ nodeId: z.string(), label: z.string(), rows: z.array(conditionPreviewRowSchema) })
export type ConditionPreview = z.infer<typeof conditionPreviewSchema>
export type ConditionPreviewRow = z.infer<typeof conditionPreviewRowSchema>

/**
 * V1.5.10 — rótulos dos motivos ESTRUTURADOS da política de entrega (códigos de feedback-delivery-policy.ts no backend).
 * Código desconhecido aparece como está — nunca inventado.
 */
export const FEEDBACK_DISPOSITION_REASON_LABELS: Record<string, string> = {
  PILOT_HOLD_ALL_FOR_QA: "Política piloto: todo item passa pelo QA",
  RISK_POLICY_SECTION: "Política de risco exige QA para esta seção",
  RISK_POLICY_FINDING_KIND: "Política de risco exige QA para este tipo de ponto",
  FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY: "Tipo de ponto ainda não liberado para entrega direta",
  ITEM_EVIDENCE_UNVERIFIED_PROCEDURE_ASSERTION: "A evidência é uma afirmação de procedimento não verificada",
  WRITER_NOT_PASSED: "O texto não passou nos validadores",
  WRITER_VALIDATION_FAILED: "O texto não passou nos validadores",
  WRITER_FALLBACK_USED: "Texto de segurança (fallback) — nunca entregue direto",
  KNOWLEDGE_APPLICABILITY_UNVERIFIED: "A regra da base não está ancorada no que aconteceu na chamada",
  KNOWLEDGE_RULE_IS_EXAMPLE: "O trecho citado como regra é um exemplo do material",
  KNOWLEDGE_PROVENANCE_INCONSISTENT: "Trechos da base de documentos/versões diferentes",
  CHECKPOINT_LABEL_UNRESOLVED: "A etapa ficou sem nome identificável",
  WORDING_PRIVACY_FLAG: "O texto contém dado pessoal",
  EFFECT_CLAIM_BOUNDARY_VIOLATED: "O texto afirmou efeito além do observado",
  ACTION_CLAIM_BOUNDARY_VIOLATED: "O texto tratou uma ação declarada como executada",
  CLAIM_BOUNDARY_NOT_ENFORCED: "O texto não foi escrito nos modos de afirmação validados",
  OWNERSHIP_NOT_ALLOWED: "O ponto não é conduta do próprio operador",
  BLOCKING_UNCERTAINTY: "Incerteza que põe a análise em dúvida",
  PROCEDURAL_CONTENT: "Ponto procedimental",
  READINESS_NOT_READY: "Evidência exibível insuficiente",
  PROCEDURAL_MATCHING_NOT_VALIDATED: "Ponto procedimental (casamento com a base ainda não validado)",
  INSUFFICIENT_DISPLAY_EVIDENCE: "Sem evidência exibível suficiente",
  EVIDENCE_PRIVACY_FAIL: "A evidência contém dado pessoal",
  NOT_COLLABORATOR_DELIVERABLE: "Fora das seções entregues ao colaborador",
  NO_COMMUNICABLE_GUIDANCE: "Sem orientação comunicável",
  // V1.5.12 — feedback confiável do Workflow
  FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY: "Tipo de feedback ainda não liberado para seguir sem QA",
  SOURCE_INTERPRETATION_CONFLICT: "A análise da origem contradiz o dado oficial (descartada do texto)",
  NO_EVIDENCE: "A origem não trouxe evidência",
  EVIDENCE_NOT_VERIFIED: "A citação da origem não confere com a transcrição",
  NOT_ATTRIBUTABLE_TO_COLLABORATOR: "A evidência não é conduta do operador",
  CANONICAL_TARGET_MISSING: "Sem meta oficial vigente para comparar",
  AUTONOMY_CRITERIA_MET: "Critérios de autonomia atendidos",
  SOURCE_NOT_EXECUTED: "A origem não produziu resultado",
  SOURCE_KIND_INCOMPATIBLE: "O resultado da origem não é deste tipo de feedback",
  ORGANIZATION_MISMATCH: "O resultado da origem é de outra organização",
  COLLABORATOR_MISMATCH: "O resultado da origem é de outro colaborador",
  INTERACTION_MISMATCH: "O resultado da origem é de outra interação",
  MEASUREMENT_MISMATCH: "O resultado da origem é de outra medição",
  INDICATOR_ORCHESTRATOR_UNSUPPORTED: "Indicador a partir de Orquestrador ainda não é suportado",
  NO_CANONICAL_INDICATOR_CONTEXT: "Sem dado oficial do indicador para esta medição",
  INTERACTION_NOT_ANALYZABLE: "Interação sem transcrição",
  SOURCE_HAS_NO_CLAIMS: "A origem não trouxe conclusões com evidência",
}
