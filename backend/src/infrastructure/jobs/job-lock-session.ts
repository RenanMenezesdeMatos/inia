import pg from "pg"
import { JOB_LOCK_NAMESPACE, jobLockKey, type ExclusiveJobRunner, type ExclusiveRunOptions, type ExclusiveRunResult, type JobLease } from "./periodic-jobs.js"

/**
 * TRAVAS DAS TAREFAS PERIÓDICAS numa conexão PRÓPRIA do processo, fora do pool. Antes cada rodada pegava uma conexão do pool e a
 * segurava até o fim (uma por tarefa em andamento: até ~11 das 20 do processamento, disputando com o motor de Workflow). Agora
 * uma única sessão do PostgreSQL detém as travas de todas as tarefas deste processo (`pg_try_advisory_lock` de chaves
 * diferentes na mesma sessão) e o trabalho de cada tarefa usa o pool só pelo tempo de cada consulta.
 *
 * Regras:
 * - Sem conexão das travas = a rodada é PULADA (`UNAVAILABLE`), nunca roda sem trava. Conexão em abertura (subida, reconexão):
 *   a rodada espera por ela (no máximo o prazo de conexão) — a rodada inicial não se perde na subida.
 * - A conexão cai (banco reiniciado, rede, sessão derrubada, sem resposta no prazo): o banco solta TODAS as travas dela. Cada
 *   abertura bem-sucedida é uma GERAÇÃO; as rodadas em andamento da geração perdida recebem o `signal` abortado
 *   (`JobLockLostError`), o resultado sai com `lockLost` e ninguém destrava na sessão nova o que era da antiga. Reconexão com
 *   espera crescente, até 30 s (o padrão de `shared/infrastructure/process-wake/postgres-wake-channel.ts`).
 * - Reentrância: o PostgreSQL deixa a MESMA sessão pegar a mesma chave de novo (contador). Uma tarefa ainda rodando neste
 *   processo devolve `BUSY` — a guarda é daqui (e o `inFlight` do agendador continua por cima).
 * - Sessão viva entre as rodadas: `select 1` periódico (mantém a sessão ativa e descobre conexão meio aberta), keepalive TCP
 *   dos dois lados e `idle_session_timeout` desligado nesta sessão (ociosidade encerrando a sessão soltaria as travas).
 * - Erro de SQL que não derruba a sessão (ex.: `periodic_job_runs` inexistente) é falha da rodada, como antes; qualquer outro
 *   erro ou falta de resposta = conexão perdida. Falha ao destravar fecha a sessão (a trava cai com ela).
 *
 * Custo: +1 conexão por processo com tarefas periódicas (papéis `worker` e `all`) no `max_connections`.
 */
export const JOB_LOCK_QUERY_TIMEOUT_MS = 10_000
export const JOB_LOCK_HEARTBEAT_MS = 10_000
/** Sem resposta nenhuma além do limite de comando do banco + esta folga = conexão perdida (o banco cancelaria antes). */
const NO_ANSWER_GRACE_MS = 2_000
const RETRY_INITIAL_MS = 1_000
const RETRY_MAX_MS = 30_000

/** Motivo do `signal` abortado quando a trava cai no meio da rodada (ou quando o processo está desligando). */
export class JobLockLostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JobLockLostError"
  }
}

/** O mínimo de um cliente do PostgreSQL de que a sessão precisa (o `pg.Client` real em `createPostgresJobLockSession`). */
export type JobLockClient = {
  connect(): Promise<void>
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
  /** Fecha a conexão (com consulta pendurada, derruba o socket). */
  end(): Promise<void>
  /** A conexão caiu fora de qualquer comando (erro do socket, sessão encerrada pelo banco, fim inesperado). */
  onLost(listener: (error: Error) => void): void
}

export type JobLockSessionStatus = {
  connected: boolean
  /** Aberturas bem-sucedidas da conexão das travas desde a subida (1 = nunca caiu). */
  generation: number
  /** Tarefas com rodada em andamento neste processo. */
  held: string[]
  losses: number
  /** Rodadas que perderam a trava antes de terminar. */
  leasesLost: number
  lastError: string | null
}

