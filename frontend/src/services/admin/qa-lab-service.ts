import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type PageResult } from "@/lib/admin/list-query"
import {
  conditionPreviewSchema,
  qaCompatibleInteractionsSchema,
  qaInteractionDetailSchema,
  qaMeasurementSchema,
  qaPersonOptionSchema,
  qaRunSchema,
  qaRunSummarySchema,
  type AgentSimulationInput,
  type ConditionPreview,
  type OrchestratorSimulationInput,
  type QaCompatibleInteractions,
  type QaInteractionDetail,
  type QaMeasurement,
  type QaPersonOption,
  type QaResourceType,
  type QaRun,
  type QaRunResumeInput,
  type QaRunStatus,
  type QaRunSummary,
  type StructureAnchor,
  type WorkflowSimulationInput,
} from "@/schemas/admin/qa-lab.schema"
import type { HumanReviewDecision } from "@/schemas/admin/workflow-graph.schema"

const BASE = "/api/v1/admin/qa-lab"

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ""
}

export type FindCompatibleInteractionsParams = {
  operatorId: string
  from?: string
  to?: string
  search?: string
  comparator?: string
  thresholdNumeric?: number
  thresholdBoolean?: boolean
  negate?: boolean
  limit?: number
  offset?: number
}

/** Interações compatíveis com o gatilho de UM workflow (colaborador-first). */
export async function findCompatibleQaInteractions(workflowId: string, params: FindCompatibleInteractionsParams): Promise<QaCompatibleInteractions> {
  return qaCompatibleInteractionsSchema.parse(await adminGet(`${BASE}/test-data/workflows/${workflowId}/interactions${toQuery(params)}`))
}

/** Detalhe + transcrição persistida — só leitura, nunca IA. */
export async function fetchQaInteractionDetail(id: string): Promise<QaInteractionDetail> {
  return qaInteractionDetailSchema.parse(await adminGet(`${BASE}/test-data/interactions/${id}`))
}

export type FindMeasurementsParams = { indicatorCode: string; comparator?: string; thresholdNumeric?: number; negate?: boolean; operatorId?: string; from?: string; to?: string; limit?: number }

export async function findQaMeasurements(params: FindMeasurementsParams): Promise<QaMeasurement[]> {
  return z.array(qaMeasurementSchema).parse(await adminGet(`${BASE}/test-data/measurements${toQuery(params)}`))
}

export type ListPeopleParams = { workflowId?: string; scopeType?: string; teamId?: string; subteamId?: string; search?: string; role?: string; limit?: number }

export async function listQaPeople(params: ListPeopleParams): Promise<QaPersonOption[]> {
  return z.array(qaPersonOptionSchema).parse(await adminGet(`${BASE}/test-data/people${toQuery(params)}`))
}

export type PreviewConditionInput = { workflowId: string; nodeId: string; graphSource?: "PUBLISHED" | "DRAFT"; simulatedNow?: string; consolidatedStructure?: StructureAnchor }

export async function previewQaCondition(input: PreviewConditionInput): Promise<ConditionPreview> {
  return conditionPreviewSchema.parse(await adminSend(`${BASE}/test-data/condition-preview`, "POST", input))
}

export async function runWorkflowSimulation(input: WorkflowSimulationInput): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/workflow`, "POST", input))
}

export async function runAgentSimulation(input: AgentSimulationInput): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/agent`, "POST", input))
}

export async function runOrchestratorSimulation(input: OrchestratorSimulationInput): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/orchestrator`, "POST", input))
}

export type QaRunListParams = ListParams & {
  resourceType: QaResourceType[]
  status: QaRunStatus[]
  workflowState: ("DRAFT" | "PUBLISHED")[]
  createdAt: DateRangeFilter
}

/** Histórico de QA — filtros e paginação no padrão das listagens administrativas. */
export async function fetchQaRunsPage(params: QaRunListParams): Promise<PageResult<QaRunSummary>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(qaRunSummarySchema).parse(await adminGet(`${BASE}/runs${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export async function fetchQaRun(id: string): Promise<QaRun> {
  return qaRunSchema.parse(await adminGet(`${BASE}/runs/${id}`))
}

export async function resumeQaRun(id: string, input: QaRunResumeInput): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/${id}/resume`, "POST", input))
}

export async function decideQaRun(id: string, decision: HumanReviewDecision, employeeId?: string): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/${id}/decision`, "POST", { decision, ...(employeeId ? { employeeId } : {}) }))
}

export async function rerunQaRun(id: string): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/${id}/rerun`, "POST"))
}

/** "Testar rascunho atual" — ação distinta do rerun: mesmo contexto, rascunho como está AGORA. */
export async function rerunQaRunWithCurrentDraft(id: string): Promise<QaRun> {
  return qaRunSchema.parse(await adminSend(`${BASE}/runs/${id}/rerun-current`, "POST"))
}
