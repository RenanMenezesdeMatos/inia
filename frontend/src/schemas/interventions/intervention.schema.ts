import { z } from "zod"

/**
 * Contratos da experiência do líder com intervenções (`/api/v1/interventions`). Os tipos vêm daqui (z.infer); o backend é a
 * fonte (interventions/application/intervention-service.ts). Status reais × atraso derivado: `overdue` nunca é um status.
 */
export const interventionStatusSchema = z.enum(["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
export type InterventionStatus = z.infer<typeof interventionStatusSchema>
export const decisionStatusSchema = z.enum(["CREATED", "PENDING_APPROVAL", "RECOMMENDED", "EXISTING", "SUPPRESSED", "CONFLICT"])
export type DecisionStatus = z.infer<typeof decisionStatusSchema>
export const evaluationOutcomeSchema = z.enum(["RECOMMENDED", "EXISTING", "CREATED", "PENDING_APPROVAL", "NO_MATCH", "INCONCLUSIVE", "CONFLICT", "SUPPRESSED", "NOT_APPLICABLE"])
export type EvaluationOutcome = z.infer<typeof evaluationOutcomeSchema>
export const conditionStatusSchema = z.enum(["MET", "NOT_MET", "INCONCLUSIVE"])
export type ConditionStatus = z.infer<typeof conditionStatusSchema>

const person = z.object({ id: z.string(), name: z.string() })
const reportPerson = z.object({ personId: z.string(), name: z.string() })

export const interventionSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseTitle: z.string(),
  person: z.object({ id: z.string(), name: z.string(), teamName: z.string().nullable() }),
  type: z.object({ key: z.string(), name: z.string(), capabilities: z.array(z.object({ key: z.string(), label: z.string() })) }),
  indicatorCode: z.string().nullable(),
  status: interventionStatusSchema,
  statusLabel: z.string(),
  sensitive: z.boolean(),
  overdue: z.boolean(),
  dueAt: z.string(),
  responsible: person,
  approver: person.nullable(),
  origin: z.enum(["MANUAL", "WORKFLOW"]),
  policy: z.object({ id: z.string(), name: z.string(), version: z.number().nullable() }).nullable(),
  reason: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  signalCount: z.number(),
})
export type InterventionSummary = z.infer<typeof interventionSummarySchema>

export const intelligenceReportSchema = z.object({
  contract: z.string(),
  asOf: z.string(),
  subject: z.object({ personId: z.string(), personName: z.string(), teamName: z.string().nullable(), indicatorCode: z.string().nullable(), indicatorName: z.string().nullable() }),
  situation: z.object({ summary: z.string(), period: z.string().nullable() }),
  facts: z.array(z.object({ handle: z.string(), kind: z.string(), statement: z.string(), status: conditionStatusSchema, ruleKey: z.string() })),
  sources: z.array(z.object({ handle: z.string(), kind: z.string(), ref: z.string(), label: z.string(), occurredAt: z.string().nullable() })),
  priorInterventions: z.array(z.object({ id: z.string(), typeKey: z.string(), typeName: z.string(), status: z.string(), openedAt: z.string(), closedAt: z.string().nullable(), operationalResult: z.string().nullable(), learningResult: z.string().nullable() })),
  diagnosis: z.array(z.object({ handle: z.string(), ref: z.string(), indicatorCode: z.string(), period: z.string(), patterns: z.array(z.object({ key: z.string(), title: z.string() })), competencies: z.array(z.string()) })),
  uncertainties: z.array(z.object({ handle: z.string(), statement: z.string(), reasonCode: z.string().nullable() })),
  missingData: z.array(z.string()),
  policy: z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    version: z.number(),
    effectiveFrom: z.string(),
    matchStrategy: z.enum(["FIRST_MATCH", "ALL_MATCHES"]),
    outcome: evaluationOutcomeSchema,
    outcomeLabel: z.string(),
    blockedBy: z.string().nullable(),
    rules: z.array(z.object({ key: z.string(), name: z.string(), priority: z.number(), status: conditionStatusSchema, statusLabel: z.string(), conditions: z.array(z.object({ statement: z.string(), status: conditionStatusSchema })) })),
  }),
  actions: z.array(
    z.object({
      handle: z.string(),
      typeKey: z.string(),
      typeName: z.string(),
      capabilities: z.array(z.object({ key: z.string(), label: z.string() })),
      status: decisionStatusSchema,
      statusLabel: z.string(),
      ruleKey: z.string(),
      ruleName: z.string(),
      justification: z.string(),
      supportingFacts: z.array(z.string()),
      responsible: reportPerson.nullable(),
      approver: reportPerson.nullable(),
      dueAt: z.string().nullable(),
      nextSteps: z.array(z.string()),
      resultCriteria: z.array(z.string()),
      interventionId: z.string().nullable(),
    }),
  ),
})
export type IntelligenceReport = z.infer<typeof intelligenceReportSchema>

