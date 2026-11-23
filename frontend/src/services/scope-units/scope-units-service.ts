import { adminGet } from "@/lib/admin/admin-api"
import { scopeUnitPageSchema, type ScopePickerPermission, type ScopeUnitKind, type ScopeUnitPage } from "@/schemas/scope-units/scope-units.schema"

export type ScopeUnitSearch = {
  kind: ScopeUnitKind
  permission: ScopePickerPermission
  search?: string | undefined
  universes?: readonly string[] | undefined
  teamId?: string | undefined
  cursor?: string | null | undefined
  limit?: number | undefined
}

function queryString(entries: Record<string, string | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) if (value) params.set(key, value)
  return params.toString()
}

/** Uma página de opções elegíveis (busca e filtros no servidor, cursor para a próxima). */
export async function fetchScopeUnits(search: ScopeUnitSearch): Promise<ScopeUnitPage> {
  const query = queryString({
    kind: search.kind,
    permission: search.permission,
    search: search.search?.trim() || undefined,
    universes: search.universes?.length ? search.universes.join(",") : undefined,
    teamId: search.teamId,
    cursor: search.cursor ?? undefined,
    limit: search.limit ? String(search.limit) : undefined,
  })
  return scopeUnitPageSchema.parse(await adminGet(`/api/v1/admin/scope-units?${query}`))
}

/** Teto de vínculos de um conteúdo (o mesmo do servidor: `scopeLinksInputSchema` e o `ids` da rota). */
export const MAX_SCOPE_UNIT_IDS = 300
/** Ids por pedido: a URL fica abaixo do `maxQueryString` padrão do IIS (2048 caracteres, com a vírgula codificada). */
const IDS_PER_REQUEST = 40

/** Nome e elegibilidade de escolhas já salvas (inclusive as que perderam a elegibilidade). Até 300 ids, em pedidos de 40. */
export async function fetchScopeUnitsByIds(kind: ScopeUnitKind, permission: ScopePickerPermission, ids: readonly string[], universes?: readonly string[]): Promise<ScopeUnitPage["items"]> {
  const sorted = [...new Set(ids)].sort().slice(0, MAX_SCOPE_UNIT_IDS)
  if (sorted.length === 0) return []
  const chunks = Array.from({ length: Math.ceil(sorted.length / IDS_PER_REQUEST) }, (_, index) => sorted.slice(index * IDS_PER_REQUEST, (index + 1) * IDS_PER_REQUEST))
  const pages = await Promise.all(chunks.map(async (chunk) => {
    const query = queryString({ kind, permission, ids: chunk.join(","), universes: universes?.length ? universes.join(",") : undefined })
    return scopeUnitPageSchema.parse(await adminGet(`/api/v1/admin/scope-units?${query}`)).items
  }))
  return pages.flat()
}