export type JobLockSession = {
  readonly runExclusive: ExclusiveJobRunner
  readonly connected: boolean
  status(): JobLockSessionStatus
  /** Fecha a conexão (as travas que sobrarem caem com ela; as rodadas ainda em andamento recebem o sinal). */
  stop(): Promise<void>
}

export type JobLockSessionOptions = {
  createClient: () => JobLockClient
  queryTimeoutMs?: number
  heartbeatMs?: number
  retryInitialMs?: number
  retryMaxMs?: number
  log?: (message: string, error?: unknown) => void
}

type Session = { client: JobLockClient; generation: number; lost: boolean }
/** Rodada deste processo: `generation` = sessão em que pediu a trava; `locked` = a trava veio (a rodada começou). */
type Held = { name: string; generation: number; locked: boolean; controller: AbortController }

/** Erro do PostgreSQL que deixa a sessão de pé: SQLSTATE fora das classes de conexão (08) e de encerramento (57P). */
export function isSessionKeepingSqlError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith("08") && !code.startsWith("57P")
}

/** Fechar com prazo: numa conexão meio aberta o fim nunca chega (o banco solta as travas quando descobrir pelo keepalive). */
async function endWithin(client: JobLockClient, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([client.end().catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))])
  clearTimeout(timer)
}

