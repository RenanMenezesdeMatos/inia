import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  goLiveImpactSchema,
  workflowDetailSchema,
  workflowEnrollmentSchema,
  workflowSchema,
  workflowValidationResultSchema,
  type GoLiveImpact,
  type ManualTriggerContext,
  type RelativeSchedule,
  type ScheduleFrequency,
  type Workflow,
  type WorkflowDetail,
  type WorkflowEnrollment,
  type WorkflowTrigger,
  type WorkflowValidationResult,
} from "@/schemas/admin/workflow.schema"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import {
  manualRunCollaboratorsSchema,
  manualRunInfoSchema,
  manualRunInteractionSchema,
  manualRunMeasurementSchema,
  manualRunRequestResultSchema,
  manualRunSchema,
  type ManualRun,
  type ManualRunInfo,
  type ManualRunInteraction,
  type ManualRunMeasurement,
} from "@/schemas/admin/workflow-manual-run.schema"
import {
  workflowExecutionAgentRecordSchema,
  workflowRetryPreviewSchema,
  workflowRetryResultSchema,
  type WorkflowExecutionAgentRecord,
  type WorkflowRetryPreview,
  type WorkflowRetryResult,
} from "@/schemas/admin/workflow-retry.schema"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import type { ConsolidatedStructure } from "@/schemas/admin/consolidated-structure-schema"
import type { PopulationFilter } from "@/schemas/admin/population-filter-schema"

export type WorkflowTriggerInput =
  | { kind: "channel_flag"; channelFlagId: string }
  | { kind: "indicator"; indicatorCode: string }
  | {
      kind: "schedule"
      mode?: "CALENDAR" | "RELATIVE_TO_SHIFT"
      times?: string[]
      intervalDays: number
      frequency?: ScheduleFrequency
      relative?: RelativeSchedule
    }
  | { kind: "manual"; context: ManualTriggerContext; indicatorCode?: string }

const schedulePreviewResultSchema = z.discriminatedUnion("mode", [
  // `catchUpToday`: horários de HOJE que já passaram — o agendador os recupera se o gatilho entrar no ar hoje.
  z.object({ mode: z.literal("CALENDAR"), occurrences: z.array(z.string()), catchUpToday: z.array(z.string()).default([]), timezone: z.string() }),
  z.object({
    mode: z.literal("RELATIVE_TO_SHIFT"),
    previewDate: z.string(),
    examples: z.array(z.object({ name: z.string(), iso: z.string() })),
    totalEligible: z.number(),
    withoutValidShift: z.number(),
    timezone: z.string(),
  }),
])
export type SchedulePreviewResult = z.infer<typeof schedulePreviewResultSchema>

export async function fetchSchedulePreview(
  trigger: Extract<WorkflowTriggerInput, { kind: "schedule" }>,
  scope?: { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string },
): Promise<SchedulePreviewResult> {
  return schedulePreviewResultSchema.parse(await adminSend("/api/v1/admin/workflows/schedule-preview", "POST", { trigger, scope }))
}

export async function fetchWorkflows(): Promise<Workflow[]> {
  return z.array(workflowSchema).parse(await adminGet("/api/v1/admin/workflows"))
}

export type WorkflowListParams = ListParams &
  OrgScopeFilter & {
    triggerKind: WorkflowTrigger["kind"][]
    published?: boolean
    active?: boolean
    hasActiveEnrollments?: boolean
    createdAt: DateRangeFilter
  }

export async function fetchWorkflowsPage(params: WorkflowListParams): Promise<PageResult<Workflow>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(workflowSchema).parse(await adminGet(`/api/v1/admin/workflows${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export type WorkflowEnrollmentListParams = ListParams & { status: WorkflowEnrollment["status"][]; createdAt: DateRangeFilter }

export async function fetchWorkflowEnrollmentsPage(id: string, params: WorkflowEnrollmentListParams): Promise<PageResult<WorkflowEnrollment>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(workflowEnrollmentSchema).parse(
    await adminGet(`/api/v1/admin/workflows/${id}/enrollments${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`),
  )
}

export async function fetchWorkflow(id: string): Promise<WorkflowDetail> {
  return workflowDetailSchema.parse(await adminGet(`/api/v1/admin/workflows/${id}`))
}

export type HumanReviewDecision = "approved" | "rejected" | "escalated"

export async function submitHumanReviewDecision(
  workflowId: string,
  enrollmentId: string,
  nodeId: string,
  decision: HumanReviewDecision,
): Promise<void> {
  await adminSend(`/api/v1/admin/workflows/${workflowId}/enrollments/${enrollmentId}/decision`, "POST", { nodeId, decision })
}

/** Prévia da nova tentativa de uma execução bloqueada: o que será usado se confirmada agora (PEN-073 a PEN-075). */
export async function fetchWorkflowRetryPreview(workflowId: string, enrollmentId: string): Promise<WorkflowRetryPreview> {
  return workflowRetryPreviewSchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/enrollments/${enrollmentId}/retry`))
}

/** Confirma a nova tentativa com a impressão digital da prévia vista — o servidor confere tudo de novo antes de criar. */
export async function confirmWorkflowRetry(workflowId: string, enrollmentId: string, fingerprint: string): Promise<WorkflowRetryResult> {
  return workflowRetryResultSchema.parse(await adminSend(`/api/v1/admin/workflows/${workflowId}/enrollments/${enrollmentId}/retry`, "POST", { fingerprint }))
}

