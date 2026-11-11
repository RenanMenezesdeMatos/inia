import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import { notificationKeys } from "@/queries/notifications/notifications-query-keys"
import { fetchContestation, fetchContestations, fetchContestationSummary, reviewContestation, type ContestationFilters } from "@/services/admin/feedback-contestation-service"
import type { ContestationDecision } from "@/schemas/feedback-ratings/feedback-rating.schema"

/** A fila se atualiza nesse intervalo (contestações novas chegam enquanto a tela está aberta). */
export const CONTESTATIONS_POLL_INTERVAL_MS = 30_000

export function useContestationsQuery(filters: ContestationFilters) {
  return useQuery({ queryKey: adminQueryKeys.feedbackContestationsList(filters), queryFn: () => fetchContestations(filters), placeholderData: keepPreviousData, refetchInterval: CONTESTATIONS_POLL_INTERVAL_MS })
}

/** Taxa de contestação do período; acompanha a fila (contestações novas e respostas mudam os números). */
export function useContestationSummaryQuery(period: { from: string; to: string }) {
  return useQuery({ queryKey: adminQueryKeys.feedbackContestationSummary(period), queryFn: () => fetchContestationSummary(period), placeholderData: keepPreviousData, refetchInterval: CONTESTATIONS_POLL_INTERVAL_MS })
}

export function useContestationQuery(id: string | null) {
  return useQuery({ queryKey: adminQueryKeys.feedbackContestation(id ?? ""), queryFn: () => fetchContestation(id!), enabled: Boolean(id) })
}

export function useReviewContestationMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { decision: ContestationDecision; response: string }) => reviewContestation(id, input),
    onSuccess: (detail) => {
      queryClient.setQueryData(adminQueryKeys.feedbackContestation(id), detail)
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.feedbackContestations() })
      // O aviso "contestação para responder" deixa de pedir ação no sino.
      void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() })
    },
  })
}
