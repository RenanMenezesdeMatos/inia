import type { Database } from "../database/pool.js"

/**
 * TAREFAS PERIÓDICAS EXCLUSIVAS. Com a API e o processamento em processos separados (ou dois processamentos), cada tarefa
 * periódica (checador de agenda, Central de Dados, calendário, varredor de entrega, monitoria de usabilidade) roda UMA vez por
 * rodada no conjunto todo: quem pega a trava consultiva do PostgreSQL (`pg_try_advisory_lock`) roda; os outros pulam a rodada.
 * Nenhum broker: a trava é da sessão — o processo que morre perde a conexão e a trava cai junto. Com `minIntervalMs`, sob a
 * trava, a última partida fica em `periodic_job_runs` (relógio do banco): dois processos com timers defasados não rodam a
 * mesma tarefa duas vezes no mesmo intervalo — uma rodada por intervalo no conjunto.
 *
 * A trava fica numa conexão dedicada do pool durante a tarefa (uma conexão por tarefa em andamento). Chave de DOIS inteiros
 * (namespace "INIA" + hash do nome): espaço separado das travas de um bigint (`pg_advisory_xact_lock(hashtext(...))`) que o
 * resto do código usa por registro.
 */
export const JOB_LOCK_NAMESPACE = 0x494e4941

