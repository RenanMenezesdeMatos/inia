import { afterEach, describe, expect, it, vi } from "vitest"
import { createJobLockSession, type JobLockSession } from "./job-lock-session.js"
import { JOB_LOCK_NAMESPACE, jobLockKey, startPeriodicJobs } from "./periodic-jobs.js"
import { createFakeJobLockServer, deferred, type FakeJobLockServer } from "./testing/fake-job-lock-server.js"

/**
 * Agenda das tarefas periódicas com 2+ processos: cada "processo" é uma sessão de travas (job-lock-session.ts) sobre o mesmo
 * banco falso (testing/fake-job-lock-server.ts). A trava em si é coberta em job-lock-session.test.ts; a prova contra o
 * PostgreSQL real está em `testing/periodic-jobs-lock-proof.test.ts`.
 */
const sessions: JobLockSession[] = []

function processOn(server: FakeJobLockServer) {
  const session = createJobLockSession({ createClient: () => server.createClient(), log: () => {} })
  sessions.push(session)
  return session
}

describe("tarefas periódicas", () => {
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(sessions.splice(0).map((session) => session.stop()))
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

  it("agenda: rodada inicial (startup), intervalo, sem sobreposição no mesmo processo, pula quando outro processo roda, `after` sempre", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    const other = processOn(server)
    const locks = processOn(server)
    const calls: string[] = []
    let wakes = 0
    const slow = deferred()
    const jobs = startPeriodicJobs(locks.runExclusive, [
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
    const otherRun = other.runExclusive("workflow-schedule", () => held.promise)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobs.status()[0]).toMatchObject({ skippedLocked: 1, lastOutcome: "SKIPPED_LOCKED" })
    expect(wakes).toBe(3)
    held.resolve()
    await otherRun
    await jobs.stop()
  })

  it("conexão das travas fora: a rodada é pulada (SKIPPED_UNAVAILABLE) e volta sozinha; trava perdida no meio conta em `lockLost`", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    server.state.refuseConnects = 1
    const locks = processOn(server)
    const gate = deferred()
    let rounds = 0
    let lastSignal: AbortSignal | null = null
    const jobs = startPeriodicJobs(locks.runExclusive, [
      {
        name: "data-hub",
        intervalMs: 5_000,
        runOnStart: true,
        run: async ({ signal }) => {
          rounds++
          lastSignal = signal
          await gate.promise
        },
      },
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.status()[0]).toMatchObject({ runs: 0, skippedUnavailable: 1, lastOutcome: "SKIPPED_UNAVAILABLE" })
    expect(rounds).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(rounds).toBe(1)
    server.terminate(server.openSessions()[0]!)
    expect(lastSignal!.aborted).toBe(true)
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.status()[0]).toMatchObject({ runs: 1, lockLost: 1, lastOutcome: "RAN" })
    await jobs.stop()
  })

  it("falha de uma rodada vai para o log e não para as próximas", async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const locks = processOn(createFakeJobLockServer())
    let attempt = 0
    const jobs = startPeriodicJobs(locks.runExclusive, [{ name: "data-hub", intervalMs: 500, run: async () => { attempt++; if (attempt === 1) throw new Error("tick falhou") }, errorLabel: "Falha no tick da Central de Dados:" }])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobs.status()[0]).toMatchObject({ runs: 1, failures: 1, lastOutcome: "RAN", lastError: null })
    expect(errors).toHaveBeenCalledWith("Falha no tick da Central de Dados:", expect.any(Error))
    await jobs.stop()
    errors.mockRestore()
  })
})
