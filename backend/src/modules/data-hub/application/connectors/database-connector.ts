import { DataRunError } from "../../domain/error-codes.js"
import { classifyDatabaseError } from "../../domain/database/database-errors.js"
import { DATABASE_ENGINE_LABELS, databaseConfigSchema, resolveDatabaseConnection, type DatabaseConfig, type DatabaseEngine, type ResolvedDatabaseConnection } from "../../domain/database/database-engine.js"
import { mysqlColumn, postgresColumn, sqlServerColumn, type DatabaseColumn } from "../../domain/database/column-types.js"
import { dialectFor, positionAlias, type DatabaseObjectKind, type DatabaseObjectRef, type SqlDialect } from "../../domain/database/sql-dialect.js"
import { databaseFeedConfigSchema, orderColumnsOf, type DatabaseFeedConfig } from "../../domain/database/database-sync.js"
import { normalizeDatabaseRow } from "../../domain/database/value-normalization.js"
import type { SourceConfig } from "../../domain/source-config.js"
import type { DataHubContext } from "../data-hub-context.js"
import type { ExternalDatabaseSession } from "../ports.js"
import type { DataFeedRow, DataSourceRow } from "../records.js"
import type { FetchedBatch } from "./file-connector.js"

/**
 * Conector de BANCO EXTERNO — a INIA lê tabelas/visões do banco do cliente pelo backend (a conexão sai do
 * servidor da INIA, nunca do navegador). Somente leitura, sempre:
 *  - SQL só do dialeto (catálogo, amostra, páginas), nunca digitado;
 *  - objetos e colunas validados contra a descrição AO VIVO do banco antes de qualquer leitura;
 *  - limites de amostra, tempo (conexão/consulta/bloqueio), páginas e no máximo 2 conexões simultâneas por fonte.
 * Testar, descobrir e amostrar nunca escrevem nada (nem no banco do cliente, nem no domínio da INIA).
 */
export const DATABASE_SAMPLE_SIZE = 20
export const DATABASE_OBJECT_LIST_LIMIT = 2_000
const MAX_CONCURRENT_OPERATIONS_PER_SOURCE = 2

// ---------------------------------------------------------------------------------------------
// Limite de conexões simultâneas por fonte (por processo)
// ---------------------------------------------------------------------------------------------
const slots = new Map<string, { active: number; waiting: (() => void)[] }>()

async function acquire(key: string): Promise<() => void> {
  const entry = slots.get(key) ?? { active: 0, waiting: [] }
  slots.set(key, entry)
  if (entry.active >= MAX_CONCURRENT_OPERATIONS_PER_SOURCE) await new Promise<void>((resolve) => entry.waiting.push(resolve))
  entry.active += 1
  return () => {
    entry.active -= 1
    const next = entry.waiting.shift()
    if (next) next()
    else if (entry.active === 0) slots.delete(key)
  }
}

// ---------------------------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------------------------
export function databaseConfigOf(source: Pick<DataSourceRow, "config">): DatabaseConfig {
  const config = source.config as SourceConfig
  if (config.kind !== "DATABASE") throw new DataRunError("DATA_INTERNAL_ERROR", "A fonte não é um banco de dados externo.")
  return databaseConfigSchema.parse(config.database)
}

export async function resolveSourceConnection(ctx: DataHubContext, source: DataSourceRow): Promise<ResolvedDatabaseConnection> {
  const config = databaseConfigOf(source)
  const password = await ctx.secrets.get({ sourceId: source.id, purpose: "DATABASE_PASSWORD" })
  if (!password) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "A senha do banco não está configurada (ou foi revogada). Informe a senha na conexão.")
  return resolveDatabaseConnection(config, password)
}

export type DatabaseSessionScope = { session: ExternalDatabaseSession; connection: ResolvedDatabaseConnection; dialect: SqlDialect; object: string | null }

/**
 * Abre uma sessão, executa `work` e fecha — com o limite por fonte e todo erro de driver traduzido para um
 * código estável da Central (com a senha removida de qualquer mensagem).
 */
