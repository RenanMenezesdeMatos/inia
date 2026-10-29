import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import setup, { proofDatabaseProblem } from "./proof-database-setup.js"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "inia-migrations-"))
  for (const file of ["001_inicial.sql", "002_pessoas.sql", "003_custodia.sql", "LEIA-ME.md"]) await writeFile(join(directory, file), "select 1;")
})
afterEach(async () => rm(directory, { recursive: true, force: true }))

/** Banco falso: só responde às duas leituras da checagem. */
function databaseWith(applied: string[] | null) {
  const commands: string[] = []
  return {
    commands,
    query: async (sql: string) => {
      commands.push(sql)
      if (sql.includes("to_regclass")) return { rows: [{ present: applied !== null }] }
      return { rows: (applied ?? []).map((name) => ({ name })) }
    },
  } as unknown as Parameters<typeof proofDatabaseProblem>[0] & { commands: string[] }
}

describe("checagem do banco das provas (INIA_DB_PROOF=1)", () => {
  it("banco com todas as migrations: nada impede as provas", async () => {
    expect(await proofDatabaseProblem(databaseWith(["001_inicial.sql", "002_pessoas.sql", "003_custodia.sql"]), directory)).toBeNull()
  })

  it("migration nova não aplicada: mensagem diz quais e o comando que resolve", async () => {
    const problem = await proofDatabaseProblem(databaseWith(["001_inicial.sql", "002_pessoas.sql"]), directory)
    expect(problem).toContain("desatualizado")
    expect(problem).toContain("1 migration(s) pendente(s): 003_custodia.sql")
    expect(problem).toContain("npm run db:migrate:test")
  })

  it("banco sem a tabela de controle: todas as migrations estão pendentes (e a checagem só lê)", async () => {
    const db = databaseWith(null)
    expect(await proofDatabaseProblem(db, directory)).toContain("3 migration(s) pendente(s): 001_inicial.sql, 002_pessoas.sql, 003_custodia.sql")
    expect(db.commands.every((sql) => /^\s*select\b/i.test(sql))).toBe(true)
  })

  it("sem INIA_DB_PROOF=1 o setup não conecta em nada", async () => {
    const previous = process.env.INIA_DB_PROOF
    delete process.env.INIA_DB_PROOF
    try {
      await expect(setup()).resolves.toBeUndefined()
    } finally {
      if (previous !== undefined) process.env.INIA_DB_PROOF = previous
    }
  })
})
