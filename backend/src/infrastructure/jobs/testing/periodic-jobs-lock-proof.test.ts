import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import { createPostgresJobLockClient, createPostgresJobLockSession, JOB_LOCK_QUERY_TIMEOUT_MS, JobLockLostError, type JobLockSession } from "../job-lock-session.js"
import { JOB_LOCK_NAMESPACE, jobLockKey, startPeriodicJobs, type JobLease } from "../periodic-jobs.js"

/**
 * PROVA contra o PostgreSQL de TESTE — tarefas periódicas com 2+ processos (INIA_PROCESS_ROLE=api|worker, ou dois workers),
 * com as travas na conexão PRÓPRIA de cada processo (job-lock-session.ts): cada "instância" aqui é uma sessão de travas com
 * `application_name` próprio — sessões diferentes no banco, como dois processos Node de verdade. Nenhum pool entra na trava.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run periodic-jobs-lock-proof --no-file-parallelism
 *
 * Travas consultivas são por banco: esta prova (inia_test) não interfere num servidor rodando em outro banco.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const run = randomUUID().slice(0, 8)

let observer: pg.Pool
const opened: JobLockSession[] = []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function instance(label: string): { locks: JobLockSession; applicationName: string } {
  const locks = createPostgresJobLockSession({ connectionString: env.TEST_DATABASE_URL, applicationName: `inia-proof-${run}-${label}`, log: () => {} })
  opened.push(locks)
  return { locks, applicationName: `inia-proof-${run}-${label}:locks` }
}

/** Conexões abertas no banco com este `application_name` (= conexões que a instância usa para as travas). */
async function connectionsOf(applicationName: string): Promise<{ pid: number }[]> {
  return (await observer.query<{ pid: number }>(`select pid from pg_stat_activity where application_name = $1 and datname = current_database()`, [applicationName])).rows
}

/** Quem segura a trava da tarefa agora (pela visão do banco). */
async function holderOf(name: string): Promise<string[]> {
  const rows = await observer.query<{ application_name: string }>(
    `select a.application_name from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and l.classid = $1::oid and l.objid = $2::oid and l.objsubid = 2
        and l.database = (select oid from pg_database where datname = current_database())`,
    [JOB_LOCK_NAMESPACE, jobLockKey(name) >>> 0],
  )
  return rows.rows.map((row) => row.application_name)
}

