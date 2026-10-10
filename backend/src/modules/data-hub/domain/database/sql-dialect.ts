import type { DatabaseColumn } from "./column-types.js"
import type { DatabaseEngine } from "./database-engine.js"

/**
 * SQL que a INIA envia a um banco EXTERNO — sempre gerado aqui, nunca digitado pelo usuário:
 *  - só SELECT (catálogo, amostra, páginas);
 *  - identificadores (esquema, tabela/visão, colunas) vêm da descoberta do próprio banco e entram entre os
 *    delimitadores do dialeto, com o delimitador duplicado;
 *  - valores (busca, posição do checkpoint) entram SEMPRE como parâmetros; números de limite são inteiros
 *    validados aqui.
 * Paginação por chave (keyset): `ORDER BY` pelas colunas nativas e posição do checkpoint em TEXTO exato,
 * lido do próprio banco (`__inia_p{i}`) — devolvido como parâmetro na próxima página sem passar por tipo do
 * JavaScript (nada de perder microssegundos de um datetime2 e reler/saltar linhas).
 */
export type DatabaseObjectRef = { schema: string; name: string }
export type DatabaseObjectKind = "TABLE" | "VIEW"
export type SqlParam = string | number | null
export type SqlStatement = { sql: string; params: SqlParam[] }

export const POSITION_ALIAS_PREFIX = "__inia_p"
export const positionAlias = (index: number) => `${POSITION_ALIAS_PREFIX}${index}`

export const MAX_IDENTIFIER_LENGTH = 128

