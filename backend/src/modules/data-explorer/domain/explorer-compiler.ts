import { escapeLike } from "../../../shared/presentation/list-query.js"
import { DEFAULT_TEXT_MAX_CHARS, ORGANIZATION_COLUMN, type ExplorerColumn } from "./explorer-catalog-types.js"
import type { ExplorerCursor } from "./explorer-cursor.js"
import type { ExplorerCondition, ExplorerFilterNode, ExplorerQuery } from "./explorer-query.js"

/**
 * COMPILADOR: consulta validada → SQL + parâmetros. O texto do SQL só é montado com trechos fixos do catálogo, palavras deste arquivo e marcadores
 * `$n`; nenhum valor do cliente entra no texto. Todas as formas começam por `<organização> = $1`, com o valor vindo da sessão. Saída sempre em
 * texto (`c0, c1…`), para o driver não converter data nem número e nenhum apelido nascer de algo enviado pelo cliente.
 */
class Params {
  readonly values: unknown[] = []
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

const SQL_CAST: Record<ExplorerColumn["type"], string> = { TEXT: "text", ENUM: "text", NUMBER: "numeric", DATE: "date", DATETIME: "timestamptz", TIME: "time", MONTH: "text", BOOLEAN: "boolean", UUID: "uuid" }

const startOfDay = (param: string, timeZoneParam: string) => `((${param}::date)::timestamp at time zone ${timeZoneParam})`
const startOfNextDay = (param: string, timeZoneParam: string) => `((${param}::date + 1)::timestamp at time zone ${timeZoneParam})`

const isEmptinessCheck = (condition: ExplorerCondition): condition is Extract<ExplorerCondition, { operator: "IS_EMPTY" | "IS_NOT_EMPTY" }> => condition.operator === "IS_EMPTY" || condition.operator === "IS_NOT_EMPTY"

function compileCondition(condition: ExplorerCondition, params: Params, timeZone: string): string {
  const { column } = condition
  const sql = column.sql
  const cast = SQL_CAST[column.type]

  if (isEmptinessCheck(condition)) {
    if (condition.operator === "IS_EMPTY") return column.type === "TEXT" ? `(${sql} is null or ${sql} = '')` : `${sql} is null`
    return column.type === "TEXT" ? `(${sql} is not null and ${sql} <> '')` : `${sql} is not null`
  }
  if (condition.operator === "IN") return `${sql} = any(${params.add(condition.values)}::${cast}[])`

  // DATETIME recebe o dia civil no fuso da organização e vira intervalo de instantes: `EQ` é o dia inteiro e `LTE` inclui o dia informado.
  if (column.type === "DATETIME") {
    const zone = () => params.add(timeZone)
    if (condition.operator === "BETWEEN") return `(${sql} >= ${startOfDay(params.add(condition.from), zone())} and ${sql} < ${startOfNextDay(params.add(condition.to), zone())})`
    if (condition.operator === "GTE") return `${sql} >= ${startOfDay(params.add(condition.value), zone())}`
    if (condition.operator === "LTE") return `${sql} < ${startOfNextDay(params.add(condition.value), zone())}`
    if (condition.operator === "EQ") return `(${sql} >= ${startOfDay(params.add(condition.value), zone())} and ${sql} < ${startOfNextDay(params.add(condition.value), zone())})`
  }

  if (condition.operator === "BETWEEN") return `${sql} between ${params.add(condition.from)}::${cast} and ${params.add(condition.to)}::${cast}`
  const placeholder = `${params.add(condition.value)}::${cast}`
  switch (condition.operator) {
    case "EQ":
      return `${sql} = ${placeholder}`
    case "NEQ":
      // "diferente" não exclui quem está vazio: é o que a pessoa espera ao ler a tabela.
      return `${sql} is distinct from ${placeholder}`
    case "GT":
      return `${sql} > ${placeholder}`
    case "GTE":
      return `${sql} >= ${placeholder}`
    case "LT":
      return `${sql} < ${placeholder}`
    case "LTE":
      return `${sql} <= ${placeholder}`
  }
}

function compileNode(node: ExplorerFilterNode, params: Params, timeZone: string): string {
  if (node.type === "condition") return compileCondition(node, params, timeZone)
  const joiner = node.logic === "AND" ? " and " : " or "
  return `(${node.children.map((child) => compileNode(child, params, timeZone)).join(joiner)})`
}

function compileSearch(search: NonNullable<ExplorerQuery["search"]>, params: Params): string {
  let contains: string | undefined
  let exact: string | undefined
  const parts = search.columns.map((column) => {
    if (column.search === "CONTAINS") {
      contains ??= params.add(`%${escapeLike(search.term)}%`)
      return `${column.sql} ilike ${contains}`
    }
    exact ??= params.add(search.term)
    return `${column.sql} = ${exact}::text`
  })
  return `(${parts.join(" or ")})`
}

function whereClause(query: ExplorerQuery, organizationId: string, params: Params, timeZone: string): string[] {
  const clauses = [`${ORGANIZATION_COLUMN} = ${params.add(organizationId)}::uuid`]
  if (query.filter) clauses.push(compileNode(query.filter, params, timeZone))
  if (query.search) clauses.push(compileSearch(query.search, params))
  if (query.recordStatus === "ACTIVE") clauses.push("t.cancelled_at is null")
  if (query.recordStatus === "CANCELLED") clauses.push("t.cancelled_at is not null")
  return clauses
}

/** Saída em texto. Instante vai em UTC (ISO); texto respeita o teto de caracteres da coluna. */
function outputExpression(column: ExplorerColumn): string {
  if (column.type === "DATETIME") return `to_char(${column.sql} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  if (column.type === "TEXT") return `left((${column.sql})::text, ${column.maxChars ?? DEFAULT_TEXT_MAX_CHARS})`
  return `(${column.sql})::text`
}

/**
 * Posição da página. Usa a ordem padrão de nulos do PostgreSQL (ASC: por último; DESC: primeiro), a única que um índice comum consegue devolver sem
 * ordenar de novo. Coluna obrigatória compara por linha, o que o índice resolve; coluna que aceita vazio precisa dos dois ramos e só existe em
 * conjuntos pequenos (conferido em `explorer-catalog.test.ts`).
 */
function keysetClause(query: ExplorerQuery, cursor: ExplorerCursor, params: Params): string {
  const { column, direction } = query.sort
  const key = query.dataset.key
  const sql = column.sql
  const cast = SQL_CAST[column.type]
  const comparison = direction === "ASC" ? ">" : "<"
  const keyParam = `${params.add(cursor.key)}::${key.cast}`
  if (cursor.sort === null) return direction === "ASC" ? `(${sql} is null and ${key.sql} > ${keyParam})` : `((${sql} is null and ${key.sql} < ${keyParam}) or ${sql} is not null)`
  const sortParam = `${params.add(cursor.sort)}::${cast}`
  const pastCursor = `(${sql}, ${key.sql}) ${comparison} (${sortParam}, ${keyParam})`
  if (!column.nullable) return pastCursor
  return direction === "ASC" ? `(${pastCursor} or ${sql} is null)` : pastCursor
}

export type CompiledSql = { sql: string; params: unknown[] }

const orderBy = (query: ExplorerQuery) => `order by ${query.sort.column.sql} ${query.sort.direction === "ASC" ? "asc" : "desc"}, ${query.dataset.key.sql} ${query.sort.direction === "ASC" ? "asc" : "desc"}`

const selectList = (query: ExplorerQuery) => query.columns.map((column, index) => `${outputExpression(column)} as c${index}`).join(", ")

export const SORT_ALIAS = "__sort"
export const KEY_ALIAS = "__key"
export const CANCELLED_ALIAS = "__cancelled"

export function compilePageQuery(query: ExplorerQuery, input: { organizationId: string; timeZone: string; pageSize: number; cursor: ExplorerCursor | null }): CompiledSql {
  const params = new Params()
  const clauses = whereClause(query, input.organizationId, params, input.timeZone)
  if (input.cursor) clauses.push(keysetClause(query, input.cursor, params))
  const limit = params.add(input.pageSize + 1)
  return {
    sql: `select ${selectList(query)}, (${query.sort.column.sql})::text as ${SORT_ALIAS}, (${query.dataset.key.sql})::text as ${KEY_ALIAS}${query.dataset.cancellation ? `, (t.cancelled_at is not null) as ${CANCELLED_ALIAS}` : ""} from ${query.dataset.from} where ${clauses.join(" and ")} ${orderBy(query)} limit ${limit}::int`,
    params: params.values,
  }
}

/** Contagem com teto: lê no máximo `cap + 1` linhas e para. Nunca varre o resultado inteiro. */
export function compileCountQuery(query: ExplorerQuery, input: { organizationId: string; timeZone: string; cap: number }): CompiledSql {
  const params = new Params()
  const clauses = whereClause(query, input.organizationId, params, input.timeZone)
  const limit = params.add(input.cap + 1)
  return { sql: `select count(*)::int as total from (select 1 from ${query.dataset.from} where ${clauses.join(" and ")} limit ${limit}::int) capped`, params: params.values }
}

/** Corpo da exportação (para o `DECLARE CURSOR`): sem posição e com teto de linhas no próprio SQL. */
export function compileExportQuery(query: ExplorerQuery, input: { organizationId: string; timeZone: string; maxRows: number }): CompiledSql {
  const params = new Params()
  const clauses = whereClause(query, input.organizationId, params, input.timeZone)
  const limit = params.add(input.maxRows)
  return { sql: `select ${selectList(query)} from ${query.dataset.from} where ${clauses.join(" and ")} ${orderBy(query)} limit ${limit}::int`, params: params.values }
}

/**
 * Registros ATIVOS que um cancelamento alcançaria: os escolhidos na tela (`keys`) ou os dos filtros, sempre da organização da sessão. Lê no máximo `cap + 1`, para
 * recusar o que passa do limite sem varrer tudo. `lock` trava as linhas até o fim da transação, então o que foi contado é o que será cancelado.
 */
export function compileCancellationScope(query: ExplorerQuery, input: { organizationId: string; timeZone: string; cap: number; keys: readonly string[] | null; lock: boolean }): CompiledSql {
  const params = new Params()
  const clauses = input.keys ? [`${ORGANIZATION_COLUMN} = ${params.add(input.organizationId)}::uuid`, `${query.dataset.key.sql} = any(${params.add(input.keys)}::uuid[])`] : whereClause(query, input.organizationId, params, input.timeZone)
  clauses.push("t.cancelled_at is null")
  const limit = params.add(input.cap + 1)
  return { sql: `select (${query.dataset.key.sql})::text as id from ${query.dataset.from} where ${clauses.join(" and ")} limit ${limit}::int${input.lock ? " for update of t" : ""}`, params: params.values }
}
