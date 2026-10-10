"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { SubjectRef } from "@/lib/analytics/subject-params"
import type { AnalyticsContext, GroupingDimension, OperationalComparison } from "@/schemas/analytics/analytics.schema"
import {
  fetchAnalyticsContext,
  fetchFollowUpFeed,
  fetchIndicatorDashboard,
  fetchIndicatorMembers,
  fetchStructureBreakdown,
  fetchTeamMembers,
  fetchTeamOverview,
  type IndicatorMembersParams,
  type TeamMembersParams,
} from "@/services/analytics/analytics-service"

import { analyticsKeys } from "./analytics-query-keys"

/** `initialData` vem do servidor (analytics-server.ts) quando a página já carregou o contexto —
 * evita um segundo round-trip e o layout shift das abas. */
export function useAnalyticsContextQuery(subject: SubjectRef | null, initialData: AnalyticsContext | null = null) {
  return useQuery({ queryKey: analyticsKeys.context(subject), queryFn: () => fetchAnalyticsContext(subject), ...(initialData ? { initialData } : {}) })
}

export function useIndicatorDashboardQuery(subject: SubjectRef | null, period: string | null, comparison: OperationalComparison | null = null, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.indicators(subject, period, comparison), queryFn: () => fetchIndicatorDashboard(subject, period, comparison), enabled, placeholderData: keepPreviousData })
}

export function useStructureBreakdownQuery(subject: SubjectRef | null, period: string | null, groupBy: GroupingDimension | null) {
  return useQuery({
    queryKey: analyticsKeys.breakdown(subject, period, groupBy ?? ""),
    queryFn: () => fetchStructureBreakdown(subject, period, groupBy!),
    enabled: groupBy !== null,
    placeholderData: keepPreviousData,
  })
}

export function useIndicatorMembersQuery(subject: SubjectRef | null, period: string | null, code: string | null, params: IndicatorMembersParams) {
  return useQuery({
    queryKey: analyticsKeys.indicatorMembers(subject, period, code ?? "", params),
    queryFn: () => fetchIndicatorMembers(subject, period, code!, params),
    enabled: code !== null,
    placeholderData: keepPreviousData,
  })
}

export function useTeamOverviewQuery(subject: SubjectRef | null, period: string | null, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.team(subject, period), queryFn: () => fetchTeamOverview(subject, period), enabled, placeholderData: keepPreviousData })
}

export function useTeamMembersQuery(subject: SubjectRef | null, period: string | null, params: TeamMembersParams, enabled = true) {
  return useQuery({ queryKey: analyticsKeys.teamMembers(subject, period, params), queryFn: () => fetchTeamMembers(subject, period, params), enabled, placeholderData: keepPreviousData })
}

export function useFollowUpFeedQuery(subject: SubjectRef | null, page: number, pageSize: number, unacknowledgedOnly = false) {
  return useQuery({ queryKey: analyticsKeys.followUps(subject, page, pageSize, unacknowledgedOnly), queryFn: () => fetchFollowUpFeed(subject, page, pageSize, unacknowledgedOnly), placeholderData: keepPreviousData })
}
