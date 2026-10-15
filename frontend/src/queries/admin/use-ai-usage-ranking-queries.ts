import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { fetchAiUsageRanking, fetchAiUsageRankingContext, type AiUsageRankingParams } from "@/services/admin/ai-usage-ranking-service"

import { adminQueryKeys } from "./admin-query-keys"

// Debaixo da key "pai" de IA: qualquer mutação de IA (preço, modelo…) invalida também o ranking.
const rankingKey = () => [...adminQueryKeys.ai(), "usage-ranking"] as const

/** Níveis, descrição do escopo e Grupos/Subgrupos onde a conta pode ver uso (decididos no backend). */
export function useAiUsageRankingContextQuery(enabled = true) {
  return useQuery({ queryKey: [...rankingKey(), "context"], queryFn: fetchAiUsageRankingContext, staleTime: 60_000, enabled })
}

/** Uma página do ranking da visão escolhida; mantém a página anterior enquanto troca filtro/página. */
export function useAiUsageRankingQuery(params: AiUsageRankingParams, enabled = true) {
  return useQuery({ queryKey: [...rankingKey(), "list", params], queryFn: () => fetchAiUsageRanking(params), placeholderData: keepPreviousData, enabled })
}
