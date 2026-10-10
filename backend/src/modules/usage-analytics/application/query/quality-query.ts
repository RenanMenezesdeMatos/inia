import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { FUNNEL_DEFINITION_VERSION, DIFFICULTY_RULES } from "../../domain/journeys.js"
import { ACTIVITY_DEFINITION_VERSION, METRIC_DEFINITIONS, SESSION_DEFINITION_VERSION, USABILITY_DEFINITIONS_VERSION } from "../../domain/metric-dictionary.js"
import { REJECTION_REASON_LABELS, REJECTION_REASONS } from "../../domain/ingestion-rules.js"
import { USAGE_EVENT_FAMILIES, USAGE_EVENT_SCHEMA_VERSION, USAGE_EVENTS, USAGE_FAMILY_LABELS } from "../../domain/usage-events.js"
import { USAGE_AREA_LABELS, USAGE_SCREENS } from "../../domain/usage-screens.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, OFFICIAL_SOURCE_LABELS, officialCoverage, type OfficialSource, type UsabilityContext } from "./usability-context.js"

/**
 * QUALIDADE DA MEDIÇÃO — o que é medido, desde quando, com que atraso e o que foi recusado. Mensagens distintas: "Nenhum evento
 * no período", "Medição iniciada em…", "Coleta parcialmente indisponível", "Histórico não medido". Evento perdido ANTES de chegar
 * ao servidor tem contagem exata desconhecida — aparecem só os sinais observáveis (fila do navegador, atraso, duplicados).
 */
type Queryable = Pick<Database, "query">

