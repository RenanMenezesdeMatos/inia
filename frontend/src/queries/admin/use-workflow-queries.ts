import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createWorkflow,
  deleteWorkflow,
  discardWorkflowConfiguration,
  fetchSchedulePreview,
  fetchWorkflow,
  fetchWorkflowEnrollmentsPage,
  fetchWorkflows,
  fetchWorkflowsPage,
  publishWorkflow,
  saveWorkflowDraft,
  submitHumanReviewDecision,
  updateWorkflow,
  updateWorkflowAnalysisConfig,
  type AnalysisConfigInput,
  type HumanReviewDecision,
  type WorkflowEnrollmentListParams,
  type WorkflowListParams,
  type WorkflowTriggerInput,
} from "@/services/admin/workflow-service"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { GO_LIVE_CONFIRMATION_CODES, type Workflow } from "@/schemas/admin/workflow.schema"

import { adminQueryKeys } from "./admin-query-keys"

export function useWorkflowsQuery() {
  return useQuery({ queryKey: adminQueryKeys.workflows(), queryFn: fetchWorkflows })
}

export function useWorkflowsPageQuery(params: WorkflowListParams) {
  return useQuery({ queryKey: adminQueryKeys.workflowsList(params), queryFn: () => fetchWorkflowsPage(params), placeholderData: keepPreviousData })
}

export function useWorkflowQuery(id: string) {
  return useQuery({ queryKey: adminQueryKeys.workflow(id), queryFn: () => fetchWorkflow(id), enabled: Boolean(id) })
}

export function useWorkflowEnrollmentsPageQuery(id: string, params: WorkflowEnrollmentListParams) {
  return useQuery({
    queryKey: adminQueryKeys.workflowEnrollmentsList(id, params),
    queryFn: () => fetchWorkflowEnrollmentsPage(id, params),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  })
}

/** Preview de próximas execuções do Trigger "Por agenda" (Parte 10; Parte 19 da evolução relativa
 * ao expediente) — chama o mesmo endpoint/calculadora que o checador real usa no backend, nunca
 * recalcula datas no cliente. `scope` só importa (e só é enviado) quando o modo é relativo ao
 * expediente — o cálculo depende de QUEM está no escopo do Workflow. `enabled` cabe a quem chama
 * (mesmo espírito de `isTriggerComplete`): só dispara quando a config já é válida o bastante pra
 * fazer sentido mostrar uma prévia. */
export function useSchedulePreviewQuery(
  trigger: Extract<WorkflowTriggerInput, { kind: "schedule" }>,
  scope: { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string } | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: adminQueryKeys.workflowSchedulePreview(trigger, scope),
    queryFn: () => fetchSchedulePreview(trigger, scope),
    enabled,
  })
}

export function useCreateWorkflowMutation() {
  return useAdminMutation({ mutationFn: createWorkflow, invalidateKey: adminQueryKeys.workflows(), successMessage: "Workflow criado." })
}

export function useUpdateWorkflowMutation() {
  // 409 "confirme o impacto" (ativar uma Agenda) vira diálogo na tela — nunca toast de erro.
  return useAdminMutation({ mutationFn: updateWorkflow, invalidateKey: adminQueryKeys.workflows(), successMessage: "Workflow atualizado.", silentErrorCodes: GO_LIVE_CONFIRMATION_CODES })
}

export function useUpdateWorkflowAnalysisConfigMutation(id: string) {
  return useAdminMutation({
    mutationFn: (input: AnalysisConfigInput) => updateWorkflowAnalysisConfig(id, input),
    invalidateKey: adminQueryKeys.workflow(id),
    successMessage: "Configuração de análise atualizada.",
  })
}

// Sem successMessage de propósito — os campos do gatilho no canvas salvam a cada mudança
// (troca de tipo, chip de horário, intervalo), um toast por tecla digitada seria barulho.
export function useUpdateWorkflowTriggerMutation(id: string) {
  return useAdminMutation({
    mutationFn: (trigger: WorkflowTriggerInput) => updateWorkflow({ id, trigger }),
    invalidateKey: adminQueryKeys.workflow(id),
  })
}

export function useSaveWorkflowDraftMutation(id: string) {
  return useAdminMutation({
    mutationFn: (graph: FlowGraph) => saveWorkflowDraft(id, graph),
    invalidateKey: adminQueryKeys.workflow(id),
    successMessage: "Rascunho salvo.",
  })
}

export function usePublishWorkflowMutation(id: string) {
  return useAdminMutation<Workflow, { confirmation?: string } | void>({
    mutationFn: (variables) => publishWorkflow(id, variables?.confirmation),
    silentErrorCodes: GO_LIVE_CONFIRMATION_CODES,
    invalidateKey: adminQueryKeys.workflow(id),
    successMessage: "Workflow publicado.",
  })
}

export function useDiscardWorkflowConfigurationMutation(id: string) {
  return useAdminMutation<Workflow, void>({
    mutationFn: () => discardWorkflowConfiguration(id),
    invalidateKey: adminQueryKeys.workflow(id),
    successMessage: "Alterações de configuração descartadas.",
  })
}

export function useSubmitHumanReviewDecisionMutation(workflowId: string) {
  return useAdminMutation({
    mutationFn: ({ enrollmentId, nodeId, decision }: { enrollmentId: string; nodeId: string; decision: HumanReviewDecision }) =>
      submitHumanReviewDecision(workflowId, enrollmentId, nodeId, decision),
    invalidateKey: adminQueryKeys.workflowEnrollments(workflowId),
    successMessage: "Decisão registrada.",
  })
}

export function useDeleteWorkflowMutation() {
  return useAdminMutation({ mutationFn: deleteWorkflow, invalidateKey: adminQueryKeys.workflows(), successMessage: "Workflow excluído." })
}
