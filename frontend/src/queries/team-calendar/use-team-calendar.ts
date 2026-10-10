"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cancelScheduleException, classifyWorkday, fetchClassificationHistory, fetchScheduleExceptionAudit, fetchTeamCalendar, provisionScheduleException, type FetchTeamCalendarInput } from "@/services/team-calendar/team-calendar-service"
import type { JustifiedAbsenceReason, TeamCalendarListParams, WorkdayClassificationKind } from "@/schemas/team-calendar/team-calendar.schema"

import { notificationKeys } from "../notifications/notifications-query-keys"
import { pendingActionKeys } from "../pending-actions/pending-actions-query-keys"

export const teamCalendarKeys = {
  all: () => ["team-calendar"] as const,
  range: (from: string, to: string, anchorId: string | null, list: TeamCalendarListParams) => ["team-calendar", "range", from, to, anchorId ?? "self", list] as const,
  audit: (exceptionId: string) => ["team-calendar", "audit", exceptionId] as const,
  classificationHistory: (personId: string, date: string) => ["team-calendar", "classification-history", personId, date] as const,
}

/** Página/filtros trocam sem piscar a grade (`keepPreviousData`) — mesmo comportamento das listagens administrativas. */
export function useTeamCalendarQuery(input: FetchTeamCalendarInput, enabled = true) {
  return useQuery({ queryKey: teamCalendarKeys.range(input.from, input.to, input.anchorId, input.list), queryFn: () => fetchTeamCalendar(input), enabled, refetchOnWindowFocus: true, placeholderData: keepPreviousData })
}

export function useScheduleExceptionAuditQuery(exceptionId: string | null) {
  return useQuery({ queryKey: teamCalendarKeys.audit(exceptionId ?? ""), queryFn: () => fetchScheduleExceptionAudit(exceptionId!), enabled: exceptionId !== null })
}

/** Provisionar/cancelar muda o calendário, a elegibilidade (perfil/Equipe), as pendências e o sino. */
function useCalendarInvalidation() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: teamCalendarKeys.all() })
    void queryClient.invalidateQueries({ queryKey: pendingActionKeys.list() })
    void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() })
    void queryClient.invalidateQueries({ queryKey: ["analytics"] })
  }
}

export function useProvisionScheduleExceptionMutation() {
  const invalidate = useCalendarInvalidation()
  return useMutation({ mutationFn: (input: { personId: string; code: string; from: string; to: string }) => provisionScheduleException(input), onSuccess: invalidate })
}

export function useCancelScheduleExceptionMutation() {
  const invalidate = useCalendarInvalidation()
  return useMutation({ mutationFn: (exceptionId: string) => cancelScheduleException(exceptionId), onSuccess: invalidate })
}

export function useClassificationHistoryQuery(personId: string | null, date: string | null) {
  return useQuery({ queryKey: teamCalendarKeys.classificationHistory(personId ?? "", date ?? ""), queryFn: () => fetchClassificationHistory(personId!, date!), enabled: personId !== null && date !== null })
}

export function useClassifyWorkdayMutation() {
  const invalidate = useCalendarInvalidation()
  return useMutation({ mutationFn: (input: { personId: string; date: string; classification: WorkdayClassificationKind; reasonCode?: JustifiedAbsenceReason | null }) => classifyWorkday(input), onSuccess: invalidate })
}
