/**
 * TAREFAS PERIÓDICAS EXCLUSIVAS. Com a API e o processamento em processos separados (ou dois processamentos), cada tarefa
 * periódica (checador de agenda, Central de Dados, calendário, varredor de entrega, monitoria de usabilidade) roda UMA vez por
 * rodada no conjunto todo: quem pega a trava consultiva do PostgreSQL (`pg_try_advisory_lock`) roda; os outros pulam a rodada.
 * Nenhum broker: a trava é da sessão — o processo que morre perde a conexão e a trava cai junto. Com `minIntervalMs`, sob a
 * trava, a última partida fica em `periodic_job_runs` (relógio do banco): dois processos com timers defasados não rodam a
 * mesma tarefa duas vezes no mesmo intervalo — uma rodada por intervalo no conjunto.
 *
 * As travas ficam numa conexão PRÓPRIA do processo, fora do pool (`job-lock-session.ts`): nenhuma tarefa segura conexão do
 * pool durante a rodada. Chave de DOIS inteiros (namespace "INIA" + hash do nome): espaço separado das travas de um bigint
 * (`pg_advisory_xact_lock(hashtext(...))`) que o resto do código usa por registro.
 */
import { randomUUID } from "node:crypto"
import { sanitizeError } from "../../shared/application/errors/classify-error.js"
import { recordOccurrence } from "../../modules/error-diagnostics/application/occurrence-recorder.js"
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

/**
 * O que a tarefa recebe: `signal` é abortado (motivo `JobLockLostError`) quando a trava cai no meio da rodada — a conexão das
 * travas caiu e o banco soltou TODAS as travas dela; outro processo pode começar a mesma tarefa. Tarefa longa confere o sinal
 * entre etapas e para no próximo ponto seguro.
 */
export type JobLease = { signal: AbortSignal }

/**
 * LOCKED = outro processo está rodando agora · RECENT = outro processo (ou este) já rodou dentro de `minIntervalMs` · BUSY = a
 * rodada anterior DESTE processo ainda não terminou (a trava do PostgreSQL é reentrante na mesma sessão: a guarda é aqui) ·
 * UNAVAILABLE = sem conexão das travas agora (nunca roda sem trava). `lockLost` = rodou, mas a trava caiu antes do fim.
 */
export type ExclusiveRunResult<T> = { ran: true; value: T; lockLost?: true } | { ran: false; reason: "LOCKED" | "RECENT" | "BUSY" | "UNAVAILABLE" }
export type ExclusiveRunOptions = { minIntervalMs?: number }
export type ExclusiveJobRunner = <T>(name: string, job: (lease: JobLease) => Promise<T>, options?: ExclusiveRunOptions) => Promise<ExclusiveRunResult<T>>

/** Fração do intervalo que separa duas rodadas no conjunto (folga para o atraso natural dos timers). */
export const MIN_INTERVAL_FRACTION = 0.9

export type PeriodicJobDefinition = {
  /** Nome da tarefa = nome da trava (o mesmo em todos os processos). */
  name: string
  intervalMs: number
  /** Primeira rodada já na subida (senão, só depois do primeiro intervalo). */
  runOnStart?: boolean
  /** Uma vez na subida, com a MESMA trava, no lugar da rodada inicial (ex.: só a projeção da situação funcional). */
  startup?: (lease: JobLease) => Promise<unknown>
  run: (lease: JobLease) => Promise<unknown>
  /** Depois de cada rodada — rodou aqui, rodou em outro processo ou falhou (ex.: acordar o worker local). */
  after?: () => void
  /** Prefixo da mensagem de erro no log (a mesma de antes da separação). */
  errorLabel?: string
}

/**
 * SKIPPED_LOCKED = outro processo rodando agora · SKIPPED_RECENT = outro processo já rodou neste intervalo · SKIPPED_BUSY = a
 * rodada anterior deste processo ainda não terminou · SKIPPED_UNAVAILABLE = conexão das travas fora (reconectando).
 */
export type PeriodicJobOutcome = "RAN" | "SKIPPED_LOCKED" | "SKIPPED_RECENT" | "SKIPPED_BUSY" | "SKIPPED_UNAVAILABLE" | "FAILED"

export type PeriodicJobStatus = {
  name: string
  intervalMs: number
  runs: number
  /** Rodadas puladas porque outro processo rodou (agora ou dentro do intervalo). */
  skippedLocked: number
  /** Rodadas puladas porque a conexão das travas estava fora. */
  skippedUnavailable: number
  /** Rodadas que perderam a trava antes de terminar (conexão das travas caiu no meio). */
  lockLost: number
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
    const status: PeriodicJobStatus = { name: definition.name, intervalMs: definition.intervalMs, runs: 0, skippedLocked: 0, skippedUnavailable: 0, lockLost: 0, failures: 0, lastOutcome: null, lastStartedAt: null, lastFinishedAt: null, lastError: null }
    let inFlight: Promise<void> | null = null
    const tick = (body: (lease: JobLease) => Promise<unknown>) => {
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
            if (result.lockLost) status.lockLost++
          } else if (result.reason === "UNAVAILABLE") {
            status.skippedUnavailable++
            status.lastOutcome = "SKIPPED_UNAVAILABLE"
          } else if (result.reason === "BUSY") {
            status.lastOutcome = "SKIPPED_BUSY"
          } else {
            status.skippedLocked++
            status.lastOutcome = result.reason === "RECENT" ? "SKIPPED_RECENT" : "SKIPPED_LOCKED"
          }
        })
        .catch((error: unknown) => {
          status.failures++
          status.lastOutcome = "FAILED"
          status.lastError = error instanceof Error ? error.message : String(error)
          // Código do catálogo + referência própria da rodada (`job-<tarefa>-<uuid>`), no log e como ocorrência pesquisável.
          const reference = `job-${definition.name}-${randomUUID()}`.slice(0, 80)
          const summary = sanitizeError(error)
          recordOccurrence({ reference, code: "INIA-JOB-FALHA", source: "JOB", httpStatus: null, severity: "error", authenticated: false, details: { job: definition.name, failure: summary } })
          console.error(JSON.stringify({ event: "job_error", code: "INIA-JOB-FALHA", reference, job: definition.name, severity: "error", label: definition.errorLabel ?? `Falha na tarefa periódica ${definition.name}:`, failure: summary }))
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
