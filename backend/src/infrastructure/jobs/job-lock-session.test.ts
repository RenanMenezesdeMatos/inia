import { afterEach, describe, expect, it, vi } from "vitest"
import { createJobLockSession, isSessionKeepingSqlError, JobLockLostError, type JobLockSession, type JobLockSessionOptions } from "./job-lock-session.js"
import type { JobLease } from "./periodic-jobs.js"
import { createFakeJobLockServer, deferred, type FakeJobLockServer } from "./testing/fake-job-lock-server.js"

/**
 * Travas das tarefas periódicas numa conexão PRÓPRIA por processo. Cada `createJobLockSession` aqui é um "processo"; o banco é
 * falso e compartilhado (testing/fake-job-lock-server.ts). Prova contra o PostgreSQL real: testing/periodic-jobs-lock-proof.
 */
const sessions: JobLockSession[] = []
const quiet = () => {}

function processOn(server: FakeJobLockServer, options: Partial<JobLockSessionOptions> = {}) {
  const session = createJobLockSession({ createClient: () => server.createClient(), log: quiet, ...options })
  sessions.push(session)
  return session
}

/** Espera a conexão das travas abrir (os timers falsos não andam sozinhos). */
async function connected(session: JobLockSession) {
  await vi.waitFor(() => expect(session.connected).toBe(true))
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe("sessão das travas das tarefas periódicas", () => {
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(sessions.splice(0).map((session) => session.stop()))
  })

  it("UMA conexão por processo para todas as tarefas: várias travas na mesma sessão, nenhuma conexão por rodada", async () => {
    const server = createFakeJobLockServer()
    const locks = processOn(server)
    await connected(locks)
    const gates = ["workflow-schedule", "data-hub", "calendar"].map((name) => ({ name, gate: deferred() }))
    const rounds = gates.map(({ name, gate }) => locks.runExclusive(name, () => gate.promise.then(() => name)))
    await vi.waitFor(() => expect(server.locks.size).toBe(3))
    expect(server.connects()).toBe(1)
    expect(new Set([...server.locks.values()].map((lock) => lock.session))).toEqual(new Set(server.openSessions()))
    expect(locks.status().held.sort()).toEqual(["calendar", "data-hub", "workflow-schedule"])
    for (const { gate } of gates) gate.resolve()
    await expect(Promise.all(rounds)).resolves.toEqual(gates.map(({ name }) => ({ ran: true, value: name })))
    expect(server.locks.size).toBe(0)
    expect(server.connects()).toBe(1)
  })

  it("dois processos, mesma tarefa ao mesmo tempo: só um roda; o outro pula sem esperar; depois a trava volta", async () => {
    const server = createFakeJobLockServer()
    const processA = processOn(server)
    const processB = processOn(server)
    await Promise.all([connected(processA), connected(processB)])
    const gate = deferred()
    let runs = 0
    const first = processA.runExclusive("workflow-schedule", async () => {
      runs++
      await gate.promise
      return "A"
    })
    await vi.waitFor(() => expect(server.locks.size).toBe(1))
    await expect(processB.runExclusive("workflow-schedule", async () => (runs++, "B"))).resolves.toEqual({ ran: false, reason: "LOCKED" })
    await expect(processB.runExclusive("data-hub", async () => "outra")).resolves.toEqual({ ran: true, value: "outra" })
    gate.resolve()
    await expect(first).resolves.toEqual({ ran: true, value: "A" })
    expect(runs).toBe(1)
    await expect(processB.runExclusive("workflow-schedule", async () => "B")).resolves.toEqual({ ran: true, value: "B" })
    expect(server.locks.size).toBe(0)
  })

  it("reentrância: com a rodada anterior ainda em andamento NESTE processo, a mesma tarefa devolve BUSY sem perguntar ao banco (que deixaria: a trava é reentrante na sessão)", async () => {
    const server = createFakeJobLockServer()
    const locks = processOn(server)
    await connected(locks)
    const gate = deferred()
    let runs = 0
    const first = locks.runExclusive("feedback-delivery-sweeper", async () => {
      runs++
      await gate.promise
    })
    await vi.waitFor(() => expect(server.locks.size).toBe(1))
    const asked = server.queries.length
    await expect(locks.runExclusive("feedback-delivery-sweeper", async () => runs++)).resolves.toEqual({ ran: false, reason: "BUSY" })
    expect(server.queries.length).toBe(asked)
    gate.resolve()
    await expect(first).resolves.toEqual({ ran: true, value: undefined })
    expect(runs).toBe(1)
    // Nenhum contador de reentrância esquecido no banco: a trava foi solta de verdade.
    expect(server.locks.size).toBe(0)
    await expect(locks.runExclusive("feedback-delivery-sweeper", async () => "de novo")).resolves.toEqual({ ran: true, value: "de novo" })
  })

  it("na subida, a primeira rodada espera a conexão em abertura (a rodada inicial não se perde)", async () => {
    const server = createFakeJobLockServer()
    const opening = deferred()
    server.state.connectGate = opening.promise
    const locks = processOn(server)
    const round = locks.runExclusive("analytics-rollup", async () => "rodou")
    await flush()
    expect(locks.connected).toBe(false)
    server.state.connectGate = null
    opening.resolve()
    await expect(round).resolves.toEqual({ ran: true, value: "rodou" })
  })

  it("sem conexão das travas: a rodada é pulada (nunca roda sem trava); reconecta com espera crescente e volta a rodar", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    server.state.refuseConnects = 3
    const locks = processOn(server)
    let runs = 0
    const job = async () => ++runs
    // A primeira tentativa já estava em andamento: a rodada esperou por ela e, recusada, pulou.
    await expect(locks.runExclusive("data-hub", job)).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    // Esperando a próxima tentativa: pula na hora, sem esperar.
    await expect(locks.runExclusive("data-hub", job)).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000)
    expect(locks.connected).toBe(true)
    const [first, ...rest] = server.state.connectAttempts
    expect(rest.map((at) => at - first!)).toEqual([1_000, 3_000, 7_000])
    await expect(locks.runExclusive("data-hub", job)).resolves.toEqual({ ran: true, value: 1 })
    expect(runs).toBe(1)
    expect(locks.status()).toMatchObject({ connected: true, generation: 1, losses: 0 })
  })

  it("conexão cai no meio das rodadas: o banco solta TODAS as travas, cada tarefa recebe o sinal, o outro processo assume, nada é destravado na sessão nova e a geração muda", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    const processA = processOn(server)
    const processB = processOn(server)
    await vi.advanceTimersByTimeAsync(0)
    const gates = { schedule: deferred(), dataHub: deferred() }
    const signals: AbortSignal[] = []
    const holdUntil = (gate: Promise<void>, value: string) => async ({ signal }: JobLease) => {
      signals.push(signal)
      await gate
      return value
    }
    const roundSchedule = processA.runExclusive("workflow-schedule", holdUntil(gates.schedule.promise, "agenda"))
    const roundDataHub = processA.runExclusive("data-hub", holdUntil(gates.dataHub.promise, "central"))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.locks.size).toBe(2)
    const [sessionA] = server.openSessions()

    server.terminate(sessionA!)
    expect(server.locks.size).toBe(0)
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
    expect(signals[0]!.reason).toBeInstanceOf(JobLockLostError)
    expect(processA.status()).toMatchObject({ connected: false, losses: 1, leasesLost: 2, held: ["workflow-schedule", "data-hub"] })
    // A trava caiu: o outro processo pega a mesma tarefa (por isso as tarefas precisam ser seguras para isso).
    await expect(processB.runExclusive("workflow-schedule", async () => "B")).resolves.toEqual({ ran: true, value: "B" })
    // Sem conexão: as rodadas novas daqui são puladas; a que ainda roda continua guardada contra reentrância.
    await expect(processA.runExclusive("calendar", async () => "x")).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(processA.status()).toMatchObject({ connected: true, generation: 2 })
    await expect(processA.runExclusive("workflow-schedule", async () => "x")).resolves.toEqual({ ran: false, reason: "BUSY" })
    const unlocksBefore = server.queries.filter((query) => query.text.includes("pg_advisory_unlock")).length
    gates.schedule.resolve()
    gates.dataHub.resolve()
    await expect(roundSchedule).resolves.toEqual({ ran: true, value: "agenda", lockLost: true })
    await expect(roundDataHub).resolves.toEqual({ ran: true, value: "central", lockLost: true })
    expect(server.queries.filter((query) => query.text.includes("pg_advisory_unlock")).length).toBe(unlocksBefore)
    await expect(processA.runExclusive("workflow-schedule", async () => "A de novo")).resolves.toEqual({ ran: true, value: "A de novo" })
    expect(server.locks.size).toBe(0)
  })

  it("banco sem responder (conexão meio aberta): o prazo da consulta derruba a sessão, a rodada é pulada e a sessão reabre", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    const locks = processOn(server, { queryTimeoutMs: 1_000, heartbeatMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    server.state.hang = true
    let runs = 0
    const round = locks.runExclusive("report-runs", async () => runs++)
    // Prazo = limite de comando (1 s) + folga (2 s); a conferência final roda logo depois da fase de E/S.
    await vi.advanceTimersByTimeAsync(3_001)
    await expect(round).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    expect(runs).toBe(0)
    expect(locks.status()).toMatchObject({ connected: false, losses: 1 })
    server.state.hang = false
    await vi.advanceTimersByTimeAsync(1_000)
    expect(locks.status()).toMatchObject({ connected: true, generation: 2 })
    await expect(locks.runExclusive("report-runs", async () => runs++)).resolves.toEqual({ ran: true, value: 0 })
  })

  it("`select 1` periódico mantém a sessão ativa e descobre a conexão parada mesmo sem rodada nenhuma", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    const locks = processOn(server, { queryTimeoutMs: 1_000, heartbeatMs: 5_000 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(server.queries.filter((query) => query.text === "select 1")).toHaveLength(3)
    server.state.hang = true
    await vi.advanceTimersByTimeAsync(5_000 + 3_001)
    expect(locks.status()).toMatchObject({ connected: false, losses: 1, leasesLost: 0 })
  })

  it("erro de SQL com a sessão de pé (ex.: `periodic_job_runs` ausente) é falha da rodada: a trava é solta e a sessão continua", async () => {
    const server = createFakeJobLockServer()
    const locks = processOn(server)
    await connected(locks)
    server.state.claimSqlError = true
    let runs = 0
    await expect(locks.runExclusive("calendar", async () => runs++, { minIntervalMs: 1_000 })).rejects.toThrow("periodic_job_runs")
    expect(runs).toBe(0)
    expect(server.locks.size).toBe(0)
    expect(locks.status()).toMatchObject({ connected: true, losses: 0 })
    // Falha da TAREFA também solta a trava e não mexe na conexão.
    server.state.claimSqlError = false
    await expect(locks.runExclusive("calendar", async () => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou")
    expect(server.locks.size).toBe(0)
    expect(locks.status()).toMatchObject({ connected: true, losses: 0 })
  })

  it("falha ao destravar fecha a sessão: a trava cai com ela e as outras rodadas da sessão são avisadas", async () => {
    const server = createFakeJobLockServer()
    const locks = processOn(server)
    await connected(locks)
    const gate = deferred()
    let otherSignal: AbortSignal | null = null
    const other = locks.runExclusive("data-retention", async ({ signal }) => {
      otherSignal = signal
      await gate.promise
    })
    await vi.waitFor(() => expect(server.locks.size).toBe(1))
    server.state.failUnlock = true
    await expect(locks.runExclusive("rate-limit-purge", async () => "ok")).resolves.toEqual({ ran: true, value: "ok" })
    expect(server.locks.size).toBe(0)
    expect(server.openSessions()).toEqual([])
    expect(otherSignal!.aborted).toBe(true)
    gate.resolve()
    await expect(other).resolves.toEqual({ ran: true, value: undefined, lockLost: true })
  })

  it("uma vez por intervalo no conjunto: com timers defasados, o outro processo pula (RECENT) até passar o intervalo", async () => {
    vi.useFakeTimers()
    const server = createFakeJobLockServer()
    const processA = processOn(server)
    const processB = processOn(server)
    await vi.advanceTimersByTimeAsync(0)
    await expect(processA.runExclusive("calendar", async () => "A", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: true, value: "A" })
    await vi.advanceTimersByTimeAsync(7_000)
    await expect(processB.runExclusive("calendar", async () => "B", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: false, reason: "RECENT" })
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(processA.runExclusive("calendar", async () => "A", { minIntervalMs: 13_500 })).resolves.toEqual({ ran: true, value: "A" })
    expect(server.locks.size).toBe(0)
  })

  it("desligando: a sessão fecha, as rodadas em andamento recebem o sinal e as próximas são puladas", async () => {
    const server = createFakeJobLockServer()
    const locks = processOn(server)
    await connected(locks)
    const gate = deferred()
    let signal: AbortSignal | null = null
    const round = locks.runExclusive("data-hub", async (lease) => {
      signal = lease.signal
      await gate.promise
      return "fim"
    })
    await vi.waitFor(() => expect(signal).not.toBeNull())
    await locks.stop()
    expect(server.openSessions()).toEqual([])
    expect(server.locks.size).toBe(0)
    expect(signal!.aborted).toBe(true)
    await expect(locks.runExclusive("calendar", async () => "x")).resolves.toEqual({ ran: false, reason: "UNAVAILABLE" })
    gate.resolve()
    await expect(round).resolves.toEqual({ ran: true, value: "fim", lockLost: true })
    expect(locks.status().leasesLost).toBe(0)
  })

  it("só erro de SQL comum mantém a sessão; conexão (08), encerramento (57P) e erro de rede derrubam", () => {
    expect(isSessionKeepingSqlError({ code: "42P01" })).toBe(true)
    expect(isSessionKeepingSqlError({ code: "57014" })).toBe(true)
    expect(isSessionKeepingSqlError({ code: "57P01" })).toBe(false)
    expect(isSessionKeepingSqlError({ code: "08006" })).toBe(false)
    expect(isSessionKeepingSqlError({ code: "ECONNRESET" })).toBe(false)
    expect(isSessionKeepingSqlError(new Error("Connection terminated unexpectedly"))).toBe(false)
    expect(isSessionKeepingSqlError(null)).toBe(false)
  })
})
