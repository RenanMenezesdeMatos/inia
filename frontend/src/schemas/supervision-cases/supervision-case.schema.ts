import { z } from "zod"

const evidenceSchema = z.object({
  id: z.string(), type: z.string(), title: z.string(), description: z.string(),
  sourceType: z.string().min(1), sourceId: z.string().min(1), occurredAt: z.coerce.string(),
})

const recommendationSchema = z.object({
  id: z.string(), actionType: z.string(), description: z.string(),
  expectedImpact: z.string(), dueAt: z.coerce.string().nullable(),
})

const feedbackSchema = z.object({
  id: z.string(), status: z.string(), impactedIndicator: z.string(),
  evidenceFound: z.string(), observedBehavior: z.string(), relatedProcedure: z.string(),
  recommendation: z.string(), suggestedApproach: z.string().nullable(),
})

export const supervisionCaseSchema = z.object({
  id: z.string(), title: z.string(), summary: z.string(), status: z.string(),
  priority: z.string(), indicatorCode: z.string(), indicatorValue: z.string(),
  indicatorTarget: z.string(), rootCause: z.string().nullable(), confidence: z.number().nullable(),
  operator: z.object({ id: z.string(), name: z.string() }),
  team: z.object({ id: z.string(), name: z.string() }), updatedAt: z.coerce.string(),
  evidences: z.array(evidenceSchema), recommendations: z.array(recommendationSchema),
  feedbacks: z.array(feedbackSchema),
})

export type SupervisionCase = z.infer<typeof supervisionCaseSchema>