const refs = z.array(z.string())
export const reportNarrativeSchema = z.object({
  situation: z.object({ text: z.string(), refs }),
  analysis: z.array(z.object({ text: z.string(), refs })),
  hypotheses: z.array(z.object({ text: z.string(), refs, toConfirm: z.string() })),
  leaderGuidance: z.array(z.object({ action: z.string(), text: z.string() })),
})
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>

export const reportViewSchema = z.object({
  id: z.string(),
  evaluationId: z.string(),
  createdAt: z.string(),
  structured: intelligenceReportSchema,
  narrative: z.object({ status: z.enum(["READY", "FAILED", "NONE"]), attempts: z.number(), current: reportNarrativeSchema.nullable(), lastError: z.string().nullable(), generatedAt: z.string().nullable() }),
})
export type ReportView = z.infer<typeof reportViewSchema>

export const interventionItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["TASK", "CHECKPOINT", "ACTIVITY"]),
  title: z.string(),
  description: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  dueAt: z.string().nullable(),
  status: z.enum(["PENDING", "DONE", "SKIPPED"]),
  result: z.record(z.string(), z.unknown()).nullable(),
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  position: z.number(),
  overdue: z.boolean(),
})
export type InterventionItem = z.infer<typeof interventionItemSchema>

export const interventionPlanSchema = z.object({
  objective: z.string().optional(),
  initialSituation: z.string().optional(),
  measurableObjective: z.object({ indicatorCode: z.string().nullable(), target: z.string(), by: z.string() }).optional(),
  support: z.string().optional(),
  closureCriterion: z.string().optional(),
  competencyKeys: z.array(z.string()).optional(),
  contents: z.array(z.object({ documentId: z.string(), title: z.string() })).optional(),
  learningAssessment: z.object({ method: z.string(), passCriterion: z.string() }).optional(),
  guidance: z.object({ summary: z.string(), documentIds: z.array(z.string()) }).optional(),
  observation: z.object({ focus: z.string(), until: z.string() }).optional(),
  review: z.object({ finding: z.string() }).optional(),
  continuityRequest: z.object({ justification: z.string() }).optional(),
  recognition: z.object({ message: z.string() }).optional(),
})
export type InterventionPlan = z.infer<typeof interventionPlanSchema>

export const formFieldSchema = z.object({ key: z.string(), label: z.string(), kind: z.enum(["TEXT", "LONG_TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"]), required: z.boolean(), help: z.string().optional(), options: z.array(z.string()).optional() })
export type FormField = z.infer<typeof formFieldSchema>

