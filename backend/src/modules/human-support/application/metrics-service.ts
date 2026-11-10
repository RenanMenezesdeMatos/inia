import { replyFunnel, type FunnelPlacement } from "../../assistant/application/reply-funnel.js"
import { REQUEST_ORIGINS, type RequestOrigin } from "../domain/catalogs.js"
import { supportMeasures, type Measure, type SupportCounts } from "../domain/metrics-definitions.js"
import type { QueueSample } from "../domain/queue-history.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, periodBounds, type CoordinatorScopes } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"
import type { PanelQuery } from "./coordination-service.js"

/**
 * FUNIL DO APOIO (M1–M17, design_draft.md seção 15), só para Coordenador de Anjos e Administrador geral (D7). M1–M6 vêm de
 * `assistant/application/reply-funnel.ts` sobre o Grupo/Subgrupo ATUAL das pessoas no alcance; M7–M17, deste módulo, sobre o escopo
 * CONGELADO de cada pedido ou evento. No topo, as datas de corte e os períodos com o apoio desligado (chave geral).
 */
export type FunnelResponse = { period: { from: string; to: string }; cutoffs: { dislikeDetailsSince: string | null; signalsSince: string | null; disabledPeriods: { from: string; to: string | null }[] }; measures: Measure[] }

const placementOf = (coverage: CoordinatorScopes): FunnelPlacement => (coverage.organizationWide ? { kind: "ORGANIZATION" } : { kind: "UNITS", teamIds: coverage.teamIds, subteamIds: coverage.subteamIds })

async function supportCounts(db: Queryable, organizationId: string, coverage: CoordinatorScopes, query: PanelQuery): Promise<SupportCounts> {
  const scoped = (alias: string) => {
    const params: unknown[] = [organizationId, query.from, query.to]
    const clause = coverageClause(coverage, alias, params, query)
    return { params, clause, ...periodBounds("$1", "$2", "$3") }
  }
  const entries = scoped("e")
  const entryRows = (
    await db.query<{ kind: string; origin: RequestOrigin | null; total: number }>(
      `select e.kind, e.origin, count(*)::int total from human_support_entry_events e
        where e.organization_id = $1 and e.occurred_at >= ${entries.start} and e.occurred_at < ${entries.end} and ${entries.clause}
        group by e.kind, e.origin`,
      entries.params,
    )
  ).rows
  const suggestions = { SIGNAL: 0, DISLIKE: 0 }
  let noAnjoAttempts = 0
  for (const row of entryRows) {
    if (row.kind === "SUGGESTION_ELIGIBLE" && (row.origin === "SIGNAL" || row.origin === "DISLIKE")) suggestions[row.origin] += row.total
    if (row.kind === "NO_ANJO_IN_SERVICE") noAnjoAttempts += row.total
  }
  const converted = scoped("e")
  const convertedRequests = Number(
    (
      await db.query<{ total: number }>(
        `select count(distinct r.id)::int total from human_support_requests r
          join human_support_entry_events e on e.organization_id = r.organization_id and e.kind = 'SUGGESTION_ELIGIBLE' and e.interaction_id = r.source_interaction_id
         where r.organization_id = $1 and e.occurred_at >= ${converted.start} and e.occurred_at < ${converted.end} and ${converted.clause}`,
        converted.params,
      )
    ).rows[0]?.total ?? 0,
  )
  const requests = scoped("r")
  const requestRows = (
    await db.query<{ origin: RequestOrigin; status: string; end_cause: string | null; had_attendance: boolean; first_assigned_seconds: number | null; queue_seconds: number | null; team_id: string | null; subteam_id: string | null }>(
      `select r.origin, r.status, r.end_cause, r.team_id, r.subteam_id,
              exists (select 1 from human_support_attendances a where a.request_id = r.id) had_attendance,
              extract(epoch from (select min(ev.occurred_at) from human_support_request_events ev where ev.request_id = r.id and ev.cause = 'ASSIGNED') - r.created_at)::float8 first_assigned_seconds,
              extract(epoch from r.ended_at - r.created_at)::float8 queue_seconds
         from human_support_requests r
        where r.organization_id = $1 and r.created_at >= ${requests.start} and r.created_at < ${requests.end} and ${requests.clause}`,
      requests.params,
    )
  ).rows
  const requestsByOrigin = Object.fromEntries(REQUEST_ORIGINS.map((origin) => [origin, 0])) as Record<RequestOrigin, number>
  const endedByOutcome: Record<string, number> = {}
  const samples: QueueSample[] = []
  let hadAttendance = 0
  let openRequests = 0
  for (const row of requestRows) {
    requestsByOrigin[row.origin] += 1
    if (row.had_attendance) hadAttendance += 1
    if (row.status === "WAITING" || row.status === "IN_PROGRESS") openRequests += 1
    else endedByOutcome[`${row.status}:${row.end_cause}`] = (endedByOutcome[`${row.status}:${row.end_cause}`] ?? 0) + 1
    if (row.status === "CANCELLED" && row.end_cause === "SCOPE_DISABLED") continue
    if (row.first_assigned_seconds !== null) samples.push({ teamId: row.team_id, subteamId: row.subteam_id, assigned: true, waitSeconds: Math.max(0, Number(row.first_assigned_seconds)) })
    else if (row.queue_seconds !== null) samples.push({ teamId: row.team_id, subteamId: row.subteam_id, assigned: false, waitSeconds: Math.max(0, Number(row.queue_seconds)) })
  }
  const attendances = scoped("r")
  const attendanceRows = (
    await db.query<{ status: string; end_cause: string | null; response_seconds: number | null; duration_seconds: number | null; reason: string | null; outcome: string | null; reference_title: string | null; resolved: string | null; stars: number | null }>(
      `select a.status, a.end_cause,
              extract(epoch from a.first_anjo_message_at - a.started_at)::float8 response_seconds,
              extract(epoch from a.ended_at - a.started_at)::float8 duration_seconds,
              c.reason, c.outcome, c.reference_title, e.resolved, e.stars
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_classifications c on c.attendance_id = a.id
         left join human_support_evaluations e on e.attendance_id = a.id and e.superseded_at is null
        where a.organization_id = $1 and a.started_at >= ${attendances.start} and a.started_at < ${attendances.end} and ${attendances.clause}`,
      attendances.params,
    )
  ).rows
  const counts: SupportCounts = {
    suggestions,
    requestsByOrigin,
    convertedRequests,
    noAnjoAttempts,
    endedByOutcome,
    hadAttendance,
    openRequests,
    queuePopulation: samples.length > 0 ? { basis: "ORGANIZATION", samples } : null,
    assignmentWaitSeconds: samples.filter((sample) => sample.assigned).map((sample) => sample.waitSeconds),
    firstResponseSeconds: [],
    endedAttendances: 0,
    endedWithoutResponseByCause: {},
    durationSeconds: [],
    interruptedAttendances: 0,
    classificationsByReason: {},
    classificationsByOutcome: {},
    topTitles: [],
    resolvedCounts: {},
    starsCounts: {},
    endedNotInterrupted: 0,
  }
  const titles = new Map<string, number>()
  for (const row of attendanceRows) {
    if (row.response_seconds !== null) counts.firstResponseSeconds.push(Math.max(0, Number(row.response_seconds)))
    if (row.status === "ENDED") {
      counts.endedAttendances += 1
      if (row.response_seconds === null && row.end_cause) counts.endedWithoutResponseByCause[row.end_cause] = (counts.endedWithoutResponseByCause[row.end_cause] ?? 0) + 1
      if (row.end_cause === "ANJO_LOST") counts.interruptedAttendances += 1
      else {
        counts.endedNotInterrupted += 1
        if (row.duration_seconds !== null) counts.durationSeconds.push(Math.max(0, Number(row.duration_seconds)))
      }
    }
    if (row.reason) counts.classificationsByReason[row.reason] = (counts.classificationsByReason[row.reason] ?? 0) + 1
    if (row.outcome) counts.classificationsByOutcome[row.outcome] = (counts.classificationsByOutcome[row.outcome] ?? 0) + 1
    if (row.reference_title) titles.set(row.reference_title, (titles.get(row.reference_title) ?? 0) + 1)
    if (row.resolved) counts.resolvedCounts[row.resolved] = (counts.resolvedCounts[row.resolved] ?? 0) + 1
    if (row.stars !== null) counts.starsCounts[String(row.stars)] = (counts.starsCounts[String(row.stars)] ?? 0) + 1
  }
  counts.topTitles = [...titles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([title, total]) => ({ title, count: total }))
  return counts
}

