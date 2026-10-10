"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchFeedbackApplications, fetchFeedbackInvite } from "@/services/feedback-applications/feedback-applications-service"

export const feedbackApplicationsKey = ["feedback-applications", "list"] as const
export const feedbackInviteKey = ["feedback-applications", "invite"] as const

/** Estado da aplicação de cada feedback (botões do Acompanhamento). Cache compartilhado; outra aba é percebida no foco. */
export function useFeedbackApplicationsQuery(enabled = true) {
  return useQuery({ queryKey: feedbackApplicationsKey, queryFn: fetchFeedbackApplications, enabled, staleTime: 15_000, refetchOnWindowFocus: true })
}

/** Convite da vez (no máximo um). Sem push: polling moderado + foco de janela, como o sino. */
export function useFeedbackInviteQuery(enabled = true) {
  return useQuery({ queryKey: feedbackInviteKey, queryFn: fetchFeedbackInvite, enabled, staleTime: 15_000, refetchInterval: 60_000, refetchOnWindowFocus: true })
}
