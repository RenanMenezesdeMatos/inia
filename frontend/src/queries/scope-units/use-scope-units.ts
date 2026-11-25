import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"

import type { ScopePickerPermission, ScopeUnitKind, ScopeUnitPurpose } from "@/schemas/scope-units/scope-units.schema"
import { fetchScopeUnits, fetchScopeUnitsByIds, type ScopeUnitSearch } from "@/services/scope-units/scope-units-service"

import { keepSameList } from "./keep-same-list"

const PAGE_SIZE = 30
export const scopeUnitKeys = {
  all: ["scope-units"] as const,
  list: (search: Omit<ScopeUnitSearch, "cursor">) => [...scopeUnitKeys.all, "list", search] as const,
  ids: (kind: ScopeUnitKind, permission: ScopePickerPermission, ids: readonly string[], universes: readonly string[] | undefined, purpose: ScopeUnitPurpose) => [...scopeUnitKeys.all, "ids", kind, permission, [...ids].sort(), universes ?? null, purpose] as const,
}

/** Opções paginadas por cursor (carregamento progressivo na rolagem). Só busca com o seletor aberto (`enabled`). */
export function useScopeUnitOptions(search: Omit<ScopeUnitSearch, "cursor" | "limit">, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: scopeUnitKeys.list(search),
    queryFn: ({ pageParam, signal }) => fetchScopeUnits({ ...search, cursor: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepSameList(search),
    enabled,
    staleTime: 30_000,
  })
}

/** Escolhas já feitas: nome, Grupo-pai, universo e se ainda têm operador em produção — mesmo fora do lote carregado no seletor. */
export function useScopeUnitsByIds(kind: ScopeUnitKind, permission: ScopePickerPermission, ids: readonly string[], universes?: readonly string[], purpose: ScopeUnitPurpose = "reach") {
  return useQuery({
    queryKey: scopeUnitKeys.ids(kind, permission, ids, universes, purpose),
    queryFn: () => fetchScopeUnitsByIds(kind, permission, ids, universes, purpose),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