export function createJobLockSession(options: JobLockSessionOptions): JobLockSession {
  const queryTimeoutMs = options.queryTimeoutMs ?? JOB_LOCK_QUERY_TIMEOUT_MS
  const heartbeatMs = options.heartbeatMs ?? JOB_LOCK_HEARTBEAT_MS
  const retryInitialMs = options.retryInitialMs ?? RETRY_INITIAL_MS
  const retryMaxMs = options.retryMaxMs ?? RETRY_MAX_MS
  const log = options.log ?? ((message: string, error?: unknown) => console.warn(message, error instanceof Error ? error.message : (error ?? "")))
  const held = new Map<string, Held>()
  let session: Session | null = null
  let connecting: Promise<void> | null = null
  let generation = 0
  let stopped = false
  let retryMs = retryInitialMs
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let losses = 0
  let leasesLost = 0
  let lastError: string | null = null

  const abortHeld = (target: Session, reason: string, count: boolean) => {
    for (const entry of held.values()) {
      if (entry.generation !== target.generation || entry.controller.signal.aborted) continue
      entry.controller.abort(new JobLockLostError(`Trava da tarefa periódica ${entry.name} perdida: ${reason}`))
      if (count && entry.locked) {
        leasesLost++
        log(`Tarefa periódica ${entry.name} perdeu a trava no meio da rodada (${reason}); a rodada daqui foi avisada para parar e outro processo pode assumir a tarefa.`)
      }
    }
  }

  /** A sessão caiu ou deixou de responder: as travas dela já não valem. Idempotente. */
  const loseSession = (target: Session, error: unknown) => {
    if (target.lost) return
    target.lost = true
    target.client.end().catch(() => undefined)
    // Candidata que caiu durante a abertura: quem a abria cuida da nova tentativa.
    if (session !== target) return
    session = null
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    losses++
    lastError = error instanceof Error ? error.message : String(error)
    abortHeld(target, "a conexão das travas caiu", true)
    if (stopped) return
    log("Conexão das travas das tarefas periódicas caiu; reconectando (rodadas puladas até voltar).", error)
    scheduleReconnect()
  }

  /** Consulta na sessão com prazo próprio: conexão meio aberta nunca segura as travas (nem as rodadas) para sempre. */
  const sessionQuery = (target: Session, text: string, values?: readonly unknown[]) =>
    new Promise<Awaited<ReturnType<JobLockClient["query"]>>>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        // Event loop parado (rodada pesada de CPU) atrasa a leitura da resposta que já chegou: confere depois da fase de E/S.
        setImmediate(() => {
          if (settled) return
          settled = true
          const error = new Error(`A conexão das travas não respondeu em ${queryTimeoutMs + NO_ANSWER_GRACE_MS} ms.`)
          loseSession(target, error)
          reject(error)
        })
      }, queryTimeoutMs + NO_ANSWER_GRACE_MS)
      target.client.query(text, values).then(
        (result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, retryMs)
    retryTimer.unref?.()
    retryMs = Math.min(retryMaxMs, retryMs * 2)
  }

  const startHeartbeat = (target: Session) => {
    let beating = false
    heartbeatTimer = setInterval(() => {
      if (beating || target.lost) return
      beating = true
      sessionQuery(target, "select 1")
        .catch((error: unknown) => loseSession(target, error))
        .finally(() => {
          beating = false
        })
    }, heartbeatMs)
    heartbeatTimer.unref?.()
  }

  async function open(): Promise<void> {
    const candidate: Session = { client: options.createClient(), generation: generation + 1, lost: false }
    let lostDuringOpen: Error | null = null
    candidate.client.onLost((error) => {
      lostDuringOpen ??= error
      loseSession(candidate, error)
    })
    try {
      await candidate.client.connect()
      if (candidate.lost) throw lostDuringOpen ?? new Error("Conexão das travas encerrada durante a abertura.")
    } catch (error) {
      loseSession(candidate, error)
      lastError = error instanceof Error ? error.message : String(error)
      if (stopped) return
      log("Não foi possível abrir a conexão das travas das tarefas periódicas; nova tentativa em instantes (rodadas puladas até lá).", error)
      scheduleReconnect()
      return
    }
    if (stopped) {
      loseSession(candidate, new Error("desligando"))
      return
    }
    generation = candidate.generation
    session = candidate
    retryMs = retryInitialMs
    startHeartbeat(candidate)
  }

  function connect() {
    if (stopped || connecting || session) return
    connecting = open().finally(() => {
      connecting = null
    })
  }

  const unavailable = { ran: false, reason: "UNAVAILABLE" } as const

  const runExclusive: ExclusiveJobRunner = async <T>(name: string, job: (lease: JobLease) => Promise<T>, runOptions: ExclusiveRunOptions = {}): Promise<ExclusiveRunResult<T>> => {
    if (held.has(name)) return { ran: false, reason: "BUSY" }
    const entry: Held = { name, generation: -1, locked: false, controller: new AbortController() }
    held.set(name, entry)
    try {
      if (!session && connecting) await connecting
      const current = session
      if (!current || stopped) return unavailable
      entry.generation = current.generation
      const signal = entry.controller.signal
      const key = jobLockKey(name)
      // Erro de SQL com a sessão de pé = falha da rodada (como antes); qualquer outro erro = conexão perdida = rodada pulada.
      const ask = async (text: string, values: readonly unknown[]) => {
        try {
          return await sessionQuery(current, text, values)
        } catch (error) {
          if (!current.lost && isSessionKeepingSqlError(error)) throw error
          loseSession(current, error)
          return null
        }
      }
      const locked = await ask("select pg_try_advisory_lock($1, $2) as locked", [JOB_LOCK_NAMESPACE, key])
      // Sessão caiu durante o pedido: a trava, se veio, caiu junto.
      if (!locked || signal.aborted) return unavailable
      if (locked.rows[0]?.locked !== true) return { ran: false, reason: "LOCKED" }
      entry.locked = true
      try {
        if (runOptions.minIntervalMs && runOptions.minIntervalMs > 0) {
          // Partida marcada atomicamente com o relógio do banco: só grava se a última foi há pelo menos `minIntervalMs`.
          const claimed = await ask(
            `insert into periodic_job_runs (name, last_started_at) values ($1, now())
             on conflict (name) do update set last_started_at = excluded.last_started_at
              where periodic_job_runs.last_started_at <= now() - ($2::double precision * interval '1 millisecond')
             returning name`,
            [name, runOptions.minIntervalMs],
          )
          if (!claimed || signal.aborted) return unavailable
          if (claimed.rowCount === 0) return { ran: false, reason: "RECENT" }
        }
        const value = await job({ signal })
        return signal.aborted ? { ran: true, value, lockLost: true } : { ran: true, value }
      } finally {
        // Trava de uma sessão que já caiu (ou do processo desligando) não existe mais: nada a destravar — destravar na sessão
        // nova seria mexer no que não é dela.
        if (!current.lost && !signal.aborted) {
          try {
            const unlocked = await sessionQuery(current, "select pg_advisory_unlock($1, $2) as unlocked", [JOB_LOCK_NAMESPACE, key])
            if (unlocked.rows[0]?.unlocked !== true) log(`Trava da tarefa periódica ${name} não estava com esta sessão ao destravar.`)
          } catch (error) {
            // Sem a confirmação de que destravou: fechar a sessão solta a trava (as outras rodadas são avisadas e ela reabre).
            loseSession(current, error)
          }
        }
      }
    } finally {
      held.delete(name)
    }
  }

  connect()
  return {
    runExclusive,
    get connected() {
      return session !== null
    },
    status: () => ({ connected: session !== null, generation, held: [...held.keys()], losses, leasesLost, lastError }),
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = null
      const current = session
      session = null
      if (current) {
        current.lost = true
        abortHeld(current, "o processo está desligando", false)
        await endWithin(current.client, NO_ANSWER_GRACE_MS)
      }
      await connecting
    },
  }
}

