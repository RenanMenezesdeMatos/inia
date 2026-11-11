import { z } from "zod"

import { feedbackEvaluationSchema } from "@/schemas/feedback-ratings/feedback-rating.schema"

/** Espelho de backend/src/modules/interaction-feedback/domain/collaborator-feedback-view.ts (V1.5.6 — feedback de atendimento). */
export const deliveredFeedbackSchema = z.object({
  id: z.string(),
  kind: z.literal("INTERACTION_FEEDBACK"),
  title: z.string(),
  section: z.enum(["STRENGTH", "OPPORTUNITY"]),
  sectionLabel: z.string(),
  interactionLabel: z.string(),
  interactionAt: z.string().nullable(),
  deliveredAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  blocks: z.array(z.object({ key: z.enum(["observed", "whyItMatters", "whatYouCanDo"]), label: z.string(), text: z.string() })),
  evidence: z.array(z.object({ speakerLabel: z.string(), text: z.string(), truncated: z.boolean() })),
  /** Avaliação do próprio colaborador (escolha registrada na ciência + contestação antiga), migration 186. */
  evaluation: feedbackEvaluationSchema.nullable().default(null),
})
export type DeliveredFeedback = z.infer<typeof deliveredFeedbackSchema>
export const deliveredFeedbackListSchema = z.array(deliveredFeedbackSchema)
