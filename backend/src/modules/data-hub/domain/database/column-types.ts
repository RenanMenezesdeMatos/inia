/**
 * Categoria de uma coluna do banco externo — o que a INIA sabe fazer com ela. Vem SEMPRE do catálogo do próprio
 * banco (descrição ao vivo), nunca do navegador: é daqui que saem a lista de colunas da amostra, quais servem de
 * campo de atualização/chave e o tipo usado nas comparações do checkpoint.
 */
export const COLUMN_CATEGORIES = ["INTEGER", "DECIMAL", "FLOAT", "BOOLEAN", "DATE", "DATETIME", "DATETIME_TZ", "TIME", "TEXT", "UUID", "JSON", "BINARY", "OTHER"] as const
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number]

export type DatabaseColumn = {
  name: string
  nativeType: string
  category: ColumnCategory
  nullable: boolean
  /** Posição na chave primária (1..n) ou null. Visões não têm. */
  primaryKeyPosition: number | null
  /** A coluna entra na amostra/importação (binários e tipos exóticos ficam de fora). */
  supported: boolean
  /** Serve de campo de atualização (cursor) do incremental: ordenável, comparável e exato. */
  cursorEligible: boolean
  /** Serve de chave de ordenação/desempate. */
  keyEligible: boolean
  /** SQL Server: tipo exato da coluna para `CAST(@p AS …)` nas comparações do checkpoint (montado do catálogo, nunca do usuário). */
  castType: string | null
}

const CURSOR_CATEGORIES: ReadonlySet<ColumnCategory> = new Set(["INTEGER", "DECIMAL", "DATE", "DATETIME", "DATETIME_TZ"])
const KEY_CATEGORIES: ReadonlySet<ColumnCategory> = new Set(["INTEGER", "DECIMAL", "DATE", "DATETIME", "DATETIME_TZ", "TEXT", "UUID"])
const UNSUPPORTED: ReadonlySet<ColumnCategory> = new Set(["BINARY", "OTHER"])

