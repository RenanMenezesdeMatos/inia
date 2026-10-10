import { z } from "zod"

/**
 * Espelho de UI do catálogo de capacidades e Tools de investigação
 * (backend: investigation/domain/capabilities.ts + tool-catalog.ts). A UI mostra CAPACIDADES
 * amigáveis; a lista de Tools é só leitura ("avançado"). Rótulos copiados do backend.
 */
export const INVESTIGATION_CAPABILITIES = ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON", "INTERACTION_ANALYSIS", "WORK_CONTEXT", "KNOWLEDGE", "SUPPORT_MATERIALS"] as const
export type InvestigationCapability = (typeof INVESTIGATION_CAPABILITIES)[number]
export const investigationCapabilitySchema = z.enum(INVESTIGATION_CAPABILITIES)

export const INVESTIGATION_CAPABILITY_LABELS: Record<InvestigationCapability, string> = {
  INDICATOR_ANALYSIS: "Indicadores e tendências",
  SEGMENTATION: "Segmentação operacional",
  OPERATIONAL_COMPARISON: "Comparação operacional",
  INTERACTION_ANALYSIS: "Interações e transcrições",
  WORK_CONTEXT: "Jornada operacional",
  KNOWLEDGE: "Base de Conhecimento",
  SUPPORT_MATERIALS: "Materiais de apoio",
}

export const INVESTIGATION_CAPABILITY_DESCRIPTIONS: Record<InvestigationCapability, string> = {
  INDICATOR_ANALYSIS: "Consultar a situação de um indicador, comparar períodos, ver histórico, composição, picos e qualidade do dado.",
  SEGMENTATION: "Descobrir por quais dimensões o dado pode ser recortado e onde o resultado está concentrado.",
  OPERATIONAL_COMPARISON: "Comparar o colaborador com a população comparável (Subgrupo/Grupo), sempre de forma agregada.",
  INTERACTION_ANALYSIS: "Localizar interações do recorte, ler o contexto e as flags, encontrar interações comparáveis e analisar transcrições com evidência.",
  WORK_CONTEXT: "Verificar escala, situação funcional, ausências, exceções e disponibilidade dos dados no período.",
  KNOWLEDGE: "Consultar as bases de conhecimento autorizadas para o Agent a partir de uma evidência.",
  SUPPORT_MATERIALS: "Selecionar, entre os materiais reais já consultados, até 3 que ajudam de verdade.",
}

