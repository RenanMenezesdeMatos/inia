import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../../config/env.js"
import { createPostgresRateLimitStore, purgeExpiredRateLimitHits } from "../postgres-rate-limit-store.js"

/**
 * PROVA contra o PostgreSQL de TESTE — limites de requisição compartilhados (migration 126). Cada "processo" aqui é um pool
 * próprio (sessões diferentes, como dois processos Node). A prova com dois processos de API de verdade (HTTP) está em
 * `main/testing/multi-instance-proof.test.ts`.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run postgres-rate-limit-store-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const run = randomUUID().slice(0, 8)

let processA: pg.Pool
let processB: pg.Pool

describe.skipIf(!ENABLED)("limites de requisição no PostgreSQL real", () => {
  beforeAll(() => {
    processA = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    processB = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    for (const pool of [processA, processB]) pool.on("error", () => {})
  })
  afterAll(async () => {
    await processA.query(`delete from rate_limit_hits where bucket like $1`, [`proof-${run}-%`])
    await Promise.all([processA.end(), processB.end()])
  })

  it("dois processos dividem o contador: o teto vale para a soma, não para cada um", async () => {
    const storeA = createPostgresRateLimitStore(processA)
    const storeB = createPostgresRateLimitStore(processB)
    const bucket = `proof-${run}-shared`
    const outcomes: boolean[] = []
    for (let index = 0; index < 6; index += 1) outcomes.push((await (index % 2 === 0 ? storeA : storeB).consume(bucket, 60_000, 4)).allowed)
    expect(outcomes).toEqual([true, true, true, true, false, false])
    const blocked = await storeB.consume(bucket, 60_000, 4)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000)
    // Recusada não conta: o contador ficou em 4.
    expect((await processA.query(`select sum(hits)::int hits from rate_limit_hits where bucket = $1`, [bucket])).rows[0]).toEqual({ hits: 4 })
  })

  it("corrida na última vaga: 20 requisições simultâneas em dois processos, só `max` passam", async () => {
    const storeA = createPostgresRateLimitStore(processA)
    const storeB = createPostgresRateLimitStore(processB)
    const bucket = `proof-${run}-race`
    const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? storeA : storeB).consume(bucket, 60_000, 7)))
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(7)
  })

  it("só falhas: conferir não conta; registrar conta; o teto barra depois", async () => {
    const store = createPostgresRateLimitStore(processA)
    const bucket = `proof-${run}-failures`
    expect((await store.check(bucket, 60_000, 2)).allowed).toBe(true)
    expect((await store.check(bucket, 60_000, 2)).allowed).toBe(true)
    await store.record(bucket, 60_000)
    await createPostgresRateLimitStore(processB).record(bucket, 60_000)
    expect((await store.check(bucket, 60_000, 2)).allowed).toBe(false)
  })

  it("janela anterior pesa e some: contador de uma janela vencida não barra nada e sai na limpeza", async () => {
    const store = createPostgresRateLimitStore(processA)
    const bucket = `proof-${run}-expired`
    // Janela de 1 s: três janelas depois, nem a "anterior" conta mais.
    for (let index = 0; index < 3; index += 1) await store.consume(bucket, 1_000, 3)
    expect((await store.consume(bucket, 1_000, 3)).allowed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect((await store.consume(bucket, 1_000, 3)).allowed).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    await purgeExpiredRateLimitHits(processB)
    const left = await processA.query(`select window_index from rate_limit_hits where bucket = $1`, [bucket])
    expect(left.rowCount).toBe(0)
  })
})