export async function withDatabaseSession<T>(ctx: DataHubContext, slotKey: string, connection: ResolvedDatabaseConnection, work: (scope: DatabaseSessionScope) => Promise<T>, object: DatabaseObjectRef | null = null): Promise<T> {
  const release = await acquire(slotKey)
  const objectLabel = object ? `${object.schema}.${object.name}` : null
  const errorContext = { engine: connection.engine, host: connection.host, port: connection.port, database: connection.database, username: connection.username, instanceName: connection.instanceName, object: objectLabel, secrets: [connection.password] }
  let session: ExternalDatabaseSession | null = null
  try {
    try {
      session = await ctx.databases.open(connection)
    } catch (error) {
      throw classifyDatabaseError(error, { ...errorContext, phase: "CONNECT" })
    }
    try {
      return await work({ session, connection, dialect: dialectFor(session.flavor), object: objectLabel })
    } catch (error) {
      throw classifyDatabaseError(error, { ...errorContext, phase: "QUERY" })
    }
  } finally {
    if (session) await session.close().catch(() => {})
    release()
  }
}

// ---------------------------------------------------------------------------------------------
// Teste de conexão
// ---------------------------------------------------------------------------------------------
export type DatabaseConnectionReport = {
  serverVersion: string
  engineFound: DatabaseEngine
  engineMismatch: string | null
  tlsActive: boolean
  readOnlyEnforced: boolean
  privilegeWarning: string | null
  objectsVisible: number
}

export async function testDatabaseConnection(ctx: DataHubContext, connection: ResolvedDatabaseConnection, slotKey: string): Promise<DatabaseConnectionReport> {
  return withDatabaseSession(ctx, slotKey, connection, async ({ session, dialect }) => {
    const objects = await session.query(dialect.listObjects(null, DATABASE_OBJECT_LIST_LIMIT))
    const engineMismatch =
      session.flavor !== connection.engine
        ? `O servidor respondeu como ${DATABASE_ENGINE_LABELS[session.flavor]} (escolhido: ${DATABASE_ENGINE_LABELS[connection.engine]}). A conexão funciona; ajuste o tipo do banco para refletir o servidor real.`
        : null
    return { serverVersion: session.serverVersion, engineFound: session.flavor, engineMismatch, tlsActive: session.tlsActive, readOnlyEnforced: session.readOnlyEnforced, privilegeWarning: await session.privilegeWarning().catch(() => null), objectsVisible: objects.length }
  })
}

export function describeTestDetail(report: DatabaseConnectionReport): string {
  const parts = [`${report.serverVersion}`, report.tlsActive ? "conexão cifrada (TLS)" : "conexão SEM criptografia", `${report.objectsVisible}${report.objectsVisible >= DATABASE_OBJECT_LIST_LIMIT ? "+" : ""} tabela(s)/visão(ões) com permissão de leitura`]
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------------------------
// Descoberta (tabelas/visões e colunas)
// ---------------------------------------------------------------------------------------------
export type DatabaseObjectSummary = { schema: string; name: string; kind: DatabaseObjectKind; estimatedRows: number | null }

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export async function listDatabaseObjects(ctx: DataHubContext, source: DataSourceRow, search: string | null): Promise<{ objects: DatabaseObjectSummary[]; truncated: boolean }> {
  const connection = await resolveSourceConnection(ctx, source)
  const term = search?.trim() ? search.trim().slice(0, 128) : null
  return withDatabaseSession(ctx, source.id, connection, async ({ session, dialect }) => {
    const rows = await session.query(dialect.listObjects(term, DATABASE_OBJECT_LIST_LIMIT + 1))
    const objects = rows.slice(0, DATABASE_OBJECT_LIST_LIMIT).map((row) => ({ schema: String(row.schema_name), name: String(row.object_name), kind: (row.object_kind === "VIEW" ? "VIEW" : "TABLE") as DatabaseObjectKind, estimatedRows: toNumber(row.estimated_rows) }))
    return { objects, truncated: rows.length > DATABASE_OBJECT_LIST_LIMIT }
  })
}

export type DatabaseObjectDescription = { schema: string; name: string; kind: DatabaseObjectKind; columns: DatabaseColumn[]; primaryKey: string[] }

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true"
}

