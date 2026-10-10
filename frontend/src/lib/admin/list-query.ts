import { z } from "zod"

// Contrato compartilhado das listagens administrativas paginadas — espelha o envelope que o
// backend devolve quando recebe `page`/`pageSize` (ver backend/src/shared/presentation/list-query.ts).

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number }

export function pageResultSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
}

export type ListParams = { page: number; pageSize: number; search?: string }

// Filtro por grupo/subgrupo: sem nada = qualquer grupo; ALL_TEAMS = só registros globais;
// teamId = grupo (e seus subgrupos); subteamId = só aquele subgrupo.
export type OrgScopeFilter = { scopeType?: "ALL_TEAMS"; teamId?: string; subteamId?: string }
export type SubjectScopeFilter = { subjectScopeType?: "ALL_SUBJECTS"; subjectId?: string }

// Datas sempre como YYYY-MM-DD (o backend trata o fim como inclusivo).
export type DateRangeFilter = { from?: string; to?: string }

export type ListQueryValue = string | number | boolean | readonly string[] | null | undefined

// Monta a query string ignorando valores vazios; arrays viram chaves repetidas (`?x=a&x=b`).
export function toQueryString(params: Record<string, ListQueryValue>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, String(entry))
      continue
    }
    query.set(key, String(value))
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ""
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}
