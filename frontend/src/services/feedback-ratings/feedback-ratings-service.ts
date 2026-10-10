import { apiGet, apiPost } from "@/lib/api/api-client"
import { feedbackRatingListSchema, feedbackRatingResultSchema, type FeedbackRating, type FeedbackRatingInput } from "@/schemas/feedback-ratings/feedback-rating.schema"

/** Avaliação do feedback pelo próprio destinatário — o backend resolve a pessoa pela sessão e autoriza a fonte. */
const BASE = "/api/v1/feedback-ratings"

export async function fetchMyFeedbackRatings(): Promise<FeedbackRating[]> {
  return feedbackRatingListSchema.parse(await apiGet<unknown>(BASE)).items
}

/** Grava a avaliação (`NONE` = retirar) e devolve a vigente (`null` depois de retirar). */
export async function rateFeedback(input: FeedbackRatingInput): Promise<FeedbackRating | null> {
  return feedbackRatingResultSchema.parse(await apiPost<unknown>(BASE, input)).rating
}
