import { z } from "zod"
import { reviewPresentationSchema } from "./review-presentation.schema"

/** Espelho de backend/src/modules/pending-actions/domain/view-models.ts. */
export const humanReviewDecisionSchema = z.enum(["approved", "rejected", "escalated"])
export type HumanReviewDecision = z.infer<typeof humanReviewDecisionSchema>

export const pendingActionStatusSchema = z.enum(["PENDING", "DECIDED", "UNAVAILABLE"])
export type PendingActionStatus = z.infer<typeof pendingActionStatusSchema>

const personSchema = z.object({ personId: z.string(), name: z.string(), teamName: z.string().nullable(), jobTitle: z.string().nullable() })

export const humanReviewSummarySchema = z.object({
  id: z.string(),
  kind: z.literal("HUMAN_REVIEW"),
  status: pendingActionStatusSchema,
  enrollmentId: z.string(),
  nodeId: z.string(),
  workflowName: z.string(),
  nodeLabel: z.string(),
  operator: personSchema.nullable(),
  reason: z.string().nullable(),
  requestedAt: z.string(),
  caseId: z.string().nullable(),
  decision: humanReviewDecisionSchema.nullable(),
  decidedAt: z.string().nullable(),
  reviewer: z.object({ personId: z.string(), name: z.string() }).nullable(),
})
export type HumanReviewSummary = z.infer<typeof humanReviewSummarySchema>

export const workdayResolutionSchema = z.enum(["NOT_WORKED", "UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING", "SCHEDULE_CORRECTED", "PRODUCTION_RECEIVED_AFTER_ALERT", "PLAN_UPDATED_AFTER_ALERT", "SOURCES_STILL_OPEN", "DATA_SOURCE_DELAYED", "STATUS_NON_PRODUCTIVE"])
export type WorkdayResolution = z.infer<typeof workdayResolutionSchema>

export const justifiedAbsenceReasonSchema = z.enum(["ATESTADO", "DAY_OFF", "BANCO_HORAS", "FOLGA_EXTRAORDINARIA", "OTHER_JUSTIFIED"])
export type JustifiedAbsenceReason = z.infer<typeof justifiedAbsenceReasonSchema>

/** Classificação vinculada à pendência (vigente ou já superada por produção/RH posterior). */
export const pendingClassificationSchema = z.object({
  id: z.string(),
  classification: z.enum(["UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING"]),
  reasonCode: justifiedAbsenceReasonSchema.nullable(),
  label: z.string(),
  supersededReason: z.enum(["REVISED", "CONTRADICTED_BY_WORK_EVIDENCE", "SUPERSEDED_BY_AUTHORITATIVE_STATUS"]).nullable(),
  supersededReasonLabel: z.string().nullable(),
})

/** "Produção não identificada após o fechamento das fontes" — pendência de reconciliação de um dia (PLANEJADO × OBSERVADO). */
export const workdayReconciliationSummarySchema = z.object({
  id: z.string(),
  kind: z.literal("WORKDAY_RECONCILIATION"),
  status: pendingActionStatusSchema,
  reconciliationId: z.string(),
  operator: personSchema.nullable(),
  workday: z.string(),
  reason: z.string(),
  plan: z.string(),
  requestedAt: z.string(),
  resolution: workdayResolutionSchema.nullable(),
  resolutionLabel: z.string().nullable(),
  decidedAt: z.string().nullable(),
  reviewer: z.object({ personId: z.string(), name: z.string() }).nullable(),
  classification: pendingClassificationSchema.nullable(),
  availability: z.object({ state: z.string(), label: z.string() }).nullable(),
})
export type WorkdayReconciliationSummary = z.infer<typeof workdayReconciliationSummarySchema>

/** Intervenção que exige resposta agora (aceitar, aprovar, decidir ou item vencendo) — o detalhe e os controles ficam no CASO. */
export const interventionPendingSummarySchema = z.object({
  id: z.string(),
  kind: z.literal("INTERVENTION"),
  status: pendingActionStatusSchema,
  interventionId: z.string(),
  caseId: z.string(),
  operator: personSchema.nullable(),
  typeName: z.string(),
  reason: z.string(),
  pendingReason: z.enum(["ACCEPT", "APPROVE", "DECIDE", "EXECUTE"]),
  pendingLabel: z.string(),
  dueAt: z.string(),
  overdue: z.boolean(),
  sensitive: z.boolean(),
  requestedAt: z.string(),
  decidedAt: z.null(),
  reviewer: z.null(),
})
export type InterventionPendingSummary = z.infer<typeof interventionPendingSummarySchema>

