import type { Database } from "../../../infrastructure/database/pool.js"
import type { ExclusiveJobRunner, JobLease } from "../../../infrastructure/jobs/periodic-jobs.js"
import { runActivityProjection } from "./activity-projection.js"
import { runEligibilityProjection } from "./eligibility-projection.js"
import { runUsageRetention } from "./usage-retention.js"

/**
 * Worker da Monitoria de usabilidade (no processo do servidor, como os demais jobs): projeção de atividade a cada 10 s (meta de
 * até 60 s entre o evento e o painel — o atraso real aparece na Qualidade da medição), elegibilidade a cada 60 s e retenção a
 * cada 6 h. Rodadas nunca se sobrepõem; falha de uma rodada só é registrada — o produto não depende disto.
 */
export const ACTIVITY_PROJECTION_INTERVAL_MS = 10_000
export const ELIGIBILITY_INTERVAL_MS = 60_000
export const RETENTION_INTERVAL_MS = 6 * 3_600_000

export function startUsageAnalyticsWorker(db: Database, options: { exclusive?: ExclusiveJobRunner } = {}): () => void {
  const running = { activity: false, eligibility: false, retention: false }
  const guard = (kind: keyof typeof running, job: (lease: JobLease) => Promise<unknown>, intervalMs: number) => () => {
    if (running[kind]) return
    running[kind] = true
    // Com 2+ processos (INIA_PROCESS_ROLE), cada projeção roda em um só por rodada (trava + última partida no banco).
    const round = options.exclusive ? options.exclusive(`usage-analytics-${kind}`, job, { minIntervalMs: Math.round(intervalMs * 0.9) }) : job({ signal: new AbortController().signal })
    round
      .catch((error: unknown) => console.error(`Falha na monitoria de usabilidade (${kind}):`, error))
      .finally(() => {
        running[kind] = false
      })
  }
  const activity = guard("activity", ({ signal }) => runActivityProjection(db, { signal }), ACTIVITY_PROJECTION_INTERVAL_MS)
  const eligibility = guard("eligibility", () => runEligibilityProjection(db), ELIGIBILITY_INTERVAL_MS)
  const retention = guard("retention", () => runUsageRetention(db), RETENTION_INTERVAL_MS)
  eligibility()
  const timers = [setInterval(activity, ACTIVITY_PROJECTION_INTERVAL_MS), setInterval(eligibility, ELIGIBILITY_INTERVAL_MS), setInterval(retention, RETENTION_INTERVAL_MS), setTimeout(retention, 5 * 60_000)]
  return () => timers.forEach((timer) => clearInterval(timer))
}