/** Períodos com a chave geral desligada que tocam o período pedido (do histórico de configuração). */
async function disabledPeriods(db: Queryable, organizationId: string, query: PanelQuery): Promise<{ from: string; to: string | null }[]> {
  const bounds = periodBounds("$1", "$2", "$3")
  const range = (await db.query<{ start: Date; end: Date }>(`select ${bounds.start} start, ${bounds.end} "end"`, [organizationId, query.from, query.to])).rows[0]!
  const events = (await db.query<{ to_value: string; occurred_at: Date }>(`select to_value, occurred_at from human_support_setting_events where organization_id = $1 and target_type = 'ORGANIZATION' and field = 'ENABLED' and occurred_at < $2 order by occurred_at, id`, [organizationId, range.end])).rows
  const periods: { from: Date; to: Date | null }[] = []
  // Tudo nasce desligado: desligado "desde sempre" até o primeiro ligar.
  let enabled = false
  let offSince: Date | null = new Date(0)
  for (const event of events) {
    const next = event.to_value === "true"
    if (next === enabled) continue
    if (next && offSince) periods.push({ from: offSince, to: event.occurred_at })
    offSince = next ? null : event.occurred_at
    enabled = next
  }
  if (!enabled && offSince) periods.push({ from: offSince, to: null })
  return periods
    .filter((period) => (period.to === null || period.to > range.start) && period.from < range.end)
    .map((period) => ({ from: (period.from < range.start ? range.start : period.from).toISOString(), to: period.to && period.to < range.end ? period.to.toISOString() : null }))
}

export async function supportFunnel(db: Queryable, viewer: Viewer, query: PanelQuery): Promise<FunnelResponse> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const filter = { teamId: query.teamId ?? null, subteamId: query.subteamId ?? null }
  const [reply, counts, disabled] = await Promise.all([
    replyFunnel(db, viewer.organizationId, { from: query.from, to: query.to }, placementOf(coverage), filter),
    supportCounts(db, viewer.organizationId, coverage, query),
    disabledPeriods(db, viewer.organizationId, query),
  ])
  return { period: reply.period, cutoffs: { ...reply.cutoffs, disabledPeriods: disabled }, measures: [...(reply.measures as Measure[]), ...supportMeasures(counts)] }
}
