import type { QueryResultRow } from "pg"
import { z } from "zod"
import type { Database } from "../../infrastructure/database/pool.js"

// Filtros e paginação das listagens administrativas.
//
// Cada router mantém o SELECT "base" que já usava (com os joins e json_agg de sempre) e a
// listagem embrulha esse SELECT como subquery `q`, aplicando os filtros sobre as colunas já
// apelidadas ("scopeType", "createdAt", status...). Assim o mesmo SELECT serve para o detalhe,
// para a lista completa (pickers) e para a lista paginada, sem duplicar SQL.
//
// A resposta só vira envelope paginado quando o cliente manda `page` ou `pageSize`; sem eles a
// rota continua devolvendo o array de sempre — é o que os pickers (agente, flag, base...) usam.

export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 20

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number }

export function isPaginatedRequest(query: Record<string, unknown>): boolean {
  return query.page !== undefined || query.pageSize !== undefined
}

// `?x=a&x=b` chega como array e `?x=a,b` como string — os dois viram ["a","b"]. Vazio vira
// undefined para o filtro nem entrar no WHERE.
export function listParam<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined
    const raw = Array.isArray(value) ? value : String(value).split(",")
    const cleaned = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    return cleaned.length ? cleaned : undefined
  }, z.array(item).optional())
}

export const booleanParam = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined
  if (value === "true" || value === true) return true
  if (value === "false" || value === false) return false
  return value
}, z.boolean().optional())

export const searchParam = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length ? value.trim() : undefined),
  z.string().max(200).optional(),
)

// Datas chegam como YYYY-MM-DD; o fim do intervalo é inclusivo (< dia seguinte).
export const dateParam = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length ? value.trim() : undefined),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
)

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// Acumula cláusulas e parâmetros posicionais ($1, $2...) para o WHERE da subquery.
export class SqlFilter {
  private readonly clauses: string[] = []
  readonly params: unknown[]

  constructor(initialParams: unknown[] = []) {
    this.params = [...initialParams]
  }

  param(value: unknown): string {
    this.params.push(value)
    return `$${this.params.length}`
  }

  add(clause: string) {
    this.clauses.push(clause)
    return this
  }

  search(term: string | undefined, columns: string[]) {
    if (!term) return this
    const placeholder = this.param(`%${escapeLike(term)}%`)
    this.add(`(${columns.map((column) => `${column} ilike ${placeholder}`).join(" or ")})`)
    return this
  }

  in(column: string, values: readonly string[] | undefined, cast = "text") {
    if (!values?.length) return this
    this.add(`${column} = any(${this.param(values)}::${cast}[])`)
    return this
  }

  equals(column: string, value: unknown) {
    if (value === undefined) return this
    this.add(`${column} = ${this.param(value)}`)
    return this
  }

  dateRange(column: string, from: string | undefined, to: string | undefined) {
    if (from) this.add(`${column} >= ${this.param(from)}::date`)
    if (to) this.add(`${column} < (${this.param(to)}::date + interval '1 day')`)
    return this
  }

  // Filtro por grupo/subgrupo em entidades com scope_type/team_id/subteam_id próprios:
  // "ALL_TEAMS" traz só as globais; um teamId traz o grupo e seus subgrupos; um subteamId traz
  // só aquele subgrupo.
  orgScope(alias: string, scope: { scopeType?: string | undefined; teamId?: string | undefined; subteamId?: string | undefined }) {
    if (scope.subteamId) this.add(`${alias}."subteamId" = ${this.param(scope.subteamId)}::uuid`)
    else if (scope.teamId) this.add(`${alias}."teamId" = ${this.param(scope.teamId)}::uuid`)
    else if (scope.scopeType === "ALL_TEAMS") this.add(`${alias}."scopeType" = 'ALL_TEAMS'`)
    return this
  }

  where() {
    return this.clauses.length ? ` where ${this.clauses.join(" and ")}` : ""
  }
}

export const orgScopeFilterSchema = z.object({
  scopeType: z.enum(["ALL_TEAMS"]).optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
})

type ListQueryInput = {
  select: string
  filter: SqlFilter
  orderBy: string
}

export function wrapSelect(select: string, filter: SqlFilter) {
  return `from (${select}) q${filter.where()}`
}

export async function queryAll<T extends QueryResultRow>(db: Database, { select, filter, orderBy }: ListQueryInput): Promise<T[]> {
  const result = await db.query<T>(`select q.* ${wrapSelect(select, filter)} order by ${orderBy}`, filter.params)
  return result.rows
}

export async function queryPage<T extends QueryResultRow>(
  db: Database,
  { select, filter, orderBy, page, pageSize }: ListQueryInput & { page: number; pageSize: number },
): Promise<PageResult<T>> {
  const from = wrapSelect(select, filter)
  const count = await db.query<{ total: number }>(`select count(*)::int total ${from}`, filter.params)
  const total = count.rows[0]?.total ?? 0
  const limit = `$${filter.params.length + 1}`
  const offset = `$${filter.params.length + 2}`
  const result = await db.query<T>(`select q.* ${from} order by ${orderBy} limit ${limit} offset ${offset}`, [
    ...filter.params,
    pageSize,
    (page - 1) * pageSize,
  ])
  return { items: result.rows, total, page, pageSize }
}

// Atalho para o padrão de todas as rotas de listagem: sem page/pageSize devolve o array
// completo (compatível com quem já consumia), com eles devolve o envelope paginado.
export async function respondList<T extends QueryResultRow>(
  db: Database,
  query: Record<string, unknown>,
  input: ListQueryInput,
): Promise<T[] | PageResult<T>> {
  if (!isPaginatedRequest(query)) return queryAll<T>(db, input)
  const { page, pageSize } = paginationQuerySchema.parse(query)
  return queryPage<T>(db, { ...input, page, pageSize })
}
