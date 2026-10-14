import { z } from "zod"

import { feedbackSupportMaterialSchema } from "@/schemas/feedbacks/support-material.schema"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { feedbackOriginSchema } from "@/schemas/feedbacks/feedback-origin.schema"

/**
 * Payload CRU de `GET /api/v1/operator/overview` e `GET /api/v1/operator/feedbacks` (backend reporting/fetch-operator-overview.ts).
 * O serviço transforma estas linhas no modelo da tela (`OperatorIndicatorsData`).
 */
export const operatorIndicatorRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  value: z.number(),
  targetValue: z.number().nullable(),
  direction: z.enum(["LOWER", "HIGHER"]),
  achieved: z.boolean().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  glossaryDescription: z.string().nullable(),
  goodPractices: z.string().nullable(),
  feedbackGuidance: z.string().nullable(),
})

export const operatorFeedbackRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  impactedIndicator: z.string().nullable(),
  evidenceFound: z.string().nullable(),
  observedBehavior: z.string().nullable(),
  relatedProcedure: z.string().nullable(),
  recommendation: z.string().nullable(),
  createdAt: z.string(),
  /** Instante canônico do feed (publicação; senão criação) — o backend já ordena por ele, mais recente primeiro. */
  occurredAt: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable(),
  supportMaterials: z.array(feedbackSupportMaterialSchema).optional(),
  /** Feedback por Flag V2 — view model publicado (null = feedback anterior). */
  feedbackView: feedbackViewSchema.nullable().optional(),
  /** Feedback de atendimento anterior (sem view model): título pelo assunto da interação vinculada, ou neutro — calculado na leitura. */
  heading: z.object({ title: z.string(), subtitle: z.string().nullable() }).nullable().optional(),
  /** Motivo do feedback (flag, rotina, avulsa, indicador) + ícone — selo do cabeçalho do item. */
  origin: feedbackOriginSchema.nullable().optional(),
})

/** Uma página do Acompanhamento: `nextCursor` null = não há feedbacks mais antigos. */
export const operatorFeedbackPageSchema = z.object({
  items: z.array(operatorFeedbackRowSchema),
  nextCursor: z.string().nullable(),
})

export const operatorOverviewSchema = z.object({
  profile: z.object({ name: z.string(), role: z.string(), avatarUrl: z.string().nullable(), jobTitle: z.string().nullable().optional() }),
  indicators: z.array(operatorIndicatorRowSchema),
  /** PRIMEIRA página do Acompanhamento; as seguintes vêm de `/operator/feedbacks?cursor=`. */
  feedbacks: z.array(operatorFeedbackRowSchema),
  feedbacksNextCursor: z.string().nullable(),
})

export type OperatorIndicatorRow = z.infer<typeof operatorIndicatorRowSchema>
export type OperatorFeedbackRow = z.infer<typeof operatorFeedbackRowSchema>
export type OperatorFeedbackPage = z.infer<typeof operatorFeedbackPageSchema>
export type OperatorOverview = z.infer<typeof operatorOverviewSchema>
