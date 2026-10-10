import type { Database } from "../../../infrastructure/database/pool.js"
import { claimDueEnrollments, processClaimedEnrollment, releaseClaimedEnrollment, type ClaimedRow, type LeaseOptions } from "./engine.js"
import { onWorkflowWork } from "./workflow-work-signal.js"

/**
 * Worker contínuo do motor de Workflow. Várias matrículas rodam AO MESMO TEMPO (até `concurrency` por processo), cada uma
 * dona da própria posse (claim com skip locked + heartbeat da lease — engine.ts): um nó de 12 min ocupa uma vaga e nunca
 * segura os outros workflows. Quando uma matrícula termina o nó, a vaga é reaproveitada na hora — o próximo nó de um fluxo
 * não espera a varredura seguinte.
 *
 * A fila é a própria tabela `workflow_enrollments` (vencida = `next_eval_at <= now()`, livre = posse nula ou vencida): várias
 * instâncias do servidor podem rodar este worker no mesmo banco sem coordenação extra — cada matrícula vencida vai para
 * exatamente um worker, e um worker morto devolve as suas quando a lease vence. Nenhum broker externo é necessário para isso.
 */
const DEFAULT_CONCURRENCY = 8
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_STOP_GRACE_MS = 30_000
/**
 * Trava de laço quente: o editor não proíbe ciclos entre nós, e sem o intervalo de 60 s do antigo ticker um ciclo sem
 * Espera giraria sem parar (e chamaria IA a cada volta). Uma matrícula que executar mais nós do que isto na janela fica
 * fora do claim deste worker durante o resfriamento — o fluxo continua, só que devagar, e o aviso aparece no log.
 */
const DEFAULT_HOT_LOOP = { maxRuns: 30, windowMs: 60_000, cooldownMs: 60_000 }

export type WorkflowWorkerOptions = LeaseOptions & {
  /** Matrículas executadas ao mesmo tempo por este processo. */
  concurrency?: number
  /** Vagas que um único workflow pode ocupar (padrão: metade, arredondada para cima) — sobra vaga para os outros. */
  perWorkflowLimit?: number
  /** Varredura quando nada acorda o worker (matrículas criadas por outra instância, esperas que vencem). */
  pollIntervalMs?: number
  /** Restringe o worker a estas matrículas — só provas contra o banco de teste compartilhado. */
  enrollmentIds?: readonly string[]
  hotLoop?: { maxRuns: number; windowMs: number; cooldownMs: number }
}

export type WorkflowWorker = {
  /** Procura trabalho agora (há vaga livre e talvez matrícula vencida). */
  wake(): void
  /**
   * Para de reivindicar e espera as matrículas em execução por até `graceMs`. As que não terminarem continuam donas da
   * posse até o processo sair; depois a lease vence e outra instância (ou o próximo boot) as retoma.
   */
  stop(graceMs?: number): Promise<{ abandoned: number }>
  readonly running: number
}

