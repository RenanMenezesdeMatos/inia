import type { Database } from "../../../infrastructure/database/pool.js"
import { cadenceLabel, computeFeedFreshness, expectedIntervalMinutes, type Cadence, type FreshnessState } from "../../data-hub/domain/freshness.js"

/**
 * CONFIANÇA do estado funcional conhecido — "tenho informação suficientemente recente para uma
 * decisão operacional?". Derivada só de metadata que a Central de Dados já mantém (feeds dos
 * contratos EMPLOYEES / EMPLOYEE_ABSENCES, cadência esperada, último sucesso, último dado), nunca
 * de um terceiro cálculo. Três conceitos que não se misturam:
 *  - Connection health: consigo acessar a fonte? (fonte)
 *  - Freshness do feed: os dados chegaram dentro da cadência? (feed)
 *  - Employment status freshness: o estado funcional que a INIA conhece é recente o bastante? (aqui)
 *
 * Estados: FRESH (feeds autoritativos — ou todos os ativos — dentro da cadência), STALE (algum
 * fora), UNKNOWN (nenhum feed de situação configurado: legado/manual — nada é degradado por isso).
 */
export type EmploymentFreshnessState = "FRESH" | "STALE" | "UNKNOWN"

export type EmploymentFeedFreshness = {
  feedId: string
  feedName: string
  sourceId: string
  sourceName: string
  sourceKind: string
  contractKey: string
  /** Valor gravado em `employee_status_periods.source` / `employee_schedule_days.source` pelas cargas deste feed. */
  sourceNamespace: string
  authoritative: boolean
  status: string
  cadenceLabel: string
  expectedIntervalMinutes: number | null
  lastSuccessAt: string | null
  lastDataAt: string | null
  freshness: FreshnessState
}

export type EmploymentStatusFreshness = {
  state: EmploymentFreshnessState
  configured: boolean
  /** Todos os feeds de situação (não-rascunho); `consideredFeedIds` diz quais decidiram o estado (autoritativos quando existem). */
  feeds: EmploymentFeedFreshness[]
  consideredFeedIds: string[]
  lastSuccessAt: string | null
  lastDataAt: string | null
  /** Data LOCAL da última carga bem-sucedida (AAAA-MM-DD) — a partir do dia seguinte a INIA só presume. */
  lastSuccessLocalDate: string | null
}

type Row = {
  feed_id: string
  feed_name: string
  source_id: string
  source_name: string
  source_kind: string
  contract_key: string
  source_namespace: string
  authoritative: boolean
  status: string
  cadence: Cadence
  expected_interval_minutes: number | null
  last_success_at: Date | null
  last_data_at: Date | null
}

const UNKNOWN: EmploymentStatusFreshness = { state: "UNKNOWN", configured: false, feeds: [], consideredFeedIds: [], lastSuccessAt: null, lastDataAt: null, lastSuccessLocalDate: null }

export const EMPLOYMENT_STATUS_CONTRACTS = ["EMPLOYEES", "EMPLOYEE_ABSENCES"] as const
/** Contratos que alimentam o calendário programado (`employee_schedule_days`). */
export const WORK_SCHEDULE_CONTRACTS = ["WORK_SCHEDULE_DAYS"] as const

export async function resolveEmploymentStatusFreshness(db: Database, organizationId: string, now: Date, timeZone: string): Promise<EmploymentStatusFreshness> {
  return resolveContractFreshness(db, organizationId, now, timeZone, [...EMPLOYMENT_STATUS_CONTRACTS])
}

/**
 * MESMA filosofia para a ESCALA: "a escala que a INIA conhece é recente o bastante?". Derivada dos
 * feeds de calendário programado; UNKNOWN quando nenhum está configurado (fallback legado seg–sex).
 * Causa diferente da situação funcional — nunca reaproveita EMPLOYMENT_STATUS_STALE.
 */
export async function resolveWorkScheduleFreshness(db: Database, organizationId: string, now: Date, timeZone: string): Promise<EmploymentStatusFreshness> {
  return resolveContractFreshness(db, organizationId, now, timeZone, [...WORK_SCHEDULE_CONTRACTS])
}

