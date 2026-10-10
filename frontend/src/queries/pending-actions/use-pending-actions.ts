"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { HumanReviewDecision, WorkdayDecision } from "@/schemas/pending-actions/pending-actions.schema"
import { decideHumanReview, fetchHumanReviewDetail, fetchPendingActions, fetchWorkdayReconciliationDetail, resolveWorkdayReconciliation } from "@/services/pending-actions/pending-actions-service"

import { notificationKeys } from "../notifications/notifications-query-keys"
import { pendingActionKeys } from "./pending-actions-query-keys"

export function usePendingActionsQuery(enabled = true) {
  return useQuery({ queryKey: pendingActionKeys.list(), queryFn: fetchPendingActions, enabled, refetchOnWindowFocus: true })
}

export function useHumanReviewDetailQuery(enrollmentId: string | null, nodeId: string | null) {
  return useQuery({
    queryKey: pendingActionKeys.review(enrollmentId ?? "", nodeId ?? ""),
    queryFn: () => fetchHumanReviewDetail(enrollmentId!, nodeId!),
    enabled: enrollmentId !== null && nodeId !== null,
  })
}

/** Decidir invalida SÓ o que muda de estado: a fila de pendências, o detalhe, o sino e os
 * contadores da Equipe/contexto (revisões pendentes) — nunca a aplicação inteira. */
export function useDecideHumanReviewMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ enrollmentId, nodeId, decision }: { enrollmentId: string; nodeId: string; decision: HumanReviewDecision }) => decideHumanReview(enrollmentId, nodeId, decision),
    onSuccess: (detail) => {
      queryClient.setQueryData(pendingActionKeys.review(detail.enrollmentId, detail.nodeId), detail)
      void queryClient.invalidateQueries({ queryKey: pendingActionKeys.list() })
      void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team-members"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "context"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "follow-ups"] })
    },
  })
}

export function useWorkdayReconciliationDetailQuery(reconciliationId: string | null) {
  return useQuery({ queryKey: pendingActionKeys.workday(reconciliationId ?? ""), queryFn: () => fetchWorkdayReconciliationDetail(reconciliationId!), enabled: reconciliationId !== null })
}

/** Resolver a pendência de produção muda: fila, detalhe, sino, contadores da Equipe e o Calendário da equipe (exceção criada). */
export function useResolveWorkdayReconciliationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reconciliationId, decision }: { reconciliationId: string; decision: WorkdayDecision }) => resolveWorkdayReconciliation(reconciliationId, decision),
    onSuccess: (detail) => {
      queryClient.setQueryData(pendingActionKeys.workday(detail.reconciliationId), detail)
      void queryClient.invalidateQueries({ queryKey: pendingActionKeys.list() })
      void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "team-members"] })
      void queryClient.invalidateQueries({ queryKey: ["analytics", "context"] })
      void queryClient.invalidateQueries({ queryKey: ["team-calendar"] })
    },
  })
}
