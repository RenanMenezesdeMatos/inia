import type { Database } from "../../../infrastructure/database/pool.js"
import { localDateParts } from "../../workflows/application/schedule-recurrence.js"
import { deriveSessions, unionSeconds, type DerivedSession, type SessionInputEvent, type Span } from "../domain/sessionization.js"
import { EVENT_BY_NAME } from "../domain/usage-events.js"
import { ADMIN_AREAS, type UsageArea } from "../domain/usage-screens.js"
import { addDays, localDateOf, startOfLocalDate } from "../domain/usage-time.js"
import { loadUsageSettings } from "./usage-settings.js"

/**
 * PROJEÇÃO de atividade — consome a fila (pessoa × dia local) e reconstrói, a partir dos EVENTOS BRUTOS, as sessões de uso,
 * os fatos pessoa × dia e pessoa × dia × tela, e os marcos de acesso. Determinística e idempotente: reprocessar o mesmo dia
 * produz as mesmas linhas; evento tardio só marca o dia dele de novo. Nunca toca tabela de negócio.
 */
type Queryable = Pick<Database, "query">

type EventRow = {
  event_id: string
  event_name: string
  occurred_at: Date
  usage_session_id: string | null
  account_id: string | null
  screen_key: string | null
  screen_instance_id: string | null
  area: UsageArea | null
  device: string | null
  app_version: string | null
  population_class: string
  team_id: string | null
  subteam_id: string | null
  reports_to_id: string | null
  properties: Record<string, unknown>
}

const isAdmin = (area: UsageArea | null) => area !== null && ADMIN_AREAS.includes(area)

/** Instante de atividade humana atestada pelo evento (null = não estende a sessão nem torna ativo). */
export function activityInstantOf(row: Pick<EventRow, "event_name" | "occurred_at" | "properties">): Date | null {
  if (row.event_name === "activity.heartbeat") {
    const last = row.properties.lastInteractionAt
    return row.properties.reason === "INTERACTION" && typeof last === "string" ? new Date(last) : null
  }
  return EVENT_BY_NAME.get(row.event_name)?.qualifiesActivity ? row.occurred_at : null
}

function spanOf(row: EventRow): Span | null {
  if (row.event_name !== "activity.heartbeat") return null
  const start = row.properties.spanStart
  const end = row.properties.spanEnd
  return typeof start === "string" && typeof end === "string" ? { start: new Date(start), end: new Date(end) } : null
}

const sessionInput = (row: EventRow): SessionInputEvent => ({
  usageSessionId: row.usage_session_id!,
  occurredAt: row.occurred_at,
  activityAt: activityInstantOf(row),
  logout: row.event_name === "screen.left" && row.properties.reason === "LOGOUT",
  admin: isAdmin(row.area),
})

const EVENT_COLUMNS = `event_id, event_name, occurred_at, usage_session_id, account_id, screen_key, screen_instance_id, area, device, app_version, population_class, team_id, subteam_id, reports_to_id, properties`

export type ProjectionResult = { processed: number; failed: number; maxLagMs: number }

export async function runActivityProjection(db: Database, options: { now?: Date; batchSize?: number; maxBatches?: number } = {}): Promise<ProjectionResult> {
  const now = options.now ?? new Date()
  const startedAt = new Date()
  let processed = 0
  let failed = 0
  let maxLagMs = 0
  for (let batch = 0; batch < (options.maxBatches ?? 5); batch += 1) {
    const claimed = await db.query<{ organization_id: string; person_id: string; local_date: string; marked_at: Date; attempts: number }>(
      `delete from usage_projection_dirty where (organization_id, person_id, local_date) in (
         select organization_id, person_id, local_date from usage_projection_dirty order by marked_at limit $1 for update skip locked)
       returning organization_id, person_id, to_char(local_date, 'YYYY-MM-DD') local_date, marked_at, attempts`,
      [options.batchSize ?? 200],
    )
    if (claimed.rows.length === 0) break
    const groups = new Map<string, { organizationId: string; personId: string; dates: string[]; attempts: number }>()
    for (const row of claimed.rows) {
      maxLagMs = Math.max(maxLagMs, now.getTime() - row.marked_at.getTime())
      const key = `${row.organization_id}|${row.person_id}`
      const group = groups.get(key) ?? { organizationId: row.organization_id, personId: row.person_id, dates: [], attempts: row.attempts }
      group.dates.push(row.local_date)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      try {
        await projectPerson(db, group.organizationId, group.personId, group.dates, now)
        processed += group.dates.length
      } catch (error) {
        failed += group.dates.length
        console.error(JSON.stringify({ event: "usage_projection_failed", personId: group.personId, message: (error as Error).message }))
        // Volta para a fila (até 5 tentativas): falha técnica nunca perde o dia.
        if (group.attempts < 5) {
          await db.query(
            `insert into usage_projection_dirty (organization_id, person_id, local_date, marked_at, attempts) select $1, $2, d, $4, $5 from unnest($3::date[]) d
             on conflict (organization_id, person_id, local_date) do update set attempts = excluded.attempts`,
            [group.organizationId, group.personId, group.dates, now, group.attempts + 1],
          )
        }
      }
    }
  }
  if (processed > 0 || failed > 0) {
    await db.query(`insert into usage_projection_runs (kind, started_at, finished_at, processed, failed, details) values ('ACTIVITY', $1, $2, $3, $4, $5)`, [startedAt, new Date(), processed, failed, JSON.stringify({ maxLagMs })])
  }
  return { processed, failed, maxLagMs }
}

