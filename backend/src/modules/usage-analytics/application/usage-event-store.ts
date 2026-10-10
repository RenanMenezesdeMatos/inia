import type { Database } from "../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { loadPersonPlacements } from "../../people/application/usage-analytics-reader.js"
import { localDateOf } from "../domain/usage-time.js"

/**
 * Gravação dos eventos de uso (navegador e servidor) — mesmo caminho para os dois: insert com deduplicação por
 * (organização, eventId) e, nos fatos de servidor, pela chave semântica; cobertura por família; marcação de reprojeção
 * (pessoa × dia local) para que eventos novos ou TARDIOS corrijam o dia certo.
 */
type Queryable = Pick<Database, "query">

export type UsageEventRow = {
  organizationId: string
  eventId: string
  eventName: string
  schemaVersion: number
  family: string
  source: "CLIENT" | "SERVER" | "BACKFILL"
  actorType: "HUMAN" | "SYSTEM"
  accountId: string | null
  actorPersonId: string | null
  subjectPersonId: string | null
  occurredAt: Date
  clientOccurredAt: Date | null
  receivedAt: Date
  clockOffsetMs: number | null
  timestampStatus: "OK" | "CLIENT_CLOCK_CORRECTED" | "LATE"
  usageSessionId: string | null
  tabId: string | null
  screenInstanceId: string | null
  screenKey: string | null
  featureKey: string | null
  elementKey: string | null
  routeTemplate: string | null
  area: string | null
  entityType: string | null
  entityId: string | null
  correlationId: string | null
  device: string | null
  appVersion: string | null
  environment: string
  populationClass: "REAL" | "TEST" | "DEMO" | "AUTOMATION"
  teamId: string | null
  subteamId: string | null
  reportsToId: string | null
  properties: Record<string, unknown>
  idempotencyKey: string | null
  batchId: string | null
}

const COLUMNS = [
  "organization_id", "event_id", "event_name", "schema_version", "family", "source", "actor_type", "account_id", "actor_person_id", "subject_person_id",
  "occurred_at", "client_occurred_at", "received_at", "clock_offset_ms", "timestamp_status", "usage_session_id", "tab_id", "screen_instance_id", "screen_key",
  "feature_key", "element_key", "route_template", "area", "entity_type", "entity_id", "correlation_id", "device", "app_version", "environment",
  "population_class", "team_id", "subteam_id", "reports_to_id", "properties", "idempotency_key", "batch_id",
] as const

function valuesOf(row: UsageEventRow): unknown[] {
  return [
    row.organizationId, row.eventId, row.eventName, row.schemaVersion, row.family, row.source, row.actorType, row.accountId, row.actorPersonId, row.subjectPersonId,
    row.occurredAt, row.clientOccurredAt, row.receivedAt, row.clockOffsetMs, row.timestampStatus, row.usageSessionId, row.tabId, row.screenInstanceId, row.screenKey,
    row.featureKey, row.elementKey, row.routeTemplate, row.area, row.entityType, row.entityId, row.correlationId, row.device, row.appVersion, row.environment,
    row.populationClass, row.teamId, row.subteamId, row.reportsToId, JSON.stringify(row.properties), row.idempotencyKey, row.batchId,
  ]
}

/** Insere; devolve os eventIds efetivamente gravados (os demais eram duplicados). */
export async function insertUsageEvents(db: Queryable, rows: readonly UsageEventRow[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set()
  const p = new SqlParams()
  const tuples = rows.map((row) => `(${valuesOf(row).map((value) => p.add(value)).join(", ")})`)
  const result = await db.query<{ event_id: string }>(
    `insert into usage_events (${COLUMNS.join(", ")}) values ${tuples.join(", ")} on conflict do nothing returning event_id`,
    p.values,
  )
  return new Set(result.rows.map((row) => row.event_id))
}

/** Primeira/última evidência de cada família na organização (base de "medição iniciada em…"). */
export async function touchCoverage(db: Queryable, organizationId: string, rows: readonly Pick<UsageEventRow, "family" | "occurredAt">[], receivedAt: Date) {
  const byFamily = new Map<string, { first: Date; last: Date }>()
  for (const row of rows) {
    const current = byFamily.get(row.family)
    byFamily.set(row.family, { first: !current || row.occurredAt < current.first ? row.occurredAt : current.first, last: !current || row.occurredAt > current.last ? row.occurredAt : current.last })
  }
  for (const [family, range] of byFamily) {
    await db.query(
      `insert into usage_coverage (organization_id, family, first_event_at, last_event_at, last_received_at) values ($1, $2, $3, $4, $5)
       on conflict (organization_id, family) do update set first_event_at = least(usage_coverage.first_event_at, excluded.first_event_at),
         last_event_at = greatest(usage_coverage.last_event_at, excluded.last_event_at), last_received_at = greatest(usage_coverage.last_received_at, excluded.last_received_at)`,
      [organizationId, family, range.first, range.last, receivedAt],
    )
  }
}

/** Marca (pessoa × dia local) para reprojeção — inclusive o dia seguinte quando o intervalo atravessa a meia-noite. */
export async function markDirty(db: Queryable, organizationId: string, items: readonly { personId: string; instants: readonly Date[] }[], timeZone: string, now: Date) {
  const pairs = new Set<string>()
  for (const item of items) for (const instant of item.instants) pairs.add(`${item.personId}|${localDateOf(instant, timeZone)}`)
  if (pairs.size === 0) return
  const people: string[] = []
  const dates: string[] = []
  for (const pair of pairs) {
    const [person, date] = pair.split("|") as [string, string]
    people.push(person)
    dates.push(date)
  }
  await db.query(
    `insert into usage_projection_dirty (organization_id, person_id, local_date, marked_at)
     select $1, person, day, $4 from unnest($2::uuid[], $3::date[]) as t(person, day)
     on conflict (organization_id, person_id, local_date) do update set marked_at = greatest(usage_projection_dirty.marked_at, excluded.marked_at)`,
    [organizationId, people, dates, now],
  )
}

export type ActorContext = { teamId: string | null; subteamId: string | null; reportsToId: string | null; populationClass: UsageEventRow["populationClass"] }

/** Estrutura (leitor do cadastro) e classificação EXPLÍCITA do ator agora (= no momento do fato: a ingestão é imediata). */
export async function loadActorContext(db: Queryable, organizationId: string, personId: string): Promise<ActorContext> {
  const [placements, classification] = await Promise.all([
    loadPersonPlacements(db, organizationId, [personId]),
    db.query<{ classification: UsageEventRow["populationClass"] }>(`select classification from usage_population_classifications where organization_id = $1 and person_id = $2 and removed_at is null`, [organizationId, personId]),
  ])
  const placement = placements.get(personId)
  return { teamId: placement?.teamId ?? null, subteamId: placement?.subteamId ?? null, reportsToId: placement?.reportsToId ?? null, populationClass: classification.rows[0]?.classification ?? "REAL" }
}
