import { apiGet, toQueryString } from "@/lib/api/api-client"
import type { ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"
import { subjectQuery, type SubjectRef } from "@/lib/analytics/subject-params"
import type { FollowUpAudience, FollowUpType } from "@/schemas/analytics/analytics.schema"
import {
  analyticsContextSchema,
  followUpFeedSchema,
  indicatorDashboardSchema,
  indicatorMembersPageSchema,
  structureBreakdownSchema,
  teamMembersPageSchema,
  teamOverviewSchema,
  type AnalyticsContext,
  type FollowUpFeed,
  type GroupingDimension,
  type IndicatorDashboard,
  type IndicatorMembersPage,
  type MemberSituation,
  type OperationalComparison,
  type StructureBreakdown,
  type TeamMembersPage,
  type TeamOverview,
} from "@/schemas/analytics/analytics.schema"

const BASE = "/api/v1/analytics"

export type IndicatorMembersParams = { search?: string; sort?: "achievement" | "name" | "delta"; order?: "asc" | "desc"; page?: number; pageSize?: number }

export type TeamMembersParams = {
  search?: string
  teamId?: readonly string[] | undefined
  subteamId?: readonly string[] | undefined
  situation?: MemberSituation
  attentionIndicatorCode?: string
  pendingOnly?: boolean
  directOnly?: boolean
  sort?: "name" | "achievement" | "prv" | "delta" | "situation"
  order?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export async function fetchAnalyticsContext(subject: SubjectRef | null): Promise<AnalyticsContext> {
  return analyticsContextSchema.parse(await apiGet(`${BASE}/context${toQueryString(subjectQuery(subject))}`))
}

/** `comparison` null = padrão do backend (últimos 7 dias × 7 anteriores) — o parâmetro nem vai na URL. */
export async function fetchIndicatorDashboard(subject: SubjectRef | null, period: string | null, comparison: OperationalComparison | null = null): Promise<IndicatorDashboard> {
  return indicatorDashboardSchema.parse(await apiGet(`${BASE}/indicators${toQueryString({ ...subjectQuery(subject), period, comparison })}`))
}

export async function fetchStructureBreakdown(subject: SubjectRef | null, period: string | null, groupBy: GroupingDimension): Promise<StructureBreakdown> {
  return structureBreakdownSchema.parse(await apiGet(`${BASE}/indicators/breakdown${toQueryString({ ...subjectQuery(subject), period, groupBy })}`))
}

export async function fetchIndicatorMembers(subject: SubjectRef | null, period: string | null, code: string, params: IndicatorMembersParams): Promise<IndicatorMembersPage> {
  return indicatorMembersPageSchema.parse(await apiGet(`${BASE}/indicators/${encodeURIComponent(code)}/members${toQueryString({ ...subjectQuery(subject), period, ...params })}`))
}

export async function fetchTeamOverview(subject: SubjectRef | null, period: string | null): Promise<TeamOverview> {
  return teamOverviewSchema.parse(await apiGet(`${BASE}/team${toQueryString({ ...subjectQuery(subject), period })}`))
}

/** Grupos e Subgrupos de quem está na estrutura vista (filtros da Equipe), em lotes. */
export function teamUnitOptionsSource(subject: SubjectRef | null): ScopedOptionsSource {
  return { path: `${BASE}/team/unit-options`, params: subjectQuery(subject) }
}

export async function fetchTeamMembers(subject: SubjectRef | null, period: string | null, params: TeamMembersParams): Promise<TeamMembersPage> {
  return teamMembersPageSchema.parse(await apiGet(`${BASE}/team/members${toQueryString({ ...subjectQuery(subject), period, ...params })}`))
}

/** Recorte do calendário do Acompanhamento em instantes ISO, [since, until). */
export type FollowUpPeriodBounds = { since: string; until: string }

/** Página do Acompanhamento da estrutura depois de `cursor` (null = a primeira); `period` = só o recorte do calendário. */
export async function fetchFollowUpFeed(subject: SubjectRef | null, cursor: string | null, limit: number, unacknowledgedOnly = false, period: FollowUpPeriodBounds | null = null, types: FollowUpType[] | null = null, audience: FollowUpAudience | null = null): Promise<FollowUpFeed> {
  return followUpFeedSchema.parse(await apiGet(`${BASE}/follow-ups${toQueryString({ ...subjectQuery(subject), cursor: cursor ?? undefined, limit, ack: unacknowledgedOnly ? "pending" : undefined, since: period?.since, until: period?.until, types: types?.join(","), audience: audience ?? undefined })}`))
}
