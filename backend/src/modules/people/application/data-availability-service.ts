import type { Database } from "../../../infrastructure/database/pool.js"
import { availabilityPolicySchema, type AvailabilityPolicy } from "../../data-hub/domain/data-availability.js"
import { computeFeedFreshness, type Cadence } from "../../data-hub/domain/freshness.js"
import { EMPLOYMENT_STATUS_CONTRACTS } from "./employment-status-freshness.js"
import type { WorkActivityEvidenceSources } from "../domain/work-activity-evidence.js"
import { resolveWorkdayDataAvailability, type AvailabilitySourceInput, type WorkdayDataAvailability } from "../domain/workday-data-availability.js"
import type { Queryable } from "./schedule-exception-service.js"

/**
 * CONTEXTO DE DISPONIBILIDADE de uma organização — metadata dos feeds relevantes da Central (política
 * de disponibilidade, última carga, último dado) + overrides por indicador. Carregado UMA vez por
 * chamada (duas consultas) e reaproveitado para todas as pessoas × dias — nunca por pessoa/fonte.
 *
 * Quais fontes entram:
 *  - WORK_ACTIVITY: feeds INTERACTIONS (se interações são evidência) e INDICATOR_MEASUREMENTS (um por
 *    indicador marcado como prova; o indicador pode ter override próprio de política). Só o que está
 *    configurado como WorkActivityEvidence participa — PRV, fechamentos oficiais etc. não são esperados.
 *  - EMPLOYMENT: feeds EMPLOYEES / EMPLOYEE_ABSENCES (situação funcional).
 * Feeds em rascunho/excluídos não contam. Feed sem política → fonte UNKNOWN (nada é presumido).
 */
export type DataAvailabilityContext = {
  organizationId: string
  timeZone: string
  feeds: AvailabilityFeed[]
  indicatorOverrides: Map<string, AvailabilityPolicy | null>
}

export type AvailabilityFeed = {
  feedId: string
  feedName: string
  sourceName: string
  contractKey: string
  status: string
  policy: AvailabilityPolicy | null
  lastSuccessAt: Date | null
  lastDataAt: Date | null
  freshness: string
  lastErrorCode: string | null
}

export const WORK_ACTIVITY_CONTRACTS = { interactions: "INTERACTIONS", measurements: "INDICATOR_MEASUREMENTS" } as const

