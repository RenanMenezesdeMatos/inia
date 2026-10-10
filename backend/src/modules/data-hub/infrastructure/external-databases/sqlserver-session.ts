import sql from "mssql"
import type { ResolvedDatabaseConnection } from "../../domain/database/database-engine.js"
import type { SqlStatement } from "../../domain/database/sql-dialect.js"
import type { ExternalDatabaseSession } from "../../application/ports.js"

/**
 * SQL Server EXTERNO — `mssql` (tedious) com UMA conexão por operação. O T-SQL não tem sessão "somente leitura":
 * a garantia é a INIA só enviar SELECT gerado pelo dialeto + o login recomendado só com `db_datareader`/SELECT.
 * `readOnlyIntent` sinaliza a intenção (num Availability Group, vai para a réplica de leitura). Datas chegam
 * como `Date` em UTC (`useUTC`) e a normalização devolve o mesmo formato dos outros bancos.
 */
export async function openSqlServerSession(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
  const encrypt = connection.tlsMode !== "DISABLED"
  const pool = new sql.ConnectionPool({
    server: connection.host,
    ...(connection.port ? { port: connection.port } : {}),
    database: connection.database,
    user: connection.username,
    password: connection.password,
    connectionTimeout: connection.connectTimeoutMs,
    requestTimeout: connection.queryTimeoutMs,
    pool: { max: 1, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt,
      trustServerCertificate: connection.tlsMode !== "VERIFY_FULL",
      ...(connection.instanceName ? { instanceName: connection.instanceName } : {}),
      ...(connection.caCertificate ? { cryptoCredentialsDetails: { ca: connection.caCertificate } } : {}),
      readOnlyIntent: true,
      useUTC: true,
      enableArithAbort: true,
      appName: "INIA Central de Dados",
    },
  })
  pool.on("error", () => {
    /* queda depois da operação — a próxima consulta falha e é classificada */
  })
  try {
    await pool.connect()
  } catch (error) {
    await pool.close().catch(() => {})
    throw error
  }
  const run = async (statement: SqlStatement, timeoutMs?: number) => {
    const request = pool.request()
    // Por consulta (a sessão é reaproveitada pelo pool de 1 conexão): espera de bloqueio limitada.
    statement.params.forEach((value, index) => {
      if (typeof value === "number") request.input(`p${index + 1}`, sql.BigInt, value)
      else request.input(`p${index + 1}`, sql.NVarChar(sql.MAX), value)
    })
    if (timeoutMs) (request as unknown as { timeout: number }).timeout = timeoutMs
    const result = await request.query(`SET LOCK_TIMEOUT 10000; ${statement.sql}`)
    return (result.recordset ?? []) as Record<string, unknown>[]
  }
  try {
    const info = await run({ sql: "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition", params: [] })
    const row = info[0] ?? {}
    return {
      flavor: "SQLSERVER",
      serverVersion: `SQL Server ${String(row.version ?? "")} (${String(row.edition ?? "")})`,
      tlsActive: encrypt,
      readOnlyEnforced: false,
      query: (statement, options) => run(statement, options?.timeoutMs),
      async privilegeWarning() {
        const rows = await run({ sql: "SELECT IS_SRVROLEMEMBER('sysadmin') AS sysadmin, IS_ROLEMEMBER('db_owner') AS db_owner, IS_ROLEMEMBER('db_datawriter') AS db_datawriter, IS_ROLEMEMBER('db_ddladmin') AS db_ddladmin", params: [] })
        const roles = rows[0] ?? {}
        if (roles.sysadmin === 1) return "Este login é sysadmin do SQL Server. A INIA só faz leituras, mas o recomendado é um login só com db_datareader (ou SELECT nas tabelas/visões usadas)."
        if (roles.db_owner === 1 || roles.db_datawriter === 1 || roles.db_ddladmin === 1) return "Este usuário pode alterar o banco (db_owner/db_datawriter/db_ddladmin). O recomendado é um usuário só com db_datareader (ou SELECT nas tabelas/visões usadas)."
        return null
      },
      async close() {
        await pool.close().catch(() => {})
      },
    }
  } catch (error) {
    await pool.close().catch(() => {})
    throw error
  }
}
