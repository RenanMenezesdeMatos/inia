import { z } from "zod"

import { contestationDecisionSchema, feedbackDislikeReasonSchema } from "@/schemas/feedback-ratings/feedback-rating.schema"

/**
 * Espelho de backend/src/modules/feedback-rating/application/contestation-review-service.ts — "Contestações de feedback"
 * (Administração). O recorte de quem aparece é sempre o escopo de quem revisa, decidido pelo backend.
 */
export const contestationStatusSchema = z.enum(["PENDING", "ANSWERED"])
export type ContestationStatus = z.infer<typeof contestationStatusSchema>
export const CONTESTATION_STATUS_LABELS: Record<ContestationStatus, string> = { PENDING: "Aguardando resposta", ANSWERED: "Respondidas" }

export const contestationItemSchema = z.object({
  id: z.string(),
  status: contestationStatusSchema,
  reason: feedbackDislikeReasonSchema,
  comment: z.string(),
  contestedAt: z.string(),
  collaborator: z.object({ personId: z.string(), name: z.string(), teamName: z.string().nullable(), subteamName: z.string().nullable() }),
  feedback: z.object({ kind: z.enum(["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"]), id: z.string(), feedbackKind: z.string().nullable(), impactedIndicator: z.string().nullable(), publishedAt: z.string().nullable() }),
  review: z.object({ decision: contestationDecisionSchema, response: z.string(), reviewerName: z.string(), respondedAt: z.string() }).nullable(),
})
export type ContestationItem = z.infer<typeof contestationItemSchema>

export const contestationDetailSchema = contestationItemSchema.extend({
  content: z.object({ observedBehavior: z.string().nullable(), evidenceFound: z.string().nullable(), relatedProcedure: z.string().nullable(), recommendation: z.string().nullable() }).nullable(),
})
export type ContestationDetail = z.infer<typeof contestationDetailSchema>

export const contestationPageSchema = z.object({ items: z.array(contestationItemSchema), total: z.number(), pendingCount: z.number() })
export type ContestationPage = z.infer<typeof contestationPageSchema>

export const CONTESTATION_RESPONSE_LIMITS = { min: 3, max: 2000 } as const
