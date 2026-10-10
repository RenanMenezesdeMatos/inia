import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createOrchestrator,
  deleteOrchestrator,
  fetchOrchestrator,
  fetchOrchestrators,
  fetchOrchestratorsPage,
  fetchStructuredOutputUsage,
  updateOrchestrator,
  updateOrchestratorActive,
  type OrchestratorInput,
  type OrchestratorListParams,
} from "@/services/admin/assistant-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useOrchestratorsQuery() {
  return useQuery({ queryKey: adminQueryKeys.assistantOrchestrators(), queryFn: fetchOrchestrators })
}

export function useOrchestratorsPageQuery(params: OrchestratorListParams) {
  return useQuery({
    queryKey: adminQueryKeys.assistantOrchestratorsList(params),
    queryFn: () => fetchOrchestratorsPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useOrchestratorQuery(id: string | null) {
  return useQuery({
    queryKey: adminQueryKeys.assistantOrchestrator(id ?? ""),
    queryFn: () => fetchOrchestrator(id!),
    enabled: id !== null,
  })
}

/** Onde cada path do resultado estruturado é usado em Workflows — alimenta o construtor visual
 * (badge por item, impacto antes de excluir). */
export function useStructuredOutputUsageQuery(id: string | null) {
  return useQuery({
    queryKey: adminQueryKeys.assistantOrchestratorStructuredOutputUsage(id ?? ""),
    queryFn: () => fetchStructuredOutputUsage(id!),
    enabled: id !== null,
  })
}

export function useCreateOrchestratorMutation() {
  return useAdminMutation({
    mutationFn: createOrchestrator,
    invalidateKey: adminQueryKeys.assistantOrchestrators(),
    successMessage: "Orquestrador criado.",
  })
}

export function useUpdateOrchestratorMutation(id: string) {
  return useAdminMutation({
    mutationFn: (input: OrchestratorInput) => updateOrchestrator(id, input),
    invalidateKey: adminQueryKeys.assistantOrchestrator(id),
    successMessage: "Orquestrador atualizado.",
    // O editor transforma este 409 em diálogo de confirmação (structured-output-impacts.tsx).
    silentErrorCodes: ["STRUCTURED_OUTPUT_IN_USE_DRAFT"],
  })
}

export function useToggleOrchestratorActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateOrchestratorActive(id, active),
    invalidateKey: adminQueryKeys.assistantOrchestrators(),
    successMessage: "Status do orquestrador atualizado.",
  })
}

export function useDeleteOrchestratorMutation() {
  return useAdminMutation({
    mutationFn: deleteOrchestrator,
    invalidateKey: adminQueryKeys.assistantOrchestrators(),
    successMessage: "Orquestrador excluído.",
  })
}
