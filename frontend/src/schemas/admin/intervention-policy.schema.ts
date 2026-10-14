import { z } from "zod"

import { teamSchema } from "@/schemas/admin/org-structure.schema"
import { evaluationOutcomeSchema, formFieldSchema, intelligenceReportSchema } from "@/schemas/interventions/intervention.schema"

/**
 * Contratos da administração de políticas de acompanhamento (`/api/v1/admin/intervention-policies`) — espelho dos contratos
 * versionados do backend (interventions/domain/intervention-type.ts e policy-definition.ts). O backend valida de novo tudo.
 */
export const INTERVENTION_TYPE_SCHEMA_VERSION = "INTERVENTION_TYPE_V1" as const
export const INTERVENTION_POLICY_SCHEMA_VERSION = "INTERVENTION_POLICY_V1" as const

export const INTERVENTION_CAPABILITIES = ["TASKS", "CHECKPOINTS", "TRAINING", "ACTION_PLAN", "GUIDANCE", "OBSERVATION", "DATA_REVIEW", "LEADERSHIP_REVIEW", "RECOGNITION", "CONTINUITY_REVIEW"] as const
export type InterventionCapability = (typeof INTERVENTION_CAPABILITIES)[number]
export const EVIDENCE_KINDS = ["EVALUATION", "FEEDBACK", "DIAGNOSIS", "INTERACTION", "INDICATOR_RESULT", "CASE_EVIDENCE"] as const
export const ESCALATION_ROLES = ["COORDINATOR", "SUPERVISOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const
export type EscalationRole = (typeof ESCALATION_ROLES)[number]
export const ESCALATION_ROLE_LABELS: Record<EscalationRole, string> = { COORDINATOR: "Coordenador", SUPERVISOR: "Supervisor", MANAGER: "Gerente", SENIOR_MANAGER: "Gerente sênior", DIRECTOR: "Diretor" }
/** Quem executa: o líder direto do colaborador (qualquer nível) ou o primeiro na cadeia com o nível escolhido. */
export const RESPONSIBLE_ROLES = ["DIRECT_LEADER", ...ESCALATION_ROLES] as const
export type ResponsibleRole = (typeof RESPONSIBLE_ROLES)[number]
export const RESPONSIBLE_ROLE_LABELS: Record<ResponsibleRole, string> = { DIRECT_LEADER: "Líder direto", ...ESCALATION_ROLE_LABELS }

export const interventionTypeDefinitionSchema = z.object({
  schemaVersion: z.literal(INTERVENTION_TYPE_SCHEMA_VERSION),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.enum(INTERVENTION_CAPABILITIES)),
  responsibleRole: z.enum(RESPONSIBLE_ROLES),
  defaultDueDays: z.number(),
  approval: z.union([z.object({ required: z.literal(false) }), z.object({ required: z.literal(true), approverRole: z.enum(ESCALATION_ROLES) })]),
  evidence: z.object({ minimumItems: z.number(), acceptedKinds: z.array(z.enum(EVIDENCE_KINDS)) }),
  form: z.array(formFieldSchema),
  completion: z.object({ requireAllTasksDone: z.boolean(), requireLearningAssessment: z.boolean(), requireOperationalReading: z.boolean(), requireOutcomeNote: z.boolean() }),
  incompatibleWith: z.array(z.string()),
  aiDraft: z.boolean(),
})
export type InterventionTypeDefinition = z.infer<typeof interventionTypeDefinitionSchema>

const versionView = <T extends z.ZodTypeAny>(definition: T) =>
  z.object({ id: z.string(), version: z.number(), status: z.enum(["DRAFT", "PUBLISHED"]), definition, updatedAt: z.string(), publishedAt: z.string().nullable(), effectiveFrom: z.string().nullable().optional() })

export const interventionTypeViewSchema = z.object({
  id: z.string(),
  key: z.string(),
  active: z.boolean(),
  published: versionView(interventionTypeDefinitionSchema).nullable(),
  draft: versionView(interventionTypeDefinitionSchema).nullable(),
  versions: z.array(versionView(interventionTypeDefinitionSchema)),
  usage: z.object({ active: z.number(), total: z.number() }),
})
export type InterventionTypeView = z.infer<typeof interventionTypeViewSchema>

