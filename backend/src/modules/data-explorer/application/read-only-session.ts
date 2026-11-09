import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { explorerErrors, ExportInterrupted } from "../domain/explorer-errors.js"
import type { ExplorerLimits } from "../domain/explorer-limits.js"

const log = createLogger("data-explorer")

/**
 * SESSÃO SOMENTE LEITURA DA CONSULTA. Quem garante é o próprio PostgreSQL, não uma lista de comandos: a transação nasce `READ ONLY` e qualquer escrita
 * (inclusive função que grava ou `nextval`) falha com 25006. Na mesma transação valem os limites, que somem com ela e não contaminam a conexão do pool.
 *
 * Concorrência: trava consultiva de transação por vaga, contada no banco, então vale somando todas as APIs e some sozinha se o processo cair.
 * `try`: sem vaga a consulta é recusada na hora, nunca fica esperando na fila ocupando conexão.
 */
export type ExplorerSessionKind = "QUERY" | "EXPORT"

export type ExplorerSessionInput = {
  kind: ExplorerSessionKind
  organizationId: string
  accountId: string
  limits: ExplorerLimits
}

/** Espaço próprio das travas de dois inteiros (`ESQ`, em ASCII): não colide com as tarefas periódicas nem com as de um bigint. */
export const EXPLORER_LOCK_NAMESPACE = 4_543_313

const SET_LIMITS = `select set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true), set_config('work_mem', $4, true), set_config('max_parallel_workers_per_gather', '0', true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, YMD', true)`

const TRY_SLOTS = `
  select coalesce((select slot from generate_series(0, $2::int - 1) slot where pg_try_advisory_xact_lock($1::int, hashtext($3 || ':' || slot)) limit 1), -1) as account_slot,
         coalesce((select slot from generate_series(0, $4::int - 1) slot where pg_try_advisory_xact_lock($1::int, hashtext($5 || ':' || slot)) limit 1), -1) as organization_slot`

function settingsFor(input: ExplorerSessionInput) {
  const { limits, kind } = input
  return kind === "EXPORT"
    ? { begin: "begin transaction isolation level repeatable read read only", statementTimeoutMs: limits.exportFetchTimeoutMs, idleTimeoutMs: limits.exportIdleTimeoutMs, accountSlots: limits.maxConcurrentExportsPerAccount, organizationSlots: limits.maxConcurrentExportsPerOrganization }
    : { begin: "begin transaction read only", statementTimeoutMs: limits.queryTimeoutMs, idleTimeoutMs: limits.queryIdleTimeoutMs, accountSlots: limits.maxConcurrentPerAccount, organizationSlots: limits.maxConcurrentPerOrganization }
}

/** Erro do banco nunca chega ao cliente: só códigos conhecidos viram mensagem fixa; o resto é falha genérica, com o código no log. */
export function toExplorerError(error: unknown, input: Pick<ExplorerSessionInput, "kind" | "limits">): DomainError {
  if (error instanceof DomainError) return error
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === "57014") return explorerErrors.queryTimeout(input.kind === "EXPORT" ? input.limits.exportFetchTimeoutMs : input.limits.queryTimeoutMs)
  // Formato de valor recusado pelo banco é erro do pedido, nunca falha do sistema (a validação do pedido já barra o que conhece).
  if (candidate.code === "22007" || candidate.code === "22008" || candidate.code === "22003" || candidate.code === "22P02") return explorerErrors.invalidValue()
  if (candidate.code === "55P03") return input.kind === "EXPORT" ? explorerErrors.exportBusy() : explorerErrors.busy()
  if (typeof candidate.message === "string" && candidate.message.includes("timeout exceeded when trying to connect")) return input.kind === "EXPORT" ? explorerErrors.exportBusy() : explorerErrors.busy()
  log.error({ code: typeof candidate.code === "string" ? candidate.code : null, kind: input.kind }, "falha na consulta de dados")
  return explorerErrors.failed()
}

export async function withExplorerSession<T>(db: Pick<Database, "connect">, input: ExplorerSessionInput, work: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  const settings = settingsFor(input)
  let client: pg.PoolClient
  try {
    client = await db.connect()
  } catch (error) {
    throw toExplorerError(error, input)
  }
  let broken = false
  try {
    await client.query(settings.begin)
    await client.query(SET_LIMITS, [String(settings.statementTimeoutMs), String(input.limits.lockTimeoutMs), String(settings.idleTimeoutMs), `${input.limits.workMemKb}kB`])
    const prefix = input.kind === "EXPORT" ? "explorer-export" : "explorer-query"
    const slots = await client.query<{ account_slot: number; organization_slot: number }>(TRY_SLOTS, [EXPLORER_LOCK_NAMESPACE, settings.accountSlots, `${prefix}:account:${input.accountId}`, settings.organizationSlots, `${prefix}:organization:${input.organizationId}`])
    const slot = slots.rows[0]
    if (!slot || slot.account_slot < 0 || slot.organization_slot < 0) throw input.kind === "EXPORT" ? explorerErrors.exportBusy() : explorerErrors.busy()
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    // Conexão encerrada pelo banco (transação ociosa além do limite) não aceita o rollback: é descartada, em vez de voltar ao pool.
    await client.query("rollback").catch(() => {
      broken = true
    })
    throw error instanceof ExportInterrupted ? error : toExplorerError(error, input)
  } finally {
    client.release(broken)
  }
}