/** FNV-1a 32 bits do nome → inteiro com sinal (o `int4` da trava). Estável entre processos e versões. */
export function jobLockKey(name: string): number {
  let hash = 0x811c9dc5
  for (const byte of Buffer.from(name, "utf8")) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/** LOCKED = outro processo está rodando agora · RECENT = outro processo (ou este) já rodou dentro de `minIntervalMs`. */
export type ExclusiveRunResult<T> = { ran: true; value: T } | { ran: false; reason: "LOCKED" | "RECENT" }
export type ExclusiveRunOptions = { minIntervalMs?: number }
export type ExclusiveJobRunner = <T>(name: string, job: () => Promise<T>, options?: ExclusiveRunOptions) => Promise<ExclusiveRunResult<T>>

/** Fração do intervalo que separa duas rodadas no conjunto (folga para o atraso natural dos timers). */
export const MIN_INTERVAL_FRACTION = 0.9

/**
 * Roda `job` só se este processo pegar a trava de `name` (e, com `minIntervalMs`, se ninguém começou a mesma tarefa há menos
 * que isso); senão devolve `{ ran: false }` sem esperar.
 */
export function createExclusiveJobRunner(db: Pick<Database, "connect">): ExclusiveJobRunner {
  return async <T>(name: string, job: () => Promise<T>, options: ExclusiveRunOptions = {}): Promise<ExclusiveRunResult<T>> => {
    const key = jobLockKey(name)
    const client = await db.connect()
    // Conexão com problema (trava/destrava falhou) é descartada — fechar a sessão solta a trava. Falha da TAREFA não é
    // problema da conexão: a trava é solta normalmente e a conexão volta ao pool.
    let destroy = false
    try {
      let locked: boolean
      try {
        locked = (await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1, $2) as locked", [JOB_LOCK_NAMESPACE, key])).rows[0]?.locked === true
      } catch (error) {
        destroy = true
        throw error
      }
      if (!locked) return { ran: false, reason: "LOCKED" }
      try {
        if (options.minIntervalMs && options.minIntervalMs > 0) {
          // Partida marcada atomicamente com o relógio do banco: só grava se a última foi há pelo menos `minIntervalMs`.
          const claimed = await client.query(
            `insert into periodic_job_runs (name, last_started_at) values ($1, now())
             on conflict (name) do update set last_started_at = excluded.last_started_at
              where periodic_job_runs.last_started_at <= now() - ($2::double precision * interval '1 millisecond')
             returning name`,
            [name, options.minIntervalMs],
          )
          if (claimed.rowCount === 0) return { ran: false, reason: "RECENT" }
        }
        return { ran: true, value: await job() }
      } finally {
        try {
          await client.query("select pg_advisory_unlock($1, $2)", [JOB_LOCK_NAMESPACE, key])
        } catch {
          destroy = true
        }
      }
    } finally {
      client.release(destroy ? true : undefined)
    }
  }
}

export type PeriodicJobDefinition = {
  /** Nome da tarefa = nome da trava (o mesmo em todos os processos). */
  name: string
  intervalMs: number
  /** Primeira rodada já na subida (senão, só depois do primeiro intervalo). */
  runOnStart?: boolean
  /** Uma vez na subida, com a MESMA trava, no lugar da rodada inicial (ex.: só a projeção da situação funcional). */
  startup?: () => Promise<unknown>
  run: () => Promise<unknown>
  /** Depois de cada rodada — rodou aqui, rodou em outro processo ou falhou (ex.: acordar o worker local). */
  after?: () => void
  /** Prefixo da mensagem de erro no log (a mesma de antes da separação). */
  errorLabel?: string
}

/** SKIPPED_LOCKED = outro processo rodando agora · SKIPPED_RECENT = outro processo já rodou neste intervalo · SKIPPED_BUSY = a rodada anterior deste processo ainda não terminou. */
export type PeriodicJobOutcome = "RAN" | "SKIPPED_LOCKED" | "SKIPPED_RECENT" | "SKIPPED_BUSY" | "FAILED"

export type PeriodicJobStatus = {
  name: string
  intervalMs: number
  runs: number
  /** Rodadas puladas porque outro processo rodou (agora ou dentro do intervalo). */
  skippedLocked: number
  failures: number
  lastOutcome: PeriodicJobOutcome | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastError: string | null
}

export type PeriodicJobs = {
  status(): PeriodicJobStatus[]
  /** Para os timers e espera as rodadas em andamento por até `graceMs`. */
  stop(graceMs?: number): Promise<{ abandoned: number }>
}

/**
 * Agenda as tarefas: cada uma nunca se sobrepõe a si mesma neste processo (rodada lenta = a próxima é pulada), nunca roda em
 * dois processos ao mesmo tempo (trava) e roda uma vez por intervalo no conjunto (`periodic_job_runs`). Falha de uma rodada
 * vai para o log e não para as outras.
 */
export function startPeriodicJobs(runner: ExclusiveJobRunner, definitions: readonly PeriodicJobDefinition[]): PeriodicJobs {
  const jobs = definitions.map((definition) => {
    const status: PeriodicJobStatus = { name: definition.name, intervalMs: definition.intervalMs, runs: 0, skippedLocked: 0, failures: 0, lastOutcome: null, lastStartedAt: null, lastFinishedAt: null, lastError: null }
    let inFlight: Promise<void> | null = null
    const tick = (body: () => Promise<unknown>) => {
      if (inFlight) {
        status.lastOutcome = "SKIPPED_BUSY"
        return
      }
      status.lastStartedAt = new Date().toISOString()
      inFlight = runner(definition.name, body, { minIntervalMs: Math.round(definition.intervalMs * MIN_INTERVAL_FRACTION) })
        .then((result) => {
          if (result.ran) {
            status.runs++
            status.lastOutcome = "RAN"
            status.lastError = null
          } else {
            status.skippedLocked++
            status.lastOutcome = result.reason === "RECENT" ? "SKIPPED_RECENT" : "SKIPPED_LOCKED"
          }
        })
        .catch((error: unknown) => {
          status.failures++
          status.lastOutcome = "FAILED"
          status.lastError = error instanceof Error ? error.message : String(error)
          console.error(definition.errorLabel ?? `Falha na tarefa periódica ${definition.name}:`, error)
        })
        .finally(() => {
          status.lastFinishedAt = new Date().toISOString()
          inFlight = null
          definition.after?.()
        })
    }
    if (definition.startup) tick(definition.startup)
    else if (definition.runOnStart) tick(definition.run)
    const timer = setInterval(() => tick(definition.run), definition.intervalMs)
    return { status, timer, current: () => inFlight }
  })

  return {
    status: () => jobs.map((job) => ({ ...job.status })),
    async stop(graceMs = 10_000) {
      for (const job of jobs) clearInterval(job.timer)
      const running = jobs.map((job) => job.current()).filter((run): run is Promise<void> => run !== null)
      if (running.length === 0) return { abandoned: 0 }
      let timeout: ReturnType<typeof setTimeout> | undefined
      const timedOut = await Promise.race([
        Promise.allSettled(running).then(() => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(true), graceMs)
        }),
      ])
      clearTimeout(timeout)
      return { abandoned: timedOut ? jobs.filter((job) => job.current() !== null).length : 0 }
    },
  }
}
