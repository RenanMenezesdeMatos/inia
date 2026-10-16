import type { Database } from "../../../infrastructure/database/pool.js"
import type { ReportSchedule } from "../domain/report-definition.js"
import { latestDueAtOrBefore, nextRunAfter } from "../domain/report-schedule.js"
import { executeReportRun, type ExecutorDeps } from "./report-executor.js"
import type { RunRecord, RunStatus } from "./report-store.js"

/**
 * Agenda e fila dos reports (worker). `scheduleDueReports`: para cada report ativo vencido, avança `next_run_at` e cria a
 * execução do horário NUMA instrução (compare-and-swap no próximo horário + chave única report × horário) — N workers nunca
 * duplicam; worker parado por dias gera UMA execução (a do último horário vencido). `processReportRuns`: reivindica execuções
 * com `for update skip locked` e lease; falha técnica volta à fila até `MAX_RUN_ATTEMPTS`.
 */
export const MAX_RUN_ATTEMPTS = 3
const RETRY_DELAY_MS = 5 * 60_000
const LEASE_SECONDS = 15 * 60

export async function scheduleDueReports(db: Database, now: Date, limit = 200): Promise<number> {
  const due = await db.query<{ id: string; schedule: ReportSchedule; time_zone: string; next_run_at: Date }>(
    `select id, schedule, time_zone, next_run_at from reports
      where status = 'ACTIVE' and deleted_at is null and next_run_at is not null and next_run_at <= $1
      order by next_run_at limit $2`,
    [now, limit],
  )
  let enqueued = 0
  for (const report of due.rows) {
    const scheduledFor = latestDueAtOrBefore(report.schedule, report.time_zone, now) ?? report.next_run_at
    const slot = scheduledFor.getTime() < report.next_run_at.getTime() ? report.next_run_at : scheduledFor
    const next = nextRunAfter(report.schedule, report.time_zone, now)
    const result = await db.query(
      `with moved as (
         update reports set next_run_at = $3 where id = $1 and next_run_at = $2 and status = 'ACTIVE' and deleted_at is null
         returning id, organization_id, config_version
       )
       insert into report_runs (organization_id, report_id, scheduled_for, trigger_kind, config_version, status)
       select organization_id, id, $4, 'SCHEDULE', config_version, 'QUEUED' from moved
       on conflict (report_id, scheduled_for) do nothing`,
      [report.id, report.next_run_at, next, slot],
    )
    enqueued += result.rowCount ?? 0
  }
  return enqueued
}

type RunRow = { id: string; organization_id: string; report_id: string; scheduled_for: Date; trigger_kind: "SCHEDULE" | "MANUAL"; config_version: number; status: RunStatus; attempts: number; outcome: Record<string, unknown> | null; error_code: string | null; error_message: string | null; started_at: Date | null; finished_at: Date | null }

export async function claimReportRuns(db: Database, limit: number): Promise<RunRecord[]> {
  const result = await db.query<RunRow>(
    `with picked as (
       select id from report_runs
        where (status = 'QUEUED' and next_attempt_at <= now()) or (status = 'RUNNING' and claimed_until < now())
        order by next_attempt_at limit $1 for update skip locked
     )
     update report_runs r set status = 'RUNNING', attempts = r.attempts + 1, claimed_until = now() + make_interval(secs => $2), started_at = coalesce(r.started_at, now())
       from picked where r.id = picked.id
     returning r.id, r.organization_id, r.report_id, r.scheduled_for, r.trigger_kind, r.config_version, r.status, r.attempts, r.outcome, r.error_code, r.error_message, r.started_at, r.finished_at`,
    [limit, LEASE_SECONDS],
  )
  return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id, reportId: row.report_id, scheduledFor: row.scheduled_for.toISOString(), triggerKind: row.trigger_kind, configVersion: row.config_version, status: row.status, attempts: row.attempts, outcome: row.outcome, errorCode: row.error_code, errorMessage: row.error_message, startedAt: row.started_at?.toISOString() ?? null, finishedAt: row.finished_at?.toISOString() ?? null }))
}

/** Processa uma execução já reivindicada (também usada pelo "executar agora" e pelos testes). */
export async function processRun(deps: ExecutorDeps, run: RunRecord): Promise<RunStatus> {
  try {
    const result = await executeReportRun(deps, run)
    await deps.store.finishRun(run.id, result.status, result.outcome, null)
    const delivered = typeof result.outcome.deliveries === "number" && result.outcome.deliveries > 0
    await deps.store.markReportRun(run.reportId, result.status, deps.now().toISOString(), delivered ? deps.now().toISOString() : null)
    return result.status
  } catch (error) {
    const message = (error as Error).message?.slice(0, 500) ?? "Falha técnica."
    console.error(JSON.stringify({ event: "report_run_failed", runId: run.id, reportId: run.reportId, attempt: run.attempts, message }))
    if (run.attempts < MAX_RUN_ATTEMPTS) {
      await deps.store.requeueRun(run.id, new Date(deps.now().getTime() + RETRY_DELAY_MS).toISOString(), { code: "REPORT_RUN_TECHNICAL_FAILURE", message })
      return "QUEUED"
    }
    await deps.store.finishRun(run.id, "FAILED", { reason: "TECHNICAL_FAILURE" }, { code: "REPORT_RUN_TECHNICAL_FAILURE", message })
    await deps.store.markReportRun(run.reportId, "FAILED", deps.now().toISOString(), null)
    return "FAILED"
  }
}

export async function processReportRuns(db: Database, deps: ExecutorDeps, limit = 5): Promise<number> {
  const runs = await claimReportRuns(db, limit)
  for (const run of runs) await processRun(deps, run)
  return runs.length
}
