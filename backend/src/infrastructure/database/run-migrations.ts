import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type pg from "pg"

export const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations")

/** Aplica as migrations pendentes (schema_migrations), em ordem, cada uma na própria transação. Erro propaga. */
export async function runMigrations(client: pg.PoolClient, log: (message: string) => void, directory = MIGRATIONS_DIRECTORY): Promise<string[]> {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)
  const applied: string[] = []
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  for (const file of files) {
    const done = await client.query("select 1 from schema_migrations where name = $1", [file])
    if (done.rowCount) continue
    await client.query("begin")
    try {
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