export const competencyActivitySchema = z.object({ key: z.string(), title: z.string(), description: z.string(), kind: z.enum(["STUDY", "PRACTICE", "SHADOWING", "ROLE_PLAY", "ASSESSMENT", "OTHER"]), documentId: z.string().nullable(), estimatedMinutes: z.number().nullable() })
export type CompetencyActivity = z.infer<typeof competencyActivitySchema>
export const competencyViewSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  knowledgeDocumentIds: z.array(z.string()),
  practiceKeys: z.array(z.string()),
  criterionKeys: z.array(z.string()),
  indicatorCodes: z.array(z.string()),
  activities: z.array(competencyActivitySchema),
  active: z.boolean(),
  documents: z.array(z.object({ id: z.string(), title: z.string(), published: z.boolean() })),
  updatedAt: z.string(),
})
export type CompetencyView = z.infer<typeof competencyViewSchema>
export type CompetencyInput = Omit<CompetencyView, "id" | "active" | "documents" | "updatedAt">

// ---- Política -------------------------------------------------------------------------------------------------------
export const NUMERIC_COMPARATORS = ["EQUALS", "NOT_EQUALS", "GT", "GTE", "LT", "LTE"] as const
export type NumericComparator = (typeof NUMERIC_COMPARATORS)[number]
export const NUMERIC_COMPARATOR_LABELS: Record<NumericComparator, string> = { EQUALS: "igual a", NOT_EQUALS: "diferente de", GT: "maior que", GTE: "pelo menos", LT: "menor que", LTE: "no máximo" }

