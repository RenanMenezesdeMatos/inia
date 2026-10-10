"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMyDeliveredFeedback } from "@/services/feedback-delivery/feedback-delivery-service"

/** Mesma chave que a confirmação de ciência atualiza (use-feedback-read-confirmation.ts). */
export const myDeliveredFeedbackKey = ["feedback-deliveries", "mine"] as const

export function useMyDeliveredFeedbackQuery() {
  return useQuery({ queryKey: myDeliveredFeedbackKey, queryFn: fetchMyDeliveredFeedback, refetchOnWindowFocus: true })
}
