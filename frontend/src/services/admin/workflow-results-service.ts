import { adminGet } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  dispatchDetailSchema,
  dispatchRowSchema,
  resultsSummarySchema,
  type DispatchDetail,
  type DispatchRow,
  type DispatchStatus,
  type ResultsSummary,
  type ResultTriggerKind,
} from "@/schemas/admin/workflow-results.schema"

/** Filtros da aba "Resultados" (período em datas locais da organização; vazio = últimos 30 dias, decidido no backend). */
export type WorkflowResultsFilters = { period: DateRangeFilter; status?: DispatchStatus; triggerKind?: ResultTriggerKind; collaborator?: string }

const filterQuery = (filters: WorkflowResultsFilters) => ({ from: filters.period.from, to: filters.period.to, status: filters.status, triggerKind: filters.triggerKind, collaborator: filters.collaborator })

export async function fetchWorkflowResultsSummary(workflowId: string, filters: WorkflowResultsFilters): Promise<ResultsSummary> {
  return resultsSummarySchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/results/summary${toQueryString(filterQuery(filters))}`))
}

export async function fetchWorkflowResultsPage(workflowId: string, filters: WorkflowResultsFilters, page: number, pageSize: number): Promise<PageResult<DispatchRow>> {
  return pageResultSchema(dispatchRowSchema).parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/results${toQueryString({ ...filterQuery(filters), page, pageSize })}`))
}

export async function fetchWorkflowDispatchDetail(workflowId: string, rootEnrollmentId: string, page: number, pageSize: number): Promise<DispatchDetail> {
  return dispatchDetailSchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/results/${rootEnrollmentId}${toQueryString({ page, pageSize })}`))
}