export const pendingActionSummarySchema = z.discriminatedUnion("kind", [humanReviewSummarySchema, workdayReconciliationSummarySchema, interventionPendingSummarySchema])
export type PendingActionSummary = z.infer<typeof pendingActionSummarySchema>

export const pendingActionsSummarySchema = z.object({
  pending: z.array(pendingActionSummarySchema),
  history: z.array(pendingActionSummarySchema),
  pendingCount: z.number(),
})
export type PendingActionsSummary = z.infer<typeof pendingActionsSummarySchema>

export const humanReviewDetailSchema = humanReviewSummarySchema.extend({
  instruction: z.string().nullable(),
  content: z.string().nullable(),
  // HUMAN REVIEW CONTEXT (V1.2) — ausente em respostas anteriores.
  presentation: reviewPresentationSchema.nullable().optional(),
  allowedDecisions: z.array(humanReviewDecisionSchema),
  caseTitle: z.string().nullable(),
  caseSummary: z.string().nullable(),
  evidences: z.array(z.object({ id: z.string(), type: z.string(), title: z.string(), description: z.string(), occurredAt: z.string() })),
  previousOutputs: z.array(z.object({ nodeId: z.string(), nodeLabel: z.string(), text: z.string() })),
  timeline: z.array(z.object({ eventType: z.string(), nodeId: z.string().nullable(), createdAt: z.string() })),
})
export type HumanReviewDetail = z.infer<typeof humanReviewDetailSchema>

export const workdayReconciliationDetailSchema = workdayReconciliationSummarySchema.extend({
  evidenceSources: z.object({ interactions: z.boolean(), indicatorCodes: z.array(z.string()) }),
  shiftEnd: z.string().nullable(),
  justifiedReasons: z.array(z.object({ code: justifiedAbsenceReasonSchema, label: z.string() })),
  provisionableCodes: z.array(z.object({ code: z.string(), label: z.string() })),
  resolutionException: z.object({ id: z.string(), code: z.string(), label: z.string() }).nullable(),
})
export type WorkdayReconciliationDetail = z.infer<typeof workdayReconciliationDetailSchema>

/** Decisão do Supervisor sobre uma pendência de produção: classificação (revisável) ou correção do planejamento. */
export type WorkdayDecision = { resolution: "UNJUSTIFIED_ABSENCE" } | { resolution: "JUSTIFIED_ABSENCE"; reasonCode: JustifiedAbsenceReason } | { resolution: "WORKED_DATA_MISSING" } | { resolution: "SCHEDULE_CORRECTED" }
export const WORKDAY_RESOLUTION_LABELS: Record<WorkdayResolution, string> = {
  NOT_WORKED: "Não trabalhou (exceção registrada)",
  UNJUSTIFIED_ABSENCE: "Falta injustificada",
  JUSTIFIED_ABSENCE: "Ausência justificada",
  WORKED_DATA_MISSING: "Trabalhou — dados não chegaram",
  SCHEDULE_CORRECTED: "Planejamento corrigido",
  PRODUCTION_RECEIVED_AFTER_ALERT: "Produção recebida após o alerta",
  PLAN_UPDATED_AFTER_ALERT: "Plano atualizado após o alerta",
  SOURCES_STILL_OPEN: "Fontes ainda dentro do prazo (reavaliada)",
  DATA_SOURCE_DELAYED: "Fonte de dados atrasada (reavaliada)",
  STATUS_NON_PRODUCTIVE: "Situação funcional não produtiva (reavaliada)",
}

export const WORKDAY_KEY_PREFIX = "workday:"
export function parseWorkdayKey(value: string | null): string | null {
  return value && value.startsWith(WORKDAY_KEY_PREFIX) && value.length > WORKDAY_KEY_PREFIX.length ? value.slice(WORKDAY_KEY_PREFIX.length) : null
}

export const DECISION_LABELS: Record<HumanReviewDecision, string> = { approved: "Aprovar", rejected: "Reprovar", escalated: "Escalar" }
export const DECISION_DONE_LABELS: Record<HumanReviewDecision, string> = { approved: "Aprovada", rejected: "Reprovada", escalated: "Escalada" }
export const PENDING_STATUS_LABELS: Record<PendingActionStatus, string> = { PENDING: "Aguardando sua decisão", DECIDED: "Decidida", UNAVAILABLE: "Não disponível" }

/** Chave de deep link `review=<enrollmentId>:<nodeId>` ↔ partes. */
export function parseReviewKey(value: string | null): { enrollmentId: string; nodeId: string } | null {
  if (!value || value.startsWith(WORKDAY_KEY_PREFIX)) return null
  const separator = value.indexOf(":")
  if (separator <= 0 || separator === value.length - 1) return null
  return { enrollmentId: value.slice(0, separator), nodeId: value.slice(separator + 1) }
}
