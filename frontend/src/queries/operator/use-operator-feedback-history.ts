"use client"

import { useCallback } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"

import type { OperatorIndicatorHistory } from "@/schemas/operator"
import { fetchOperatorFeedbackPage } from "@/services/operator/operator-feed"

type HistoryPage = { history: OperatorIndicatorHistory[]; nextCursor: string | null }

/**
 * Acompanhamento do colaborador paginado por cursor: a PRIMEIRA página chega pelo SSR (`/operator/overview`) e as seguintes,
 * sob demanda, de `/operator/feedbacks`. Nunca refaz a página do SSR; ao sair da tela o cache é descartado (o próximo
 * carregamento traz o SSR atualizado). A chave carrega a "identidade" da primeira página para um SSR novo nunca reaproveitar
 * páginas de outro.
 */
export function useOperatorFeedbackHistory(initialHistory: OperatorIndicatorHistory[], initialNextCursor: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["operator-feedback-history", initialHistory[0]?.id ?? "empty", initialNextCursor ?? "end"],
    queryFn: ({ pageParam }): Promise<HistoryPage> => (pageParam ? fetchOperatorFeedbackPage(pageParam) : Promise.resolve({ history: initialHistory, nextCursor: initialNextCursor })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    initialData: { pages: [{ history: initialHistory, nextCursor: initialNextCursor }], pageParams: [null] },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const { fetchNextPage } = query
  const loadMoreHistory = useCallback(() => void fetchNextPage({ cancelRefetch: false }), [fetchNextPage])
  const seen = new Set<string>()
  const history = (query.data?.pages ?? []).flatMap((page) => page.history).filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
  return {
    history,
    hasMoreHistory: query.hasNextPage,
    loadingMoreHistory: query.isFetchingNextPage,
    loadMoreError: query.isFetchNextPageError,
    loadMoreHistory,
  }
}