export function startWorkflowWorker(db: Database, options: WorkflowWorkerOptions = {}): WorkflowWorker {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY))
  const perWorkflowLimit = Math.max(1, Math.floor(options.perWorkflowLimit ?? Math.ceil(concurrency / 2)))
  const hotLoop = options.hotLoop ?? DEFAULT_HOT_LOOP
  const leaseOptions: LeaseOptions = {
    ...(options.leaseSeconds !== undefined ? { leaseSeconds: options.leaseSeconds } : {}),
    ...(options.maxHoldSeconds !== undefined ? { maxHoldSeconds: options.maxHoldSeconds } : {}),
  }
  const inFlight = new Map<string, { workflowId: string; run: Promise<void> }>()
  const recentRuns = new Map<string, number[]>()
  const coolingUntil = new Map<string, number>()
  let stopped = false
  let filling: Promise<void> | null = null
  let again = false

  function runningByWorkflow(): Map<string, number> {
    const counts = new Map<string, number>()
    for (const { workflowId } of inFlight.values()) counts.set(workflowId, (counts.get(workflowId) ?? 0) + 1)
    return counts
  }

  function cooling(now: number): string[] {
    for (const [enrollmentId, until] of coolingUntil) if (until <= now) coolingUntil.delete(enrollmentId)
    for (const [enrollmentId, runs] of recentRuns) if ((runs.at(-1) ?? 0) <= now - hotLoop.windowMs) recentRuns.delete(enrollmentId)
    return [...coolingUntil.keys()]
  }

  function noteRun(row: ClaimedRow): void {
    const now = Date.now()
    const runs = (recentRuns.get(row.id) ?? []).filter((at) => at > now - hotLoop.windowMs)
    runs.push(now)
    if (runs.length < hotLoop.maxRuns) {
      recentRuns.set(row.id, runs)
      return
    }
    recentRuns.delete(row.id)
    coolingUntil.set(row.id, now + hotLoop.cooldownMs)
    console.warn(JSON.stringify({ event: "workflow_enrollment_hot_loop", enrollmentId: row.id, workflowId: row.workflow_id, nodeId: row.current_node_id, runs: runs.length, windowMs: hotLoop.windowMs, cooldownMs: hotLoop.cooldownMs }))
  }

  function launch(row: ClaimedRow): void {
    const run = processClaimedEnrollment(db, row, leaseOptions)
      .then(
        (processed) => {
          if (processed) noteRun(row)
        },
        (error: unknown) => {
          // O nó já registra a própria falha (markFailed); chegar aqui = nem isso foi possível (banco fora). A posse fica
          // até a lease vencer e a matrícula é retomada depois — a falha de uma nunca derruba as outras.
          console.error(JSON.stringify({ event: "workflow_enrollment_run_failed", enrollmentId: row.id, workflowId: row.workflow_id, nodeId: row.current_node_id, error: error instanceof Error ? error.message : String(error) }))
        },
      )
      .finally(() => {
        inFlight.delete(row.id)
        wake()
      })
    inFlight.set(row.id, { workflowId: row.workflow_id, run })
  }

  async function fillOnce(): Promise<void> {
    const free = concurrency - inFlight.size
    if (free <= 0) return
    try {
      const rows = await claimDueEnrollments(db, {
        limit: free,
        ...(options.leaseSeconds !== undefined ? { leaseSeconds: options.leaseSeconds } : {}),
        enrollmentIds: options.enrollmentIds ?? null,
        excludeEnrollmentIds: cooling(Date.now()),
        perWorkflowLimit,
        runningByWorkflow: runningByWorkflow(),
      })
      if (stopped) {
        await Promise.all(rows.map((row) => releaseClaimedEnrollment(db, row).catch(() => undefined)))
        return
      }
      for (const row of rows) launch(row)
    } catch (error) {
      console.error(JSON.stringify({ event: "workflow_worker_claim_failed", error: error instanceof Error ? error.message : String(error) }))
    }
  }

  function wake(): void {
    if (stopped) return
    if (filling) {
      again = true
      return
    }
    filling = (async () => {
      do {
        again = false
        await fillOnce()
      } while (again && !stopped)
    })().finally(() => {
      filling = null
    })
  }

  const timer = setInterval(wake, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  timer.unref?.()
  const unsubscribe = onWorkflowWork(wake)
  wake()

  return {
    wake,
    get running() {
      return inFlight.size
    },
    async stop(graceMs = DEFAULT_STOP_GRACE_MS) {
      stopped = true
      clearInterval(timer)
      unsubscribe()
      await filling
      const runs = [...inFlight.values()].map((entry) => entry.run)
      if (runs.length === 0) return { abandoned: 0 }
      let timeout: ReturnType<typeof setTimeout> | undefined
      const timedOut = await Promise.race([
        Promise.allSettled(runs).then(() => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(true), graceMs)
        }),
      ])
      clearTimeout(timeout)
      return { abandoned: timedOut ? inFlight.size : 0 }
    },
  }
}
