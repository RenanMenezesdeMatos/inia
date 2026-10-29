/**
 * PROVA contra o banco de TESTE real (lote 1 da 4ª auditoria): a fronteira de só leitura do "Testar diagnóstico" tem o banco
 * como segunda trava. A lista de comandos olha só o começo — um `select` que grava por dentro (função que escreve, `nextval`)
 * passava; com `enforcedByDatabase`, cada leitura roda numa transação `read only` própria e o PostgreSQL recusa a escrita.
 * Consultas em paralelo continuam em paralelo, nada fica "idle in transaction" e a conexão volta ao pool sem ficar só leitura.
 * Objetos próprios, apagados no fim.
 *   INIA_DB_PROOF=1 npx vitest run read-only-database-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../application/read-only-database.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool

async function cleanup() {
  await pool.query("drop function if exists read_only_proof_write()")
  await pool.query("drop table if exists read_only_proof_rows")
  await pool.query("drop sequence if exists read_only_proof_seq")
}

const rowsWritten = async () => (await pool.query<{ n: number }>("select count(*)::int n from read_only_proof_rows")).rows[0]!.n

describe.skipIf(!ENABLED)("Fronteira de só leitura com o banco como segunda trava (Testar diagnóstico)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    await cleanup()
    await pool.query("create table read_only_proof_rows (n int)")
    await pool.query("create sequence read_only_proof_seq")
    await pool.query("create function read_only_proof_write() returns int language sql as $$ insert into read_only_proof_rows values (1) returning n $$")
  })

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("só a lista de comandos: um select que grava por dentro passa (o buraco que o banco fecha)", async () => {
    const listOnly = createReadOnlyDatabase(pool as unknown as Database)
    await listOnly.query("select read_only_proof_write()")
    expect(await rowsWritten()).toBe(1)
    await pool.query("truncate read_only_proof_rows")
  })

  it("com o banco: a função que grava e o nextval são recusados pelo PostgreSQL e nada é gravado; leitura comum funciona", async () => {
    const readDb = createReadOnlyDatabase(pool as unknown as Database, { enforcedByDatabase: true })
    await expect(readDb.query("select read_only_proof_write()")).rejects.toMatchObject({ code: "25006" })
    await expect(readDb.query("select nextval('read_only_proof_seq')")).rejects.toMatchObject({ code: "25006" })
    await expect(readDb.query("with gravado as (select read_only_proof_write()) select * from gravado")).rejects.toMatchObject({ code: "25006" })
    expect(await rowsWritten()).toBe(0)
    expect((await pool.query<{ last_value: string; is_called: boolean }>("select last_value::text, is_called from read_only_proof_seq")).rows[0]).toEqual({ last_value: "1", is_called: false })
    expect((await readDb.query<{ n: number }>("select $1::int + 1 n", [41])).rows[0]!.n).toBe(42)
    // A lista de comandos continua valendo antes do banco.
    await expect(readDb.query("insert into read_only_proof_rows values (2)")).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
    await expect(readDb.connect()).rejects.toMatchObject({ code: "QA_WRITE_BLOCKED" })
  })

  it("consultas em paralelo continuam em paralelo; nada fica aberto e a conexão volta ao pool sem ficar só leitura", async () => {
    const readDb = createReadOnlyDatabase(pool as unknown as Database, { enforcedByDatabase: true })
    const started = Date.now()
    await Promise.all(Array.from({ length: 5 }, () => readDb.query("select pg_sleep(0.3)")))
    expect(Date.now() - started).toBeLessThan(1_200)
    const idle = await pool.query<{ n: number }>("select count(*)::int n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%' and application_name = ''")
    expect(idle.rows[0]!.n).toBe(0)
    for (let round = 0; round < 8; round += 1) {
      expect((await pool.query<{ transaction_read_only: string }>("show transaction_read_only")).rows[0]!.transaction_read_only).toBe("off")
    }
    await pool.query("insert into read_only_proof_rows values (3)")
    expect(await rowsWritten()).toBe(1)
  })
})
