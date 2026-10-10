import pg from "pg"
import { env } from "../../config/env.js"

/**
 * `npm run db:create` — cria os bancos INTERNOS de DATABASE_URL e TEST_DATABASE_URL (se ainda não existirem) no
 * servidor PostgreSQL configurado. Conecta no banco de manutenção `postgres` do mesmo servidor, ou em
 * POSTGRES_ADMIN_URL quando informado (usuário com permissão CREATEDB).
 */
function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""))
}

function maintenanceUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = "/postgres"
  return parsed.toString()
}

const client = new pg.Client({ connectionString: process.env.POSTGRES_ADMIN_URL ?? maintenanceUrl(env.DATABASE_URL) })

await client.connect()

for (const database of [...new Set([databaseOf(env.DATABASE_URL), databaseOf(env.TEST_DATABASE_URL)])]) {
  const exists = await client.query<{ exists: boolean }>(
    "select exists(select 1 from pg_database where datname = $1)",
    [database],
  )
  if (!exists.rows[0]?.exists) {
    await client.query(`create database "${database.replace(/"/g, '""')}"`)
    process.stdout.write(`created ${database}\n`)
  } else {
    process.stdout.write(`exists ${database}\n`)
  }
}

await client.end()
