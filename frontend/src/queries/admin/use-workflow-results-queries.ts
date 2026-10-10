import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import { fetchWorkflowDispatchDetail, fetchWorkflowResultsPage, fetchWorkflowResultsSummary, type WorkflowResultsFilters } from "@/services/admin/workflow-results-service"

/** V1.5.13 — aba "Resultados": uma request para os cards, uma para a página de disparos e UMA por disparo aberto
 * (pessoas + feedback + Outputs + uso de IA juntos) — nunca uma por pessoa/accordion interno. */
export function useWorkflowResultsSummaryQuery(workflowId: string, filters: WorkflowResultsFilters) {
  return useQuery({ queryKey: adminQueryKeys.workflowResultsSummary(workflowId, filters), queryFn: () => fetchWorkflowResultsSummary(workflowId, filters), enabled: Boolean(workflowId), placeholderData: keepPreviousData })
}

export function useWorkflowResultsPageQuery(workflowId: string, filters: WorkflowResultsFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: adminQueryKeys.workflowResultsList(workflowId, { ...filters, page, pageSize }),
    queryFn: () => fetchWorkflowResultsPage(workflowId, filters, page, pageSize),
    enabled: Boolean(workflowId),
    placeholderData: keepPreviousData,
  })
}

export function useWorkflowDispatchDetailQuery(workflowId: string, rootEnrollmentId: string, page: number, pageSize: number, enabled: boolean) {
  return useQuery({
    queryKey: adminQueryKeys.workflowDispatchDetail(workflowId, rootEnrollmentId, page, pageSize),
    queryFn: () => fetchWorkflowDispatchDetail(workflowId, rootEnrollmentId, page, pageSize),
    enabled: enabled && Boolean(workflowId),
    placeholderData: keepPreviousData,
  })
}
