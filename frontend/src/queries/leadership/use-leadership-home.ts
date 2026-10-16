"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLeadershipHome } from "@/services/leadership/leadership-service"

export const leadershipKeys = { home: ["leadership", "home"] as const }

/** Compartilhada pelo cartão "Onde atuar hoje" e pelas perguntas sugeridas do chat: uma leitura só. */
export function useLeadershipHomeQuery(enabled = true) {
  return useQuery({ queryKey: leadershipKeys.home, queryFn: fetchLeadershipHome, enabled, staleTime: 60_000 })
}
