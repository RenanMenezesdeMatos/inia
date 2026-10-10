import type { FeedbackReviewListParams } from "@/schemas/feedback-review/feedback-review.schema"

export const feedbackReviewKeys = {
  all: () => ["feedback-reviews"] as const,
  access: () => ["feedback-reviews", "access"] as const,
  list: (params: FeedbackReviewListParams) => ["feedback-reviews", "list", params] as const,
  detail: (reviewId: string) => ["feedback-reviews", "detail", reviewId] as const,
}
