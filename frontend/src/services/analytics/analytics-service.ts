import { apiGet, toQueryString } from "@/lib/api/api-client"
import { subjectQuery, type SubjectRef } from "@/lib/analytics/subject-params"
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
  teamId?: string
  subteamId?: string
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

export async function fetchTeamMembers(subject: SubjectRef | null, period: string | null, params: TeamMembersParams): Promise<TeamMembersPage> {
  return teamMembersPageSchema.parse(await apiGet(`${BASE}/team/members${toQueryString({ ...subjectQuery(subject), period, ...params })}`))
}

export async function fetchFollowUpFeed(subject: SubjectRef | null, page: number, pageSize: number, unacknowledgedOnly = false): Promise<FollowUpFeed> {
  return followUpFeedSchema.parse(await apiGet(`${BASE}/follow-ups${toQueryString({ ...subjectQuery(subject), page, pageSize, ack: unacknowledgedOnly ? "pending" : undefined })}`))
}
