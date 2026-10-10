import { DATA_CONTRACTS } from "../domain/contract-registry.js"
import { describeErrorCode, WARNING_RECORD_ERROR_CODES } from "../domain/error-codes.js"
import type { FreshnessState } from "../domain/freshness.js"
import type { DataHubContext } from "./data-hub-context.js"
import { SELECT_FEED, SELECT_SOURCE, type DataFeedRow, type DataSourceRow } from "./records.js"
import { feedFreshness } from "./run-pipeline.js"
import { resolveEmploymentStatusFreshness, resolveWorkScheduleFreshness, type EmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { loadWorkActivityEvidenceSources } from "../../indicators/application/operational-measurement-resolver.js"
import { buildHolidayCatalogCoverage, type HolidayCatalogCoverage } from "../../people/application/holiday-catalog-coverage.js"
import { resolveWorkScheduleHorizon, type WorkScheduleHorizon } from "../../people/application/work-schedule-service.js"
import { evidenceSourcesEnabled, type WorkActivityEvidenceSources } from "../../people/domain/work-activity-evidence.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { describeAvailabilityPolicy, resolveSourceAvailability, SOURCE_AVAILABILITY_LABELS, type SourceAvailabilityState } from "../domain/data-availability.js"
import { availabilityByDate, availabilitySourcesOf, loadDataAvailabilityContext } from "../../people/application/data-availability-service.js"
import { AVAILABILITY_SOURCE_GROUP_LABELS, type AvailabilitySourceGroup } from "../../people/domain/workday-data-availability.js"

/**
 * Leituras operacionais da Central (home, fontes, mapa de dados, qualidade, lineage). Não é BI:
 * responde "está funcionando? quando atualizou? o que falhou?" — nada além disso.
 */
export type FeedSummary = DataFeedRow & { freshness: FreshnessState; contractLabel: string; lastRun: RunSummary | null }
export type RunSummary = { id: string; status: string; triggerKind: string; startedAt: string | null; finishedAt: string | null; recordsReceived: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number; errorCode: string | null }

export type SourceSummary = DataSourceRow & {
  feedCount: number
  activeFeedCount: number
  freshness: FreshnessState
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastDataAt: string | null
  nextSyncAt: string | null
  lastRecordsReceived: number | null
  lastRecordsRejected: number | null
  feeds: FeedSummary[]
}

function worstFreshness(states: FreshnessState[]): FreshnessState {
  if (states.length === 0) return "NEVER"
  if (states.includes("STALE")) return "STALE"
  if (states.every((state) => state === "NEVER")) return "NEVER"
  return "FRESH"
}

function maxIso(values: (string | null)[]): string | null {
  return values.reduce<string | null>((max, value) => (value && (!max || value > max) ? value : max), null)
}

async function loadLastRuns(ctx: DataHubContext, organizationId: string, feedIds: string[]): Promise<Map<string, RunSummary>> {
  if (feedIds.length === 0) return new Map()
  const result = await ctx.db.query<RunSummary & { feedId: string }>(
    `select distinct on (r.feed_id) r.feed_id "feedId", r.id, r.status, r.trigger_kind "triggerKind", r.started_at "startedAt", r.finished_at "finishedAt",
            r.records_received "recordsReceived", r.records_inserted "recordsInserted", r.records_updated "recordsUpdated", r.records_rejected "recordsRejected", r.error_code "errorCode"
     from data_ingestion_runs r where r.organization_id = $1 and r.feed_id = any($2::uuid[]) and r.status not in ('QUEUED', 'CANCELLED')
     order by r.feed_id, r.created_at desc`,
    [organizationId, feedIds],
  )
  return new Map(result.rows.map((row) => [row.feedId, { ...row, startedAt: toIso(row.startedAt), finishedAt: toIso(row.finishedAt) }]))
}

function toIso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null
}

function feedRowToIso(row: DataFeedRow): DataFeedRow {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[key] = value instanceof Date ? value.toISOString() : value
  return out as DataFeedRow
}

