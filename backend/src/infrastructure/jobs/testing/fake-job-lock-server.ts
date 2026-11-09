import type { JobLockClient } from "../job-lock-session.js"

/**
 * PostgreSQL FALSO para as travas das tarefas periódicas, compartilhado entre vários "processos" (várias sessões de trava), com
 * a semântica que importa: `pg_try_advisory_lock` por SESSÃO e reentrante na mesma sessão (contador), sessão encerrada = todas
 * as travas dela soltas, `periodic_job_runs` pelo relógio (`Date.now()`, controlado pelos timers falsos). A prova contra o
 * PostgreSQL real está em `periodic-jobs-lock-proof.test.ts`.
 */
type FakeSession = { id: number; alive: boolean; lost: ((error: Error) => void) | null; pending: Set<(error: Error) => void> }

export type FakeJobLockServer = ReturnType<typeof createFakeJobLockServer>

export function createFakeJobLockServer() {
  let nextId = 0
  const sessions = new Map<number, FakeSession>()
  /** chave → sessão dona + contador de reentrância. */
  const locks = new Map<string, { session: number; count: number }>()
  const lastStarts = new Map<string, number>()
  const queries: { session: number; text: string }[] = []
  const state = {
    /** Próximas N aberturas de conexão recusadas. */
    refuseConnects: 0,
    connectAttempts: [] as number[],
    /** Abertura esperando liberação (subida lenta). */
    connectGate: null as Promise<void> | null,
    /** Banco sem responder (conexão meio aberta): consultas nunca voltam. */
    hang: false,
    /** `periodic_job_runs` inexistente: erro de SQL que não derruba a sessão. */
    claimSqlError: false,
    /** O destravar falha como falha de conexão. */
    failUnlock: false,
  }

  const closeSession = (session: FakeSession, error: Error) => {
    if (!session.alive) return
    session.alive = false
    for (const [key, owner] of locks) if (owner.session === session.id) locks.delete(key)
    for (const reject of session.pending) reject(error)
    session.pending.clear()
  }

  const answer = (session: FakeSession, text: string, values: readonly unknown[]) => {
    if (text.includes("pg_try_advisory_lock")) {
      const key = `${values[0]}:${values[1]}`
      const owner = locks.get(key)
      if (owner && owner.session !== session.id) return { rows: [{ locked: false }], rowCount: 1 }
      if (owner) owner.count++
      else locks.set(key, { session: session.id, count: 1 })
      return { rows: [{ locked: true }], rowCount: 1 }
    }
    if (text.includes("periodic_job_runs")) {
      if (state.claimSqlError) throw Object.assign(new Error('relation "periodic_job_runs" does not exist'), { code: "42P01" })
      const [name, minIntervalMs] = values as [string, number]
      const last = lastStarts.get(name)
      if (last !== undefined && last > Date.now() - minIntervalMs) return { rows: [], rowCount: 0 }
      lastStarts.set(name, Date.now())
      return { rows: [{ name }], rowCount: 1 }
    }
    if (text.includes("pg_advisory_unlock")) {
      if (state.failUnlock) throw new Error("conexão caiu ao destravar")
      const key = `${values[0]}:${values[1]}`
      const owner = locks.get(key)
      if (!owner || owner.session !== session.id) return { rows: [{ unlocked: false }], rowCount: 1 }
      if (--owner.count === 0) locks.delete(key)
      return { rows: [{ unlocked: true }], rowCount: 1 }
    }
    if (text.trim() === "select 1") return { rows: [{ "?column?": 1 }], rowCount: 1 }
    throw new Error(`sql inesperado: ${text}`)
  }

  return {
    state,
    locks,
    queries,
    /** Sessões abertas agora (= conexões do "banco"). */
    openSessions: () => [...sessions.values()].filter((session) => session.alive).map((session) => session.id),
    /** Quantas aberturas de conexão deram certo. */
    connects: () => sessions.size,
    /** O banco derruba a sessão (`pg_terminate_backend`, reinício): travas soltas, consultas pendentes falham, cliente avisado. */
    terminate(sessionId: number) {
      const session = sessions.get(sessionId)
      if (!session?.alive) return
      const error = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })
      closeSession(session, error)
      session.lost?.(error)
    },
    createClient(): JobLockClient {
      let session: FakeSession | null = null
      let lost: ((error: Error) => void) | null = null
      return {
        async connect() {
          state.connectAttempts.push(Date.now())
          if (state.connectGate) await state.connectGate
          if (state.refuseConnects > 0) {
            state.refuseConnects--
            throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })
          }
          session = { id: ++nextId, alive: true, lost, pending: new Set() }
          sessions.set(session.id, session)
        },
        query(text, values = []) {
          const current = session
          if (!current?.alive) return Promise.reject(new Error("Client has encountered a connection error and is not queryable"))
          queries.push({ session: current.id, text })
          if (state.hang) return new Promise((_resolve, reject) => current.pending.add(reject))
          try {
            return Promise.resolve(answer(current, text, values))
          } catch (error) {
            return Promise.reject(error)
          }
        },
        async end() {
          if (session) closeSession(session, new Error("Connection terminated"))
        },
        onLost(listener) {
          lost = listener
          if (session) session.lost = listener
        },
      }
    },
  }
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
