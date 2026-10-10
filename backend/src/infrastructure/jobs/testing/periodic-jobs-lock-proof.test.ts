import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createExclusiveJobRunner, JOB_LOCK_NAMESPACE, jobLockKey, startPeriodicJobs } from "../periodic-jobs.js"

/**
 * PROVA contra o PostgreSQL de TESTE — tarefas periódicas com 2+ processos (INIA_PROCESS_ROLE=api|worker, ou dois workers):
 * cada "processo" aqui é um pool próprio (sessões diferentes, como dois processos Node de verdade).
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run periodic-jobs-lock-proof
 *
 * Travas consultivas são por banco: esta prova (inia_test) não interfere num servidor rodando em outro banco.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const run = randomUUID().slice(0, 8)

let processA: pg.Pool
let processB: pg.Pool

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!ENABLED)("tarefas periódicas — trava no PostgreSQL real com dois processos", () => {
  beforeAll(() => {
    processA = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    processB = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    // Como o pool de produção (pool.ts): conexão derrubada pelo servidor não derruba o processo.
    for (const pool of [processA, processB]) pool.on("error", () => {})
  })
  afterAll(async () => {
    await processA.query(`delete from periodic_job_runs where name like $1`, [`proof-${run}-%`])
    await Promise.all([processA.end(), processB.end()])
  })

  it("a mesma tarefa ao mesmo tempo: um processo roda, o outro pula a rodada sem esperar; depois da rodada a trava volta", async () => {
    const name = `proof-${run}-same-job`
    const runnerA = createExclusiveJobRunner(processA)
    const runnerB = createExclusiveJobRunner(processB)
    let release!: () => void
    const holding = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = runnerA(name, async () => {
      await holding
      return "A"
    })
    await sleep(100)
    const startedAt = Date.now()
    await expect(runnerB(name, async () => "B")).resolves.toEqual({ ran: false, reason: "LOCKED" })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    const visible = await processB.query<{ granted: boolean }>(`select granted from pg_locks where locktype = 'advisory' and classid = $1::oid and objid = $2::oid and database = (select oid from pg_database where datname = current_database())`, [JOB_LOCK_NAMESPACE, jobLockKey(name) >>> 0])
    expect(visible.rows).toEqual([{ granted: true }])
    release()
    await expect(first).resolves.toEqual({ ran: true, value: "A" })
    await expect(runnerB(name, async () => "B")).resolves.toEqual({ ran: true, value: "B" })
  })

  it("processo morto no meio da rodada (sessão encerrada): a trava cai junto e o outro processo assume na rodada seguinte", async () => {
    const name = `proof-${run}-crash`
    const victim = await processA.connect()
    const locked = await victim.query<{ locked: boolean; pid: number }>("select pg_try_advisory_lock($1, $2) as locked, pg_backend_pid() as pid", [JOB_LOCK_NAMESPACE, jobLockKey(name)])
    expect(locked.rows[0]!.locked).toBe(true)
    const runnerB = createExclusiveJobRunner(processB)
    await expect(runnerB(name, async () => "B")).resolves.toEqual({ ran: false, reason: "LOCKED" })
    victim.on("error", () => {})
    await processB.query("select pg_terminate_backend($1)", [locked.rows[0]!.pid])
    victim.release(true)
    await sleep(100)
    await expect(runnerB(name, async () => "B")).resolves.toEqual({ ran: true, value: "B" })
  })

  it("dois processos agendando a MESMA tarefa a cada 150 ms durante 2 s: nunca duas rodadas ao mesmo tempo nem duas no mesmo intervalo", async () => {
    const name = `proof-${run}-schedule`
    const rounds: { process: string; start: number; end: number }[] = []
    const job = (process: string) => async () => {
      const start = Date.now()
      await sleep(120)
      rounds.push({ process, start, end: Date.now() })
    }
    const jobsA = startPeriodicJobs(createExclusiveJobRunner(processA), [{ name, intervalMs: 150, runOnStart: true, run: job("A") }])
    const jobsB = startPeriodicJobs(createExclusiveJobRunner(processB), [{ name, intervalMs: 150, runOnStart: true, run: job("B") }])
    await sleep(2_000)
    await Promise.all([jobsA.stop(), jobsB.stop()])
    const sorted = [...rounds].sort((a, b) => a.start - b.start)
    for (let index = 1; index < sorted.length; index++) expect(sorted[index]!.start).toBeGreaterThanOrEqual(sorted[index - 1]!.end)
    // Uma rodada por intervalo no conjunto: partidas separadas por ≥ 90% do intervalo (135 ms; folga de relógio de 10 ms).
    for (let index = 1; index < sorted.length; index++) expect(sorted[index]!.start - sorted[index - 1]!.start).toBeGreaterThanOrEqual(125)
    expect(rounds.length).toBeLessThanOrEqual(Math.ceil(2_000 / 135) + 1)
    const statuses = [...jobsA.status(), ...jobsB.status()]
    expect(rounds.length).toBe(statuses.reduce((sum, status) => sum + status.runs, 0))
    expect(rounds.length).toBeGreaterThan(5)
    expect(statuses.reduce((sum, status) => sum + status.skippedLocked, 0)).toBeGreaterThan(0)
    process.stdout.write(`[periodic-jobs-lock-proof] ${rounds.length} rodadas (A=${rounds.filter((r) => r.process === "A").length}, B=${rounds.filter((r) => r.process === "B").length}), puladas por trava=${statuses.reduce((sum, s) => sum + s.skippedLocked, 0)}, sobreposições=0\n`)
  })
})