const historicalPeriodSchema = z.union([
  z.object({ kind: z.literal("ROLLING_DAYS"), days: z.number() }),
  z.object({ kind: z.literal("CALENDAR"), unit: z.enum(["DAY", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER", "FOUR_MONTHS", "SEMESTER"]), phase: z.enum(["CURRENT", "PREVIOUS"]).optional() }),
  z.object({ kind: z.literal("CLOSURES"), unit: z.literal("MONTH"), count: z.number() }),
])
export type HistoricalPeriod = z.infer<typeof historicalPeriodSchema>

export const indicatorCriterionSchema = z.object({
  comparator: z.string(),
  thresholdBoolean: z.boolean().nullable().optional(),
  thresholdNumeric: z.number().nullable().optional(),
  thresholdText: z.string().optional(),
  historicalQuery: z
    .object({
      kind: z.literal("INDICATOR_THRESHOLD_COUNT"),
      indicatorCode: z.string().optional(),
      aggregation: z.enum(["COUNT", "AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"]).optional(),
      source: z.enum(["MEASUREMENT", "INDICATOR_ACHIEVEMENT", "PRV_ACHIEVEMENT", "OPERATIONAL_QUARTILE"]).optional(),
      comparator: z.string().optional(),
      indicatorThreshold: z.number().optional(),
      period: historicalPeriodSchema.optional(),
      minimumSampleSize: z.number().optional(),
      minimumCoverage: z.number().optional(),
      compareTo: z.union([z.object({ kind: z.literal("GOAL") }), z.object({ kind: z.literal("PREVIOUS_PERIOD"), changeMode: z.enum(["VALUE", "PERCENT"]).optional() })]).optional(),
    })
    .optional(),
  performanceQuery: z
    .object({
      kind: z.literal("EMPLOYEE_PERFORMANCE"),
      metric: z.enum(["INDICATOR_VALUE", "INDICATOR_ACHIEVEMENT", "INDICATOR_QUARTILE", "INDICATOR_WEIGHT", "PRV_ACHIEVEMENT", "PRV_QUARTILE"]),
      indicatorCode: z.string().optional(),
      recurrence: z.object({ periods: z.number(), matchQuartile: z.enum(["Q1", "Q2", "Q3", "Q4"]) }).optional(),
    })
    .optional(),
})
export type IndicatorCriterion = z.infer<typeof indicatorCriterionSchema>

export const policyConditionSchema = z.union([
  z.object({ kind: z.literal("INDICATOR"), label: z.string().optional(), criterion: indicatorCriterionSchema }),
  z.object({ kind: z.literal("EMPLOYMENT"), check: z.literal("CURRENTLY_ELIGIBLE"), expected: z.boolean() }),
  z.object({ kind: z.literal("EMPLOYMENT"), check: z.literal("ELIGIBLE_DAYS"), period: historicalPeriodSchema, comparator: z.enum(NUMERIC_COMPARATORS), threshold: z.number() }),
  z.object({ kind: z.literal("PRIOR_INTERVENTIONS"), typeKeys: z.array(z.string()), statuses: z.array(z.enum(["ACTIVE", "COMPLETED", "CANCELLED"])), operationalResults: z.array(z.enum(["IMPROVED", "UNCHANGED", "WORSENED", "NOT_MEASURED"])), sameSubject: z.boolean(), withinDays: z.number(), comparator: z.enum(NUMERIC_COMPARATORS), threshold: z.number() }),
  z.object({ kind: z.literal("TIME_SINCE_INTERVENTION"), typeKeys: z.array(z.string()), event: z.enum(["OPENED", "COMPLETED"]), sameSubject: z.boolean(), comparator: z.enum(NUMERIC_COMPARATORS), days: z.number(), whenNone: z.enum(["MET", "NOT_MET"]) }),
  z.object({ kind: z.literal("SUPPORTED_DIAGNOSIS"), indicatorCode: z.string().nullable(), competencyKeys: z.array(z.string()), withinDays: z.number(), expectation: z.enum(["EXISTS", "NOT_EXISTS"]) }),
  z.object({ kind: z.literal("PUBLISHED_FEEDBACK"), feedbackKind: z.enum(["INDICATOR", "MONITORING"]).nullable(), indicatorCode: z.string().nullable(), withinDays: z.number(), comparator: z.enum(NUMERIC_COMPARATORS), threshold: z.number() }),
  z.object({
    kind: z.literal("INTERACTION_FLAG"),
    channel: z.string(),
    flagName: z.string(),
    match: z.union([z.object({ type: z.literal("BOOLEAN"), value: z.boolean() }), z.object({ type: z.literal("NUMERIC"), comparator: z.enum(NUMERIC_COMPARATORS), threshold: z.number() })]),
    withinDays: z.number(),
    measure: z.enum(["COUNT", "PERCENT"]),
    comparator: z.enum(NUMERIC_COMPARATORS),
    threshold: z.number(),
    minimumInteractions: z.number(),
  }),
])
export type PolicyCondition = z.infer<typeof policyConditionSchema>
export type PolicyConditionGroup = { operator: "ALL" | "ANY"; items: (PolicyCondition | PolicyConditionGroup)[] }
export const policyConditionGroupSchema: z.ZodType<PolicyConditionGroup> = z.lazy(() => z.object({ operator: z.enum(["ALL", "ANY"]), items: z.array(z.union([policyConditionSchema, policyConditionGroupSchema])) }))
export const isConditionGroup = (item: PolicyCondition | PolicyConditionGroup): item is PolicyConditionGroup => "operator" in item && "items" in item

export const policyActionSchema = z.object({ typeKey: z.string(), effect: z.enum(["RECOMMEND", "OPEN"]), dueInDays: z.number().nullable(), onActive: z.enum(["KEEP", "UPDATE"]), cooldownDays: z.number() })
export type PolicyAction = z.infer<typeof policyActionSchema>
export const policyRuleSchema = z.object({ key: z.string(), name: z.string(), priority: z.number(), justification: z.string(), when: policyConditionGroupSchema, actions: z.array(policyActionSchema), inconclusiveActions: z.array(policyActionSchema) })
export type PolicyRule = z.infer<typeof policyRuleSchema>
export const policyDefinitionSchema = z.object({ schemaVersion: z.literal(INTERVENTION_POLICY_SCHEMA_VERSION), description: z.string(), indicatorCode: z.string().nullable(), matchStrategy: z.enum(["FIRST_MATCH", "ALL_MATCHES"]), rules: z.array(policyRuleSchema), report: z.object({ aiNarrative: z.boolean() }) })
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>

export const policyViewSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  scopeType: z.enum(["ORGANIZATION", "GROUP", "SUBGROUP"]),
  teamId: z.string().nullable(),
  subteamId: z.string().nullable(),
  active: z.boolean(),
  scopeLabel: z.string(),
  draft: versionView(policyDefinitionSchema).nullable(),
  inForce: versionView(policyDefinitionSchema).nullable(),
  scheduled: z.array(versionView(policyDefinitionSchema)),
  versions: z.array(versionView(policyDefinitionSchema)),
  evaluations: z.object({ last30Days: z.number() }),
  can: z.object({ edit: z.boolean(), publish: z.boolean(), simulate: z.boolean(), audit: z.boolean().optional() }),
})
export type PolicyView = z.infer<typeof policyViewSchema>

export const configIssueSchema = z.object({ path: z.string(), code: z.string(), message: z.string() })
export type ConfigIssue = z.infer<typeof configIssueSchema>
export const validationResultSchema = z.object({ valid: z.boolean(), issues: z.array(configIssueSchema) })

export const capabilityCatalogSchema = z.object({
  capabilities: z.array(z.object({ key: z.enum(INTERVENTION_CAPABILITIES), label: z.string(), description: z.string(), allowedOnInconclusive: z.boolean(), assertsSkillGap: z.boolean(), implies: z.array(z.string()) })),
  evidenceKinds: z.array(z.object({ key: z.string(), label: z.string() })),
})
export type CapabilityCatalog = z.infer<typeof capabilityCatalogSchema>

/** Leituras do editor servidas pela própria área (`/editor-catalog`): grupos do escopo de quem edita, indicadores e documentos. */
export const editorCatalogSchema = z.object({
  teams: z.array(teamSchema),
  unrestricted: z.boolean(),
  indicators: z.array(z.object({ code: z.string(), name: z.string(), unit: z.string(), active: z.boolean(), dailySupported: z.boolean(), officialClosureSupported: z.boolean() })),
  documents: z.array(z.object({ id: z.string(), title: z.string(), published: z.boolean() })),
  flags: z.array(z.object({ channel: z.string(), flagName: z.string(), valueType: z.enum(["BOOLEAN", "NUMERIC"]), description: z.string().nullable(), active: z.boolean() })).default([]),
})
export type EditorCatalog = z.infer<typeof editorCatalogSchema>

/** Prática (KP-…) ou critério (KC-…) da base, pelo nome — para ligar a competência ao diagnóstico. */
export const patternOptionSchema = z.object({ key: z.string(), kind: z.enum(["PRACTICE", "CRITERION"]), title: z.string(), detail: z.string().nullable() })
export type PatternOption = z.infer<typeof patternOptionSchema>

/** Resumo publicado para o nó "Avaliar política de acompanhamento" (lido também com `workflows.manage`). */
export const publishedPolicySummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  active: z.boolean(),
  scopeLabel: z.string(),
  inForceVersion: z.number().nullable(),
  scheduledVersions: z.array(z.object({ version: z.number(), effectiveFrom: z.string().nullable().optional() })),
  description: z.string(),
  indicatorCode: z.string().nullable(),
  matchStrategy: z.enum(["FIRST_MATCH", "ALL_MATCHES"]).nullable(),
  rules: z.array(z.object({ key: z.string(), name: z.string(), priority: z.number(), actions: z.array(z.object({ typeKey: z.string(), effect: z.enum(["RECOMMEND", "OPEN"]) })), inconclusiveActions: z.array(z.object({ typeKey: z.string(), effect: z.enum(["RECOMMEND", "OPEN"]) })) })),
  types: z.array(z.object({ key: z.string(), name: z.string(), responsibleRole: z.enum(RESPONSIBLE_ROLES).nullable(), approval: z.union([z.object({ required: z.literal(false) }), z.object({ required: z.literal(true), approverRole: z.enum(ESCALATION_ROLES) })]).nullable(), sensitive: z.boolean(), active: z.boolean() })),
})
export type PublishedPolicySummary = z.infer<typeof publishedPolicySummarySchema>

