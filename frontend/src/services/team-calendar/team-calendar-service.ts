import { z } from "zod"

import { toQueryString } from "@/lib/admin/list-query"
import { apiGet, apiPost } from "@/lib/api/api-client"
import { classifyOutcomeSchema, provisionOutcomeSchema, scheduleExceptionAuditSchema, scheduleExceptionRecordSchema, teamCalendarViewSchema, workdayClassificationRecordSchema, type ClassifyOutcome, type JustifiedAbsenceReason, type ProvisionOutcome, type ScheduleExceptionAudit, type ScheduleExceptionRecord, type TeamCalendarListParams, type TeamCalendarView, type WorkdayClassificationKind, type WorkdayClassificationRecord } from "@/schemas/team-calendar/team-calendar.schema"

const BASE = "/api/v1/team-calendar"
const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

export type FetchTeamCalendarInput = { from: string; to: string; anchorId: string | null; list: TeamCalendarListParams }

export async function fetchTeamCalendar(input: FetchTeamCalendarInput): Promise<TeamCalendarView> {
  const { list } = input
  return teamCalendarViewSchema.parse(await apiGet<unknown>(`${BASE}${toQueryString({ from: input.from, to: input.to, anchorId: input.anchorId, search: list.search, teamId: list.teamId, subteamId: list.subteamId, jobTitle: list.jobTitle, scheduleType: list.scheduleType, attention: list.attention, scheduledToday: list.scheduledToday, page: list.page, pageSize: list.pageSize })}`))
}

export async function provisionScheduleException(input: { personId: string; code: string; from: string; to: string }): Promise<ProvisionOutcome> {
  return provisionOutcomeSchema.parse(await apiPost<unknown>(`${BASE}/exceptions`, input))
}

export async function cancelScheduleException(exceptionId: string): Promise<ScheduleExceptionRecord> {
  const response = await fetch(`${API_URL}${BASE}/exceptions/${exceptionId}`, { method: "DELETE", credentials: "include", cache: "no-store" })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `Erro ${response.status}`)
  }
  const payload = (await response.json()) as { data: unknown }
  return scheduleExceptionRecordSchema.parse(payload.data)
}

export async function fetchScheduleExceptionAudit(exceptionId: string): Promise<ScheduleExceptionAudit> {
  return scheduleExceptionAuditSchema.parse(await apiGet<unknown>(`${BASE}/exceptions/${exceptionId}/audit`))
}

export async function classifyWorkday(input: { personId: string; date: string; classification: WorkdayClassificationKind; reasonCode?: JustifiedAbsenceReason | null }): Promise<ClassifyOutcome> {
  return classifyOutcomeSchema.parse(await apiPost<unknown>(`${BASE}/classifications`, input))
}

export async function fetchClassificationHistory(personId: string, date: string): Promise<WorkdayClassificationRecord[]> {
  return z.array(workdayClassificationRecordSchema).parse(await apiGet<unknown>(`${BASE}/classifications/${personId}/${date}`))
}
