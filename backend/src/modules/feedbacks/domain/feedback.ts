import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"

export const feedbackContentSchema = z.object({
  impactedIndicator: z.string().trim().min(1),
  evidenceFound: z.string().trim().min(1),
  observedBehavior: z.string().trim().min(1),
  relatedProcedure: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
  suggestedApproach: z.string().trim().optional(),
})

export type FeedbackContent = z.infer<typeof feedbackContentSchema>

export function validatePublishableFeedback(content: FeedbackContent): FeedbackContent {
  const parsed = feedbackContentSchema.safeParse(content)
  if (!parsed.success) {
    throw new DomainError(
      "O feedback precisa conter indicador, evidência, comportamento, procedimento e recomendação.",
      "FEEDBACK_EVIDENCE_REQUIRED",
      422,
      z.treeifyError(parsed.error),
    )
  }
  return parsed.data
}
