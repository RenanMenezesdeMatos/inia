import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { AdminApiError } from "@/lib/admin/admin-api"
import {
  decideQaRun,
  fetchQaInteractionDetail,
  fetchQaRun,
  fetchQaRunsPage,
  findCompatibleQaInteractions,
  findQaMeasurements,
  listQaPeople,
  previewQaCondition,
  rerunQaRun,
  rerunQaRunWithCurrentDraft,
  resumeQaRun,
  runAgentSimulation,
  runOrchestratorSimulation,
  runWorkflowSimulation,
  type FindCompatibleInteractionsParams,
  type FindMeasurementsParams,
  type ListPeopleParams,
  type PreviewConditionInput,
  type QaRunListParams,
} from "@/services/admin/qa-lab-service"
import type { QaRun, QaRunResumeInput } from "@/schemas/admin/qa-lab.schema"
import type { HumanReviewDecision } from "@/schemas/admin/workflow-graph.schema"

import { adminQueryKeys } from "./admin-query-keys"

export function useQaRunsPageQuery(params: QaRunListParams) {
  return useQuery({ queryKey: adminQueryKeys.qaRunsList(params), queryFn: () => fetchQaRunsPage(params), placeholderData: keepPreviousData })
}

export function useQaRunQuery(id: string | null) {
  return useQuery({ queryKey: adminQueryKeys.qaRun(id ?? ""), queryFn: () => fetchQaRun(id!), enabled: id !== null })
}

export function useQaCompatibleInteractionsQuery(workflowId: string | null, params: FindCompatibleInteractionsParams | null) {
  return useQuery({
    queryKey: adminQueryKeys.qaTestData("compatible-interactions", { workflowId: workflowId ?? "", ...(params ?? {}) }),
    queryFn: () => findCompatibleQaInteractions(workflowId!, params!),
    enabled: workflowId !== null && params !== null,
    placeholderData: (previous) => previous,
  })
}

export function useQaInteractionDetailQuery(id: string | null) {
  return useQuery({ queryKey: adminQueryKeys.qaTestData("interaction-detail", { id: id ?? "" }), queryFn: () => fetchQaInteractionDetail(id!), enabled: id !== null })
}

export function useQaMeasurementsQuery(params: FindMeasurementsParams | null) {
  return useQuery({ queryKey: adminQueryKeys.qaTestData("measurements", params ?? {}), queryFn: () => findQaMeasurements(params!), enabled: params !== null })
}

export function useQaPeopleQuery(params: ListPeopleParams | null) {
  return useQuery({ queryKey: adminQueryKeys.qaTestData("people", params ?? {}), queryFn: () => listQaPeople(params!), enabled: params !== null })
}

export function useQaConditionPreviewQuery(input: PreviewConditionInput | null) {
  return useQuery({ queryKey: adminQueryKeys.qaTestData("condition-preview", input ?? {}), queryFn: () => previewQaCondition(input!), enabled: input !== null })
}

/** Toda mutação de execução devolve o QaRun completo — o cache do run e a listagem são
 * atualizados na hora, sem refetch do detalhe. Erros viram toast (mesmo padrão de
 * useAdminMutation), mas o resultado é devolvido pro caller renderizar o trace. */
function useQaRunMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<QaRun>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (run) => {
      queryClient.setQueryData(adminQueryKeys.qaRun(run.id), run)
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.qaRuns() })
    },
    onError: (error) => {
      toast.error(error instanceof AdminApiError ? error.message : "Não foi possível executar a simulação.")
    },
  })
}

export function useRunWorkflowSimulationMutation() {
  return useQaRunMutation(runWorkflowSimulation)
}

export function useRunAgentSimulationMutation() {
  return useQaRunMutation(runAgentSimulation)
}

export function useRunOrchestratorSimulationMutation() {
  return useQaRunMutation(runOrchestratorSimulation)
}

export function useResumeQaRunMutation() {
  return useQaRunMutation(({ id, input }: { id: string; input: QaRunResumeInput }) => resumeQaRun(id, input))
}

export function useDecideQaRunMutation() {
  return useQaRunMutation(({ id, decision, employeeId }: { id: string; decision: HumanReviewDecision; employeeId?: string }) => decideQaRun(id, decision, employeeId))
}

export function useRerunQaRunMutation() {
  return useQaRunMutation((id: string) => rerunQaRun(id))
}

export function useRerunQaRunWithCurrentDraftMutation() {
  return useQaRunMutation((id: string) => rerunQaRunWithCurrentDraft(id))
}