export async function qualityQuery(db: Queryable, ctx: UsabilityContext) {
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const range = (p: SqlParams, column: string) => `${column} >= ${p.typed(ctx.period.start, "timestamptz")} and ${column} < ${p.typed(ctx.period.end, "timestamptz")}`
  const [batches, reasons, timestamps, screensSeen, projection, pending, classifications, authFailures] = await Promise.all([
    run<Record<string, number | null>>((p) => `select count(*)::int batches, coalesce(sum(events_received), 0)::int received, coalesce(sum(accepted), 0)::int accepted, coalesce(sum(duplicates), 0)::int duplicates,
        coalesce(sum(rejected), 0)::int rejected, count(*) filter (where transport = 'BEACON')::int beacon_batches,
        percentile_cont(0.5) within group (order by abs(clock_offset_ms)) clock_offset_p50, percentile_cont(0.95) within group (order by abs(clock_offset_ms)) clock_offset_p95,
        percentile_cont(0.95) within group (order by oldest_event_age_ms) delivery_delay_p95, max(received_at) last_batch_at
      from usage_ingest_batches where organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${range(p, "received_at")}`),
    run<{ reason: string; n: number }>((p) => `select key reason, sum(value::int)::int n from usage_ingest_batches b, jsonb_each_text(b.rejection_reasons) where b.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${range(p, "b.received_at")} group by 1`),
    run<{ timestamp_status: string; source: string; n: number }>((p) => `select timestamp_status, source, count(*)::int n from usage_events where organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${range(p, "occurred_at")} group by 1, 2`),
    run<{ screen_key: string; first_at: Date; last_at: Date; views: number }>((p) => `select screen_key, min(occurred_at) first_at, max(occurred_at) last_at, count(*)::int views from usage_events
      where organization_id = ${p.typed(ctx.organizationId, "uuid")} and event_name = 'screen.viewed' group by 1`),
    run<{ kind: string; started_at: Date; finished_at: Date | null; processed: number; failed: number; details: Record<string, unknown> }>(() => `select distinct on (kind) kind, started_at, finished_at, processed, failed, details from usage_projection_runs order by kind, started_at desc`),
    run<{ pending: number; oldest: Date | null; retried: number }>((p) => `select count(*)::int pending, min(marked_at) oldest, count(*) filter (where attempts > 0)::int retried from usage_projection_dirty where organization_id = ${p.typed(ctx.organizationId, "uuid")}`),
    ctx.can.manage && ctx.can.people
      ? run<{ person_id: string; name: string; classification: string; reason: string; classified_at: Date }>((p) => `select c.person_id, pop.name, c.classification, c.reason, c.classified_at from usage_population_classifications c
          join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = c.person_id where c.organization_id = ${p.typed(ctx.organizationId, "uuid")} and c.removed_at is null order by pop.name limit 500`)
      : Promise.resolve(null),
    ctx.can.manage ? run<{ failures: number }>((p) => `select coalesce(sum(failures), 0)::int failures from usage_auth_failure_counts where ${range(p, "bucket_start")}`) : Promise.resolve(null),
  ])
  const seen = new Map(screensSeen.map((row) => [row.screen_key, row]))
  const familyRows = USAGE_EVENT_FAMILIES.map((family) => {
    const state = coverageState.families.get(family)
    return { family, label: USAGE_FAMILY_LABELS[family], firstEventAt: state?.first.toISOString() ?? null, lastEventAt: state?.last.toISOString() ?? null, lastReceivedAt: state?.lastReceived.toISOString() ?? null, coverage: familyCoverage(coverageState, [family], ctx.period.start, ctx.period.end) }
  })
  const b = batches[0] ?? {}
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  const p0 = pending[0]
  const state = (row: { coverage: { status: string } }) => row.coverage.status
  const statusMessage = familyRows.every((row) => state(row) === "NONE")
    ? "Nenhum evento no período — a medição ainda não começou ou está desligada."
    : familyRows.some((row) => state(row) === "PARTIAL")
      ? "Medição iniciada durante o período (cobertura parcial)."
      : coverageState.disabledIntervals.length > 0
        ? "Coleta parcialmente indisponível em parte do período."
        : null
  return {
    meta: metaOf(ctx, freshness, { statusMessage }),
    collection: { enabled: ctx.settings.collectionEnabled, rawRetentionDays: ctx.settings.rawRetentionDays, factRetentionMonths: ctx.settings.factRetentionMonths, timezone: ctx.settings.timezone, timezoneSource: ctx.settings.timezoneSource, disabledIntervals: coverageState.disabledIntervals.map((interval) => ({ from: interval.from.toISOString(), to: interval.to.toISOString() })) },
    families: familyRows,
    officialSources: (Object.keys(OFFICIAL_SOURCE_LABELS) as OfficialSource[]).map((source) => ({ source, label: OFFICIAL_SOURCE_LABELS[source], since: coverageState.official.get(source)?.toISOString() ?? null, coverage: officialCoverage(coverageState, source, ctx.period.start, ctx.period.end) })),
    eligibility: { trackingStartedAt: coverageState.eligibilityStart?.toISOString() ?? null, note: "Antes do início do registro, a elegibilidade é desconhecida (nunca reconstruída)." },
    ingestion: {
      batches: Number(b.batches ?? 0), received: Number(b.received ?? 0), accepted: Number(b.accepted ?? 0), duplicates: Number(b.duplicates ?? 0), rejected: Number(b.rejected ?? 0), beaconBatches: Number(b.beacon_batches ?? 0),
      clockOffsetMedianMs: b.clock_offset_p50 === null || b.clock_offset_p50 === undefined ? null : Math.round(Number(b.clock_offset_p50)), clockOffsetP95Ms: b.clock_offset_p95 === null || b.clock_offset_p95 === undefined ? null : Math.round(Number(b.clock_offset_p95)),
      deliveryDelayP95Ms: b.delivery_delay_p95 === null || b.delivery_delay_p95 === undefined ? null : Math.round(Number(b.delivery_delay_p95)),
      lastBatchAt: (b.last_batch_at as unknown) instanceof Date ? (b.last_batch_at as unknown as Date).toISOString() : null,
      rejections: REJECTION_REASONS.map((reason) => ({ reason, label: REJECTION_REASON_LABELS[reason], count: reasons.find((row) => row.reason === reason)?.n ?? 0 })),
      timestamps: timestamps.map((row) => ({ status: row.timestamp_status, source: row.source, count: row.n })),
      unknownLoss: "Eventos perdidos antes de chegar ao servidor (aba fechada sem envio, rede) não têm contagem exata conhecida.",
    },
    projection: {
      runs: projection.map((row) => ({ kind: row.kind, startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null, processed: row.processed, failed: row.failed, details: ownDetails(row.kind, row.details, ctx.organizationId) })),
      pendingDays: p0?.pending ?? 0, oldestPendingAt: p0?.oldest?.toISOString() ?? null, retriedDays: p0?.retried ?? 0, lagSeconds: freshness.lagSeconds,
    },
    catalog: USAGE_SCREENS.map((screen) => {
      const observed = seen.get(screen.key)
      return { key: screen.key, label: screen.label, kind: screen.kind, area: screen.area, areaLabel: USAGE_AREA_LABELS[screen.area], routeTemplate: screen.routeTemplate, instrumentation: screen.instrumentation, firstObservedAt: observed?.first_at.toISOString() ?? null, lastObservedAt: observed?.last_at.toISOString() ?? null, views: observed?.views ?? 0 }
    }),
    versions: { definitions: USABILITY_DEFINITIONS_VERSION, session: SESSION_DEFINITION_VERSION, activity: ACTIVITY_DEFINITION_VERSION, funnels: FUNNEL_DEFINITION_VERSION, difficulty: DIFFICULTY_RULES.version, eventSchema: USAGE_EVENT_SCHEMA_VERSION },
    dictionary: METRIC_DEFINITIONS,
    events: USAGE_EVENTS.map((event) => ({ name: event.name, family: event.family, familyLabel: USAGE_FAMILY_LABELS[event.family], emitter: event.emitter, authority: event.authority, purpose: event.purpose, moment: event.moment, correlation: event.correlation, dedupe: event.dedupe, sensitivity: event.sensitivity, qualifiesActivity: event.qualifiesActivity, entityTypes: event.entityTypes ?? [] })),
    classifications: classifications?.map((row) => ({ personId: row.person_id, name: row.name, classification: row.classification, reason: row.reason, classifiedAt: row.classified_at.toISOString() })) ?? null,
    authFailures: authFailures ? { installationWide: authFailures[0]?.failures ?? 0, note: "Falhas de login da instalação inteira: nunca atribuídas a organização nem a pessoa pela entrada digitada." } : null,
  }
}

/**
 * As execuções de projeção/retenção são da INSTALAÇÃO: o detalhe por organização (retenção) só mostra a organização de quem
 * consulta — ids e contagens de outros clientes nunca saem daqui.
 */
function ownDetails(kind: string, details: Record<string, unknown>, organizationId: string): Record<string, unknown> | null {
  if (kind === "RETENTION") return (details[organizationId] as Record<string, unknown> | undefined) ?? null
  return Object.fromEntries(Object.entries(details).filter(([key]) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key)))
}
