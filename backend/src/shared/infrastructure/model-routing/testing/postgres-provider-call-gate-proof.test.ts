import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../../config/env.js"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { AiProviderError } from "../../../application/model-routing/ai-errors.js"
import { createPostgresProviderCallGate } from "../postgres-provider-call-gate.js"

/**
 * PROVA contra o PostgreSQL de TESTE — portão por conexão de IA (migrations 127 e 137): vaga de um processo que morreu volta
 * quando o prazo vence; quem desiste (cancelado) não deixa vaga presa; a interativa não espera para sempre; banco fora não
 * derruba a chamada; 429 grava a pausa da conexão antes de o erro voltar. A prova com dois processos de API está em
 * `main/testing/multi-instance-proof.test.ts`.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run postgres-provider-call-gate-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const run = randomUUID().slice(0, 8)
const key = (name: string) => `connection:prova-portao-${run}-${name}`

let pool: pg.Pool
const gates: { stop(): void }[] = []
const gateOf = (options: Partial<Parameters<typeof createPostgresProviderCallGate>[1]> = {}) => {
  const gate = createPostgresProviderCallGate(pool, { source: "prova", slotPollMs: 30, ...options })
  gates.push(gate)
  return gate
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!ENABLED)("portão por conexão de IA no PostgreSQL real", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    pool.on("error", () => {})
  })
  afterAll(async () => {
    for (const gate of gates) gate.stop()
    await pool.query(`delete from ai_call_slot_leases where key like $1`, [`connection:prova-portao-${run}-%`])
    await pool.query(`delete from ai_provider_cooldowns where scope like $1`, [`connection:prova-portao-${run}-%`])
    await pool.end()
  })

  it("vaga de um processo que morreu (sem renovar) volta quando o prazo vence; vaga viva nunca é tomada", async () => {
    const k = key("morto")
    await pool.query(`insert into ai_call_slot_leases (key, slot, priority, holder, expires_at) values ($1, 1, 'INTERACTIVE', 'morto', clock_timestamp() - interval '1 second'), ($1, 2, 'INTERACTIVE', 'vivo', clock_timestamp() + interval '1 minute')`, [k])
    const gate = gateOf()
    let holder = ""
    await gate.run({ key: k, maxConcurrent: 2, priority: "INTERACTIVE" }, async () => {
      holder = (await pool.query<{ holder: string }>(`select holder from ai_call_slot_leases where key = $1 and slot = 1`, [k])).rows[0]!.holder
    })
    expect(holder).toMatch(/^prova:/)
    expect((await pool.query(`select holder from ai_call_slot_leases where key = $1 and slot = 2`, [k])).rows[0]).toEqual({ holder: "vivo" })
    // Ao terminar, a vaga 1 sai da tabela.
    await sleep(100)
    expect((await pool.query(`select 1 from ai_call_slot_leases where key = $1 and slot = 1`, [k])).rowCount).toBe(0)
  })

  it("cancelada esperando vaga: sai na hora com AI_CALL_CANCELLED e não deixa vaga presa; a interativa desiste com AI_CAPACITY_BUSY", async () => {
    const k = key("cheia")
    const gate = gateOf({ interactiveWaitMs: 300 })
    let release!: () => void
    const holding = gate.run({ key: k, maxConcurrent: 1, priority: "BATCH" }, () => new Promise<void>((resolve) => (release = resolve)))
    await sleep(100)
    const cancel = new AbortController()
    const waiting = gate.run({ key: k, maxConcurrent: 1, priority: "BATCH", signal: cancel.signal }, async () => "não devia rodar").catch((error: unknown) => error)
    await sleep(100)
    expect(gate.stats().waiting[k]).toBe(1)
    cancel.abort()
    expect(await waiting).toMatchObject({ code: "AI_CALL_CANCELLED" })
    const busy = await gate.run({ key: k, maxConcurrent: 1, priority: "INTERACTIVE" }, async () => "não devia rodar").catch((error: unknown) => error)
    expect(busy).toMatchObject({ code: "AI_CAPACITY_BUSY", statusCode: 503 })
    release()
    await holding
    await sleep(100)
    expect((await pool.query(`select 1 from ai_call_slot_leases where key = $1 and expires_at > now()`, [k])).rowCount).toBe(0)
    expect(gate.stats()).toMatchObject({ held: {}, waiting: {} })
  })

  it("429 da conexão: a pausa já está no banco quando o erro volta; sem teto (null) não usa vagas", async () => {
    const k = key("pausa")
    const gate = gateOf()
    const error = await gate.run({ key: k, maxConcurrent: null, priority: "INTERACTIVE" }, async () => {
      throw new AiProviderError("RATE_LIMIT", { httpStatus: 429, retryAfterMs: 4_000 })
    }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "AI_RATE_LIMIT" })
    const row = await pool.query<{ remaining: number; reason: string }>(`select (extract(epoch from paused_until - clock_timestamp()) * 1000)::float8 remaining, reason from ai_provider_cooldowns where scope = $1`, [k])
    expect(row.rows[0]!.reason).toBe("RATE_LIMIT")
    expect(row.rows[0]!.remaining).toBeGreaterThan(3_000)
    expect(gate.cooldownRemainingMs(k)).toBeGreaterThan(3_000)
    expect((await pool.query(`select 1 from ai_call_slot_leases where key = $1`, [k])).rowCount).toBe(0)
  })

  it("banco fora: a chamada sai mesmo assim (o portão nunca derruba a IA)", async () => {
    const down = { query: async () => { throw new Error("connection refused") } } as unknown as Pick<Database, "query">
    const gate = createPostgresProviderCallGate(down, { source: "prova" })
    gates.push(gate)
    await expect(gate.run({ key: key("fora"), maxConcurrent: 2, priority: "BATCH" }, async () => "respondeu")).resolves.toBe("respondeu")
  })
})
