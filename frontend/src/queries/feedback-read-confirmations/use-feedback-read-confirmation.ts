"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { feedbackSourceKey, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { feedbackApplicationsKey } from "@/queries/feedback-applications/use-feedback-applications"
import { myDeliveredFeedbackKey } from "@/queries/feedback-delivery/use-delivered-feedback"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"
import type { ReadConfirmationAttempt } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"
import { confirmFeedbackReading } from "@/services/feedback-read-confirmations/feedback-read-confirmations-service"

/**
 * Ciências confirmadas NESTA sessão do navegador (chave da fonte → data). O Acompanhamento chega do servidor já renderizado e a
 * sessão com a INIA é outro componente: os dois leem daqui para que confirmar num lugar mude o outro na hora. A verdade é o
 * backend — este mapa só cobre o intervalo até o próximo carregamento.
 */
const CONFIRMED_KEY = ["feedback-read-confirmations", "confirmed"] as const
type ConfirmedReadings = Record<string, string>

export function useConfirmedReadingAt(source: FeedbackSourceRef): string | null {
  const { data } = useQuery<ConfirmedReadings>({ queryKey: CONFIRMED_KEY, queryFn: () => ({}), initialData: {}, staleTime: Infinity, gcTime: Infinity })
  return data[feedbackSourceKey(source)] ?? null
}

export function useConfirmFeedbackReadingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReadConfirmationAttempt & { login: string; password: string }) => confirmFeedbackReading(input),
    onSuccess: (result) => {
      queryClient.setQueryData<ConfirmedReadings>(CONFIRMED_KEY, (current) => ({ ...current, [feedbackSourceKey(result.source)]: result.acknowledgedAt }))
      if (result.source.kind === "INTERACTION_FEEDBACK_DELIVERY") {
        queryClient.setQueryData<DeliveredFeedback[]>(myDeliveredFeedbackKey, (current) => current?.map((entry) => (entry.id === result.source.id ? { ...entry, acknowledgedAt: result.acknowledgedAt } : entry)))
      }
      // O botão da aplicação ("Continuar feedback" → "Ver feedback e conversa") e o que mostra o estado de ciência para a gestão.
      void queryClient.invalidateQueries({ queryKey: feedbackApplicationsKey })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "follow-ups"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team-members"] })
    },
  })
}
