import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { sqlServerColumn, type DatabaseColumn } from "../domain/database/column-types.js"

/**
 * Lê a especificação das tabelas do cliente que está na Wiki (`frontend/.../client-database-tables.ts`). O import é dinâmico
 * porque o arquivo fica fora do projeto TypeScript do backend; os tipos abaixo repetem só o que os testes usam.
 */
export type SpecColumn = { name: string; sqlType: string; required: boolean; field: string | null; description: string; example: string | number | boolean | null }
export type SpecTable = { name: string; contractKey: string; contractVersion: number; primaryKey: string[]; readKeys: string[]; columns: SpecColumn[] }
export type SpecRelation = { table: string; column: string; targetTable: string; targetColumn: string; rejection: string; condition?: string }
export type SpecReference = { table: string; column: string; catalog: string; rejection: string }
export type ClientTablesSpec = {
  CLIENT_SCHEMA: string
  CLIENT_READER_LOGIN: string
  UPDATED_AT_COLUMN: string
  CLIENT_TABLES: SpecTable[]
  CLIENT_RELATIONS: SpecRelation[]
  CLIENT_INIA_REFERENCES: SpecReference[]
  EXAMPLE_FIRST_READ_SQL: string
  EXAMPLE_NEXT_READ_FILTER_SQL: string
  columnsOf(table: SpecTable): SpecColumn[]
  clientTablesScript(): string
  clientReaderScript(): string
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(MODULE_DIR, "../../../../..")
export const CLIENT_DATABASE_PAGE = join(REPO_ROOT, "frontend/src/app/wiki/central-de-dados/banco-do-cliente/page.tsx")

export async function loadClientTablesSpec(): Promise<ClientTablesSpec> {
  const file = join(REPO_ROOT, "frontend/src/components/wiki/client-database-tables.ts")
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as ClientTablesSpec
}

/** Coluna como a descoberta do SQL Server a descreveria, a partir do tipo escrito no script. */
export function specColumn(column: SpecColumn): DatabaseColumn {
  const match = /^([a-z0-9]+)(?:\(([^)]+)\))?$/.exec(column.sqlType)
  if (!match) throw new Error(`Tipo inválido: ${column.sqlType}`)
  const type = match[1]!
  const [first, second] = (match[2] ?? "").split(",")
  const exact = type === "decimal"
  const scaled = type === "datetime2" || type === "time"
  return sqlServerColumn({
    name: column.name,
    typeName: type,
    maxLength: first === "max" ? -1 : !exact && !scaled && first ? Number(first) * (type.startsWith("n") ? 2 : 1) : 8,
    precision: exact ? Number(first) : 0,
    scale: exact ? Number(second) : scaled ? Number(first) : 0,
    nullable: !column.required,
    primaryKeyPosition: null,
  })
}