function columnsFromRows(engine: DatabaseEngine, rows: Record<string, unknown>[]): DatabaseColumn[] {
  return rows.map((row) => {
    const name = String(row.column_name)
    const primaryKeyPosition = toNumber(row.pk_position)
    if (engine === "POSTGRESQL") return postgresColumn({ name, nativeType: String(row.native_type), typtype: row.typtype === null || row.typtype === undefined ? null : String(row.typtype), nullable: bool(row.nullable), primaryKeyPosition })
    if (engine === "SQLSERVER") return sqlServerColumn({ name, typeName: String(row.type_name), maxLength: Number(row.max_length), precision: Number(row.precision), scale: Number(row.scale), nullable: bool(row.nullable), primaryKeyPosition })
    return mysqlColumn({ name, dataType: String(row.data_type), columnType: String(row.column_type), nullable: bool(row.nullable), primaryKeyPosition })
  })
}

/** Descrição AO VIVO de um objeto: existe? o usuário pode ler? quais colunas? Erro claro em cada caso. */
export async function describeObjectInSession(scope: DatabaseSessionScope, object: DatabaseObjectRef): Promise<DatabaseObjectDescription> {
  const { session, dialect, connection } = scope
  const info = await session.query(dialect.objectInfo(object))
  const label = `${object.schema}.${object.name}`
  if (!info[0]) throw new DataRunError("DATA_SCHEMA_CHANGED", `A tabela/visão ${label} não existe em ${connection.database} ou não está visível para o usuário "${connection.username}".`)
  if (!bool(info[0].can_select)) throw new DataRunError("DATA_SOURCE_PERMISSION_DENIED", `O usuário "${connection.username}" não tem permissão de leitura (SELECT) em ${label}.`)
  const columns = columnsFromRows(session.flavor, await session.query(dialect.describeColumns(object)))
  if (columns.length === 0) throw new DataRunError("DATA_SOURCE_PERMISSION_DENIED", `O usuário "${connection.username}" não enxerga nenhuma coluna de ${label}.`)
  const primaryKey = columns.filter((column) => column.primaryKeyPosition !== null).sort((a, b) => a.primaryKeyPosition! - b.primaryKeyPosition!).map((column) => column.name)
  return { schema: object.schema, name: object.name, kind: info[0].object_kind === "VIEW" ? "VIEW" : "TABLE", columns, primaryKey }
}

export async function describeDatabaseObject(ctx: DataHubContext, source: DataSourceRow, object: DatabaseObjectRef): Promise<DatabaseObjectDescription> {
  const connection = await resolveSourceConnection(ctx, source)
  return withDatabaseSession(ctx, source.id, connection, (scope) => describeObjectInSession(scope, object), object)
}

// ---------------------------------------------------------------------------------------------
// Validação da configuração do conjunto de dados contra o banco
// ---------------------------------------------------------------------------------------------
export type ResolvedFeedColumns = { description: DatabaseObjectDescription; order: DatabaseColumn[]; supported: DatabaseColumn[] }

