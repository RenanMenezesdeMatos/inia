import mysql from "mysql2/promise"
import type { ResolvedDatabaseConnection } from "../../domain/database/database-engine.js"
import type { SqlStatement } from "../../domain/database/sql-dialect.js"
import type { ExternalDatabaseSession } from "../../application/ports.js"

/**
 * MySQL / MariaDB EXTERNOS — mesmo driver (mysql2) e mesmo dialeto. Uma conexão por operação, sessão
 * `TRANSACTION READ ONLY`, fuso +00:00, datas como texto (`dateStrings`) e números grandes/decimais como texto.
 * O tempo-limite de consulta muda entre os dois: `max_execution_time` (MySQL, ms) × `max_statement_time`
 * (MariaDB, s) — escolhido pelo servidor REAL encontrado, não pelo rótulo escolhido na tela.
 */
export type SslMode = "OFF" | "NO_VERIFY" | "VERIFY"

export function sslOption(connection: Pick<ResolvedDatabaseConnection, "caCertificate">, mode: SslMode): mysql.ConnectionOptions["ssl"] | undefined {
  if (mode === "OFF") return undefined
  if (mode === "NO_VERIFY") return { rejectUnauthorized: false }
  // `verifyIdentity`: sem ele o mysql2 valida só a CADEIA — qualquer certificado de uma CA aceita passava por qualquer servidor
  // (achado DATA-4 da auditoria de 17/10/2026).
  return { rejectUnauthorized: true, verifyIdentity: true, ...(connection.caCertificate ? { ca: connection.caCertificate } : {}) }
}

async function connect(connection: ResolvedDatabaseConnection, mode: SslMode): Promise<mysql.Connection> {
  const options: mysql.ConnectionOptions = {
    host: connection.host,
    port: connection.port ?? 3306,
    user: connection.username,
    password: connection.password,
    database: connection.database,
    connectTimeout: connection.connectTimeoutMs,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    timezone: "Z",
    charset: "utf8mb4",
    multipleStatements: false,
    connectAttributes: { program_name: "INIA Central de Dados" },
  }
  const ssl = sslOption(connection, mode)
  if (ssl) options.ssl = ssl
  return mysql.createConnection(options)
}

export async function openMySqlSession(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
  let client: mysql.Connection
  if (connection.tlsMode === "PREFERRED") {
    try {
      client = await connect(connection, "NO_VERIFY")
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "HANDSHAKE_NO_SSL_SUPPORT" && !/does not support secure/i.test(error instanceof Error ? error.message : "")) throw error
      client = await connect(connection, "OFF")
    }
  } else {
    client = await connect(connection, connection.tlsMode === "DISABLED" ? "OFF" : connection.tlsMode === "REQUIRED" ? "NO_VERIFY" : "VERIFY")
  }
  client.on("error", () => {
    /* queda depois da operação — a próxima consulta falha e é classificada */
  })
  try {
    const [versionRows] = await client.query<mysql.RowDataPacket[]>("SELECT VERSION() AS version")
    const version = String(versionRows[0]?.version ?? "")
    const mariadb = /mariadb/i.test(version)
    await client.query("SET SESSION TRANSACTION READ ONLY")
    await client.query("SET time_zone = '+00:00'")
    if (mariadb) await client.query(`SET SESSION max_statement_time = ${Math.max(1, Math.ceil(connection.queryTimeoutMs / 1000))}`)
    else await client.query(`SET SESSION max_execution_time = ${Math.trunc(connection.queryTimeoutMs)}`)
    const [readOnlyRows] = await client.query<mysql.RowDataPacket[]>(mariadb ? "SELECT @@SESSION.tx_read_only AS read_only" : "SELECT @@SESSION.transaction_read_only AS read_only")
    const [sslRows] = await client.query<mysql.RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
    const readOnly = Number(readOnlyRows[0]?.read_only ?? 0) === 1
    return {
      flavor: mariadb ? "MARIADB" : "MYSQL",
      serverVersion: `${mariadb ? "MariaDB" : "MySQL"} ${version.replace(/-MariaDB.*$/i, "")}`,
      tlsActive: Boolean(sslRows[0]?.Value),
      readOnlyEnforced: readOnly,
      async query(statement: SqlStatement, options?: { timeoutMs?: number }) {
        const [rows] = await client.execute<mysql.RowDataPacket[]>({ sql: statement.sql, timeout: (options?.timeoutMs ?? connection.queryTimeoutMs) + 5_000 }, statement.params)
        return rows as Record<string, unknown>[]
      },
      async privilegeWarning() {
        const [grants] = await client.query<mysql.RowDataPacket[]>("SHOW GRANTS FOR CURRENT_USER()")
        const text = grants.map((row) => String(Object.values(row)[0] ?? "")).join(" ").toUpperCase()
        if (/ALL PRIVILEGES|SUPER\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b|\bCREATE\b/.test(text)) {
          return `Este usuário tem permissões de escrita ou administração no ${mariadb ? "MariaDB" : "MySQL"}. A INIA só faz leituras, mas o recomendado é um usuário com permissão apenas de SELECT.`
        }
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
