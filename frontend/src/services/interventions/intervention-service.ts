import { apiGet, apiPost, apiSend } from "@/lib/api/api-client"
import { caseInterventionsSchema, forwardTargetSchema, trainingCompetencySchema, interventionDetailSchema, interventionSummarySchema, reportViewSchema, type CaseInterventions, type ContinuityDecision, type InterventionDetail, type InterventionPlan, type InterventionSummary, type ReportView } from "@/schemas/interventions/intervention.schema"
import { z } from "zod"

const BASE = "/api/v1/interventions"
const detail = async (promise: Promise<unknown>) => interventionDetailSchema.parse(await promise)

export async function fetchIntervention(id: string): Promise<InterventionDetail> {
  return detail(apiGet<unknown>(`${BASE}/${id}`))
}
export async function fetchCaseInterventions(caseId: string): Promise<CaseInterventions> {
  return caseInterventionsSchema.parse(await apiGet<unknown>(`${BASE}/cases/${caseId}`))
}
export async function fetchPersonInterventions(personId: string): Promise<InterventionSummary[]> {
  return z.array(interventionSummarySchema).parse(await apiGet<unknown>(`${BASE}/people/${personId}`))
}
export async function fetchReport(reportId: string): Promise<ReportView> {
  return reportViewSchema.parse(await apiGet<unknown>(`${BASE}/reports/${reportId}`))
}
export async function retryReportNarrative(reportId: string): Promise<ReportView> {
  return reportViewSchema.parse(await apiPost<unknown>(`${BASE}/reports/${reportId}/narrative`))
}
export async function fetchForwardTargets(id: string) {
  return z.array(forwardTargetSchema).parse(await apiGet<unknown>(`${BASE}/${id}/forward-targets`))
}

export const acceptIntervention = (id: string, body: { expectedRevision: number; justification?: string }) => detail(apiPost<unknown>(`${BASE}/${id}/accept`, body))
export const approveIntervention = (id: string, body: { expectedRevision: number; note?: string }) => detail(apiPost<unknown>(`${BASE}/${id}/approve`, body))
export const returnIntervention = (id: string, body: { expectedRevision: number; reason: string }) => detail(apiPost<unknown>(`${BASE}/${id}/return`, body))
export const decideContinuity = (id: string, body: { expectedRevision: number; decision: ContinuityDecision; justification: string }) => detail(apiPost<unknown>(`${BASE}/${id}/decide`, body))
export const cancelIntervention = (id: string, body: { expectedRevision: number; reason: string }) => detail(apiPost<unknown>(`${BASE}/${id}/cancel`, body))
export const forwardIntervention = (id: string, body: { expectedRevision: number; toPersonId: string; reason: string }) => detail(apiPost<unknown>(`${BASE}/${id}/forward`, body))
export const completeIntervention = (id: string, body: { expectedRevision: number; note: string; learning: { result: "ACHIEVED" | "PARTIAL" | "NOT_ACHIEVED"; note: string } | null; operational: { result: "IMPROVED" | "UNCHANGED" | "WORSENED" | "NOT_MEASURED"; reading: string } | null; formValues?: Record<string, string | number | boolean | null> }) =>
  detail(apiPost<unknown>(`${BASE}/${id}/complete`, body))
export const updateInterventionPlan = (id: string, body: { expectedRevision: number; plan?: InterventionPlan; formValues?: Record<string, string | number | boolean | null> }) => detail(apiSend<unknown>(`${BASE}/${id}/plan`, "PUT", body))
export const addInterventionItem = (id: string, body: { expectedRevision: number; kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description?: string; ownerId?: string | null; dueAt?: string | null }) => detail(apiPost<unknown>(`${BASE}/${id}/items`, body))
export const updateInterventionItem = (id: string, itemId: string, body: { expectedRevision: number; status: "PENDING" | "DONE" | "SKIPPED"; note?: string; reading?: string }) => detail(apiSend<unknown>(`${BASE}/${id}/items/${itemId}`, "PATCH", body))
export const requestAiDraft = (id: string) => detail(apiPost<unknown>(`${BASE}/${id}/ai-draft`))
export const applyAiDraft = (id: string, expectedRevision: number) => detail(apiPost<unknown>(`${BASE}/${id}/ai-draft/apply`, { expectedRevision }))
export async function fetchTrainingCompetencies() {
  return z.array(trainingCompetencySchema).parse(await apiGet<unknown>(`${BASE}/competencies`))
}
export const applyTrainingCompetency = (id: string, body: { expectedRevision: number; competencyKey: string }) => detail(apiPost<unknown>(`${BASE}/${id}/competency`, body))