const conditionTraceSchema = z.object({ type: z.literal("CONDITION"), path: z.string(), kind: z.string(), outcome: z.object({ status: z.enum(["MET", "NOT_MET", "INCONCLUSIVE"]), summary: z.string(), facts: z.record(z.string(), z.unknown()), reasonCode: z.string().optional() }) })
export type ConditionTrace = z.infer<typeof conditionTraceSchema>
export type GroupTrace = { type: "GROUP"; path: string; operator: "ALL" | "ANY"; status: "MET" | "NOT_MET" | "INCONCLUSIVE"; items: (ConditionTrace | GroupTrace)[] }
const groupTraceSchema: z.ZodType<GroupTrace> = z.lazy(() => z.object({ type: z.literal("GROUP"), path: z.string(), operator: z.enum(["ALL", "ANY"]), status: z.enum(["MET", "NOT_MET", "INCONCLUSIVE"]), items: z.array(z.union([conditionTraceSchema, groupTraceSchema])) }))

export const simulationResultSchema = z.object({
  simulated: z.literal(true),
  effects: z.literal("NONE"),
  draftIssues: z.array(configIssueSchema),
  evaluation: z.object({
    policy: z.object({ id: z.string(), key: z.string(), name: z.string(), versionId: z.string().nullable(), version: z.number().nullable(), effectiveFrom: z.string().nullable() }),
    person: z.object({ id: z.string(), name: z.string(), teamName: z.string().nullable() }),
    asOf: z.string(),
    subjectKey: z.string(),
    indicatorCode: z.string().nullable(),
    notApplicableReason: z.string().nullable(),
    outcome: evaluationOutcomeSchema,
    selection: z.object({ status: z.string(), blockedBy: z.string().nullable(), inconclusiveRules: z.array(z.string()) }),
    rules: z.array(z.object({ key: z.string(), name: z.string(), priority: z.number(), status: z.enum(["MET", "NOT_MET", "INCONCLUSIVE"]), trace: groupTraceSchema })),
    decisions: z.array(z.object({ typeKey: z.string(), typeName: z.string(), ruleKey: z.string(), mode: z.enum(["MATCHED", "INCONCLUSIVE"]), status: z.string(), effectiveEffect: z.enum(["RECOMMEND", "OPEN"]), note: z.string().nullable(), alsoRequestedBy: z.array(z.string()), assignment: z.object({ responsible: z.object({ personId: z.string(), name: z.string() }).nullable(), approver: z.object({ personId: z.string(), name: z.string() }).nullable(), dueAt: z.string(), problem: z.string().nullable() }).nullable() })),
    justification: z.string(),
  }),
  report: intelligenceReportSchema.nullable(),
})
export type SimulationResult = z.infer<typeof simulationResultSchema>

