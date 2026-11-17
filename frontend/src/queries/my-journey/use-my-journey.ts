"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { fetchMyJourney } from "@/services/my-journey/my-journey-service"

export const myJourneyKeys = {
  all: () => ["my-journey"] as const,
  week: (week: string | null) => ["my-journey", week ?? "current"] as const,
}

/** Trocar de semana mantém a anterior na tela até a nova chegar (sem piscar). Escala muda pouco: relê ao voltar para a janela. */
export function useMyJourneyQuery(week: string | null) {
  return useQuery({ queryKey: myJourneyKeys.week(week), queryFn: () => fetchMyJourney(week), placeholderData: keepPreviousData, refetchOnWindowFocus: true, staleTime: 60_000 })
}