export async function projectPerson(db: Queryable, organizationId: string, personId: string, dates: readonly string[], now: Date) {
  const { timezone } = await loadUsageSettings(db, organizationId, now)
  const sorted = [...new Set(dates)].sort()
  const windowStart = startOfLocalDate(addDays(sorted[0]!, -1), timezone)
  const windowEnd = startOfLocalDate(addDays(sorted[sorted.length - 1]!, 2), timezone)
  const window = await db.query<EventRow>(
    `select ${EVENT_COLUMNS} from usage_events where organization_id = $1 and actor_person_id = $2 and source = 'CLIENT' and occurred_at >= $3 and occurred_at < $4 order by occurred_at, event_id`,
    [organizationId, personId, windowStart, windowEnd],
  )

  // 1) Sessões dos ids do navegador tocados nos dias marcados (todos os eventos desses ids, mesmo fora da janela).
  const touchedIds = new Set<string>()
  for (const date of sorted) {
    const start = startOfLocalDate(date, timezone).getTime()
    const end = startOfLocalDate(addDays(date, 1), timezone).getTime()
    for (const row of window.rows) if (row.usage_session_id && row.occurred_at.getTime() >= start && row.occurred_at.getTime() < end) touchedIds.add(row.usage_session_id)
  }
  const extraDirty = new Set<string>()
  if (touchedIds.size > 0) {
    const all = await db.query<EventRow>(`select ${EVENT_COLUMNS} from usage_events where organization_id = $1 and actor_person_id = $2 and source = 'CLIENT' and usage_session_id = any($3::uuid[])`, [organizationId, personId, [...touchedIds]])
    const derived = deriveSessions(all.rows.map(sessionInput), now)
    const previous = await db.query<{ usage_session_id: string; seq: number; started_at: Date; ended_at: Date; end_reason: string }>(`select usage_session_id, seq, started_at, ended_at, end_reason from usage_sessions where organization_id = $1 and usage_session_id = any($2::uuid[])`, [organizationId, [...touchedIds]])
    const signature = (row: { usage_session_id?: string; usageSessionId?: string; seq: number; started_at?: Date; startedAt?: Date; ended_at?: Date; endedAt?: Date; end_reason?: string; endReason?: string }) => `${row.usage_session_id ?? row.usageSessionId}|${row.seq}|${(row.started_at ?? row.startedAt)!.toISOString()}|${(row.ended_at ?? row.endedAt)!.toISOString()}|${row.end_reason ?? row.endReason}`
    const before = new Set(previous.rows.map(signature))
    await db.query(`delete from usage_sessions where organization_id = $1 and usage_session_id = any($2::uuid[])`, [organizationId, [...touchedIds]])
    for (const session of derived) {
      const rows = all.rows.filter((row) => row.usage_session_id === session.usageSessionId)
      await insertSession(db, organizationId, personId, session, rows, timezone, now)
      // Sessão nova/alterada que atravessa a meia-noite: o outro dia também precisa recontar "sessões ativas no dia".
      if (!before.has(signature(session))) {
        for (let date = localDateOf(session.startedAt, timezone); date <= localDateOf(session.endedAt, timezone); date = addDays(date, 1)) if (!sorted.includes(date)) extraDirty.add(date)
      }
    }
  }

  // 2) Fatos pessoa × dia e pessoa × dia × tela.
  let firstActivity: Date | null = null
  let lastActivity: Date | null = null
  for (const date of sorted) {
    const dayStart = startOfLocalDate(date, timezone)
    const dayEnd = startOfLocalDate(addDays(date, 1), timezone)
    const inDay = window.rows.filter((row) => row.occurred_at >= dayStart && row.occurred_at < dayEnd)
    const activities = window.rows.map((row) => ({ row, at: activityInstantOf(row) })).filter((item): item is { row: EventRow; at: Date } => item.at !== null && item.at >= dayStart && item.at < dayEnd)
    const spans = window.rows.map((row) => ({ row, span: spanOf(row) })).filter((item): item is { row: EventRow; span: Span } => item.span !== null && item.span.end > dayStart && item.span.start < dayEnd)
    const sessions = await db.query<{ started: number; started_product: number; active: number }>(
      `select count(*) filter (where started_at >= $3 and started_at < $4)::int started,
              count(*) filter (where started_at >= $3 and started_at < $4 and has_product_activity)::int started_product,
              count(*) filter (where started_at < $4 and ended_at >= $3)::int active
       from usage_sessions where organization_id = $1 and person_id = $2`,
      [organizationId, personId, dayStart, dayEnd],
    )
    const counts = sessions.rows[0] ?? { started: 0, started_product: 0, active: 0 }
    await db.query(`delete from usage_screen_person_days where organization_id = $1 and person_id = $2 and local_date = $3`, [organizationId, personId, date])
    if (activities.length === 0 && spans.length === 0 && counts.active === 0) {
      await db.query(`delete from usage_person_days where organization_id = $1 and person_id = $2 and local_date = $3`, [organizationId, personId, date])
      continue
    }
    const latest = [...inDay].reverse()[0] ?? activities[activities.length - 1]?.row ?? null
    const views = inDay.filter((row) => row.event_name === "screen.viewed")
    const hours = [...new Set(activities.map((item) => Number(localDateParts(item.at, timezone).time.slice(0, 2))))].sort((a, b) => a - b)
    const dayFirst = activities.length > 0 ? new Date(Math.min(...activities.map((item) => item.at.getTime()))) : null
    const dayLast = activities.length > 0 ? new Date(Math.max(...activities.map((item) => item.at.getTime()))) : null
    if (dayFirst && (!firstActivity || dayFirst < firstActivity)) firstActivity = dayFirst
    if (dayLast && (!lastActivity || dayLast > lastActivity)) lastActivity = dayLast
    await db.query(
      `insert into usage_person_days (organization_id, person_id, local_date, timezone, active_product, active_admin, sessions_started, sessions_started_product, sessions_active,
         active_seconds, active_seconds_product, screen_views, screen_views_product, activations, first_activity_at, last_activity_at, devices, active_hours,
         population_class, team_id, subteam_id, reports_to_id, projected_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       on conflict (organization_id, person_id, local_date) do update set timezone = excluded.timezone, active_product = excluded.active_product, active_admin = excluded.active_admin,
         sessions_started = excluded.sessions_started, sessions_started_product = excluded.sessions_started_product, sessions_active = excluded.sessions_active,
         active_seconds = excluded.active_seconds, active_seconds_product = excluded.active_seconds_product, screen_views = excluded.screen_views,
         screen_views_product = excluded.screen_views_product, activations = excluded.activations, first_activity_at = excluded.first_activity_at,
         last_activity_at = excluded.last_activity_at, devices = excluded.devices, active_hours = excluded.active_hours, population_class = excluded.population_class,
         team_id = excluded.team_id, subteam_id = excluded.subteam_id, reports_to_id = excluded.reports_to_id, projected_at = excluded.projected_at`,
      [
        organizationId, personId, date, timezone,
        activities.some((item) => !isAdmin(item.row.area)), activities.some((item) => isAdmin(item.row.area)),
        counts.started, counts.started_product, counts.active,
        unionSeconds(spans.map((item) => item.span), dayStart, dayEnd), unionSeconds(spans.filter((item) => !isAdmin(item.row.area)).map((item) => item.span), dayStart, dayEnd),
        views.length, views.filter((row) => !isAdmin(row.area)).length, inDay.filter((row) => row.event_name === "element.activated").length,
        dayFirst, dayLast, [...new Set(inDay.map((row) => row.device).filter((device): device is string => device !== null))].sort(), hours,
        latest?.population_class ?? "REAL", latest?.team_id ?? null, latest?.subteam_id ?? null, latest?.reports_to_id ?? null, now,
      ],
    )
    const screens = new Map<string, { area: UsageArea | null; views: number; spans: Span[]; row: EventRow }>()
    for (const row of views) {
      const entry = screens.get(row.screen_key!) ?? { area: row.area, views: 0, spans: [], row }
      entry.views += 1
      screens.set(row.screen_key!, entry)
    }
    for (const item of spans) {
      if (!item.row.screen_key) continue
      const entry = screens.get(item.row.screen_key) ?? { area: item.row.area, views: 0, spans: [], row: item.row }
      entry.spans.push(item.span)
      screens.set(item.row.screen_key, entry)
    }
    for (const [screenKey, entry] of screens) {
      await db.query(
        `insert into usage_screen_person_days (organization_id, person_id, local_date, screen_key, area, views, active_seconds, population_class, team_id, subteam_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [organizationId, personId, date, screenKey, entry.area, entry.views, unionSeconds(entry.spans, dayStart, dayEnd), entry.row.population_class, entry.row.team_id, entry.row.subteam_id],
      )
    }
  }

  // 3) Marcos de acesso (nunca expiram).
  if (firstActivity && lastActivity) {
    await db.query(
      `insert into usage_person_milestones (organization_id, person_id, first_observed_at, first_observed_source, last_observed_at, last_observed_source, updated_at)
       values ($1, $2, $3, 'ACTIVITY', $4, 'ACTIVITY', $5)
       on conflict (organization_id, person_id) do update set
         first_observed_source = case when usage_person_milestones.first_observed_at is null or excluded.first_observed_at < usage_person_milestones.first_observed_at then 'ACTIVITY' else usage_person_milestones.first_observed_source end,
         first_observed_at = least(coalesce(usage_person_milestones.first_observed_at, excluded.first_observed_at), excluded.first_observed_at),
         last_observed_source = case when usage_person_milestones.last_observed_at is null or excluded.last_observed_at > usage_person_milestones.last_observed_at then 'ACTIVITY' else usage_person_milestones.last_observed_source end,
         last_observed_at = greatest(coalesce(usage_person_milestones.last_observed_at, excluded.last_observed_at), excluded.last_observed_at),
         updated_at = excluded.updated_at`,
      [organizationId, personId, firstActivity, lastActivity, now],
    )
  }
  if (extraDirty.size > 0) {
    await db.query(
      `insert into usage_projection_dirty (organization_id, person_id, local_date, marked_at) select $1, $2, d, $4 from unnest($3::date[]) d on conflict (organization_id, person_id, local_date) do nothing`,
      [organizationId, personId, [...extraDirty], now],
    )
  }
}

async function insertSession(db: Queryable, organizationId: string, personId: string, session: DerivedSession, rows: readonly EventRow[], timezone: string, now: Date) {
  const spans = rows.map(spanOf).filter((span): span is Span => span !== null)
  const activeSeconds = unionSeconds(spans, new Date(session.startedAt.getTime() - 20_000), new Date(session.endedAt.getTime() + 20_000))
  const inSession = rows.filter((row) => row.occurred_at >= session.startedAt && row.occurred_at <= session.endedAt)
  const reference = inSession[inSession.length - 1] ?? rows[rows.length - 1]
  await db.query(
    `insert into usage_sessions (organization_id, account_id, person_id, usage_session_id, seq, started_at, last_activity_at, ended_at, end_reason, activity_count, active_seconds,
       has_product_activity, has_admin_activity, device, app_version, population_class, team_id, subteam_id, reports_to_id, started_local_date, timezone, projected_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      organizationId, reference?.account_id, personId, session.usageSessionId, session.seq, session.startedAt, session.lastActivityAt, session.endedAt, session.endReason, session.activityCount, activeSeconds,
      session.hasProductActivity, session.hasAdminActivity, reference?.device ?? null, reference?.app_version ?? null, reference?.population_class ?? "REAL",
      reference?.team_id ?? null, reference?.subteam_id ?? null, reference?.reports_to_id ?? null, localDateOf(session.startedAt, timezone), timezone, now,
    ],
  )
}
