"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { feedbackSourceKey } from "@/schemas/feedback-applications/feedback-application.schema"
import type { FeedbackRating, FeedbackRatingInput } from "@/schemas/feedback-ratings/feedback-rating.schema"
import { fetchMyFeedbackRatings, rateFeedback } from "@/services/feedback-ratings/feedback-ratings-service"

export const feedbackRatingsKey = ["feedback-ratings", "mine"] as const

/** Avaliações vigentes da pessoa da sessão (estado dos botões "Este conteúdo foi útil?"). */
export function useMyFeedbackRatingsQuery() {
  return useQuery({ queryKey: feedbackRatingsKey, queryFn: fetchMyFeedbackRatings, staleTime: 60_000 })
}

function replaceRating(list: FeedbackRating[] | undefined, input: FeedbackRatingInput, next: FeedbackRating | null): FeedbackRating[] {
  const key = feedbackSourceKey(input.source)
  const rest = (list ?? []).filter((item) => feedbackSourceKey(item.source) !== key)
  return next ? [next, ...rest] : rest
}

/**
 * Curtir aparece na hora (otimista) e volta atrás se o backend recusar; descurtir só fecha o questionário depois de gravado
 * (o formulário mostra o erro e mantém o texto). O backend é a autoridade: o retorno substitui o estado otimista.
 */
export function useRateFeedbackMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rateFeedback,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: feedbackRatingsKey })
      const previous = queryClient.getQueryData<FeedbackRating[]>(feedbackRatingsKey)
      if (input.value !== "DOWN") {
        const optimistic: FeedbackRating | null = input.value === "UP" ? { source: input.source, value: "UP", reason: null, comment: null, ratedAt: new Date().toISOString(), review: null } : null
        queryClient.setQueryData<FeedbackRating[]>(feedbackRatingsKey, (list) => replaceRating(list, input, optimistic))
      }
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context) queryClient.setQueryData(feedbackRatingsKey, context.previous)
    },
    onSuccess: (rating, input) => {
      queryClient.setQueryData<FeedbackRating[]>(feedbackRatingsKey, (list) => replaceRating(list, input, rating))
    },
  })
}
