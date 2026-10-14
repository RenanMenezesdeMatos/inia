/**
 * PROVA contra o banco de TESTE real: o pool do SERVIDOR nasce com os limites de sessão do papel e o processo sobrevive a eles.
 * Limites curtos só nesta prova (variáveis definidas antes de importar o pool; cada arquivo de teste tem os próprios módulos).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run pool-session-proof
 */
import { afterAll, describe, expect, it } from "vitest"

const ENABLED = process.env.INIA_DB_PROOF === "1"
if (ENABLED) {
  Object.assign(process.env, {
    INIA_DATABASE_SESSION: "server",
    INIA_PROCESS_ROLE: "api",
    DATABASE_POOL_MAX: "2",
    DATABASE_CONNECTION_TIMEOUT_MS: "300",
    DATABASE_STATEMENT_TIMEOUT_MS: "500",
    DATABASE_WORKER_STATEMENT_TIMEOUT_MS: "4000",
    DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "400",
  })
}
const loaded = ENABLED ? await import("../pool.js") : null
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!ENABLED)("Pool do servidor — limites de sessão (prova Postgres)", () => {
  afterAll(async () => { await loaded?.pool.end() })

  it("parâmetros na conexão; comando longo cancelado; transação ociosa encerrada sem derrubar o processo; lote amplia só na transação; pool esgotado falha no teto", async () => {
    const { pool, useBatchStatementTimeout } = loaded!
    const settings = (await pool.query<{ statement_timeout: string; idle: string; app: string }>(
      "select current_setting('statement_timeout') statement_timeout, current_setting('idle_in_transaction_session_timeout') idle, current_setting('application_name') app",
    )).rows[0]!
    expect(settings).toEqual({ statement_timeout: "500ms", idle: "400ms", app: "inia-api" })

    // Comando além do limite: o banco cancela (57014) e a conexão continua utilizável.
    await expect(pool.query("select pg_sleep(1)")).rejects.toMatchObject({ code: "57014" })
    expect((await pool.query("select 1 ok")).rows[0]).toEqual({ ok: 1 })

    // Transação esquecida: o banco encerra a sessão; o comando seguinte falha, o processo segue e o pool repõe a conexão.
    const forgotten = await pool.connect()
    await forgotten.query("begin")
    await sleep(800)
    await expect(forgotten.query("select 1")).rejects.toBeTruthy()
    forgotten.release()
    expect((await pool.query("select 2 ok")).rows[0]).toEqual({ ok: 2 })

    // Carga em lote: o limite das cargas vale só dentro da transação.
    const batch = await pool.connect()
    try {
      await batch.query("begin")
      await useBatchStatementTimeout(batch)
      expect((await batch.query("select current_setting('statement_timeout') value")).rows[0].value).toBe("4s")
      await batch.query("select pg_sleep(0.7)")
      await batch.query("commit")
      expect((await batch.query("select current_setting('statement_timeout') value")).rows[0].value).toBe("500ms")
    } finally {
      batch.release()
    }

    // Pool esgotado: quem chega depois falha no teto de espera em vez de esperar para sempre.
    const held = [await pool.connect(), await pool.connect()]
    const started = Date.now()
    await expect(pool.connect()).rejects.toThrow(/timeout exceeded when trying to connect/)
    expect(Date.now() - started).toBeLessThan(2_000)
    for (const client of held) client.release()
  })
})
