import { ApiError, apiGet, apiPost, toQueryString } from "@/lib/api/api-client"
import { editCheckSchema, feedbackQualityAccessSchema, type FeedbackQualityAccess, feedbackReviewDetailSchema, feedbackReviewPageSchema, type EditCheck, type FeedbackReviewDecisionInput, type FeedbackReviewDetail, type FeedbackReviewListParams, type FeedbackReviewPage, type ItemWording } from "@/schemas/feedback-review/feedback-review.schema"

/** QA de feedback (QA Lab › Feedbacks). Só existe com a flag do pipeline ligada; avaliar exige a capability explícita. */
const BASE = "/api/v1/feedback-quality-reviews"
const MODULE_DISABLED: FeedbackQualityAccess = { enabled: false, canReview: false, canDecide: false, scopes: [] }
const FORBIDDEN: FeedbackQualityAccess = { enabled: true, canReview: false, canDecide: false, scopes: [] }

/**
 * Acesso ao QA de feedback. Dois estados que NUNCA se misturam (V1.5.8a): rota não montada (404) = MÓDULO DESLIGADO neste
 * ambiente; 403 = módulo ligado e conta SEM a permissão. A UI decide a presença do módulo pelo `features` do /auth/me — isto
 * é só a defesa para quando a chamada acontece mesmo assim.
 */
export async function fetchFeedbackQualityAccess(): Promise<FeedbackQualityAccess> {
  try {
    return feedbackQualityAccessSchema.parse(await apiGet<unknown>(`${BASE}/access`))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return MODULE_DISABLED
    if (error instanceof ApiError && error.status === 403) return FORBIDDEN
    throw error
  }
}

export async function fetchFeedbackReviews(params: FeedbackReviewListParams): Promise<FeedbackReviewPage> {
  return feedbackReviewPageSchema.parse(await apiGet<unknown>(`${BASE}${toQueryString(params)}`))
}

export async function fetchFeedbackReview(reviewId: string): Promise<FeedbackReviewDetail> {
  return feedbackReviewDetailSchema.parse(await apiGet<unknown>(`${BASE}/${encodeURIComponent(reviewId)}`))
}

export async function checkFeedbackReviewEdit(reviewId: string, wording: ItemWording): Promise<EditCheck> {
  return editCheckSchema.parse(await apiPost<unknown>(`${BASE}/${encodeURIComponent(reviewId)}/edit-check`, wording))
}

export async function decideFeedbackReview(reviewId: string, input: FeedbackReviewDecisionInput): Promise<FeedbackReviewDetail> {
  return feedbackReviewDetailSchema.parse(await apiPost<unknown>(`${BASE}/${encodeURIComponent(reviewId)}/decision`, input))
}