/** "Ver histórico desta execução" (PEN-071): só as execuções de agente desta execução do Workflow. */
export async function fetchWorkflowExecutionAgentRecords(workflowId: string, enrollmentId: string): Promise<WorkflowExecutionAgentRecord[]> {
  return z.array(workflowExecutionAgentRecordSchema).parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/enrollments/${enrollmentId}/agent-records`))
}

export type CreateWorkflowInput = { name: string; description?: string; orgScope: OrgScopeValue; trigger: WorkflowTriggerInput }

export async function createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
  return workflowSchema.parse(
    await adminSend("/api/v1/admin/workflows", "POST", {
      name: input.name,
      description: input.description,
      scopeType: input.orgScope.scopeType,
      teamId: input.orgScope.teamId,
      subteamId: input.orgScope.subteamId,
      trigger: input.trigger,
    }),
  )
}

export type UpdateWorkflowInput = {
  id: string
  name?: string
  description?: string
  orgScope?: OrgScopeValue
  trigger?: WorkflowTriggerInput
  active?: boolean
  /** Ativar uma Agenda publicada pode exigir a confirmação do impacto: o `fingerprint` que a pessoa viu. */
  confirmation?: string
}

/** Gatilho e Abrangência gravam no RASCUNHO; nome, descrição e ativo valem na hora. */
export async function updateWorkflow(input: UpdateWorkflowInput): Promise<Workflow> {
  return workflowSchema.parse(
    await adminSend(`/api/v1/admin/workflows/${input.id}`, "PATCH", {
      name: input.name,
      description: input.description,
      scopeType: input.orgScope?.scopeType,
      teamId: input.orgScope?.teamId,
      subteamId: input.orgScope?.subteamId,
      trigger: input.trigger,
      active: input.active,
      confirmation: input.confirmation,
    }),
  )
}

export type AnalysisConfigInput = { mode: "INDIVIDUAL"; populationFilter: PopulationFilter | null } | { mode: "CONSOLIDATED"; consolidatedStructure: ConsolidatedStructure }

/** Modo de avaliação (Individual x Consolidado) — configuração própria do workflow, endpoint
 * dedicado (backend valida a Abrangência de novo). */
export async function updateWorkflowAnalysisConfig(id: string, input: AnalysisConfigInput): Promise<Workflow> {
  return workflowSchema.parse(await adminSend(`/api/v1/admin/workflows/${id}/analysis-config`, "PUT", input))
}

export async function saveWorkflowDraft(id: string, graph: FlowGraph): Promise<void> {
  await adminSend(`/api/v1/admin/workflows/${id}/draft`, "PUT", { graph })
}

/** Dry-run de publicação do rascunho PERSISTIDO — zero escrita. O editor chama depois de salvar
 * (nunca a cada tecla) pra "Pronto para publicar" significar validação local + backend. */
export async function validateWorkflowDraft(id: string): Promise<WorkflowValidationResult> {
  return workflowValidationResultSchema.parse(await adminSend(`/api/v1/admin/workflows/${id}/validate`, "POST"))
}

/** O que publicar o rascunho AGORA faria no runtime (zero escrita) — abre o diálogo de publicação. */
export async function fetchPublishImpact(id: string): Promise<GoLiveImpact> {
  return goLiveImpactSchema.parse(await adminGet(`/api/v1/admin/workflows/${id}/publish-impact`))
}

/** `confirmation` = fingerprint do impacto confirmado; sem ele, um impacto que exige confirmação volta 409 com o impacto. */
export async function publishWorkflow(id: string, confirmation?: string): Promise<Workflow> {
  return workflowSchema.parse(await adminSend(`/api/v1/admin/workflows/${id}/publish`, "POST", confirmation ? { confirmation } : {}))
}

/** O rascunho da configuração volta a ser a publicada (o grafo em rascunho não muda). */
export async function discardWorkflowConfiguration(id: string): Promise<Workflow> {
  return workflowSchema.parse(await adminSend(`/api/v1/admin/workflows/${id}/configuration/discard`, "POST"))
}

export async function deleteWorkflow(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/workflows/${id}`, "DELETE")
}

// ---------------------------------------------------------------------------------------------
// Gatilho MANUAL — "Executar agora" (backend manual-run.ts)
// ---------------------------------------------------------------------------------------------

export async function fetchManualRunInfo(workflowId: string): Promise<ManualRunInfo> {
  return manualRunInfoSchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/manual-run`))
}

export async function fetchManualRunCollaborators(workflowId: string, search: string) {
  return manualRunCollaboratorsSchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/manual-run/collaborators${toQueryString({ search: search || undefined })}`))
}

export async function fetchManualRunInteractions(workflowId: string, collaboratorId: string, search: string): Promise<ManualRunInteraction[]> {
  return z.array(manualRunInteractionSchema).parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/manual-run/interactions${toQueryString({ collaboratorId, search: search || undefined })}`))
}

export async function fetchManualRunMeasurements(workflowId: string, collaboratorId: string): Promise<ManualRunMeasurement[]> {
  return z.array(manualRunMeasurementSchema).parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/manual-run/measurements${toQueryString({ collaboratorId })}`))
}

export type ManualRunRequestInput = { collaboratorId: string; interactionId?: string | null; indicatorMeasurementId?: string | null; idempotencyKey: string }

export async function requestManualRun(workflowId: string, input: ManualRunRequestInput) {
  return manualRunRequestResultSchema.parse(await adminSend(`/api/v1/admin/workflows/${workflowId}/manual-runs`, "POST", input))
}

export async function fetchManualRun(workflowId: string, runId: string): Promise<ManualRun> {
  return manualRunSchema.parse(await adminGet(`/api/v1/admin/workflows/${workflowId}/manual-runs/${runId}`))
}
