import pg from "pg"
import type { ResolvedDatabaseConnection } from "../../domain/database/database-engine.js"
import type { SqlStatement } from "../../domain/database/sql-dialect.js"
import type { ExternalDatabaseSession } from "../../application/ports.js"

/**
 * PostgreSQL EXTERNO (do cliente) — um `pg.Client` por operação, nunca o pool do banco interno da INIA.
 * Sessão somente leitura (`default_transaction_read_only`), tempo-limite de consulta e de bloqueio, fuso UTC e
 * datas como TEXTO do próprio servidor (sem o parse para o fuso local do processo que o `pg` faria).
 */
const asText = (value: string) => value
// date, timestamp, timestamptz, time, timetz, interval, numeric, int8, money — texto exato do servidor.
const TEXT_TYPES = new Set([1082, 1114, 1184, 1083, 1266, 1186, 1700, 20, 790])

const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (TEXT_TYPES.has(oid)) return asText
    return pg.types.getTypeParser(oid, format as "text")
  },
}

function sslOption(connection: ResolvedDatabaseConnection, mode: "OFF" | "NO_VERIFY" | "VERIFY"): pg.ClientConfig["ssl"] {
  if (mode === "OFF") return false
  if (mode === "NO_VERIFY") return { rejectUnauthorized: false }
  return { rejectUnauthorized: true, servername: connection.host, ...(connection.caCertificate ? { ca: connection.caCertificate } : {}) }
}

async function connect(connection: ResolvedDatabaseConnection, mode: "OFF" | "NO_VERIFY" | "VERIFY"): Promise<pg.Client> {
  const client = new pg.Client({
    host: connection.host,
    port: connection.port ?? 5432,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: sslOption(connection, mode),
    connectionTimeoutMillis: connection.connectTimeoutMs,
    // Rede de segurança do lado do cliente; o tempo-limite real é o statement_timeout do servidor.
    query_timeout: connection.queryTimeoutMs + 5_000,
    application_name: "INIA Central de Dados",
    keepAlive: true,
    types,
  })
  client.on("error", () => {
    /* erro assíncrono depois de fechada a operação — a próxima consulta falha e é classificada */
  })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
  return client
}

export async function openPostgresSession(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
  let client: pg.Client
  if (connection.tlsMode === "PREFERRED") {
    try {
      client = await connect(connection, "NO_VERIFY")
    } catch (error) {
      // Igual ao `sslmode=prefer` do libpq: servidor sem TLS → conecta sem.
      if (!/does not support ssl/i.test(error instanceof Error ? error.message : "")) throw error
      client = await connect(connection, "OFF")
    }
  } else {
    client = await connect(connection, connection.tlsMode === "DISABLED" ? "OFF" : connection.tlsMode === "REQUIRED" ? "NO_VERIFY" : "VERIFY")
  }
  try {
    await client.query(
      `SET default_transaction_read_only = on; SET statement_timeout = ${Math.trunc(connection.queryTimeoutMs)}; SET lock_timeout = 10000; SET TimeZone = 'UTC'; SET DateStyle = 'ISO, YMD'; SET IntervalStyle = 'iso_8601'`,
    )
    const info = await client.query<{ version: string; read_only: string; ssl: boolean | null }>(
      `SELECT current_setting('server_version') AS version, current_setting('default_transaction_read_only') AS read_only,
              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`,
    )
    const row = info.rows[0]!
    return {
      flavor: "POSTGRESQL",
      serverVersion: `PostgreSQL ${row.version}`,
      tlsActive: row.ssl === true,
      readOnlyEnforced: row.read_only === "on",
      async query(statement: SqlStatement, options?: { timeoutMs?: number }) {
        if (options?.timeoutMs) await client.query(`SET statement_timeout = ${Math.trunc(options.timeoutMs)}`)
        try {
          const result = await client.query({ text: statement.sql, values: statement.params })
          return result.rows as Record<string, unknown>[]
        } finally {
          if (options?.timeoutMs) await client.query(`SET statement_timeout = ${Math.trunc(connection.queryTimeoutMs)}`).catch(() => {})
        }
      },
      async privilegeWarning() {
        const result = await client.query<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`)
        const role = result.rows[0]
        if (role?.rolsuper) return "Este usuário é superusuário do PostgreSQL. A INIA só faz leituras, mas o recomendado é um usuário com permissão apenas de SELECT nas tabelas/visões usadas."
        if (role?.rolcreaterole || role?.rolcreatedb) return "Este usuário pode criar bancos ou papéis. O recomendado é um usuário com permissão apenas de SELECT."
        return null
      },
      async close() {
        await client.end().catch(() => {})
      },
    }
  } catch (error) {
    await client.end().catch(() => {})
    throw error
  }
}
