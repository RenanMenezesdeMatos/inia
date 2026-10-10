"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { FeedbackReviewDecisionInput, FeedbackReviewListParams, ItemWording } from "@/schemas/feedback-review/feedback-review.schema"
import { checkFeedbackReviewEdit, decideFeedbackReview, fetchFeedbackQualityAccess, fetchFeedbackReview, fetchFeedbackReviews } from "@/services/feedback-review/feedback-review-service"

import { feedbackReviewKeys } from "./feedback-review-query-keys"

/** Capability FEEDBACK_QUALITY_REVIEW do usuário (decide se o QA Lab › Feedbacks aparece). */
export function useFeedbackQualityAccessQuery() {
  return useQuery({ queryKey: feedbackReviewKeys.access(), queryFn: fetchFeedbackQualityAccess, staleTime: 5 * 60_000, retry: false })
}

export function useFeedbackReviewsQuery(params: FeedbackReviewListParams, enabled = true) {
  return useQuery({ queryKey: feedbackReviewKeys.list(params), queryFn: () => fetchFeedbackReviews(params), enabled, placeholderData: keepPreviousData, refetchOnWindowFocus: true })
}

export function useFeedbackReviewQuery(reviewId: string | null) {
  return useQuery({ queryKey: feedbackReviewKeys.detail(reviewId ?? ""), queryFn: () => fetchFeedbackReview(reviewId!), enabled: reviewId !== null })
}

export function useCheckFeedbackReviewEditMutation() {
  return useMutation({ mutationFn: ({ reviewId, wording }: { reviewId: string; wording: ItemWording }) => checkFeedbackReviewEdit(reviewId, wording) })
}

/** Avaliar muda só o resultado de QA e a fila (nunca a disposição; nada é entregue nem notificado nesta versão). */
export function useDecideFeedbackReviewMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reviewId, input }: { reviewId: string; input: FeedbackReviewDecisionInput }) => decideFeedbackReview(reviewId, input),
    onSuccess: (detail) => {
      queryClient.setQueryData(feedbackReviewKeys.detail(detail.reviewId), detail)
      void queryClient.invalidateQueries({ queryKey: [...feedbackReviewKeys.all(), "list"] })
    },
    // Estado mudou no servidor (ex.: outra pessoa decidiu): recarrega o detalhe e a fila — a verdade é do backend.
    onError: (_error, { reviewId }) => {
      void queryClient.invalidateQueries({ queryKey: feedbackReviewKeys.detail(reviewId) })
      void queryClient.invalidateQueries({ queryKey: [...feedbackReviewKeys.all(), "list"] })
    },
  })
}