/** Contratos que gravam a hierarquia (`people.reports_to_id`, `team_id`, `subteam_id`). */
export const ORGANIZATIONAL_STRUCTURE_CONTRACTS = ["ORGANIZATIONAL_STRUCTURE"] as const

/**
 * MESMA filosofia para a ESTRUTURA ORGANIZACIONAL (aba Estrutura do perfil): "de onde veio e quando
 * chegou a hierarquia que a INIA conhece?". Só metadata dos feeds da Central — UNKNOWN quando nenhum
 * feed de estrutura está configurado (cadastro manual/legado): a aba então não mostra origem alguma,
 * em vez de inventar uma.
 */
export async function resolveOrganizationalStructureFreshness(db: Database, organizationId: string, now: Date, timeZone: string): Promise<EmploymentStatusFreshness> {
  return resolveContractFreshness(db, organizationId, now, timeZone, [...ORGANIZATIONAL_STRUCTURE_CONTRACTS])
}

async function resolveContractFreshness(db: Database, organizationId: string, now: Date, timeZone: string, contractKeys: string[]): Promise<EmploymentStatusFreshness> {
  const result = await db.query<Row>(
    `select f.id feed_id, f.name feed_name, s.id source_id, s.name source_name, s.kind source_kind, f.contract_key, coalesce(f.source_namespace, s.public_id) source_namespace,
            f.authoritative, f.status, f.cadence, f.expected_interval_minutes, f.last_success_at, f.last_data_at
       from data_feeds f join data_sources s on s.id = f.source_id
      where f.organization_id = $1 and f.deleted_at is null and s.deleted_at is null and f.contract_key = any($2::text[]) and f.status <> 'DRAFT'
      order by f.authoritative desc, f.created_at`,
    [organizationId, contractKeys],
  )
  if (result.rows.length === 0) return UNKNOWN
  const feeds: EmploymentFeedFreshness[] = result.rows.map((row) => {
    const interval = row.expected_interval_minutes ?? expectedIntervalMinutes(row.cadence)
    return {
      feedId: row.feed_id,
      feedName: row.feed_name,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceKind: row.source_kind,
      contractKey: row.contract_key,
      sourceNamespace: row.source_namespace,
      authoritative: row.authoritative,
      status: row.status,
      cadenceLabel: cadenceLabel(row.cadence),
      expectedIntervalMinutes: interval,
      lastSuccessAt: row.last_success_at?.toISOString() ?? null,
      lastDataAt: row.last_data_at?.toISOString() ?? null,
      freshness: computeFeedFreshness({ lastSuccessAt: row.last_success_at, cadence: row.cadence, expectedIntervalMinutes: row.expected_interval_minutes }, now, timeZone),
    }
  })
  const authoritative = feeds.filter((feed) => feed.authoritative)
  const considered = authoritative.length > 0 ? authoritative : feeds
  const state: EmploymentFreshnessState = considered.some((feed) => feed.freshness === "STALE") ? "STALE" : considered.every((feed) => feed.freshness === "NEVER") ? "UNKNOWN" : "FRESH"
  const lastSuccessAt = considered.reduce<string | null>((max, feed) => (feed.lastSuccessAt && (!max || feed.lastSuccessAt > max) ? feed.lastSuccessAt : max), null)
  const lastDataAt = considered.reduce<string | null>((max, feed) => (feed.lastDataAt && (!max || feed.lastDataAt > max) ? feed.lastDataAt : max), null)
  return { state, configured: true, feeds, consideredFeedIds: considered.map((feed) => feed.feedId), lastSuccessAt, lastDataAt, lastSuccessLocalDate: lastSuccessAt ? localDate(new Date(lastSuccessAt), timeZone) : null }
}

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Feed (fonte + nome) que gravou um `source` de período — para explicar a origem de uma situação. */
export function describeStatusSource(freshness: EmploymentStatusFreshness, source: string | null): { sourceName: string; feedName: string; feedId: string; sourceId: string } | null {
  if (!source) return null
  const feed = freshness.feeds.find((entry) => entry.sourceNamespace === source)
  return feed ? { sourceName: feed.sourceName, feedName: feed.feedName, feedId: feed.feedId, sourceId: feed.sourceId } : null
}
