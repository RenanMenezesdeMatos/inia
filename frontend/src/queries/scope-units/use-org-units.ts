import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"

import type { ScopePickerPermission, ScopeUnitKind, ScopeUnitOption, ScopeUnitPurpose } from "@/schemas/scope-units/scope-units.schema"
import { fetchScopeUnits, fetchScopeUnitsByIds } from "@/services/scope-units/scope-units-service"
import { fetchScopedOptions, fetchScopedOptionsByIds, type ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"

import { keepSameList } from "./keep-same-list"

/**
 * De onde vêm os Grupos e Subgrupos de um campo: a permissão da tela (rota de alcance `/admin/scope-units`, Administração) ou a rota de
 * opções da própria tela (telas de acompanhamento, no alcance de quem vê).
 */
export type OrgUnitSource = ScopePickerPermission | ScopedOptionsSource
/** `manageable` só vem da rota de alcance: a conta administra a unidade inteira. */
export type OrgUnit = Pick<ScopeUnitOption, "kind" | "id" | "name" | "teamId" | "teamName" | "operatingUniverse"> & { manageable?: boolean }
export type OrgUnitSearch = { kind: ScopeUnitKind; search?: string | undefined; universes?: readonly string[] | undefined; purpose?: ScopeUnitPurpose | undefined; eligibility?: "production" | "all" | undefined; teamId?: string | undefined; withinTeamIds?: readonly string[] | undefined }

const PAGE_SIZE = 30

async function fetchUnits(source: OrgUnitSource, search: OrgUnitSearch, cursor: string | null, signal?: AbortSignal): Promise<{ items: OrgUnit[]; nextCursor: string | null }> {
  if (typeof source === "string") return fetchScopeUnits({ ...search, permission: source, cursor, limit: PAGE_SIZE }, signal)
  const page = await fetchScopedOptions(source, { kind: search.kind, search: search.search, teamId: search.withinTeamIds ?? search.teamId, cursor, limit: PAGE_SIZE }, signal)
  return { items: page.items.map((item) => ({ ...item, kind: search.kind })), nextCursor: page.nextCursor }
}

/** Grupos ou Subgrupos em lotes (cursor). Só busca com o seletor aberto (`enabled`). */
export function useOrgUnitOptions(source: OrgUnitSource, search: OrgUnitSearch, enabled: boolean) {
  const key = { source, ...search }
  return useInfiniteQuery({
    queryKey: ["org-units", "list", key],
    queryFn: ({ pageParam, signal }) => fetchUnits(source, search, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepSameList(key),
    enabled,
    staleTime: 30_000,
  })
}

const unitsByIdsKey = (source: OrgUnitSource, kind: ScopeUnitKind, ids: readonly string[], purpose: ScopeUnitPurpose) => ["org-units", "ids", source, kind, [...ids].sort(), purpose] as const

/** Guarda a opção recém-escolhida, para o nome dela aparecer no gatilho sem esperar a consulta por id. */
export function useRememberOrgUnit(source: OrgUnitSource, purpose: ScopeUnitPurpose) {
  const client = useQueryClient()
  return (unit: OrgUnit) => client.setQueryData(unitsByIdsKey(source, unit.kind, [unit.id], purpose), [unit])
}

/** O mesmo na escolha múltipla: a nova escolha inteira, quando já se conhece cada item dela. */
export function useRememberOrgUnits(source: OrgUnitSource) {
  const client = useQueryClient()
  return (kind: ScopeUnitKind, ids: readonly string[], units: readonly OrgUnit[]) => {
    if (ids.length > 0 && ids.every((id) => units.some((unit) => unit.id === id))) client.setQueryData(unitsByIdsKey(source, kind, ids, "filter"), [...units])
  }
}

/** Escolhas já feitas, mesmo fora do lote carregado. */
export function useOrgUnitsByIds(source: OrgUnitSource, kind: ScopeUnitKind, ids: readonly string[], purpose: ScopeUnitPurpose) {
  return useQuery({
    queryKey: unitsByIdsKey(source, kind, ids, purpose),
    queryFn: async (): Promise<OrgUnit[]> => {
      if (typeof source === "string") return fetchScopeUnitsByIds(kind, source, ids, undefined, purpose)
      return (await fetchScopedOptionsByIds(source, kind, ids)).map((item) => ({ ...item, kind }))
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
