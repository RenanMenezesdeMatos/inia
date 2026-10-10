import { apiGet, apiPost } from "@/lib/api/api-client"
import { humanReviewDetailSchema, pendingActionsSummarySchema, workdayReconciliationDetailSchema, type HumanReviewDecision, type HumanReviewDetail, type PendingActionsSummary, type WorkdayDecision, type WorkdayReconciliationDetail } from "@/schemas/pending-actions/pending-actions.schema"

const BASE = "/api/v1/pending-actions"

export async function fetchPendingActions(): Promise<PendingActionsSummary> {
  return pendingActionsSummarySchema.parse(await apiGet<unknown>(BASE))
}

export async function fetchHumanReviewDetail(enrollmentId: string, nodeId: string): Promise<HumanReviewDetail> {
  return humanReviewDetailSchema.parse(await apiGet<unknown>(`${BASE}/human-reviews/${enrollmentId}/${encodeURIComponent(nodeId)}`))
}

export async function decideHumanReview(enrollmentId: string, nodeId: string, decision: HumanReviewDecision): Promise<HumanReviewDetail> {
  return humanReviewDetailSchema.parse(await apiPost<unknown>(`${BASE}/human-reviews/${enrollmentId}/${encodeURIComponent(nodeId)}/decision`, { decision }))
}

export async function fetchWorkdayReconciliationDetail(reconciliationId: string): Promise<WorkdayReconciliationDetail> {
  return workdayReconciliationDetailSchema.parse(await apiGet<unknown>(`${BASE}/workday-reconciliations/${reconciliationId}`))
}

export async function resolveWorkdayReconciliation(reconciliationId: string, decision: WorkdayDecision): Promise<WorkdayReconciliationDetail> {
  return workdayReconciliationDetailSchema.parse(await apiPost<unknown>(`${BASE}/workday-reconciliations/${reconciliationId}/resolve`, decision))
}