export async function listSourceSummaries(ctx: DataHubContext, organizationId: string): Promise<SourceSummary[]> {
  const now = ctx.clock.now()
  const [sources, feeds] = await Promise.all([
    ctx.db.query<DataSourceRow>(`${SELECT_SOURCE} where s.organization_id = $1 and s.deleted_at is null order by s.created_at`, [organizationId]),
    ctx.db.query<DataFeedRow>(`${SELECT_FEED} where f.organization_id = $1 and f.deleted_at is null order by f.created_at`, [organizationId]),
  ])
  const lastRuns = await loadLastRuns(ctx, organizationId, feeds.rows.map((feed) => feed.id))
  const contractLabels = new Map(DATA_CONTRACTS.map((contract) => [contract.key, contract.label]))
  return sources.rows.map((sourceRaw) => {
    const source = Object.fromEntries(Object.entries(sourceRaw).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as DataSourceRow
    const ownFeeds: FeedSummary[] = feeds.rows
      .filter((feed) => feed.sourceId === source.id)
      .map((feedRaw) => {
        const feed = feedRowToIso(feedRaw)
        return { ...feed, freshness: feedFreshness(feed, now), contractLabel: contractLabels.get(feed.contractKey) ?? feed.contractKey, lastRun: lastRuns.get(feed.id) ?? null }
      })
    const latest = ownFeeds.map((feed) => feed.lastRun).filter((run): run is RunSummary => run !== null).sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0] ?? null
    return {
      ...source,
      feedCount: ownFeeds.length,
      activeFeedCount: ownFeeds.filter((feed) => feed.status === "ACTIVE").length,
      freshness: worstFreshness(ownFeeds.filter((feed) => feed.status !== "DRAFT").map((feed) => feed.freshness)),
      lastRunAt: maxIso(ownFeeds.map((feed) => feed.lastRunAt)),
      lastSuccessAt: maxIso(ownFeeds.map((feed) => feed.lastSuccessAt)),
      lastDataAt: maxIso(ownFeeds.map((feed) => feed.lastDataAt)),
      nextSyncAt: ownFeeds.map((feed) => feed.nextSyncAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
      lastRecordsReceived: latest?.recordsReceived ?? null,
      lastRecordsRejected: latest?.recordsRejected ?? null,
      feeds: ownFeeds,
    }
  })
}

/** Relação entre contratos que alimentam a MESMA camada canônica (ex.: Ausências complementam Colaboradores). */
export type DataMapRelation = { kind: "COMPLEMENTS" | "COMPLEMENTED_BY"; contractKey: string; note: string }

const DATA_MAP_RELATIONS: Record<string, DataMapRelation> = {
  EMPLOYEES: { kind: "COMPLEMENTED_BY", contractKey: "EMPLOYEE_ABSENCES", note: "Snapshot do cadastro; quando traz a situação funcional, é a fonte da situação 'a partir de uma data'. Ausências complementam com períodos explícitos." },
  EMPLOYEE_ABSENCES: { kind: "COMPLEMENTS", contractKey: "EMPLOYEES", note: "Complementa o cadastro de Colaboradores com períodos explícitos (férias, INSS, maternidade, paternidade, atividade off) — um período explícito vence um snapshot sem intervalo." },
  WORK_SCHEDULES: { kind: "COMPLEMENTED_BY", contractKey: "WORK_SCHEDULE_DAYS", note: "Jornada e regime (5x2/6x1) com vigência — metadata. Quem diz se a pessoa trabalha em cada data é Escalas de trabalho." },
  WORK_SCHEDULE_DAYS: { kind: "COMPLEMENTS", contractKey: "WORK_SCHEDULES", note: "Calendário programado por dia (trabalha/folga): a evidência da elegibilidade operacional junto com a situação funcional. Ausência de linha não é folga; a folga normal do 6x1 chega aqui." },
  WORK_SCHEDULE_EXCEPTIONS: { kind: "COMPLEMENTS", contractKey: "WORK_SCHEDULE_DAYS", note: "Exceções individuais (banco de horas, day off, folga extraordinária): vencem a escala naquele dia sem reescrever o calendário programado. Medição do dia fica preservada e fora do cálculo." },
}

export type DataMapEntry = {
  contractKey: string
  label: string
  category: string
  targetEntity: string
  relation: DataMapRelation | null
  feeds: { feedId: string; feedName: string; sourceId: string; sourceName: string; sourceKind: string; status: string; freshness: FreshnessState; lastSuccessAt: string | null; lastDataAt: string | null; authoritative: boolean }[]
  freshness: FreshnessState | null
  recordCount: number | null
}

export type Overview = {
  generatedAt: string
  cards: { activeSources: number; sourcesWithError: number; receivedToday: number; rejectedToday: number; warningsToday: number; staleFeeds: number; runsToday: number; queuedRuns: number }
  sources: SourceSummary[]
  dataMap: DataMapEntry[]
  /** Situação funcional: "o estado funcional conhecido está atualizado?" — derivado dos feeds EMPLOYEES/EMPLOYEE_ABSENCES (nunca da saúde da conexão). */
  employmentStatus: EmploymentStatusFreshness
  /** Escalas de trabalho: mesma pergunta para o calendário programado (feeds WORK_SCHEDULE_DAYS). */
  workSchedule: EmploymentStatusFreshness
  /** Horizonte do calendário (até quando a escala é conhecida) — diferente de freshness e de saúde da conexão. */
  workScheduleHorizon: WorkScheduleHorizon
  /** Qualidade de dado do calendário operacional: capital operacional preenchida, 6x1 com/sem calendário. */
  calendarQuality: CalendarQuality
  recentRuns: (RunSummary & { feedName: string; sourceName: string; contractKey: string })[]
}

export type CalendarQuality = {
  /** Colaboradores (ativos) com capital operacional informada ÷ total. */
  operationalCapital: { filled: number; total: number }
  /** Pessoas com regime 6x1 vigente: com pelo menos um dia de calendário conhecido a partir de hoje × sem nenhum (escala desconhecida). */
  sixByOne: { withCalendar: number; withoutCalendar: number; total: number }
  /** Exceções de calendário vigentes de hoje em diante. */
  activeExceptionsAhead: number
  /** Exceções por ORIGEM (últimos 30 dias + futuro): vindas da Central × registradas pelo Supervisor; conflitos = linhas com override manual sobre dado da Central. */
  exceptionsByOrigin: { central: number; supervisor: number; conflicts: number; conflictWarnings30d: number }
  /** PLANEJADO × OBSERVADO nos últimos 7 dias (job de reconciliação) e as fontes de evidência configuradas. */
  reconciliation: { windowDays: number; openMissingProduction: number; resolvedMissingProduction: number; divergences: number; statusInconsistencies: number; evidenceSources: WorkActivityEvidenceSources & { enabled: boolean } }
  /** Cobertura verificada do catálogo-base de feriados + pendências de verificação (nunca "100%"). */
  holidayCatalog: HolidayCatalogCoverage
  /**
   * DISPONIBILIDADE ESPERADA (SLA D-1/D-2) — distinta de freshness: por fonte relevante (evidência de
   * produção e situação funcional), a política, o dia de referência mais recente que já deveria estar
   * disponível e se chegou; e, nos últimos 7 dias, quantos dias ainda aguardam dados × têm fonte atrasada.
   */
  dataAvailability: {
    sources: { key: string; label: string; group: AvailabilitySourceGroup; groupLabel: string; policyLabel: string; configured: boolean; referenceDate: string | null; state: SourceAvailabilityState; stateLabel: string; expectedAt: string | null; lastSuccessAt: string | null; lastDataAt: string | null; freshness: string | null }[]
    withinSla: number
    delayed: number
    unknownPolicy: number
    daysWaitingForData: number
    daysWithSourceDelay: number
    daysReady: number
  }
  /** CLASSIFICAÇÕES humanas (últimos 30 dias): confirmadas, revisadas, superadas por dado tardio. */
  classifications: { windowDays: number; unjustifiedAbsences: number; justifiedAbsences: number; workedDataMissing: number; revised: number; contradictedByEvidence: number; supersededByStatus: number; lateDataAutoResolved: number; awaitingClassification: number }
}

export async function buildCalendarQuality(ctx: DataHubContext, organizationId: string, today: string): Promise<CalendarQuality> {
  const since30 = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const [capital, sixByOne, exceptions, byOrigin, conflictWarnings, reconciliation, evidenceSources, holidayCatalog] = await Promise.all([
    ctx.db.query<{ filled: number; total: number }>(`select count(*) filter (where operational_capital_code is not null)::int filled, count(*)::int total from people where organization_id = $1 and active`, [organizationId]),
    ctx.db.query<{ with_calendar: number; total: number }>(
      `with six as (
         select distinct s.person_id from employee_work_shifts s join people p on p.id = s.person_id
          where p.organization_id = $1 and p.active and s.schedule_type = 'SIX_BY_ONE' and s.effective_from <= $2::date and (s.effective_to is null or s.effective_to >= $2::date))
       select count(*)::int total,
              count(*) filter (where exists (select 1 from employee_schedule_days d where d.person_id = six.person_id and d.schedule_date >= $2::date))::int with_calendar
         from six`,
      [organizationId, today],
    ),
    ctx.db.query<{ c: number }>(`select count(*)::int c from employee_schedule_exceptions where organization_id = $1 and active and exception_date >= $2::date`, [organizationId, today]),
    ctx.db.query<{ central: number; supervisor: number; conflicts: number }>(
      `select count(*) filter (where active and origin = 'CENTRAL_DATA')::int central, count(*) filter (where active and origin = 'SUPERVISOR_MANUAL')::int supervisor, count(*) filter (where manual_override)::int conflicts
         from employee_schedule_exceptions where organization_id = $1 and exception_date >= $2::date`,
      [organizationId, since30],
    ),
    ctx.db.query<{ c: number }>(`select count(*)::int c from data_ingestion_rejections where organization_id = $1 and error_code = 'DATA_SCHEDULE_EXCEPTION_CONFLICT' and created_at >= $2::date`, [organizationId, since30]),
    ctx.db.query<{ open_missing: number; resolved_missing: number; divergences: number; inconsistencies: number }>(
      `select count(*) filter (where kind = 'MISSING_EXPECTED_PRODUCTION' and status = 'OPEN')::int open_missing,
              count(*) filter (where kind = 'MISSING_EXPECTED_PRODUCTION' and status = 'RESOLVED')::int resolved_missing,
              count(*) filter (where kind = 'PRODUCTION_ON_NON_WORKING_DAY')::int divergences,
              count(*) filter (where kind = 'PRODUCTION_WITH_NON_ELIGIBLE_STATUS')::int inconsistencies
         from workday_reconciliations where organization_id = $1 and workday >= $2::date`,
      [organizationId, since7],
    ),
    loadWorkActivityEvidenceSources(ctx.db, organizationId),
    buildHolidayCatalogCoverage(ctx.db),
  ])
  const [classificationRows, lateData, timeZone] = await Promise.all([
    ctx.db.query<{ unjustified: number; justified: number; data_missing: number; revised: number; contradicted: number; by_status: number }>(
      `select count(*) filter (where classification = 'UNJUSTIFIED_ABSENCE' and superseded_at is null)::int unjustified,
              count(*) filter (where classification = 'JUSTIFIED_ABSENCE' and superseded_at is null)::int justified,
              count(*) filter (where classification = 'WORKED_DATA_MISSING' and superseded_at is null)::int data_missing,
              count(*) filter (where superseded_reason = 'REVISED')::int revised,
              count(*) filter (where superseded_reason = 'CONTRADICTED_BY_WORK_EVIDENCE')::int contradicted,
              count(*) filter (where superseded_reason = 'SUPERSEDED_BY_AUTHORITATIVE_STATUS')::int by_status
         from workday_classifications where organization_id = $1 and workday >= $2::date`,
      [organizationId, since30],
    ),
    ctx.db.query<{ c: number }>(`select count(*)::int c from workday_reconciliations where organization_id = $1 and workday >= $2::date and (resolution = 'PRODUCTION_RECEIVED_AFTER_ALERT' or (snapshot->>'receivedAfterAlert') = 'true')`, [organizationId, since30]),
    resolveOrganizationTimezone(ctx.db, organizationId),
  ])
  const now = ctx.clock.now()
  const availabilityContext = await loadDataAvailabilityContext(ctx.db, organizationId, timeZone, now)
  const sourceInputs = availabilitySourcesOf(availabilityContext, evidenceSources)
  const last7 = Array.from({ length: 7 }, (_, index) => new Date(new Date(`${today}T00:00:00Z`).getTime() - (index + 1) * 86_400_000).toISOString().slice(0, 10))
  const byDate = availabilityByDate(availabilityContext, last7, now, evidenceSources)
  const sourceStatuses = sourceInputs.map((source) => {
    // Dia de referência = o mais recente que já deveria estar disponível segundo a política (hoje − lagDays).
    const referenceDate = source.policy ? new Date(new Date(`${today}T00:00:00Z`).getTime() - source.policy.lagDays * 86_400_000).toISOString().slice(0, 10) : null
    const resolved = referenceDate ? resolveSourceAvailability({ policy: source.policy, workDate: referenceDate, now, timeZone, lastSuccessAt: source.lastSuccessAt, lastDataLocalDate: source.lastDataLocalDate }) : { state: "UNKNOWN" as const, expectedAt: null }
    // Hoje − lagDays ainda pode não ter vencido (horário): nesse caso o dia anterior é o de referência fechado.
    const effective = resolved.state === "WAITING" && referenceDate ? { referenceDate: new Date(new Date(`${referenceDate}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) } : { referenceDate }
    const final = effective.referenceDate && effective.referenceDate !== referenceDate ? resolveSourceAvailability({ policy: source.policy, workDate: effective.referenceDate, now, timeZone, lastSuccessAt: source.lastSuccessAt, lastDataLocalDate: source.lastDataLocalDate }) : resolved
    return {
      key: source.key,
      label: source.label,
      group: source.group,
      groupLabel: AVAILABILITY_SOURCE_GROUP_LABELS[source.group],
      policyLabel: describeAvailabilityPolicy(source.policy),
      configured: source.policy !== null,
      referenceDate: effective.referenceDate,
      state: final.state,
      stateLabel: SOURCE_AVAILABILITY_LABELS[final.state],
      expectedAt: final.expectedAt?.toISOString() ?? null,
      lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
      lastDataAt: source.lastDataLocalDate,
      freshness: source.freshness,
    }
  })
  const dayStates = [...byDate.values()].map((day) => day.state)
  const six = sixByOne.rows[0] ?? { with_calendar: 0, total: 0 }
  const origin = byOrigin.rows[0] ?? { central: 0, supervisor: 0, conflicts: 0 }
  const recon = reconciliation.rows[0] ?? { open_missing: 0, resolved_missing: 0, divergences: 0, inconsistencies: 0 }
  return {
    operationalCapital: { filled: capital.rows[0]?.filled ?? 0, total: capital.rows[0]?.total ?? 0 },
    sixByOne: { withCalendar: six.with_calendar, withoutCalendar: six.total - six.with_calendar, total: six.total },
    activeExceptionsAhead: exceptions.rows[0]?.c ?? 0,
    exceptionsByOrigin: { central: origin.central, supervisor: origin.supervisor, conflicts: origin.conflicts, conflictWarnings30d: conflictWarnings.rows[0]?.c ?? 0 },
    reconciliation: { windowDays: 7, openMissingProduction: recon.open_missing, resolvedMissingProduction: recon.resolved_missing, divergences: recon.divergences, statusInconsistencies: recon.inconsistencies, evidenceSources: { ...evidenceSources, enabled: evidenceSourcesEnabled(evidenceSources) } },
    holidayCatalog,
    dataAvailability: {
      sources: sourceStatuses,
      withinSla: sourceStatuses.filter((source) => source.state === "READY" || source.state === "WAITING").length,
      delayed: sourceStatuses.filter((source) => source.state === "DELAYED").length,
      unknownPolicy: sourceStatuses.filter((source) => source.state === "UNKNOWN").length,
      daysWaitingForData: dayStates.filter((state) => state === "WAITING_FOR_SOURCES").length,
      daysWithSourceDelay: dayStates.filter((state) => state === "DATA_SOURCE_DELAY").length,
      daysReady: dayStates.filter((state) => state === "READY").length,
    },
    classifications: {
      windowDays: 30,
      unjustifiedAbsences: classificationRows.rows[0]?.unjustified ?? 0,
      justifiedAbsences: classificationRows.rows[0]?.justified ?? 0,
      workedDataMissing: classificationRows.rows[0]?.data_missing ?? 0,
      revised: classificationRows.rows[0]?.revised ?? 0,
      contradictedByEvidence: classificationRows.rows[0]?.contradicted ?? 0,
      supersededByStatus: classificationRows.rows[0]?.by_status ?? 0,
      lateDataAutoResolved: lateData.rows[0]?.c ?? 0,
      awaitingClassification: recon.open_missing,
    },
  }
}

const ENTITY_COUNT_SQL: Record<string, string> = {
  people: "select count(*)::int c from people where organization_id = $1",
  teams: "select count(*)::int c from teams where organization_id = $1",
  subteams: "select count(*)::int c from subteams where organization_id = $1",
  employee_work_shifts: "select count(*)::int c from employee_work_shifts where organization_id = $1",
  employee_status_periods: "select count(*)::int c from employee_status_periods p join people pe on pe.id = p.person_id where pe.organization_id = $1",
  employee_schedule_days: "select count(*)::int c from employee_schedule_days where organization_id = $1",
  employee_schedule_exceptions: "select count(*)::int c from employee_schedule_exceptions where organization_id = $1",
  goals: "select count(*)::int c from goals where organization_id = $1",
  indicator_measurements: "select count(*)::int c from indicator_measurements where organization_id = $1",
  employee_indicator_performance: "select count(*)::int c from employee_indicator_performance where organization_id = $1",
  employee_prv_performance: "select count(*)::int c from employee_prv_performance where organization_id = $1",
  interactions: "select count(*)::int c from interactions where organization_id = $1",
  transcripts: "select count(*)::int c from transcripts where organization_id = $1",
  interaction_flags: "select count(*)::int c from interaction_flags where organization_id = $1",
}

export async function buildOverview(ctx: DataHubContext, organizationId: string): Promise<Overview> {
  const now = ctx.clock.now()
  const sources = await listSourceSummaries(ctx, organizationId)
  const timeZone = await resolveOrganizationTimezone(ctx.db, organizationId)
  const today = localDateOf(now, timeZone)
  const [employmentStatus, workSchedule, workScheduleHorizon, calendarQuality] = await Promise.all([
    resolveEmploymentStatusFreshness(ctx.db, organizationId, now, timeZone),
    resolveWorkScheduleFreshness(ctx.db, organizationId, now, timeZone),
    resolveWorkScheduleHorizon(ctx.db, organizationId, today),
    buildCalendarQuality(ctx, organizationId, today),
  ])
  // "Hoje" = dia LOCAL da organização no instante do Clock (nunca o now() do banco): as cargas gravam
  // queued_at/finished_at pelo mesmo Clock, então os cartões fecham em teste (relógio fixo) e em produção.
  const todayRuns = await ctx.db.query<{ received: number; rejected: number; warnings: number; runs: number; queued: number }>(
    `with day as (select $2::date as start_local)
     select coalesce(sum(records_received) filter (where status in ('COMPLETED','PARTIAL','FAILED') and (finished_at at time zone $3)::date = day.start_local), 0)::int received,
            coalesce(sum(records_rejected) filter (where (finished_at at time zone $3)::date = day.start_local), 0)::int rejected,
            coalesce(sum(warning_count) filter (where (finished_at at time zone $3)::date = day.start_local), 0)::int warnings,
            count(*) filter (where (queued_at at time zone $3)::date = day.start_local)::int runs,
            count(*) filter (where status = 'QUEUED')::int queued
     from data_ingestion_runs, day where organization_id = $1`,
    [organizationId, today, timeZone],
  )
  const counts = new Map<string, number>()
  const entities = [...new Set(DATA_CONTRACTS.map((contract) => contract.targetEntity))]
  for (const entity of entities) {
    const sql = ENTITY_COUNT_SQL[entity]
    if (!sql) continue
    const result = await ctx.db.query<{ c: number }>(sql, [organizationId])
    counts.set(entity, result.rows[0]?.c ?? 0)
  }
  const allFeeds = sources.flatMap((source) => source.feeds.map((feed) => ({ feed, source })))
  const dataMap: DataMapEntry[] = DATA_CONTRACTS.map((contract) => {
    const feeds = allFeeds.filter(({ feed }) => feed.contractKey === contract.key && feed.status !== "DRAFT")
    return {
      contractKey: contract.key,
      label: contract.label,
      category: contract.category,
      targetEntity: contract.targetEntity,
      relation: DATA_MAP_RELATIONS[contract.key] ?? null,
      feeds: feeds.map(({ feed, source }) => ({ feedId: feed.id, feedName: feed.name, sourceId: source.id, sourceName: source.name, sourceKind: source.kind, status: feed.status, freshness: feed.freshness, lastSuccessAt: feed.lastSuccessAt, lastDataAt: feed.lastDataAt, authoritative: feed.authoritative })),
      freshness: feeds.length ? worstFreshness(feeds.map(({ feed }) => feed.freshness)) : null,
      recordCount: counts.get(contract.targetEntity) ?? null,
    }
  })
  const recent = await ctx.db.query<RunSummary & { feedName: string; sourceName: string; contractKey: string }>(
    `select r.id, r.status, r.trigger_kind "triggerKind", r.started_at "startedAt", r.finished_at "finishedAt", r.records_received "recordsReceived", r.records_inserted "recordsInserted",
            r.records_updated "recordsUpdated", r.records_rejected "recordsRejected", r.error_code "errorCode", f.name "feedName", s.name "sourceName", r.contract_key "contractKey"
     from data_ingestion_runs r join data_feeds f on f.id = r.feed_id join data_sources s on s.id = r.source_id
     where r.organization_id = $1 order by r.created_at desc limit 8`,
    [organizationId],
  )
  const staleFeeds = allFeeds.filter(({ feed }) => feed.status === "ACTIVE" && feed.freshness === "STALE").length
  return {
    generatedAt: now.toISOString(),
    cards: {
      activeSources: sources.filter((source) => source.status === "ACTIVE").length,
      sourcesWithError: sources.filter((source) => source.status === "ERROR" || source.connectionHealth === "ERROR").length,
      receivedToday: todayRuns.rows[0]?.received ?? 0,
      rejectedToday: todayRuns.rows[0]?.rejected ?? 0,
      warningsToday: todayRuns.rows[0]?.warnings ?? 0,
      staleFeeds,
      runsToday: todayRuns.rows[0]?.runs ?? 0,
      queuedRuns: todayRuns.rows[0]?.queued ?? 0,
    },
    sources,
    dataMap,
    employmentStatus,
    workSchedule,
    workScheduleHorizon,
    calendarQuality,
    recentRuns: recent.rows.map((row) => ({ ...row, startedAt: toIso(row.startedAt), finishedAt: toIso(row.finishedAt) })),
  }
}

export type QualityReport = {
  /** Só erros reais (registros rejeitados). Avisos ficam em `topWarnings`. */
  topErrors: { code: string; label: string; count: number }[]
  topWarnings: { code: string; label: string; count: number }[]
  /** Totais do período: erros (rejeições) × avisos (registros aplicados com ressalva). */
  totals: { errors: number; warnings: number }
  feedsWithRejections: { feedId: string; feedName: string; sourceName: string; rejected: number; received: number; rate: number }[]
  staleFeeds: { feedId: string; feedName: string; sourceName: string; lastSuccessAt: string | null; expectedIntervalMinutes: number | null }[]
  schemaChanges: { feedId: string; feedName: string; sourceName: string; schemaChangedAt: string; lastErrorMessage: string | null }[]
  recentRejections: { runId: string; feedName: string; recordNumber: number; sourceRecordKey: string | null; errorCode: string; field: string | null; message: string; createdAt: string; severity: "ERROR" | "WARNING" }[]
  /** Calendário operacional: capital preenchida, 6x1 sem calendário, horizonte terminando. */
  calendar: CalendarQuality & { horizon: WorkScheduleHorizon }
}

export async function buildQualityReport(ctx: DataHubContext, organizationId: string, days = 7): Promise<QualityReport> {
  const [topErrors, feedsWithRejections, recentRejections] = await Promise.all([
    ctx.db.query<{ code: string; count: number }>(
      `select error_code code, count(*)::int count from data_ingestion_rejections where organization_id = $1 and created_at >= now() - make_interval(days => $2) group by 1 order by 2 desc limit 20`,
      [organizationId, days],
    ),
    ctx.db.query<{ feedId: string; feedName: string; sourceName: string; rejected: number; received: number }>(
      `select f.id "feedId", f.name "feedName", s.name "sourceName", coalesce(sum(r.records_rejected), 0)::int rejected, coalesce(sum(r.records_received), 0)::int received
       from data_ingestion_runs r join data_feeds f on f.id = r.feed_id join data_sources s on s.id = r.source_id
       where r.organization_id = $1 and r.created_at >= now() - make_interval(days => $2) and r.status in ('COMPLETED','PARTIAL','FAILED')
       group by f.id, f.name, s.name having coalesce(sum(r.records_rejected), 0) > 0 order by rejected desc limit 10`,
      [organizationId, days],
    ),
    ctx.db.query<{ runId: string; feedName: string; recordNumber: number; sourceRecordKey: string | null; errorCode: string; field: string | null; message: string; createdAt: Date }>(
      `select rej.run_id "runId", f.name "feedName", rej.record_number "recordNumber", rej.source_record_key "sourceRecordKey", rej.error_code "errorCode", rej.field, rej.message, rej.created_at "createdAt"
       from data_ingestion_rejections rej join data_ingestion_runs r on r.id = rej.run_id join data_feeds f on f.id = r.feed_id
       where rej.organization_id = $1 order by rej.created_at desc limit 20`,
      [organizationId],
    ),
  ])
  const sources = await listSourceSummaries(ctx, organizationId)
  const today = localDateOf(ctx.clock.now(), await resolveOrganizationTimezone(ctx.db, organizationId))
  const [calendarQuality, horizon] = await Promise.all([buildCalendarQuality(ctx, organizationId, today), resolveWorkScheduleHorizon(ctx.db, organizationId, today)])
  const feeds = sources.flatMap((source) => source.feeds.map((feed) => ({ feed, source })))
  const isWarning = (code: string) => (WARNING_RECORD_ERROR_CODES as ReadonlySet<string>).has(code)
  const errorRows = topErrors.rows.filter((row) => !isWarning(row.code))
  const warningRows = topErrors.rows.filter((row) => isWarning(row.code))
  return {
    topErrors: errorRows.map((row) => ({ code: row.code, label: describeErrorCode(row.code), count: row.count })),
    topWarnings: warningRows.map((row) => ({ code: row.code, label: describeErrorCode(row.code), count: row.count })),
    totals: { errors: errorRows.reduce((sum, row) => sum + row.count, 0), warnings: warningRows.reduce((sum, row) => sum + row.count, 0) },
    feedsWithRejections: feedsWithRejections.rows.map((row) => ({ ...row, rate: row.received > 0 ? row.rejected / row.received : 0 })),
    staleFeeds: feeds.filter(({ feed }) => feed.status === "ACTIVE" && feed.freshness === "STALE").map(({ feed, source }) => ({ feedId: feed.id, feedName: feed.name, sourceName: source.name, lastSuccessAt: feed.lastSuccessAt, expectedIntervalMinutes: feed.expectedIntervalMinutes })),
    schemaChanges: feeds.filter(({ feed }) => feed.schemaChangedAt).map(({ feed, source }) => ({ feedId: feed.id, feedName: feed.name, sourceName: source.name, schemaChangedAt: feed.schemaChangedAt!, lastErrorMessage: feed.lastErrorMessage })),
    recentRejections: recentRejections.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), severity: isWarning(row.errorCode) ? ("WARNING" as const) : ("ERROR" as const) })),
    calendar: { ...calendarQuality, horizon },
  }
}

export type LineageEntryView = { runId: string; feedId: string; feedName: string; sourceId: string; sourceName: string; sourceKind: string; contractKey: string; sourceRecordKey: string | null; recordNumber: number | null; action: string; createdAt: string; runFinishedAt: string | null }

/** "De onde veio este dado?" — histórico de cargas que criaram/alteraram uma entidade. */
export async function lineageOf(ctx: DataHubContext, organizationId: string, entityType: string, entityId: string): Promise<LineageEntryView[]> {
  const result = await ctx.db.query<LineageEntryView & { createdAt: Date; runFinishedAt: Date | null }>(
    `select l.run_id "runId", l.feed_id "feedId", f.name "feedName", l.source_id "sourceId", s.name "sourceName", s.kind "sourceKind", l.contract_key "contractKey",
            l.source_record_key "sourceRecordKey", l.record_number "recordNumber", l.action, l.created_at "createdAt", r.finished_at "runFinishedAt"
     from data_lineage l join data_feeds f on f.id = l.feed_id join data_sources s on s.id = l.source_id join data_ingestion_runs r on r.id = l.run_id
     where l.organization_id = $1 and l.entity_type = $2 and l.entity_id = $3 order by l.created_at desc limit 50`,
    [organizationId, entityType, entityId],
  )
  return result.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), runFinishedAt: row.runFinishedAt?.toISOString() ?? null }))
}
