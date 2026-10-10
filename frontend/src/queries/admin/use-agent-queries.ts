import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createAgent,
  deleteAgent,
  fetchAgent,
  fetchAgentHistory,
  fetchAgentRuns,
  fetchAgents,
  fetchAgentsPage,
  testAgent,
  updateAgent,
  updateAgentActive,
  type AgentListParams,
  type CreateAgentInput,
} from "@/services/admin/agent-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useAgentsQuery() {
  return useQuery({ queryKey: adminQueryKeys.agents(), queryFn: fetchAgents })
}

export function useAgentsPageQuery(params: AgentListParams) {
  return useQuery({ queryKey: adminQueryKeys.agentsList(params), queryFn: () => fetchAgentsPage(params), placeholderData: keepPreviousData })
}

export function useAgentQuery(id: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.agents(), id],
    queryFn: () => fetchAgent(id!),
    enabled: id !== null,
  })
}

export function useAgentHistoryQuery(id: string) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), id, "history"], queryFn: () => fetchAgentHistory(id) })
}

export function useAgentRunsQuery(id: string) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), id, "runs"], queryFn: () => fetchAgentRuns(id) })
}

export function useTestAgentMutation(agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: string) => testAgent(agentId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.agents(), agentId, "runs"] }),
  })
}

export function useCreateAgentMutation() {
  return useAdminMutation({
    mutationFn: createAgent,
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Agente criado.",
  })
}

export function useUpdateAgentMutation() {
  return useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateAgentInput }) => updateAgent(id, input),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Agente atualizado.",
  })
}

export function useToggleAgentActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateAgentActive(id, active),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Status do agente atualizado.",
  })
}

export function useDeleteAgentMutation() {
  return useAdminMutation({
    mutationFn: deleteAgent,
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Agente excluído.",
  })
}
