import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"

import type { ScopePickerPermission, ScopeUnitKind } from "@/schemas/scope-units/scope-units.schema"
import { fetchScopeUnits, fetchScopeUnitsByIds, type ScopeUnitSearch } from "@/services/scope-units/scope-units-service"

const PAGE_SIZE = 30
export const scopeUnitKeys = {
  all: ["scope-units"] as const,
  list: (search: Omit<ScopeUnitSearch, "cursor">) => [...scopeUnitKeys.all, "list", search] as const,
  ids: (kind: ScopeUnitKind, permission: ScopePickerPermission, ids: readonly string[], universes: readonly string[] | undefined) => [...scopeUnitKeys.all, "ids", kind, permission, [...ids].sort(), universes ?? null] as const,
}

/** Opções paginadas por cursor (carregamento progressivo na rolagem). Só busca com o seletor aberto (`enabled`). */
export function useScopeUnitOptions(search: Omit<ScopeUnitSearch, "cursor" | "limit">, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: scopeUnitKeys.list(search),
    queryFn: ({ pageParam }) => fetchScopeUnits({ ...search, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  })
}

/** Escolhas já salvas: nome, Grupo-pai, universo e se ainda têm operador em produção. */
export function useScopeUnitsByIds(kind: ScopeUnitKind, permission: ScopePickerPermission, ids: readonly string[], universes?: readonly string[]) {
  return useQuery({
    queryKey: scopeUnitKeys.ids(kind, permission, ids, universes),
    queryFn: () => fetchScopeUnitsByIds(kind, permission, ids, universes),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