export function parseAvailabilityPolicy(raw: unknown): AvailabilityPolicy | null {
  if (raw === null || raw === undefined) return null
  const parsed = availabilityPolicySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export async function loadDataAvailabilityContext(db: Queryable, organizationId: string, timeZone: string, now: Date): Promise<DataAvailabilityContext> {
  type FeedRow = { feed_id: string; feed_name: string; source_name: string; contract_key: string; status: string; availability_policy: unknown; cadence: Cadence; expected_interval_minutes: number | null; last_success_at: Date | null; last_data_at: Date | null; last_error_code: string | null }
  const contracts = [WORK_ACTIVITY_CONTRACTS.interactions, WORK_ACTIVITY_CONTRACTS.measurements, ...EMPLOYMENT_STATUS_CONTRACTS]
  const [feeds, overrides] = await Promise.all([
    db.query<FeedRow>(
      `select f.id feed_id, f.name feed_name, s.name source_name, f.contract_key, f.status, f.availability_policy, f.cadence, f.expected_interval_minutes, f.last_success_at, f.last_data_at, f.last_error_code
         from data_feeds f join data_sources s on s.id = f.source_id
        where f.organization_id = $1 and f.deleted_at is null and s.deleted_at is null and f.status <> 'DRAFT' and f.contract_key = any($2::text[])
        order by f.contract_key, f.authoritative desc, f.created_at`,
      [organizationId, contracts],
    ),
    db.query<{ code: string; availability_policy: unknown }>(`select code, availability_policy from indicator_definitions where organization_id = $1 and active and proves_work_activity`, [organizationId]),
  ])
  return {
    organizationId,
    timeZone,
    feeds: feeds.rows.map((row) => ({
      feedId: row.feed_id,
      feedName: row.feed_name,
      sourceName: row.source_name,
      contractKey: row.contract_key,
      status: row.status,
      policy: parseAvailabilityPolicy(row.availability_policy),
      lastSuccessAt: row.last_success_at,
      lastDataAt: row.last_data_at,
      freshness: computeFeedFreshness({ lastSuccessAt: row.last_success_at, cadence: row.cadence, expectedIntervalMinutes: row.expected_interval_minutes }, now, timeZone),
      lastErrorCode: row.last_error_code,
    })),
    indicatorOverrides: new Map(overrides.rows.map((row) => [row.code, parseAvailabilityPolicy(row.availability_policy)])),
  }
}

function localDate(instant: Date | null, timeZone: string): string | null {
  if (!instant) return null
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** As fontes relevantes do contexto como entradas do domínio (uma por feed; indicadores expandem os feeds de medição). */
export function availabilitySourcesOf(context: DataAvailabilityContext, evidenceSources: WorkActivityEvidenceSources): AvailabilitySourceInput[] {
  const sources: AvailabilitySourceInput[] = []
  const feedInput = (feed: AvailabilityFeed, key: string, label: string, group: AvailabilitySourceInput["group"], policy: AvailabilityPolicy | null): AvailabilitySourceInput => ({
    key,
    label,
    group,
    policy,
    lastSuccessAt: feed.lastSuccessAt,
    lastDataLocalDate: localDate(feed.lastDataAt, context.timeZone),
    freshness: feed.freshness,
    lastErrorCode: feed.lastErrorCode,
  })
  if (evidenceSources.interactions) {
    const feeds = context.feeds.filter((feed) => feed.contractKey === WORK_ACTIVITY_CONTRACTS.interactions)
    if (feeds.length === 0) sources.push({ key: "interactions", label: "Interações (sem feed configurado)", group: "WORK_ACTIVITY", policy: null, lastSuccessAt: null, lastDataLocalDate: null, freshness: null, lastErrorCode: null })
    for (const feed of feeds) sources.push(feedInput(feed, `feed:${feed.feedId}`, `Interações · ${feed.feedName}`, "WORK_ACTIVITY", feed.policy))
  }
  const measurementFeeds = context.feeds.filter((feed) => feed.contractKey === WORK_ACTIVITY_CONTRACTS.measurements)
  for (const code of evidenceSources.indicatorCodes) {
    const override = context.indicatorOverrides.get(code) ?? null
    if (measurementFeeds.length === 0) sources.push({ key: `indicator:${code}`, label: `${code} (sem feed de medições configurado)`, group: "WORK_ACTIVITY", policy: override, lastSuccessAt: null, lastDataLocalDate: null, freshness: null, lastErrorCode: null })
    for (const feed of measurementFeeds) sources.push(feedInput(feed, `indicator:${code}:feed:${feed.feedId}`, `${code} · ${feed.feedName}`, "WORK_ACTIVITY", override ?? feed.policy))
  }
  for (const feed of context.feeds.filter((entry) => (EMPLOYMENT_STATUS_CONTRACTS as readonly string[]).includes(entry.contractKey))) {
    sources.push(feedInput(feed, `feed:${feed.feedId}`, `${feed.contractKey === "EMPLOYEES" ? "Colaboradores" : "Afastamentos"} · ${feed.feedName}`, "EMPLOYMENT", feed.policy))
  }
  return sources
}

/** Disponibilidade por DIA para a organização — memoizada por data (os mesmos feeds valem para todas as pessoas). */
export function availabilityByDate(context: DataAvailabilityContext, dates: string[], now: Date, evidenceSources: WorkActivityEvidenceSources): Map<string, WorkdayDataAvailability> {
  const sources = availabilitySourcesOf(context, evidenceSources)
  return new Map(dates.map((date) => [date, resolveWorkdayDataAvailability({ date, now, timeZone: context.timeZone, evidenceSources, sources })]))
}

export type { Database }
