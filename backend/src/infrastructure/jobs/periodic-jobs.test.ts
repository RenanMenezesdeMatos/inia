import { afterEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../database/pool.js"
import { createExclusiveJobRunner, JOB_LOCK_NAMESPACE, jobLockKey, startPeriodicJobs } from "./periodic-jobs.js"

/**
 * Tarefas periódicas com 2+ processos: a trava consultiva do PostgreSQL decide quem roda cada rodada. O "banco" daqui é falso
 * e compartilhado entre dois "processos" (dois runners), com a semântica de `pg_try_advisory_lock`: trava por sessão
 * (conexão), soltar devolve, conexão destruída solta. A prova contra o PostgreSQL real está em
 * `testing/periodic-jobs-lock-proof.test.ts`.
 */
type FakeClient = { id: number; query: (sql: string, params: unknown[]) => Promise<{ rows: { locked: boolean }[]; rowCount?: number }>; release: (destroy?: boolean) => void }

/** Cada conexão = uma sessão do PostgreSQL, com id único entre os dois "processos". */
let sessions = 0

/** `periodic_job_runs` do banco falso — compartilhado entre os "processos", como a tabela real. */
const lastStarts = new Map<string, number>()

function fakeDatabase(locks: Map<string, number>, options: { failUnlock?: boolean } = {}) {
  const released: { id: number; destroyed: boolean }[] = []
  const db = {
    async connect() {
      const id = ++sessions
      const client: FakeClient = {
        id,
        async query(sql, params) {
          const key = `${params[0]}:${params[1]}`
          if (sql.includes("pg_try_advisory_lock")) {
            if (locks.has(key) && locks.get(key) !== id) return { rows: [{ locked: false }] }
            locks.set(key, id)
            return { rows: [{ locked: true }] }
          }
          if (sql.includes("periodic_job_runs")) {
            const [name, minIntervalMs] = params as [string, number]
            const last = lastStarts.get(name)
            if (last !== undefined && last > Date.now() - minIntervalMs) return { rows: [], rowCount: 0 }
            lastStarts.set(name, Date.now())
            return { rows: [], rowCount: 1 }
          }
          if (sql.includes("pg_advisory_unlock")) {
            if (options.failUnlock) throw new Error("conexão caiu")
            if (locks.get(key) === id) locks.delete(key)
            return { rows: [] }
          }
          throw new Error(`sql inesperado: ${sql}`)
        },
        release(destroy) {
          released.push({ id, destroyed: destroy === true })
          // Sessão encerrada = travas soltas (o que o PostgreSQL faz ao fechar a conexão).
          if (destroy) for (const [key, owner] of locks) if (owner === id) locks.delete(key)
        },
      }
      return client
    },
  } as unknown as Pick<Database, "connect">
  return { db, released }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("trava das tarefas periódicas", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("chave estável de dois inteiros: namespace INIA + hash do nome (int4 com sinal)", () => {
    expect(JOB_LOCK_NAMESPACE).toBe(1_229_867_329)
    expect(jobLockKey("workflow-schedule")).toBe(jobLockKey("workflow-schedule"))
    expect(jobLockKey("workflow-schedule")).not.toBe(jobLockKey("data-hub"))
    for (const name of ["workflow-schedule", "data-hub", "calendar", "feedback-delivery-sweeper", "usage-analytics-activity"]) {
      const key = jobLockKey(name)
      expect(Number.isInteger(key) && key >= -(2 ** 31) && key < 2 ** 31).toBe(true)
    }
  })

  it("dois processos, mesma tarefa ao mesmo tempo: só um roda; o outro pula a rodada sem esperar; depois a trava volta", async () => {
    const locks = new Map<string, number>()
    const processA = createExclusiveJobRunner(fakeDatabase(locks).db)
    const processB = createExclusiveJobRunner(fakeDatabase(locks).db)
    const gate = deferred()
    let runs = 0
    const first = processA("workflow-schedule", async () => {
      runs++
      await gate.promise
      return "A"
    })
    await new Promise((resolve) => setImmediate(resolve))
    await expect(processB("workflow-schedule", async () => (runs++, "B"))).resolves.toEqual({ ran: false, reason: "LOCKED" })
    // Outra tarefa não é bloqueada pela primeira.
    await expect(processB("data-hub", async () => "outra")).resolves.toEqual({ ran: true, value: "outra" })
    gate.resolve()
    await expect(first).resolves.toEqual({ ran: true, value: "A" })
    expect(runs).toBe(1)
    await expect(processB("workflow-schedule", async () => "B")).resolves.toEqual({ ran: true, value: "B" })
    expect(locks.size).toBe(0)
  })

  it("uma vez por intervalo no conjunto: com timers defasados, o outro processo pula (RECENT) até passar o intervalo", async () => {
    vi.useFakeTimers()
    const locks = new Map<string, number>()
    const processA = createExclusiveJobRunner(fakeDatabase(locks).db)
    const processB = createExclusiveJobRunner(fakeDatabase(locks).db)
    const name = `interval-${Math.random()}`
    await expect(processA(name, async () => "A", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: true, value: "A" })
    await vi.advanceTimersByTimeAsync(7_000)
    await expect(processB(name, async () => "B", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: false, reason: "RECENT" })
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(processA(name, async () => "A", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: true, value: "A" })
    expect(locks.size).toBe(0)
  })

  it("falha da tarefa solta a trava e devolve a conexão; falha ao soltar DESCARTA a conexão (a sessão fecha e a trava cai)", async () => {
    const locks = new Map<string, number>()
    const fake = fakeDatabase(locks)
    const runner = createExclusiveJobRunner(fake.db)
    await expect(runner("calendar", async () => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou")
    expect(locks.size).toBe(0)
    expect(fake.released.at(-1)).toMatchObject({ destroyed: false })

    const broken = fakeDatabase(locks, { failUnlock: true })
    await expect(createExclusiveJobRunner(broken.db)("calendar", async () => "ok")).resolves.toEqual({ ran: true, value: "ok" })
    expect(broken.released.at(-1)).toMatchObject({ destroyed: true })
    expect(locks.size).toBe(0)
  })

  it("agenda: rodada inicial (startup), intervalo, sem sobreposição no mesmo processo, pula quando outro processo roda, `after` sempre", async () => {
    vi.useFakeTimers()
    const locks = new Map<string, number>()
    const other = createExclusiveJobRunner(fakeDatabase(locks).db)
    const runner = createExclusiveJobRunner(fakeDatabase(locks).db)
    const calls: string[] = []
    let wakes = 0
    const slow = deferred()
    const jobs = startPeriodicJobs(runner, [
      {
        name: "workflow-schedule",
        intervalMs: 1_000,
        startup: async () => calls.push("startup"),
        run: async () => {
          calls.push("run")
          await slow.promise
        },
        after: () => wakes++,
      },
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(["startup"])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toEqual(["startup", "run"])
    // Rodada lenta: o próximo intervalo é pulado neste processo (nunca duas ao mesmo tempo).
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toEqual(["startup", "run"])
    expect(jobs.status()[0]).toMatchObject({ lastOutcome: "SKIPPED_BUSY" })
    slow.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.status()[0]).toMatchObject({ runs: 2, lastOutcome: "RAN" })

    // Outro processo segurando a trava: a rodada daqui é pulada — e o worker local é acordado mesmo assim.
    const held = deferred()
    const otherRun = other("workflow-schedule", () => held.promise)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobs.status()[0]).toMatchObject({ skippedLocked: 1, lastOutcome: "SKIPPED_LOCKED" })
    expect(wakes).toBe(3)
    held.resolve()
    await otherRun
    await jobs.stop()
  })

  it("falha de uma rodada vai para o log e não para as próximas", async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const runner = createExclusiveJobRunner(fakeDatabase(new Map()).db)
    let attempt = 0
    const jobs = startPeriodicJobs(runner, [{ name: "data-hub", intervalMs: 500, run: async () => { attempt++; if (attempt === 1) throw new Error("tick falhou") }, errorLabel: "Falha no tick da Central de Dados:" }])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobs.status()[0]).toMatchObject({ runs: 1, failures: 1, lastOutcome: "RAN", lastError: null })
    expect(errors).toHaveBeenCalledWith("Falha no tick da Central de Dados:", expect.any(Error))
    await jobs.stop()
    errors.mockRestore()
  })
})