export function resolveFeedColumns(description: DatabaseObjectDescription, config: DatabaseFeedConfig): ResolvedFeedColumns {
  const byName = new Map(description.columns.map((column) => [column.name, column]))
  const label = `${description.schema}.${description.name}`
  const order = orderColumnsOf(config.sync).map((name) => {
    const column = byName.get(name)
    if (!column) throw new DataRunError("DATA_SCHEMA_CHANGED", `A coluna "${name}" (usada para ordenar a leitura de ${label}) não existe mais. Revise a sincronização do conjunto de dados.`)
    return column
  })
  if (config.sync.mode === "INCREMENTAL") {
    const cursor = order[0]!
    if (!cursor.cursorEligible) throw new DataRunError("DATA_SCHEMA_CHANGED", `A coluna "${cursor.name}" (${cursor.nativeType}) não serve como campo de atualização: use número inteiro/decimal ou data/hora.`)
  }
  for (const column of order.slice(config.sync.mode === "INCREMENTAL" ? 1 : 0)) {
    if (!column.keyEligible) throw new DataRunError("DATA_SCHEMA_CHANGED", `A coluna "${column.name}" (${column.nativeType}) não serve como chave de ordenação.`)
  }
  return { description, order, supported: description.columns.filter((column) => column.supported) }
}

/** Valida (antes de salvar o conjunto) que o objeto e as colunas de sincronização existem e servem. */
export async function validateDatabaseFeed(ctx: DataHubContext, source: DataSourceRow, rawConfig: unknown): Promise<ResolvedFeedColumns> {
  const config = databaseFeedConfigSchema.parse(rawConfig)
  const description = await describeDatabaseObject(ctx, source, config.object)
  if (description.kind !== config.object.kind) config.object.kind = description.kind
  return resolveFeedColumns(description, config)
}

// ---------------------------------------------------------------------------------------------
// Amostra (zero efeito)
// ---------------------------------------------------------------------------------------------
export async function fetchDatabaseSample(ctx: DataHubContext, source: DataSourceRow, feed: Pick<DataFeedRow, "connectorConfig">): Promise<FetchedBatch & { description: DatabaseObjectDescription }> {
  if (feed.connectorConfig.connector !== "DATABASE") throw new DataRunError("DATA_INTERNAL_ERROR", "O conjunto de dados não é de banco externo.")
  const config = databaseFeedConfigSchema.parse(feed.connectorConfig.database)
  const connection = await resolveSourceConnection(ctx, source)
  return withDatabaseSession(
    ctx,
    source.id,
    connection,
    async (scope) => {
      const description = await describeObjectInSession(scope, config.object)
      const supported = description.columns.filter((column) => column.supported)
      if (supported.length === 0) throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", `Nenhuma coluna de ${config.object.schema}.${config.object.name} tem tipo suportado (só binários/tipos especiais).`)
      const rows = await scope.session.query(scope.dialect.sample(config.object, supported, DATABASE_SAMPLE_SIZE), { timeoutMs: Math.min(connection.queryTimeoutMs, 30_000) })
      const records = rows.map((row) => normalizeDatabaseRow(row, supported))
      const skipped = description.columns.length - supported.length
      return {
        columns: supported.map((column) => column.name),
        records,
        bytes: Buffer.byteLength(JSON.stringify(records)),
        totalRecords: records.length,
        detail: `${description.kind === "VIEW" ? "Visão" : "Tabela"} ${config.object.schema}.${config.object.name} · ${records.length} linha(s) de amostra${skipped ? ` · ${skipped} coluna(s) binária(s)/não suportada(s) ignorada(s)` : ""}`,
        description,
      }
    },
    config.object,
  )
}

// ---------------------------------------------------------------------------------------------
// Leitura de páginas (usada pela carga)
// ---------------------------------------------------------------------------------------------
export type DatabasePageRow = { record: Record<string, unknown>; position: string[] }

/** Lê uma página: linhas normalizadas + posição em texto exato de cada uma. */
export async function readPage(scope: DatabaseSessionScope, input: { object: DatabaseObjectRef; select: DatabaseColumn[]; order: DatabaseColumn[]; after?: string[] | null; atOrAfterFirst?: string | null; equalTo?: string[] | null; limit: number }): Promise<DatabasePageRow[]> {
  const rows = await scope.session.query(scope.dialect.page(input))
  return rows.map((row) => ({ record: normalizeDatabaseRow(row, input.select), position: input.order.map((_, index) => String(row[positionAlias(index)] ?? "")) }))
}
