import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { RETENTION_BATCH_SIZE, retentionTargetOf, type RetentionTarget } from "../domain/retention-catalog.js"

/**
 * Tarefa `data-retention` (worker, de hora em hora, trava exclusiva): aplica as políticas LIGADAS de
 * `data_retention_policies` (migration 140). Para cada uma: corte = agora − prazo; apaga em lotes de 5.000 o que é mais
 * antigo que o corte, satisfaz a regra da tabela e não é referenciado por nenhuma outra tabela (retention-catalog.ts).
 * Política sem entrada no catálogo ou com bloqueio estrutural é RECUSADA (registrada, nada apagado). Cada rodada por tabela
 * fica em `data_retention_runs`. Hoje nenhuma política está ligada: a tarefa só lê a tabela de políticas.
 */
export type RetentionRunResult = { table: string; outcome: "COMPLETED" | "PARTIAL" | "REFUSED" | "FAILED"; deletedRows: number; detail: string | null }

export type RetentionOptions = { clock?: Clock; timeBudgetMs?: number; batchSize?: number }

const DEFAULT_TIME_BUDGET_MS = 60_000

/** Predicado "esta linha é referenciada por outra tabela" (alias `alias`), montado do catálogo do PostgreSQL + extras. */
export async function protectionPredicate(db: Pick<Database, "query">, target: RetentionTarget, alias = "t"): Promise<string> {
  const foreignKeys = await db.query<{ table_name: string; column_name: string; referenced_column: string; columns: number }>(
    `select c.conrelid::regclass::text table_name, a.attname column_name, ra.attname referenced_column, array_length(c.conkey, 1) columns
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = $1::regclass
      order by 1, 2`,
    [target.table],
  )
  const clauses: string[] = []
  for (const fk of foreignKeys.rows) {
    if (fk.columns !== 1) throw new Error(`Retenção de ${target.table}: FK composta em ${fk.table_name} não é suportada.`)
    if (fk.table_name === target.table || (target.children ?? []).includes(fk.table_name)) continue
    clauses.push(`exists (select 1 from ${fk.table_name} r where r.${fk.column_name} = ${alias}.${fk.referenced_column})`)
  }
  for (const extra of target.extraProtection ?? []) clauses.push(extra(alias))
  if (target.protectedVia) {
    const parent = retentionTargetOf(target.protectedVia.table)
    if (!parent) throw new Error(`Retenção de ${target.table}: tabela-mãe ${target.protectedVia.table} fora do catálogo.`)
    clauses.push(`exists (select 1 from ${parent.table} p where p.id = ${alias}.${target.protectedVia.column} and (${await protectionPredicate(db, parent, "p")}))`)
  }
  return clauses.length > 0 ? clauses.join(" or ") : "false"
}

export async function runDataRetention(db: Database, options: RetentionOptions = {}): Promise<RetentionRunResult[]> {
  const clock = options.clock ?? systemClock
  const policies = await db.query<{ table_name: string; retention_days: number }>(`select table_name, retention_days from data_retention_policies where enabled order by table_name`)
  const results: RetentionRunResult[] = []
  for (const policy of policies.rows) {
    const startedAt = clock.now()
    const cutoff = new Date(startedAt.getTime() - policy.retention_days * 86_400_000)
    const target = retentionTargetOf(policy.table_name)
    let result: RetentionRunResult
    if (!target) result = { table: policy.table_name, outcome: "REFUSED", deletedRows: 0, detail: "Tabela fora do catálogo de retenção." }
    else if (target.blockedReason) result = { table: policy.table_name, outcome: "REFUSED", deletedRows: 0, detail: target.blockedReason }
    else result = await purge(db, target, cutoff, clock, options)
    await db.query(
      `insert into data_retention_runs (table_name, cutoff, started_at, finished_at, deleted_rows, outcome, detail) values ($1, $2, $3, $4, $5, $6, $7)`,
      [policy.table_name, cutoff.toISOString(), startedAt.toISOString(), clock.now().toISOString(), result.deletedRows, result.outcome, result.detail],
    )
    results.push(result)
  }
  return results
}

async function purge(db: Database, target: RetentionTarget, cutoff: Date, clock: Clock, options: RetentionOptions): Promise<RetentionRunResult> {
  const startedMs = clock.now().getTime()
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE
  let deletedRows = 0
  try {
    const protection = await protectionPredicate(db, target)
    const statement = `delete from ${target.table} t where t.ctid = any(array(
        select t.ctid from ${target.table} t
         where t.${target.timeColumn} < $1${target.eligible ? ` and (${target.eligible})` : ""} and not (${protection})
         limit $2))`
    for (;;) {
      const deleted = await db.query(statement, [cutoff.toISOString(), batchSize])
      deletedRows += deleted.rowCount ?? 0
      if ((deleted.rowCount ?? 0) < batchSize) return { table: target.table, outcome: "COMPLETED", deletedRows, detail: null }
      if (clock.now().getTime() - startedMs > (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)) return { table: target.table, outcome: "PARTIAL", deletedRows, detail: "Tempo da rodada esgotado; continua na próxima." }
    }
  } catch (error) {
    return { table: target.table, outcome: "FAILED", deletedRows, detail: error instanceof Error ? error.message : String(error) }
  }
}