/** Tools internas liberadas por capacidade (só leitura na UI). */
export const INVESTIGATION_TOOLS: { key: string; label: string; capability: InvestigationCapability }[] = [
  { key: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS" },
  { key: "compare_periods", label: "Comparar períodos", capability: "INDICATOR_ANALYSIS" },
  { key: "inspect_indicator_composition", label: "Composição do indicador", capability: "INDICATOR_ANALYSIS" },
  { key: "validate_data_quality", label: "Validar qualidade do dado", capability: "INDICATOR_ANALYSIS" },
  { key: "detect_anomalies", label: "Detectar picos e recorrência", capability: "INDICATOR_ANALYSIS" },
  { key: "get_employee_history", label: "Histórico do colaborador", capability: "INDICATOR_ANALYSIS" },
  { key: "synthesize_evidence", label: "Organizar evidências", capability: "INDICATOR_ANALYSIS" },
  { key: "get_available_dimensions", label: "Dimensões disponíveis", capability: "SEGMENTATION" },
  { key: "segment_indicator", label: "Segmentar", capability: "SEGMENTATION" },
  { key: "compare_population", label: "Comparar com a estrutura", capability: "OPERATIONAL_COMPARISON" },
  { key: "find_interactions", label: "Buscar interações", capability: "INTERACTION_ANALYSIS" },
  { key: "get_interaction_context", label: "Contexto da interação", capability: "INTERACTION_ANALYSIS" },
  { key: "get_interaction_flags", label: "Flags do conjunto", capability: "INTERACTION_ANALYSIS" },
  { key: "find_comparable_interactions", label: "Interações comparáveis", capability: "INTERACTION_ANALYSIS" },
  { key: "analyze_interactions", label: "Analisar transcrições", capability: "INTERACTION_ANALYSIS" },
  { key: "analyze_peer_patterns", label: "Padrões nas comparáveis", capability: "INTERACTION_ANALYSIS" },
  { key: "inspect_work_context", label: "Jornada operacional", capability: "WORK_CONTEXT" },
  { key: "query_knowledge", label: "Consultar Base de Conhecimento", capability: "KNOWLEDGE" },
  { key: "recommend_support_materials", label: "Recomendar materiais de apoio", capability: "SUPPORT_MATERIALS" },
]

export function toolsForCapabilities(capabilities: readonly InvestigationCapability[]): typeof INVESTIGATION_TOOLS {
  const set = new Set(capabilities)
  return INVESTIGATION_TOOLS.filter((tool) => set.has(tool.capability))
}

/** effective = Agent ∩ Workflow (o Workflow nunca concede). Ausente = as do Agent. */
export function effectiveCapabilities(agentCapabilities: readonly InvestigationCapability[], allowed?: readonly InvestigationCapability[] | null): InvestigationCapability[] {
  if (allowed === undefined || allowed === null) return [...agentCapabilities]
  const permitted = new Set(allowed)
  return agentCapabilities.filter((capability) => permitted.has(capability))
}

/** Trace seguro de uma Tool usada (backend: investigation/domain/tool-trace.ts). */
export const toolInvocationTraceSchema = z.object({
  sequence: z.number(),
  tool: z.string(),
  label: z.string(),
  capability: z.string(),
  argumentsSummary: z.record(z.string(), z.unknown()).catch({}),
  resultSummary: z.string(),
  quality: z.object({ status: z.string(), sampleCount: z.number().nullable(), coverage: z.number().nullable(), freshness: z.string().nullable(), note: z.string().optional() }).nullable().catch(null),
  provenance: z.object({ period: z.object({ start: z.string(), end: z.string(), label: z.string().optional() }).optional(), population: z.string(), filters: z.array(z.string()), dataSource: z.string(), method: z.string().optional() }).nullable().catch(null),
  status: z.enum(["COMPLETED", "FAILED", "REJECTED", "CACHED", "BUDGET_EXCEEDED"]),
  error: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string(),
  // V1.1: rodada (0 = preflight), concorrência da onda e referência no Evidence Ledger — ausentes em traces antigos.
  round: z.number().optional(),
  concurrency: z.number().optional(),
  ledgerRef: z.string().optional(),
  // V1.2: como o MODELO pediu (handles I1/K1/M1) — `argumentsSummary` guarda os ids reais (auditoria).
  modelArguments: z.record(z.string(), z.unknown()).optional(),
})
export type ToolInvocationTrace = z.infer<typeof toolInvocationTraceSchema>

export const claimScopeSchema = z.enum(["INTERACTION_SPECIFIC", "PERIOD_PATTERN", "EMPLOYEE_PATTERN", "POPULATION_PATTERN"])
export type ClaimScope = z.infer<typeof claimScopeSchema>
export const CLAIM_SCOPE_LABELS: Record<ClaimScope, string> = {
  INTERACTION_SPECIFIC: "Nesta(s) interação(ões)",
  PERIOD_PATTERN: "Padrão no período",
  EMPLOYEE_PATTERN: "Padrão do colaborador",
  POPULATION_PATTERN: "Padrão dos pares",
}
export const STOP_REASON_LABELS: Record<string, string> = {
  ANSWER_SUFFICIENT: "evidência suficiente para o objetivo",
  INSUFFICIENT_DATA: "dados insuficientes",
  NO_MORE_SUPPORTED_PATHS: "sem ferramenta autorizada para a lacuna",
  MAX_PLANNING_ROUNDS: "limite de rodadas",
  INVESTIGATION_TOOL_BUDGET: "orçamento de ferramentas esgotado",
  TOKEN_WARNING_STOP: "limiar de tokens",
  SAFETY_STOP: "parada de segurança",
}
export const representativenessSchema = z.enum(["INSUFFICIENT", "ANECDOTAL", "REPRESENTATIVE"])
export const REPRESENTATIVENESS_LABELS: Record<z.infer<typeof representativenessSchema>, string> = {
  INSUFFICIENT: "Insuficiente",
  ANECDOTAL: "Anedótica",
  REPRESENTATIVE: "Representativa",
}

/** Resumo da investigação (espelho de InvestigationSummary — investigation/domain/tool-trace.ts). Tudo além dos 5 campos originais é V1.1 e opcional. */
export const investigationSummarySchema = z.object({
  toolCalls: z.number(),
  cachedCalls: z.number(),
  rejectedCalls: z.number(),
  budget: z.number(),
  outcome: z.enum(["ANSWERED", "BUDGET_EXHAUSTED", "NO_TOOLS", "TIMEOUT"]),
  preflightCalls: z.number().optional(),
  investigationToolCalls: z.number().optional(),
  interactionsInPeriod: z.number().nullable().optional(),
  handles: z.array(z.object({ handle: z.string(), kind: z.enum(["I", "K", "M"]), realId: z.string() })).optional(),
  planningRounds: z.number().optional(),
  maxPlanningRounds: z.number().optional(),
  targetToolCalls: z.number().optional(),
  parallelWaves: z.number().optional(),
  requests: z.number().optional(),
  tokens: z.object({ input: z.number().nullable(), cached: z.number().nullable(), output: z.number().nullable(), reasoning: z.number().nullable(), total: z.number().nullable() }).optional(),
  tokenBudget: z.object({ status: z.enum(["OK", "WARNING", "NOT_INFORMED"]), thresholds: z.object({ total: z.number().nullable(), input: z.number().nullable(), output: z.number().nullable() }), exceeded: z.array(z.enum(["total", "input", "output"])) }).optional(),
  synthesis: z
    .object({
      supportedHypotheses: z.array(z.string()),
      unsupportedHypotheses: z.array(z.string()),
      limitations: z.array(z.string()),
      behavioralClaims: z.array(z.object({ text: z.string(), evidenceRefs: z.array(z.string()), scope: claimScopeSchema.optional() })),
      recommendationSupport: z.array(z.object({ text: z.string(), basis: z.enum(["OBSERVED_EVIDENCE", "KNOWLEDGE_GUIDANCE", "GENERAL_DEVELOPMENT_SUGGESTION"]), evidenceRefs: z.array(z.string()) })),
      evidenceRepresentativeness: z
        .array(
          z.object({
            ref: z.string(),
            tool: z.string(),
            analyzed: z.number(),
            universe: z.number().nullable(),
            level: representativenessSchema,
            // V1.3 — dois universos (registrado × operacional); ausentes em runs anteriores.
            analyzedCount: z.number().optional(),
            recordedUniverseCount: z.number().nullable().optional(),
            recordedCoverage: z.number().nullable().optional(),
            operationalUniverseCount: z.number().nullable().optional(),
            operationalCoverage: z.number().nullable().optional(),
            universeRelationship: z.enum(["EXACT", "PARTIAL", "UNKNOWN"]).optional(),
            classification: representativenessSchema.optional(),
            reason: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  evidenceGating: z
    .object({
      rejectedClaims: z.array(z.object({ kind: z.enum(["BEHAVIORAL_CLAIM", "RECOMMENDATION", "CRITICAL_FACT", "TEMPORAL_CLAIM", "PROCEDURAL_CLAIM", "CLAIM_BINDING"]), text: z.string(), reason: z.string() })),
      corrected: z.boolean(),
      // V1.3 fail-closed — ausentes em runs anteriores.
      envelopePresent: z.boolean().optional(),
      parseStatus: z.enum(["PARSED", "MISSING", "INVALID"]).optional(),
      correctionAttempted: z.boolean().optional(),
      correctionSucceeded: z.boolean().optional(),
      fallbackUsed: z.boolean().optional(),
      fallbackReason: z.enum(["ENVELOPE_MISSING", "CLAIMS_REJECTED", "UNISOLABLE_TEXT", "NO_SAFE_CLAIM"]).nullable().optional(),
      // V1.4.3 — destino por afirmação (aceita / corrigida / descartada) e contadores do salvamento parcial.
      claimOutcomes: z.array(z.object({ text: z.string(), status: z.enum(["ACCEPTED", "ACCEPTED_CORRECTED", "DROPPED"]), reason: z.string().nullable().optional(), category: z.string().nullable().optional() })).optional(),
      claimsProposed: z.number().optional(),
      claimsAcceptedFirstPass: z.number().optional(),
      claimsCorrectionRequired: z.number().optional(),
      claimsCorrected: z.number().optional(),
      claimsDropped: z.number().optional(),
      claimsPreservedAfterSiblingFailure: z.number().optional(),
      recommendationsDropped: z.number().optional(),
      salvage: z.enum(["NONE", "PARTIAL", "FULL_FALLBACK"]).optional(),
      // V1.4.4 — projeção determinística: candidatos disponíveis × selecionados × entregues e erros de texto.
      claimCandidatesAvailable: z.number().optional(),
      claimCandidatesSelected: z.number().optional(),
      claimCandidatesDelivered: z.number().optional(),
      textPolarityMismatch: z.number().optional(),
      textScopeMismatch: z.number().optional(),
      candidateSwapRejected: z.number().optional(),
      duplicateCandidateSelection: z.number().optional(),
      // V1.4.2 — categorias das rejeições que motivaram a correção e das que persistiram (BINDING_FORMAT / SEMANTIC / TEMPORAL / ENVELOPE).
      correctionCategories: z.array(z.string()).optional(),
      persistentCategories: z.array(z.string()).optional(),
    })
    .optional(),
  /** Universo operacional do indicador em foco (V1.3) — null = não determinado. */
  operationalUniverse: z.object({ count: z.number(), source: z.string(), label: z.string() }).nullable().optional(),
  // V1.3.1 — objetivo derivado e motivo da parada (ausentes em runs anteriores).
  objective: z.object({ kind: z.string(), question: z.string(), requiredScope: claimScopeSchema.nullable(), causal: z.boolean() }).optional(),
  stopReason: z.enum(["ANSWER_SUFFICIENT", "INSUFFICIENT_DATA", "NO_MORE_SUPPORTED_PATHS", "MAX_PLANNING_ROUNDS", "INVESTIGATION_TOOL_BUDGET", "TOKEN_WARNING_STOP", "SAFETY_STOP"]).optional(),
})
export type InvestigationSummary = z.infer<typeof investigationSummarySchema>

export type RecommendationBasis = "OBSERVED_EVIDENCE" | "KNOWLEDGE_GUIDANCE" | "GENERAL_DEVELOPMENT_SUGGESTION"
export const RECOMMENDATION_BASIS_LABELS: Record<RecommendationBasis, string> = {
  OBSERVED_EVIDENCE: "Evidência observada",
  KNOWLEDGE_GUIDANCE: "Orientação da base de conhecimento",
  GENERAL_DEVELOPMENT_SUGGESTION: "Sugestão geral de desenvolvimento",
}

/** Lê o resumo da investigação de um nodeOutput (topo = Agent direto). */
export function readInvestigationSummary(value: unknown): InvestigationSummary | null {
  if (!value || typeof value !== "object") return null
  const parsed = investigationSummarySchema.safeParse((value as { investigation?: unknown }).investigation)
  return parsed.success ? parsed.data : null
}

export const TOOL_QUALITY_STATUS_LABELS: Record<string, string> = {
  SUFFICIENT: "Dado suficiente",
  INSUFFICIENT_SAMPLE: "Amostra insuficiente",
  INSUFFICIENT_COVERAGE: "Cobertura insuficiente",
  STALE: "Dado desatualizado",
  SOURCE_DELAY: "Fonte atrasada",
  AVAILABILITY_UNKNOWN: "Disponibilidade desconhecida",
  NO_DATA: "Sem dados",
  NOT_SUPPORTED: "Não suportado",
}

/** Lê o trace de qualquer nodeOutput (topo = Agent direto; results[] = especialistas do Orquestrador). */
export function readToolTrace(value: unknown): ToolInvocationTrace[] {
  if (!value || typeof value !== "object") return []
  const record = value as { toolTrace?: unknown; results?: { toolTrace?: unknown }[] }
  const parse = (list: unknown) => (Array.isArray(list) ? list.flatMap((item) => { const parsed = toolInvocationTraceSchema.safeParse(item); return parsed.success ? [parsed.data] : [] }) : [])
  const own = parse(record.toolTrace)
  if (own.length > 0) return own
  if (Array.isArray(record.results)) return record.results.flatMap((result) => parse(result?.toolTrace))
  return []
}
