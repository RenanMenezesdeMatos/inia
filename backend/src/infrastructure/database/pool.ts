import pg from "pg"
import { env } from "../../config/env.js"
import { resolveProcessRole } from "../../main/process-role.js"
import { DATABASE_SESSION_MARKER, databaseSessionSettings } from "./session-limits.js"

/** Limites de sessão DESTE processo (ver session-limits.ts): servidor pelo papel; migrations, seeds, scripts e testes sem limite. */
export const databaseSession = databaseSessionSettings({
  server: process.env[DATABASE_SESSION_MARKER] === "server",
  role: resolveProcessRole(process.argv.slice(2), env.INIA_PROCESS_ROLE),
  entryScript: process.argv[1],
  config: env,
})

/**
 * Teto do LADO DA APLICAÇÃO para um comando (prova `database-outage-proof`): com o banco travado — rede cortada, servidor
 * congelado — o `statement_timeout` do próprio banco não dispara e o comando esperaria pela conexão TCP (minutos), prendendo
 * conexões do pool até esgotá-lo. Fica acima do maior limite do banco (o da carga em lote, que pode valer até no processo da
 * API) para nunca cortar um comando que o banco ainda deixaria terminar. Sem limite no banco (scripts, testes) = sem teto.
 */
export const clientQueryTimeoutMs =
  databaseSession.statementTimeoutMs > 0 && databaseSession.batchStatementTimeoutMs > 0
    ? Math.max(databaseSession.statementTimeoutMs, databaseSession.batchStatementTimeoutMs) + 5_000
    : 0

// Os limites vão como parâmetros de abertura da conexão (0 = não enviado = sem limite no banco).
export const pool = new pg.Pool({
  connectionString: env.activeDatabaseUrl,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: databaseSession.connectionTimeoutMs,
  statement_timeout: databaseSession.statementTimeoutMs,
  idle_in_transaction_session_timeout: databaseSession.idleInTransactionTimeoutMs,
  application_name: databaseSession.applicationName,
  ...(clientQueryTimeoutMs > 0 ? { query_timeout: clientQueryTimeoutMs } : {}),
  // Conexão ociosa com o outro lado sumido (failover, rede) é percebida pelo sistema operacional em segundos, não em horas.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
})

// Conexão OCIOSA que cai (PostgreSQL reiniciado ou parado, rede) chega como evento "error" do pool. Sem este
// tratador o Node encerra o processo inteiro; com ele o pool descarta a conexão e abre outra no próximo uso.
pool.on("error", (error) => {
  console.error("Conexão ociosa com o banco interno caiu (o pool abre outra no próximo uso):", error.message)
})

// Conexão EMPRESTADA que o banco encerra (transação ociosa além do limite, administrador derrubando a sessão) chega como
// "error" NO CLIENTE, fora de qualquer comando — o pool só escuta as ociosas. Sem um tratador aqui, esse evento derrubaria o
// processo; com ele, o comando seguinte falha normalmente e o pool descarta a conexão ao recebê-la de volta.
pool.on("connect", (client) => {
  client.on("error", (error) => {
    console.error("Conexão com o banco interno encerrada durante o uso (descartada ao ser devolvida ao pool):", error.message)
  })
})

/**
 * Carga em lote (Central de Dados): o limite de comando do processamento em segundo plano, mesmo quando a carga roda no
 * processo da API (`kickWorker` depois de um upload ou de um "Sincronizar"). Vale só DENTRO da transação aberta em `client`
 * (`set_config(..., true)`): quando ela termina, a conexão volta ao limite do processo.
 */
export async function useBatchStatementTimeout(client: Pick<pg.ClientBase, "query">): Promise<void> {
  if (databaseSession.batchStatementTimeoutMs === databaseSession.statementTimeoutMs) return
  await client.query(`select set_config('statement_timeout', $1, true)`, [String(databaseSession.batchStatementTimeoutMs)])
}

export type Database = Pick<pg.Pool, "query" | "connect">