function column(input: { name: string; nativeType: string; category: ColumnCategory; nullable: boolean; primaryKeyPosition: number | null; orderable?: boolean; castType?: string | null }): DatabaseColumn {
  const orderable = input.orderable ?? true
  return {
    name: input.name,
    nativeType: input.nativeType,
    category: input.category,
    nullable: input.nullable,
    primaryKeyPosition: input.primaryKeyPosition,
    supported: !UNSUPPORTED.has(input.category),
    cursorEligible: orderable && CURSOR_CATEGORIES.has(input.category),
    keyEligible: orderable && KEY_CATEGORIES.has(input.category),
    castType: input.castType ?? null,
  }
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL — `format_type()` do catálogo (ex.: "timestamp(3) without time zone", "numeric(10,2)").
// ---------------------------------------------------------------------------------------------
export function postgresCategory(nativeType: string, typtype: string | null): ColumnCategory {
  const type = nativeType.toLowerCase()
  if (type.endsWith("[]")) return "OTHER"
  if (typtype === "e") return "TEXT"
  if (/^(smallint|integer|bigint|smallserial|serial|bigserial)$/.test(type)) return "INTEGER"
  if (/^(numeric|decimal)(\(|$)/.test(type) || type === "money") return "DECIMAL"
  if (type === "real" || type === "double precision") return "FLOAT"
  if (type === "boolean") return "BOOLEAN"
  if (type === "date") return "DATE"
  if (/^timestamp(\(\d\))? without time zone$/.test(type)) return "DATETIME"
  if (/^timestamp(\(\d\))? with time zone$/.test(type)) return "DATETIME_TZ"
  if (/^time(\(\d\))? (with|without) time zone$/.test(type)) return "TIME"
  if (/^(character varying|varchar|character|char|text|citext|name)(\(|$)/.test(type) || type === '"char"') return "TEXT"
  if (type === "uuid") return "UUID"
  if (type === "json" || type === "jsonb") return "JSON"
  if (type === "bytea") return "BINARY"
  if (type === "inet" || type === "cidr" || type === "interval" || type === "xml") return "TEXT"
  return "OTHER"
}

export function postgresColumn(row: { name: string; nativeType: string; typtype: string | null; nullable: boolean; primaryKeyPosition: number | null }): DatabaseColumn {
  const category = postgresCategory(row.nativeType, row.typtype)
  // citext/name/enum ordenam pela regra do próprio tipo — ok como chave; interval/xml/inet não são chave.
  const orderable = !/^(interval|xml|inet|cidr|money)$/.test(row.nativeType.toLowerCase())
  return column({ ...row, category, orderable })
}

// ---------------------------------------------------------------------------------------------
// SQL Server — `TYPE_NAME(system_type_id)` + max_length/precision/scale de sys.columns.
// ---------------------------------------------------------------------------------------------
const SQLSERVER_SIMPLE: Record<string, ColumnCategory> = {
  tinyint: "INTEGER",
  smallint: "INTEGER",
  int: "INTEGER",
  bigint: "INTEGER",
  decimal: "DECIMAL",
  numeric: "DECIMAL",
  money: "DECIMAL",
  smallmoney: "DECIMAL",
  float: "FLOAT",
  real: "FLOAT",
  bit: "BOOLEAN",
  date: "DATE",
  datetime: "DATETIME",
  datetime2: "DATETIME",
  smalldatetime: "DATETIME",
  datetimeoffset: "DATETIME_TZ",
  time: "TIME",
  char: "TEXT",
  varchar: "TEXT",
  nchar: "TEXT",
  nvarchar: "TEXT",
  text: "TEXT",
  ntext: "TEXT",
  xml: "TEXT",
  uniqueidentifier: "UUID",
  binary: "BINARY",
  varbinary: "BINARY",
  image: "BINARY",
  timestamp: "BINARY",
  rowversion: "BINARY",
}

/** Tipo exato para `CAST(@p AS …)` — só a partir de números do catálogo e de nomes da lista acima. */
export function sqlServerCastType(typeName: string, maxLength: number, precision: number, scale: number): string | null {
  const type = typeName.toLowerCase()
  if (!(type in SQLSERVER_SIMPLE)) return null
  const n = (value: number) => (Number.isInteger(value) && value >= 0 && value <= 8000 ? value : null)
  switch (type) {
    case "decimal":
    case "numeric":
      return n(precision) !== null && n(scale) !== null ? `${type}(${precision},${scale})` : null
    case "datetime2":
    case "datetimeoffset":
    case "time":
      return n(scale) !== null ? `${type}(${scale})` : null
    case "varchar":
    case "char":
      return maxLength === -1 ? `${type}(max)` : n(maxLength) !== null ? `${type}(${maxLength})` : null
    case "nvarchar":
    case "nchar":
      return maxLength === -1 ? `${type}(max)` : n(maxLength) !== null ? `${type}(${maxLength / 2})` : null
    default:
      return type
  }
}

export function sqlServerColumn(row: { name: string; typeName: string; maxLength: number; precision: number; scale: number; nullable: boolean; primaryKeyPosition: number | null }): DatabaseColumn {
  const type = row.typeName.toLowerCase()
  const category = SQLSERVER_SIMPLE[type] ?? "OTHER"
  // text/ntext/xml e (n)varchar(max) não podem ser ordenados/comparados de forma útil para checkpoint.
  const orderable = !["text", "ntext", "xml", "money", "smallmoney"].includes(type) && !(row.maxLength === -1 && ["varchar", "nvarchar"].includes(type))
  const castType = sqlServerCastType(type, row.maxLength, row.precision, row.scale)
  return column({ name: row.name, nativeType: castType ?? type, category, nullable: row.nullable, primaryKeyPosition: row.primaryKeyPosition, orderable: orderable && castType !== null, castType })
}

// ---------------------------------------------------------------------------------------------
// MySQL / MariaDB — information_schema.COLUMNS (DATA_TYPE + COLUMN_TYPE).
// ---------------------------------------------------------------------------------------------
export function mysqlCategory(dataType: string, columnType: string): ColumnCategory {
  const type = dataType.toLowerCase()
  const full = columnType.toLowerCase()
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|year)$/.test(type)) return "INTEGER"
  if (type === "decimal" || type === "numeric") return "DECIMAL"
  if (type === "float" || type === "double" || type === "real") return "FLOAT"
  if (type === "bit") return full === "bit(1)" ? "BOOLEAN" : "BINARY"
  if (type === "date") return "DATE"
  if (type === "datetime") return "DATETIME"
  if (type === "timestamp") return "DATETIME_TZ"
  if (type === "time") return "TIME"
  if (/^(char|varchar|tinytext|text|mediumtext|longtext|enum|set|inet4|inet6)$/.test(type)) return "TEXT"
  if (type === "uuid") return "UUID"
  if (type === "json") return "JSON"
  if (/^(binary|varbinary|tinyblob|blob|mediumblob|longblob)$/.test(type)) return "BINARY"
  return "OTHER"
}

export function mysqlColumn(row: { name: string; dataType: string; columnType: string; nullable: boolean; primaryKeyPosition: number | null }): DatabaseColumn {
  const category = mysqlCategory(row.dataType, row.columnType)
  const orderable = !/^(tinytext|text|mediumtext|longtext|set|json)$/.test(row.dataType.toLowerCase())
  return column({ name: row.name, nativeType: row.columnType, category, nullable: row.nullable, primaryKeyPosition: row.primaryKeyPosition, orderable })
}
