import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../../config/env.js"
import { listenForWake, notifyWake, type WakeListener } from "../postgres-wake-channel.js"

/**
 * PROVA contra o PostgreSQL de TESTE — aviso entre processos (papel `api` → papel `worker`) por NOTIFY/LISTEN:
 * o aviso chega; a escuta derrubada pelo servidor reconecta sozinha e roda uma vez na volta (trabalho que chegou com a escuta
 * fora não fica parado até o próximo tick).
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run postgres-wake-channel-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const CHANNEL = `inia_proof_wake_${process.pid}`

let api: pg.Pool
let listener: WakeListener | null = null
const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("tempo esgotado esperando o aviso")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe.skipIf(!ENABLED)("aviso entre processos pelo PostgreSQL (NOTIFY/LISTEN)", () => {
  beforeAll(() => {
    api = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    api.on("error", () => {})
  })
  afterAll(async () => {
    await listener?.stop()
    await api.end()
  })

  it("o aviso da API chega ao processamento; derrubada a conexão de escuta, ela volta e acorda uma vez", async () => {
    let wakes = 0
    listener = listenForWake({ connectionString: env.TEST_DATABASE_URL, channel: CHANNEL, onWake: () => (wakes += 1), log: () => {} })
    // Conectar já acorda uma vez (trabalho que chegou com a escuta fora).
    await waitFor(() => listener!.connected && wakes === 1)
    await notifyWake(api, CHANNEL)
    await waitFor(() => wakes === 2)

    const killed = await api.query(`select pg_terminate_backend(pid) from pg_stat_activity where query ilike $1 and pid <> pg_backend_pid()`, [`listen ${CHANNEL}%`])
    expect(killed.rowCount).toBeGreaterThan(0)
    await waitFor(() => !listener!.connected)
    await waitFor(() => listener!.connected && wakes === 3, 15_000)
    await notifyWake(api, CHANNEL)
    await waitFor(() => wakes === 4)
  }, 30_000)
})
