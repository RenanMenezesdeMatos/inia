import { adminGet } from "@/lib/admin/admin-api"
import { toQueryString } from "@/lib/admin/list-query"
import { scopedOptionPageSchema, type ScopedOptionKind, type ScopedOptionPage } from "@/schemas/scope-units/scoped-options.schema"

/** Rota de opções de uma tela (o alcance é o da própria rota) e os parâmetros fixos dela (ex.: a estrutura vista). */
export type ScopedOptionsSource = { path: string; params?: Record<string, string | undefined> | undefined }

export type ScopedOptionsSearch = { kind: ScopedOptionKind; search?: string | undefined; teamId?: string | readonly string[] | undefined; subteamId?: string | readonly string[] | undefined; cursor?: string | null | undefined; limit?: number | undefined }

/** Ids por pedido: a URL fica abaixo do `maxQueryString` padrão do IIS. */
const IDS_PER_REQUEST = 40

export async function fetchScopedOptions(source: ScopedOptionsSource, search: ScopedOptionsSearch, signal?: AbortSignal): Promise<ScopedOptionPage> {
  return scopedOptionPageSchema.parse(await adminGet(`${source.path}${toQueryString({ ...source.params, ...search, search: search.search?.trim() })}`, signal))
}

/** Escolhas já feitas (nome, Grupo de origem), mesmo fora do lote carregado; fora do alcance não voltam. */
export async function fetchScopedOptionsByIds(source: ScopedOptionsSource, kind: ScopedOptionKind, ids: readonly string[]): Promise<ScopedOptionPage["items"]> {
  const sorted = [...new Set(ids)].sort()
  const chunks = Array.from({ length: Math.ceil(sorted.length / IDS_PER_REQUEST) }, (_, index) => sorted.slice(index * IDS_PER_REQUEST, (index + 1) * IDS_PER_REQUEST))
  const pages = await Promise.all(chunks.map(async (chunk) => scopedOptionPageSchema.parse(await adminGet(`${source.path}${toQueryString({ ...source.params, kind, ids: chunk.join(",") })}`)).items))
  return pages.flat()
}