/**
 * Parâmetros da sessão das travas. Ociosidade nunca a encerra (as travas cairiam junto); o banco descobre um processo que sumiu
 * sem fechar a conexão (máquina desligada, rede) em ~30 s + sondas, em vez das 2 h padrão do sistema operacional, e solta as
 * travas para os outros processos. Parâmetro que o servidor não conhece (`idle_session_timeout` antes do PostgreSQL 14) fica de
 * fora sem impedir a abertura.
 */
const SESSION_SETTINGS: readonly (readonly [string, string])[] = [
  ["idle_session_timeout", "0"],
  ["tcp_keepalives_idle", "30"],
  ["tcp_keepalives_interval", "10"],
]

type PostgresJobLockOptions = { connectionString: string; applicationName: string; queryTimeoutMs?: number }

/**
 * O cliente das travas sobre um `pg.Client` próprio: `application_name` = o do processo + `:locks` (ex.: `inia-worker:locks` em
 * `pg_stat_activity`), limite de comando curto (as consultas daqui são instantâneas) e keepalive TCP do lado do Node.
 */
export function createPostgresJobLockClient(options: PostgresJobLockOptions): JobLockClient {
  const queryTimeoutMs = options.queryTimeoutMs ?? JOB_LOCK_QUERY_TIMEOUT_MS
  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: `${options.applicationName.slice(0, 57)}:locks`,
    connectionTimeoutMillis: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  // Uma consulta por vez no cliente (rodadas e `select 1` chegam juntos): a fila interna do `pg` para consultas simultâneas
  // está obsoleta e sai no pg@9. Consulta pendurada derruba a sessão pelo prazo e as da fila falham junto.
  let tail: Promise<unknown> = Promise.resolve()
  return {
    async connect() {
      await client.connect()
      for (const [parameter, value] of SESSION_SETTINGS) {
        try {
          await client.query("select set_config($1, $2, false)", [parameter, value])
        } catch (error) {
          if (!isSessionKeepingSqlError(error)) throw error
        }
      }
    },
    query(text, values) {
      const next = tail.then(() => client.query(text, values ? [...values] : undefined))
      tail = next.catch(() => undefined)
      return next
    },
    end: () => client.end(),
    onLost(listener) {
      client.on("error", listener)
      client.on("end", () => listener(new Error("Conexão das travas encerrada.")))
    },
  }
}

export function createPostgresJobLockSession(options: PostgresJobLockOptions & { log?: (message: string, error?: unknown) => void }): JobLockSession {
  return createJobLockSession({
    ...(options.queryTimeoutMs ? { queryTimeoutMs: options.queryTimeoutMs } : {}),
    ...(options.log ? { log: options.log } : {}),
    createClient: () => createPostgresJobLockClient(options),
  })
}