export function assertIdentifier(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_IDENTIFIER_LENGTH || name.includes("\u0000")) throw new Error(`Identificador inválido: ${JSON.stringify(String(name).slice(0, 40))}`)
  return name
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Limite inválido: ${value}`)
  return value
}

export type PageQuery = {
  object: DatabaseObjectRef
  /** Colunas devolvidas (já filtradas para as suportadas). */
  select: DatabaseColumn[]
  /** Colunas de ordenação (campo de atualização + chaves, ou só chaves). */
  order: DatabaseColumn[]
  /** Posição exclusiva: linhas DEPOIS desta tupla (texto exato de cada coluna de ordenação). */
  after?: string[] | null
  /** Janela de releitura: primeira coluna de ordenação `>=` este valor (incremental com releitura). */
  atOrAfterFirst?: string | null
  /** Busca de um grupo de empate: tupla exatamente igual. */
  equalTo?: string[] | null
  limit: number
}

abstract class BaseDialect {
  abstract readonly family: "POSTGRESQL" | "SQLSERVER" | "MYSQL"
  abstract quote(identifier: string): string
  /** Placeholder do parâmetro de índice `index` (1-based) para comparar com `column`. */
  protected abstract placeholder(index: number, column: DatabaseColumn | null): string
  /** Expressão que devolve o valor EXATO da coluna como texto (posição do checkpoint). */
  abstract textOf(column: DatabaseColumn): string
  abstract listObjects(search: string | null, limit: number): SqlStatement
  abstract objectInfo(object: DatabaseObjectRef): SqlStatement
  abstract describeColumns(object: DatabaseObjectRef): SqlStatement
  protected abstract limited(selectList: string, from: string, where: string | null, orderBy: string | null, limit: number): string

  qualify(object: DatabaseObjectRef): string {
    return `${this.quote(object.schema)}.${this.quote(object.name)}`
  }

  sample(object: DatabaseObjectRef, columns: DatabaseColumn[], limit: number): SqlStatement {
    if (columns.length === 0) throw new Error("Nenhuma coluna suportada para ler.")
    return { sql: this.limited(columns.map((column) => this.quote(column.name)).join(", "), this.qualify(object), null, null, integer(limit, 1, 1_000)), params: [] }
  }

  page(query: PageQuery): SqlStatement {
    if (query.select.length === 0) throw new Error("Nenhuma coluna suportada para ler.")
    const params: SqlParam[] = []
    const bind = (value: string, column: DatabaseColumn) => {
      params.push(value)
      return this.placeholder(params.length, column)
    }
    const order = query.order
    const selectList = [
      ...query.select.map((column) => this.quote(column.name)),
      ...order.map((column, index) => `${this.textOf(column)} AS ${this.quote(positionAlias(index))}`),
    ].join(", ")
    const conditions: string[] = order.map((column) => `${this.quote(column.name)} IS NOT NULL`)
    if (query.equalTo) {
      if (query.equalTo.length !== order.length) throw new Error("Tupla de empate incompatível com a ordenação.")
      order.forEach((column, index) => conditions.push(`${this.quote(column.name)} = ${bind(query.equalTo![index]!, column)}`))
    } else if (query.after) {
      if (query.after.length !== order.length) throw new Error("Posição do checkpoint incompatível com a ordenação.")
      conditions.push(this.tupleAfter(order, query.after, bind))
    } else if (query.atOrAfterFirst !== undefined && query.atOrAfterFirst !== null && order[0]) {
      conditions.push(`${this.quote(order[0].name)} >= ${bind(query.atOrAfterFirst, order[0])}`)
    }
    const orderBy = order.length > 0 ? order.map((column) => this.quote(column.name)).join(", ") : null
    return { sql: this.limited(selectList, this.qualify(query.object), conditions.length ? conditions.join(" AND ") : null, orderBy, integer(query.limit, 1, 1_000_001)), params }
  }

  /** (c0 > v0) OR (c0 = v0 AND ((c1 > v1) OR (c1 = v1 AND …))) — forma expandida, aceita pelos três dialetos. */
  private tupleAfter(columns: DatabaseColumn[], values: string[], bind: (value: string, column: DatabaseColumn) => string): string {
    const [column, ...rest] = columns
    const [value, ...restValues] = values
    const greater = `${this.quote(column!.name)} > ${bind(value!, column!)}`
    if (rest.length === 0) return `(${greater})`
    return `(${greater} OR (${this.quote(column!.name)} = ${bind(value!, column!)} AND ${this.tupleAfter(rest, restValues, bind)}))`
  }
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------
class PostgresDialect extends BaseDialect {
  readonly family = "POSTGRESQL" as const

  quote(identifier: string): string {
    return `"${assertIdentifier(identifier).replace(/"/g, '""')}"`
  }

  // Parâmetro sem tipo: o servidor infere o tipo da coluna comparada — o texto exato vira o valor exato.
  protected placeholder(index: number): string {
    return `$${index}`
  }

  textOf(column: DatabaseColumn): string {
    return `(${this.quote(column.name)})::text`
  }

  protected limited(selectList: string, from: string, where: string | null, orderBy: string | null, limit: number): string {
    return `SELECT ${selectList} FROM ${from}${where ? ` WHERE ${where}` : ""}${orderBy ? ` ORDER BY ${orderBy}` : ""} LIMIT ${limit}`
  }

  listObjects(search: string | null, limit: number): SqlStatement {
    return {
      sql: `SELECT n.nspname AS schema_name, c.relname AS object_name,
               CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'TABLE' END AS object_kind,
               CASE WHEN c.relkind IN ('r', 'p') AND c.reltuples >= 0 THEN c.reltuples::bigint END AS estimated_rows
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND NOT c.relispartition
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
               AND has_schema_privilege(n.oid, 'USAGE')
               AND has_table_privilege(c.oid, 'SELECT')
               AND ($1::text IS NULL OR position(lower($1::text) in lower(n.nspname || '.' || c.relname)) > 0)
             ORDER BY 1, 2
             LIMIT ${integer(limit, 1, 10_000)}`,
      params: [search],
    }
  }

  objectInfo(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'TABLE' END AS object_kind,
               (has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')) AS can_select
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
      params: [object.schema, object.name],
    }
  }

  describeColumns(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT a.attname AS column_name,
               format_type(CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE a.atttypid END, CASE WHEN t.typtype = 'd' THEN t.typtypmod ELSE a.atttypmod END) AS native_type,
               t.typtype AS typtype,
               NOT a.attnotnull AS nullable,
               (SELECT k.ordinality FROM pg_catalog.pg_index i, unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
                 WHERE i.indrelid = c.oid AND i.indisprimary AND k.attnum = a.attnum) AS pk_position
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
             WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
               AND has_column_privilege(c.oid, a.attnum, 'SELECT')
             ORDER BY a.attnum`,
      params: [object.schema, object.name],
    }
  }
}

// ---------------------------------------------------------------------------------------------
// SQL Server
// ---------------------------------------------------------------------------------------------
const SQLSERVER_DATETIME_TYPES = new Set(["date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time"])

class SqlServerDialect extends BaseDialect {
  readonly family = "SQLSERVER" as const

  quote(identifier: string): string {
    return `[${assertIdentifier(identifier).replace(/]/g, "]]")}]`
  }

  // O parâmetro chega como nvarchar e é convertido EXPLICITAMENTE para o tipo exato da coluna — a comparação
  // segue o tipo e o collation da coluna (nunca a conversão implícita nvarchar × varchar).
  protected placeholder(index: number, column: DatabaseColumn | null): string {
    if (!column) return `@p${index}`
    if (!column.castType) throw new Error(`A coluna "${column.name}" não pode ser usada na ordenação (tipo ${column.nativeType}).`)
    return `CAST(@p${index} AS ${column.castType})`
  }

  textOf(column: DatabaseColumn): string {
    const base = column.nativeType.toLowerCase().replace(/\(.*$/, "")
    if (SQLSERVER_DATETIME_TYPES.has(base)) return `CONVERT(nvarchar(64), ${this.quote(column.name)}, 126)`
    return `CAST(${this.quote(column.name)} AS nvarchar(450))`
  }

  protected limited(selectList: string, from: string, where: string | null, orderBy: string | null, limit: number): string {
    return `SELECT TOP (${limit}) ${selectList} FROM ${from}${where ? ` WHERE ${where}` : ""}${orderBy ? ` ORDER BY ${orderBy}` : ""}`
  }

  listObjects(search: string | null, limit: number): SqlStatement {
    return {
      sql: `SELECT TOP (${integer(limit, 1, 10_000)}) s.name AS schema_name, o.name AS object_name,
               CASE o.type WHEN 'V' THEN 'VIEW' ELSE 'TABLE' END AS object_kind,
               (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS estimated_rows
             FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
               AND HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1
               AND (@p1 IS NULL OR CHARINDEX(LOWER(@p1), LOWER(s.name + '.' + o.name)) > 0)
             ORDER BY s.name, o.name`,
      params: [search],
    }
  }

  objectInfo(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT CASE o.type WHEN 'V' THEN 'VIEW' ELSE 'TABLE' END AS object_kind,
               CAST(CASE WHEN HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1 THEN 1 ELSE 0 END AS bit) AS can_select
             FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
             WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')`,
      params: [object.schema, object.name],
    }
  }

  describeColumns(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT c.name AS column_name, TYPE_NAME(c.system_type_id) AS type_name, c.max_length, c.precision, c.scale,
               CAST(c.is_nullable AS bit) AS nullable, pk.key_ordinal AS pk_position
             FROM sys.columns c
             JOIN sys.objects o ON o.object_id = c.object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
             LEFT JOIN (
               SELECT ic.object_id, ic.column_id, ic.key_ordinal
               FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
               WHERE i.is_primary_key = 1
             ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
             WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')
               AND HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT', c.name, 'COLUMN') = 1
             ORDER BY c.column_id`,
      params: [object.schema, object.name],
    }
  }
}

// ---------------------------------------------------------------------------------------------
// MySQL / MariaDB
// ---------------------------------------------------------------------------------------------
class MySqlDialect extends BaseDialect {
  readonly family = "MYSQL" as const

  quote(identifier: string): string {
    return `\`${assertIdentifier(identifier).replace(/`/g, "``")}\``
  }

  protected placeholder(): string {
    return "?"
  }

  textOf(column: DatabaseColumn): string {
    return `CAST(${this.quote(column.name)} AS CHAR)`
  }

  protected limited(selectList: string, from: string, where: string | null, orderBy: string | null, limit: number): string {
    return `SELECT ${selectList} FROM ${from}${where ? ` WHERE ${where}` : ""}${orderBy ? ` ORDER BY ${orderBy}` : ""} LIMIT ${limit}`
  }

  listObjects(search: string | null, limit: number): SqlStatement {
    return {
      sql: `SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS object_name,
               CASE WHEN TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS object_kind,
               CASE WHEN TABLE_TYPE = 'VIEW' THEN NULL ELSE TABLE_ROWS END AS estimated_rows
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
               AND TABLE_TYPE IN ('BASE TABLE', 'VIEW', 'SYSTEM VERSIONED')
               AND (? IS NULL OR LOCATE(LOWER(?), LOWER(CONCAT(TABLE_SCHEMA, '.', TABLE_NAME))) > 0)
             ORDER BY 1, 2
             LIMIT ${integer(limit, 1, 10_000)}`,
      params: [search, search],
    }
  }

  // information_schema só mostra objetos em que o usuário tem algum privilégio; a leitura em si é confirmada
  // pela amostra (sem permissão de SELECT o servidor recusa com erro de permissão).
  objectInfo(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT CASE WHEN TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS object_kind, 1 AS can_select
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      params: [object.schema, object.name],
    }
  }

  describeColumns(object: DatabaseObjectRef): SqlStatement {
    return {
      sql: `SELECT c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.COLUMN_TYPE AS column_type,
               CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
               (SELECT k.ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE k
                 WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY') AS pk_position
             FROM information_schema.COLUMNS c
             WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
             ORDER BY c.ORDINAL_POSITION`,
      params: [object.schema, object.name],
    }
  }
}

const POSTGRES = new PostgresDialect()
const SQLSERVER = new SqlServerDialect()
const MYSQL = new MySqlDialect()

export type SqlDialect = BaseDialect

export function dialectFor(engine: DatabaseEngine): SqlDialect {
  switch (engine) {
    case "POSTGRESQL":
      return POSTGRES
    case "SQLSERVER":
      return SQLSERVER
    case "MARIADB":
    case "MYSQL":
      return MYSQL
  }
}