function gate() {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe.skipIf(!ENABLED)("tarefas periódicas — travas numa conexão própria por processo, PostgreSQL real com duas instâncias", () => {
  beforeAll(async () => {
    observer = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    observer.on("error", () => {})
    const database = (await observer.query<{ name: string }>("select current_database() as name")).rows[0]!.name
    // Nunca o banco de desenvolvimento compartilhado.
    expect(database).toMatch(/_test$/)
  })
  afterAll(async () => {
    await Promise.all(opened.map((locks) => locks.stop()))
    await observer.query(`delete from periodic_job_runs where name like $1`, [`proof-${run}-%`])
    await observer.end()
  })

  it("duas instâncias, a mesma tarefa ao mesmo tempo: só uma roda, a outra pula sem esperar; todas as travas de uma instância numa conexão só", async () => {
    const A = instance("A")
    const B = instance("B")
    await vi.waitFor(() => expect(A.locks.connected && B.locks.connected).toBe(true), { timeout: 5_000 })
    const names = ["same-job", "other-1", "other-2"].map((suffix) => `proof-${run}-${suffix}`)
    const hold = gate()
    let runs = 0
    const rounds = names.map((name) =>
      A.locks.runExclusive(name, async () => {
        runs++
        await hold.promise
        return "A"
      }),
    )
    await vi.waitFor(() => expect(runs).toBe(3))
    const startedAt = Date.now()
    await expect(B.locks.runExclusive(names[0]!, async () => (runs++, "B"))).resolves.toEqual({ ran: false, reason: "LOCKED" })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    // O banco confirma: as três travas com a sessão de travas de A — uma única conexão de A, nenhuma do pool.
    for (const name of names) expect(await holderOf(name)).toEqual([A.applicationName])
    expect(await connectionsOf(A.applicationName)).toHaveLength(1)
    expect(await connectionsOf(B.applicationName)).toHaveLength(1)
    hold.open()
    await expect(Promise.all(rounds)).resolves.toEqual(names.map(() => ({ ran: true, value: "A" })))
    expect(runs).toBe(3)
    expect(await holderOf(names[0]!)).toEqual([])
    await expect(B.locks.runExclusive(names[0]!, async () => "B")).resolves.toEqual({ ran: true, value: "B" })
  })

  it("reentrância: o PostgreSQL deixa a MESMA sessão pegar a mesma chave duas vezes — por isso a guarda do processo devolve BUSY", async () => {
    const raw = new pg.Client({ connectionString: env.TEST_DATABASE_URL })
    await raw.connect()
    try {
      const key = jobLockKey(`proof-${run}-reentrant-raw`)
      const twice = await raw.query<{ first: boolean; second: boolean }>("select pg_try_advisory_lock($1, $2) as first, pg_try_advisory_lock($1, $2) as second", [JOB_LOCK_NAMESPACE, key])
      expect(twice.rows[0]).toEqual({ first: true, second: true })
    } finally {
      await raw.end()
    }
    const A = instance("R")
    await vi.waitFor(() => expect(A.locks.connected).toBe(true), { timeout: 5_000 })
    const name = `proof-${run}-reentrant`
    const hold = gate()
    let runs = 0
    const first = A.locks.runExclusive(name, async () => {
      runs++
      await hold.promise
    })
    await vi.waitFor(() => expect(runs).toBe(1))
    await expect(A.locks.runExclusive(name, async () => runs++)).resolves.toEqual({ ran: false, reason: "BUSY" })
    hold.open()
    await first
    expect(runs).toBe(1)
    // Nenhum contador de reentrância ficou no banco: a trava foi solta de verdade.
    expect(await holderOf(name)).toEqual([])
  })

  it("conexão das travas derrubada no meio da rodada: o banco solta a trava, a tarefa recebe o sinal, a outra instância assume e a sessão reabre", async () => {
    const A = instance("K")
    const B = instance("L")
    await vi.waitFor(() => expect(A.locks.connected && B.locks.connected).toBe(true), { timeout: 5_000 })
    const name = `proof-${run}-crash`
    const hold = gate()
    let lease: JobLease | null = null
    const round = A.locks.runExclusive(name, async (current) => {
      lease = current
      await hold.promise
      return "A terminou"
    })
    await vi.waitFor(() => expect(lease).not.toBeNull())
    expect(await holderOf(name)).toEqual([A.applicationName])
    const [backend] = await connectionsOf(A.applicationName)
    await observer.query("select pg_terminate_backend($1)", [backend!.pid])
    await vi.waitFor(() => expect(lease!.signal.aborted).toBe(true), { timeout: 5_000 })
    expect(lease!.signal.reason).toBeInstanceOf(JobLockLostError)
    expect(await holderOf(name)).toEqual([])
    // A outra instância pega a mesma tarefa na hora.
    await expect(B.locks.runExclusive(name, async () => "B")).resolves.toEqual({ ran: true, value: "B" })
    hold.open()
    await expect(round).resolves.toEqual({ ran: true, value: "A terminou", lockLost: true })
    // Reconexão sozinha (espera de 1 s), numa sessão nova do banco.
    await vi.waitFor(() => expect(A.locks.status()).toMatchObject({ connected: true, generation: 2, losses: 1, leasesLost: 1 }), { timeout: 5_000 })
    const [reopened] = await connectionsOf(A.applicationName)
    expect(reopened!.pid).not.toBe(backend!.pid)
    await expect(A.locks.runExclusive(name, async () => "A de novo")).resolves.toEqual({ ran: true, value: "A de novo" })
  })

  it("sessão das travas no banco: `application_name` do processo + `:locks`, ociosidade nunca a encerra, keepalive TCP e limite de comando curto", async () => {
    const client = createPostgresJobLockClient({ connectionString: env.TEST_DATABASE_URL, applicationName: `inia-proof-${run}-P` })
    await client.connect()
    try {
      const settings = await client.query(
        `select current_setting('application_name') as application_name, current_setting('idle_session_timeout') as idle_session_timeout,
                current_setting('tcp_keepalives_idle') as tcp_keepalives_idle, current_setting('tcp_keepalives_interval') as tcp_keepalives_interval,
                current_setting('statement_timeout') as statement_timeout, inet_client_addr() is null as unix_socket`,
      )
      const row = settings.rows[0] as Record<string, string | boolean>
      expect(row).toMatchObject({ application_name: `inia-proof-${run}-P:locks`, idle_session_timeout: "0", statement_timeout: `${JOB_LOCK_QUERY_TIMEOUT_MS / 1000}s` })
      // Por socket Unix o PostgreSQL ignora o keepalive TCP (e mostra 0).
      if (!row.unix_socket) expect(row).toMatchObject({ tcp_keepalives_idle: "30", tcp_keepalives_interval: "10" })
      process.stdout.write(`[periodic-jobs-lock-proof] sessão de travas: ${JSON.stringify(row)}\n`)
    } finally {
      await client.end()
    }
  })

  it("banco inalcançável: a rodada é pulada (UNAVAILABLE) e a tarefa nunca roda sem trava", async () => {
    const unreachable = new URL(env.TEST_DATABASE_URL)
    unreachable.port = "1"
    const locks = createPostgresJobLockSession({ connectionString: unreachable.toString(), applicationName: `inia-proof-${run}-X`, queryTimeoutMs: 2_000, log: () => {} })
    opened.push(locks)
    let runs = 0
    await expect(locks.runExclusive(`proof-${run}-unreachable`, async () => runs++)).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    await expect(locks.runExclusive(`proof-${run}-unreachable`, async () => runs++)).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    expect(runs).toBe(0)
    expect(locks.status().connected).toBe(false)
  })

  it("duas instâncias agendando a MESMA tarefa a cada 150 ms durante 2 s: nunca duas rodadas juntas, uma por intervalo, e cada instância com uma conexão de travas", async () => {
    const A = instance("SA")
    const B = instance("SB")
    await vi.waitFor(() => expect(A.locks.connected && B.locks.connected).toBe(true), { timeout: 5_000 })
    const name = `proof-${run}-schedule`
    const rounds: { process: string; start: number; end: number }[] = []
    const job = (process: string) => async () => {
      const start = Date.now()
      await sleep(120)
      rounds.push({ process, start, end: Date.now() })
    }
    const jobsA = startPeriodicJobs(A.locks.runExclusive, [{ name, intervalMs: 150, runOnStart: true, run: job("A") }])
    const jobsB = startPeriodicJobs(B.locks.runExclusive, [{ name, intervalMs: 150, runOnStart: true, run: job("B") }])
    const samples: number[] = []
    for (let index = 0; index < 8; index++) {
      await sleep(250)
      samples.push((await connectionsOf(A.applicationName)).length, (await connectionsOf(B.applicationName)).length)
    }
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
    expect(new Set(samples)).toEqual(new Set([1]))
    process.stdout.write(
      `[periodic-jobs-lock-proof] ${rounds.length} rodadas (A=${rounds.filter((r) => r.process === "A").length}, B=${rounds.filter((r) => r.process === "B").length}), puladas por trava=${statuses.reduce((sum, s) => sum + s.skippedLocked, 0)}, sobreposições=0, conexões de trava por instância=1 em ${samples.length} amostras\n`,
    )
  })
})