export const aiDraftSchema = z
  .object({
    contract: z.string(),
    status: z.enum(["PROPOSED", "APPLIED", "FAILED", "INVESTIGATION_NEEDED"]),
    kind: z.enum(["TRAINING", "ACTION_PLAN"]),
    generatedAt: z.string(),
    facts: z.array(z.string()).optional(),
    sources: z.array(z.object({ handle: z.string(), kind: z.string(), label: z.string(), ref: z.string().nullable() })).optional(),
    proposal: z.unknown().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .nullable()
export type AiDraft = z.infer<typeof aiDraftSchema>

export const interventionActionSchema = z.enum(["ACCEPT", "APPROVE", "RETURN", "DECIDE_CONTINUITY", "COMPLETE", "CANCEL", "FORWARD", "EDIT", "UPDATE_ITEM", "ADD_EVIDENCE", "DRAFT_WITH_AI"])
export type InterventionAction = z.infer<typeof interventionActionSchema>

export const interventionDetailSchema = interventionSummarySchema.extend({
  revision: z.number(),
  initialSituation: z.record(z.string(), z.unknown()),
  evidence: z.array(z.object({ kind: z.string(), kindLabel: z.string(), ref: z.string(), label: z.string(), occurredAt: z.string().nullable(), addedBy: z.string().nullable() })),
  plan: interventionPlanSchema,
  formValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  form: z.array(formFieldSchema),
  completion: z.object({ requireAllTasksDone: z.boolean(), requireLearningAssessment: z.boolean(), requireOperationalReading: z.boolean(), requireOutcomeNote: z.boolean() }),
  approvalRequired: z.boolean(),
  aiDraftEnabled: z.boolean(),
  aiDraft: aiDraftSchema,
  outcome: z.record(z.string(), z.unknown()).nullable(),
  items: z.array(interventionItemSchema),
  counts: z.object({ tasksTotal: z.number(), tasksDone: z.number(), tasksSkipped: z.number(), checkpointsTotal: z.number(), checkpointsDone: z.number(), activitiesTotal: z.number(), activitiesDone: z.number() }),
  events: z.array(z.object({ id: z.string(), eventType: z.string(), actorKind: z.string(), actorName: z.string().nullable(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), payload: z.record(z.string(), z.unknown()), createdAt: z.string() })),
  report: reportViewSchema.nullable(),
  laterReports: z.array(z.object({ id: z.string(), evaluationId: z.string(), createdAt: z.string(), outcome: z.string() })),
  availableActions: z.array(z.string()),
  /** O que falta para aceitar (só com a intervenção proposta) — a mesma regra que o aceite aplica no backend. */
  readiness: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).default([]),
  continuityDecisions: z.array(z.object({ value: z.enum(["CONTINUITY_CONFIRMED", "DEVELOPMENT_CONTINUES", "REFERRED_TO_FORMAL_PROCESS", "MORE_EVIDENCE_NEEDED"]), label: z.string() })).nullable(),
  audit: z.object({ origin: z.enum(["MANUAL", "WORKFLOW"]), workflowId: z.string().nullable(), workflowName: z.string().nullable(), enrollmentId: z.string().nullable(), nodeId: z.string().nullable(), evaluationId: z.string().nullable(), ruleKey: z.string().nullable(), typeVersionId: z.string(), policyVersionId: z.string().nullable() }),
})
export type InterventionDetail = z.infer<typeof interventionDetailSchema>
export type ContinuityDecision = NonNullable<InterventionDetail["continuityDecisions"]>[number]["value"]

export const caseInterventionsSchema = z.object({
  interventions: z.array(interventionSummarySchema),
  reports: z.array(z.object({ id: z.string(), createdAt: z.string(), outcome: z.string(), policyName: z.string(), policyVersion: z.number().nullable() })),
})
export type CaseInterventions = z.infer<typeof caseInterventionsSchema>

export const forwardTargetSchema = z.object({ id: z.string(), name: z.string(), role: z.string() })

/** Competência para o treinamento: conteúdos aprovados (só documentos publicados) e atividades sugeridas. */
export const trainingCompetencySchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  indicatorCodes: z.array(z.string()),
  contents: z.array(z.object({ documentId: z.string(), title: z.string() })),
  activities: z.array(z.object({ title: z.string(), description: z.string(), kind: z.string(), estimatedMinutes: z.number().nullable() })),
})
export type TrainingCompetency = z.infer<typeof trainingCompetencySchema>

/** Rótulos de negócio (o líder nunca vê o código técnico). */
export const OPERATIONAL_RESULT_LABELS: Record<string, string> = { IMPROVED: "Melhorou", UNCHANGED: "Sem mudança", WORSENED: "Piorou", NOT_MEASURED: "Não medido" }
export const LEARNING_RESULT_LABELS: Record<string, string> = { ACHIEVED: "Aprendizagem atingida", PARTIAL: "Atingida em parte", NOT_ACHIEVED: "Não atingida" }
export const INTERVENTION_STATUS_LABELS: Record<string, string> = { PROPOSED: "Recomendada", AWAITING_APPROVAL: "Aguardando aprovação", IN_PROGRESS: "Em andamento", COMPLETED: "Concluída", CANCELLED: "Cancelada" }
export const CONDITION_STATUS_LABELS: Record<ConditionStatus, string> = { MET: "Atendida", NOT_MET: "Não atendida", INCONCLUSIVE: "Inconclusiva" }
export const EVENT_LABELS: Record<string, string> = {
  OPENED: "Aberta",
  ACCEPTED: "Aceita",
  APPROVED: "Aprovada",
  RETURNED: "Devolvida para ajuste",
  CONTINUITY_DECIDED: "Decisão registrada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
  FORWARDED: "Encaminhada",
  PLAN_UPDATED: "Plano atualizado",
  ITEM_ADDED: "Item incluído",
  ITEM_UPDATED: "Item atualizado",
  CHECKPOINT_RECORDED: "Checkpoint registrado",
  EVIDENCE_ADDED: "Evidência incluída",
  SIGNAL_RECEIVED: "Novo sinal da política",
  REEVALUATED: "Reavaliação registrada",
  AI_DRAFT_REQUESTED: "Rascunho pedido à INIA",
  AI_DRAFT_APPLIED: "Rascunho aplicado ao plano",
  COMPETENCY_APPLIED: "Competência aplicada ao treinamento",
}