export const auditEntrySchema = z.object({ id: z.string(), action: z.string(), entityType: z.string(), entityId: z.string(), payload: z.unknown(), createdAt: z.string(), actorName: z.string().nullable() })
export type AuditEntry = z.infer<typeof auditEntrySchema>
export const evaluationListItemSchema = z.object({ id: z.string(), person: z.object({ id: z.string(), name: z.string() }).nullable(), origin: z.string(), outcome: evaluationOutcomeSchema, evaluatedAt: z.string(), policyVersion: z.number().nullable(), supersedesEvaluationId: z.string().nullable() })
export type EvaluationListItem = z.infer<typeof evaluationListItemSchema>

export const CAPABILITY_LABELS: Record<InterventionCapability, string> = {
  TASKS: "Tarefas",
  CHECKPOINTS: "Checkpoints",
  TRAINING: "Treinamento",
  ACTION_PLAN: "Plano de ação",
  GUIDANCE: "Orientação",
  OBSERVATION: "Observação",
  DATA_REVIEW: "Revisão de dados",
  LEADERSHIP_REVIEW: "Revisão pela liderança",
  RECOGNITION: "Reconhecimento",
  CONTINUITY_REVIEW: "Avaliação de continuidade",
}
export const OUTCOME_LABELS: Record<z.infer<typeof evaluationOutcomeSchema>, string> = {
  RECOMMENDED: "Intervenção recomendada",
  EXISTING: "Intervenção já existente",
  CREATED: "Intervenção criada",
  PENDING_APPROVAL: "Aprovação pendente",
  NO_MATCH: "Nenhuma regra atendida",
  INCONCLUSIVE: "Avaliação inconclusiva",
  CONFLICT: "Conflito entre intervenções",
  SUPPRESSED: "Suprimida pela carência",
  NOT_APPLICABLE: "Política não aplicável",
}
export const DECISION_LABELS: Record<string, string> = { CREATED: "Abriria", PENDING_APPROVAL: "Abriria aguardando aprovação", RECOMMENDED: "Recomendaria", EXISTING: "Já existe ativa", SUPPRESSED: "Não reabre (carência)", CONFLICT: "Conflito — nada aplicado" }

export function emptyTypeDefinition(name = "Nova intervenção"): InterventionTypeDefinition {
  return { schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION, name, description: "", capabilities: ["TASKS"], responsibleRole: "SUPERVISOR", defaultDueDays: 15, approval: { required: false }, evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "FEEDBACK", "DIAGNOSIS", "INDICATOR_RESULT"] }, form: [], completion: { requireAllTasksDone: true, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true }, incompatibleWith: [], aiDraft: false }
}
