import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"

import type { ScopedOption, ScopedOptionKind } from "@/schemas/scope-units/scoped-options.schema"
import { fetchScopedOptions, fetchScopedOptionsByIds, type ScopedOptionsSearch, type ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"

import { keepSameList } from "./keep-same-list"

const PAGE_SIZE = 30

/** Opções de uma tela em lotes (cursor). Só busca com o seletor aberto (`enabled`). */
export function useScopedOptions(source: ScopedOptionsSource, search: Omit<ScopedOptionsSearch, "cursor" | "limit">, enabled: boolean) {
  const key = { source, ...search }
  return useInfiniteQuery({
    queryKey: ["scoped-options", "list", key],
    queryFn: ({ pageParam, signal }) => fetchScopedOptions(source, { ...search, cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepSameList(key),
    enabled,
    staleTime: 30_000,
  })
}

const byIdsKey = (source: ScopedOptionsSource, kind: ScopedOptionKind, ids: readonly string[]) => ["scoped-options", "ids", source, kind, [...ids].sort()] as const

/** Guarda a opção recém-escolhida, para o nome aparecer no gatilho sem esperar a consulta por id. */
export function useRememberScopedOption(source: ScopedOptionsSource) {
  const client = useQueryClient()
  return (option: ScopedOption) => client.setQueryData(byIdsKey(source, option.kind, [option.id]), [option])
}

export function useScopedOptionsByIds(source: ScopedOptionsSource, kind: ScopedOptionKind, ids: readonly string[]) {
  return useQuery({
    queryKey: byIdsKey(source, kind, ids),
    queryFn: () => fetchScopedOptionsByIds(source, kind, ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
