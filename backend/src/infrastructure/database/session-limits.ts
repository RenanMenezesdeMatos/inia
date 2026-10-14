import { basename } from "node:path"
import type { ProcessRole } from "../../main/process-role.js"

/**
 * Limites de sessão do banco interno (auditoria de escalabilidade, 2026-10-13). Cada conexão do pool nasce com eles (parâmetros
 * de abertura do PostgreSQL), conforme QUEM é o processo:
 *
 *   servidor `api`             comando até 30 s (um request preso nunca segura uma conexão), transação ociosa até 60 s
 *   servidor `worker` / `all`  comando até 300 s (tarefas periódicas e cargas em lote), transação ociosa até 60 s
 *   qualquer outro processo    sem limite — migrations, seeds, scripts e testes rodam como sempre rodaram
 *
 * Esperar uma conexão livre do pool tem teto no servidor (10 s): com o pool esgotado, o request falha em vez de esperar para
 * sempre. `application_name` identifica o processo em `pg_stat_activity` (`inia-api`, `inia-worker`, `inia-all`,
 * `inia-script:<arquivo>`).
 *
 * O servidor se identifica pela marca `INIA_DATABASE_SESSION=server`, que main/server-database-session.ts grava ANTES de o
 * pool nascer (é o primeiro import de server.ts). Valores configuráveis no backend/.env (config/env.ts); 0 = sem limite.
 * Trechos que precisam de mais (carga da Central de Dados, migrations) ampliam o limite dentro da PRÓPRIA transação.
 */
export type DatabaseSessionSettings = {
  /** `server` = API/processamento (limites do papel); `maintenance` = migrations, seeds, scripts e testes (sem limite). */
  kind: "server" | "maintenance"
  applicationName: string
  statementTimeoutMs: number
  idleInTransactionTimeoutMs: number
  connectionTimeoutMs: number
  /** Limite de comando das cargas em lote (Central de Dados), mesmo quando rodam no processo da API. 0 = sem limite. */
  batchStatementTimeoutMs: number
}

export type DatabaseSessionConfig = {
  DATABASE_CONNECTION_TIMEOUT_MS: number
  DATABASE_STATEMENT_TIMEOUT_MS: number
  DATABASE_WORKER_STATEMENT_TIMEOUT_MS: number
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: number
}

export const DATABASE_SESSION_MARKER = "INIA_DATABASE_SESSION"

export function databaseSessionSettings(input: { server: boolean; role: ProcessRole; entryScript: string | undefined; config: DatabaseSessionConfig }): DatabaseSessionSettings {
  if (!input.server) {
    const entry = input.entryScript ? basename(input.entryScript).replace(/\.(m?[jt]s)$/, "") : "node"
    return { kind: "maintenance", applicationName: `inia-script:${entry}`.slice(0, 63), statementTimeoutMs: 0, idleInTransactionTimeoutMs: 0, connectionTimeoutMs: 0, batchStatementTimeoutMs: 0 }
  }
  const { config } = input
  return {
    kind: "server",
    applicationName: `inia-${input.role}`,
    statementTimeoutMs: input.role === "api" ? config.DATABASE_STATEMENT_TIMEOUT_MS : config.DATABASE_WORKER_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: config.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    batchStatementTimeoutMs: config.DATABASE_WORKER_STATEMENT_TIMEOUT_MS,
  }
}
