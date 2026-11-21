import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type pg from "pg"

export const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations")

/** Migrations do diretório que o banco ainda não aplicou, em ordem (sem a tabela de controle, todas). Só lê. */
export async function pendingMigrations(db: Pick<pg.ClientBase, "query">, directory = MIGRATIONS_DIRECTORY): Promise<string[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  const control = await db.query<{ present: boolean }>(`select to_regclass('schema_migrations') is not null as present`)
  if (!control.rows[0]?.present) return files
  const applied = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((row) => row.name))
  return files.filter((file) => !applied.has(file))
}

/**
 * Pendentes com número MENOR que a mais nova já aplicada (run-8, ARQ-11). Numa instalação nova ela rodaria antes das seguintes; num banco
 * já atualizado, depois — duas ordens diferentes para o mesmo esquema. Só contam as aplicadas que ainda existem no diretório (uma
 * renumerada sai do cálculo).
 */
export function outOfOrderMigrations(files: readonly string[], applied: ReadonlySet<string>): string[] {
  const newest = files.filter((file) => applied.has(file)).sort().at(-1)
  return newest ? files.filter((file) => !applied.has(file) && file < newest) : []
}

export class MigrationOrderError extends Error {
  constructor(readonly migrations: readonly string[]) {
    super(`Migration fora de ordem: ${migrations.join(", ")} tem número menor que uma já aplicada neste banco. Renumere para depois da última antes de aplicar — nada foi aplicado.`)
    this.name = "MigrationOrderError"
  }
}

/** Aplica as migrations pendentes (schema_migrations), em ordem, cada uma na própria transação. Fora de ordem = recusa antes de aplicar qualquer uma. Erro propaga. */
export async function runMigrations(client: pg.PoolClient, log: (message: string) => void, directory = MIGRATIONS_DIRECTORY): Promise<string[]> {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)
  const applied: string[] = []
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  const alreadyApplied = new Set((await client.query<{ name: string }>("select name from schema_migrations")).rows.map((row) => row.name))
  const outOfOrder = outOfOrderMigrations(files, alreadyApplied)
  if (outOfOrder.length > 0) throw new MigrationOrderError(outOfOrder)
  for (const file of files) {
    if (alreadyApplied.has(file)) continue
    await client.query("begin")
    try {
      // Migration nunca herda limite de comando/transação de quem a chama (um índice sobre tabela grande passa de minutos).
      await client.query(`select set_config('statement_timeout', '0', true), set_config('idle_in_transaction_session_timeout', '0', true)`)
      await client.query(await readFile(join(directory, file), "utf8"))
      await client.query("insert into schema_migrations(name) values($1)", [file])
      await client.query("commit")
      applied.push(file)
      log(`applied ${file}`)
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }
  return applied
}
