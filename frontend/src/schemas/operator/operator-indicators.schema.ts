import { z } from "zod"

import { feedbackSupportMaterialSchema } from "@/schemas/feedbacks/support-material.schema"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { feedbackOriginSchema } from "@/schemas/feedbacks/feedback-origin.schema"

export const indicatorStatusSchema = z.enum(["good", "attention"])

export const indicatorHistoryIconKeySchema = z.enum([
  "sun",
  "phone",
  "mail",
  "mail-warning",
  "sparkles",
  "clipboard-check",
  "badge-check",
  "book-open-check",
  "alert-triangle",
  "timer",
  "target",
])

export const indicatorHistoryToneSchema = z.enum([
  "default",
  "info",
  "success",
  "warning",
  "danger",
  "quality",
])

export const indicatorPresentationSchema = z.object({
  label: z.string(),
  iconKey: indicatorHistoryIconKeySchema,
  tone: indicatorHistoryToneSchema,
})

export const operatorIndicatorActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  presentation: indicatorPresentationSchema.optional(),
})

export const operatorIndicatorSchema = z.object({
  id: z.string(),
  title: z.string(),
  value: z.string(),
  meta: z.string(),
  status: indicatorStatusSchema,
  priority: z.number(),
  description: z.string().optional(),
  recommendation: z.string().optional(),
  suggestedApproach: z.string().optional(),
  actions: z.array(operatorIndicatorActionSchema),
  relatedHistoryIds: z.array(z.string()),
  isPrv: z.boolean().optional(),
  insight: z.string().optional(),
})

export const operatorIndicatorHistoryFeedbackSchema = z.object({
  recommendation: z.string().optional(),
  evidenceFound: z.string().optional(),
  observedBehavior: z.string().optional(),
  relatedProcedure: z.string().optional(),
  /** Materiais de apoio recomendados pela IA (resolvidos pelo backend). Ausente = feedback antigo. */
  supportMaterials: z.array(feedbackSupportMaterialSchema).optional(),
  /** Feedback por Flag V2 — narrativa + detalhes (ausente/null = feedback anterior: vale o texto publicado). */
  view: feedbackViewSchema.nullable().optional(),
})

export const operatorIndicatorsHistoryKindSchema = z.enum(["reading", "monitoria_feedback", "indicator_feedback"])

export const operatorIndicatorHistorySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Data do atendimento ("Atendimento de dd/mm/aaaa") quando o título é o assunto; ausente/null = sem subtítulo. */
  subtitle: z.string().nullable().optional(),
  message: z.string(),
  timestamp: z.string(),
  /** Instante canônico do item no Acompanhamento (ISO) — ordena a timeline (mais recente primeiro). */
  occurredAt: z.string().optional(),
  kind: operatorIndicatorsHistoryKindSchema,
  presentation: indicatorPresentationSchema,
  feedback: operatorIndicatorHistoryFeedbackSchema.optional(),
  /** Ciência do colaborador (confirmação formal de recebimento). `null` = ainda aguardando;
   * ausente = item que não é um feedback publicado (ex.: leitura do dia). */
  acknowledgedAt: z.string().nullable().optional(),
  origin: feedbackOriginSchema.nullable().optional(),
})

export const operatorIndicatorsDataSchema = z.object({
  current: z.array(operatorIndicatorSchema),
  /** Primeira página do Acompanhamento (mais recente primeiro). */
  history: z.array(operatorIndicatorHistorySchema),
  /** Cursor da página seguinte (`/operator/feedbacks`); null/ausente = o histórico acaba nesta página. */
  historyNextCursor: z.string().nullable().optional(),
})

export type IndicatorStatus = z.infer<typeof indicatorStatusSchema>

export type OperatorIndicatorsHistoryKind = z.infer<typeof operatorIndicatorsHistoryKindSchema>

export type IndicatorHistoryIconKey = z.infer<
  typeof indicatorHistoryIconKeySchema
>

export type IndicatorHistoryTone = z.infer<typeof indicatorHistoryToneSchema>

export type IndicatorPresentation = z.infer<
  typeof indicatorPresentationSchema
>

export type OperatorIndicatorAction = z.infer<
  typeof operatorIndicatorActionSchema
>

export type OperatorIndicator = z.infer<typeof operatorIndicatorSchema>

export type OperatorIndicatorHistoryFeedback = z.infer<
  typeof operatorIndicatorHistoryFeedbackSchema
>

export type OperatorIndicatorHistory = z.infer<
  typeof operatorIndicatorHistorySchema
>

export type OperatorIndicatorsData = z.infer<
  typeof operatorIndicatorsDataSchema
>
