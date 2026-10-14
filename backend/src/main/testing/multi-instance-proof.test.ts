import { fork, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../config/env.js"
import { loginIdentifierHash } from "../../modules/auth/infrastructure/postgres-credential-store.js"

/**
 * PROVA — DOIS PROCESSOS DE API de verdade (Node separados, cada um com o próprio pool e a mesma ligação do server.ts),
 * contra o PostgreSQL de TESTE:
 *   1. o limite de login (IP + e-mail) é UM só: tentativas alternadas entre as duas APIs esgotam o teto da soma, não o de cada
 *      processo (antes, em memória, cada processo deixava passar o teto inteiro);
 *   2. as VAGAS de uma conexão de IA (as da tela de Provedores) valem para a soma das instâncias: com a conexão cheia na API A,
 *      a chamada da API B espera e sai quando A solta uma vaga; o lote nunca ocupa a reserva da interativa;
 *   3. o 429 de uma conexão recebido pela API A pausa os LOTES da API B naquela conexão — outra conexão segue, e a interativa
 *      nunca é pausada.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run multi-instance-proof
 *
 * Nenhuma API paga: o "provedor" é uma função dentro do processo filho; as chaves são de mentira (`connection:prova-…`).
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const here = dirname(fileURLToPath(import.meta.url))
const run = randomUUID().slice(0, 8)
const LOGIN_LIMIT = 4
const EMAIL = `prova-multi-instancia-${run}@inia.invalid`
const CLIENT_IP = "198.51.100.77"

type Child = { process: ChildProcess; port: number; pid: number; request<T>(command: Record<string, unknown>): Promise<T> }

function startApi(): Promise<Child> {
  return new Promise((resolve, reject) => {
    const child = fork(join(here, "multi-instance-child.ts"), [], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, NODE_ENV: "test", PROOF_LOGIN_LIMIT: String(LOGIN_LIMIT), TRUST_PROXY: "loopback", INIA_AI_LIMITER: "ON" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    let sequence = 0
    const pending = new Map<number, (value: unknown) => void>()
    child.on("message", (raw) => {
      const message = raw as { type: string; id?: number; port?: number; pid?: number }
      if (message.type === "ready") {
        resolve({
          process: child,
          port: message.port!,
          pid: message.pid!,
          request: <T,>(command: Record<string, unknown>) =>
            new Promise<T>((done) => {
              const id = ++sequence
              pending.set(id, done as (value: unknown) => void)
              child.send({ ...command, id })
            }),
        })
        return
      }
      if (message.id !== undefined) pending.get(message.id)?.(message)
    })
    child.on("exit", (code) => reject(new Error(`processo de API saiu (${code}) antes de ficar pronto: ${stderr.slice(-2000)}`)))
  })
}

let db: pg.Pool
let apiA: Child
let apiB: Child

const login = (api: Child) =>
  fetch(`http://127.0.0.1:${api.port}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": CLIENT_IP }, body: JSON.stringify({ email: EMAIL, password: "senha-errada-123" }) })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!ENABLED)("dois processos de API dividem o estado (PostgreSQL de teste)", () => {
  beforeAll(async () => {
    db = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    ;[apiA, apiB] = await Promise.all([startApi(), startApi()])
  }, 60_000)

  afterAll(async () => {
    for (const api of [apiA, apiB]) {
      if (!api) continue
      const exited = new Promise((resolve) => api.process.once("exit", resolve))
      api.process.send({ type: "stop", id: 0 })
      await Promise.race([exited, sleep(5_000)])
      api.process.kill()
    }
    await db.query(`delete from auth_login_attempts where identifier_hash = $1`, [loginIdentifierHash(EMAIL)])
    await db.query(`delete from ai_provider_cooldowns where scope like $1`, [`connection:prova-${run}-%`])
    await db.query(`delete from ai_call_slot_leases where key like $1`, [`connection:prova-${run}-%`])
    await db.end()
  }, 30_000)

  it("são dois processos de verdade", () => {
    expect(apiA.pid).not.toBe(apiB.pid)
    expect(apiA.port).not.toBe(apiB.port)
    expect([apiA.pid, apiB.pid]).not.toContain(process.pid)
  })

  it("login: tentativas alternadas entre as duas APIs esgotam UM teto de IP + e-mail (a 5ª é 429 — em memória seria a 9ª)", async () => {
    const statuses: number[] = []
    for (let index = 0; index < LOGIN_LIMIT + 2; index += 1) statuses.push((await login(index % 2 === 0 ? apiA : apiB)).status)
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429])
    const blocked = await login(apiB)
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/)
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED")
  })

  it("vagas da conexão: com a conexão cheia na API A, a chamada da API B espera e sai quando A solta uma vaga", async () => {
    const key = `connection:prova-${run}-vagas`
    const holdIds = [(await apiA.request<{ id: number }>({ type: "hold", key, max: 2, priority: "INTERACTIVE" })).id, (await apiA.request<{ id: number }>({ type: "hold", key, max: 2, priority: "INTERACTIVE" })).id]
    expect((await apiA.request<{ stats: { held: Record<string, number> } }>({ type: "gate-stats" })).stats.held[key]).toBe(2)
    const probe = apiB.request<{ waitedMs: number }>({ type: "probe", key, max: 2, priority: "INTERACTIVE" })
    await sleep(1_200)
    const leases = await db.query<{ n: number }>(`select count(*)::int n from ai_call_slot_leases where key = $1 and expires_at > now()`, [key])
    expect(leases.rows[0]!.n).toBe(2)
    await apiA.request({ type: "release", holdId: holdIds[0] })
    const done = await probe
    expect(done.waitedMs).toBeGreaterThan(1_000)
    await apiA.request({ type: "release", holdId: holdIds[1] })
  }, 30_000)

  it("reserva da interativa: com o LOTE ocupando a parte dele (3 de 4) na API A, outro lote na API B espera e o chat da B sai na hora", async () => {
    const key = `connection:prova-${run}-reserva`
    const holds: number[] = []
    for (let index = 0; index < 3; index += 1) holds.push((await apiA.request<{ id: number }>({ type: "hold", key, max: 4, priority: "BATCH" })).id)
    const chat = await apiB.request<{ waitedMs: number }>({ type: "probe", key, max: 4, priority: "INTERACTIVE" })
    expect(chat.waitedMs).toBeLessThan(1_000)
    const batch = apiB.request<{ waitedMs: number }>({ type: "probe", key, max: 4, priority: "BATCH" })
    await sleep(1_000)
    await apiA.request({ type: "release", holdId: holds[0] })
    expect((await batch).waitedMs).toBeGreaterThan(800)
    for (const holdId of holds.slice(1)) await apiA.request({ type: "release", holdId })
  }, 30_000)

  it("pausa por conexão: o 429 recebido pela API A pausa os lotes da API B NAQUELA conexão; outra conexão e o chat seguem", async () => {
    const paused = `connection:prova-${run}-pausada`
    const other = `connection:prova-${run}-outra`
    const fromA = await apiA.request<{ stats: { cooldowns: Record<string, string> } }>({ type: "rate-limited", key: paused, retryAfterMs: 5_000 })
    expect(Object.keys(fromA.stats.cooldowns)).toContain(paused)
    const row = await db.query<{ remaining: number; reason: string; source: string }>(`select (extract(epoch from paused_until - clock_timestamp()) * 1000)::float8 remaining, reason, source from ai_provider_cooldowns where scope = $1`, [paused])
    expect(row.rows[0]).toMatchObject({ reason: "RATE_LIMIT" })
    expect(row.rows[0]!.remaining).toBeGreaterThan(2_500)
    expect(row.rows[0]!.source).toContain(`#${apiA.pid}`)

    // A API B lê as pausas em até um intervalo (2 s).
    await sleep(2_300)
    const statsB = await apiB.request<{ stats: { cooldowns: Record<string, string> } }>({ type: "gate-stats" })
    expect(Object.keys(statsB.stats.cooldowns)).toEqual([paused])
    const [otherBatch, chat] = await Promise.all([
      apiB.request<{ waitedMs: number }>({ type: "probe", key: other, max: null, priority: "BATCH" }),
      apiB.request<{ waitedMs: number }>({ type: "probe", key: paused, max: null, priority: "INTERACTIVE" }),
    ])
    expect(otherBatch.waitedMs).toBeLessThan(500)
    expect(chat.waitedMs).toBeLessThan(500)
    const pausedBatch = await apiB.request<{ waitedMs: number }>({ type: "probe", key: paused, max: null, priority: "BATCH" })
    expect(pausedBatch.waitedMs).toBeGreaterThan(1_500)
  }, 30_000)
})
