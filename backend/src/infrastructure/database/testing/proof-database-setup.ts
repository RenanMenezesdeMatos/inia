import pg from "pg"
import { pendingMigrations } from "../run-migrations.js"

/**
 * `globalSetup` do vitest. Com `INIA_DB_PROOF=1`, as provas de banco só começam se o banco de teste (`TEST_DATABASE_URL`) tiver
 * TODAS as migrations do diretório. Sem esta checagem, uma migration nova ainda não aplicada no `inia_test` fazia as provas
 * falharem como se fosse defeito de código (29/10/2026: 12 de 17 casos da Central de Dados, por falta da 163). Sem a variável,
 * não conecta em nada.
 */
export default async function setup(): Promise<void> {
  if (process.env.INIA_DB_PROOF !== "1") return
  const { env } = await import("../../../config/env.js")
  const pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 1 })
  try {
    const client = await pool.connect().catch((error: unknown) => {
      throw new Error(`Provas de banco (INIA_DB_PROOF=1): banco de teste inacessível em TEST_DATABASE_URL — ${error instanceof Error ? error.message : String(error)}`)
    })
    try {
      const problem = await proofDatabaseProblem(client)
      if (problem) throw new Error(problem)
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

/** O que impede as provas de rodar neste banco, ou `null` se ele está com todas as migrations. */
export async function proofDatabaseProblem(db: Pick<pg.ClientBase, "query">, directory?: string): Promise<string | null> {
  const pending = await pendingMigrations(db, directory)
  if (pending.length === 0) return null
  return `Provas de banco (INIA_DB_PROOF=1): o banco de teste está desatualizado — ${pending.length} migration(s) pendente(s): ${pending.join(", ")}. Rode \`npm run db:migrate:test\` antes das provas; sem isso, elas falham como se fosse defeito de código.`
}
