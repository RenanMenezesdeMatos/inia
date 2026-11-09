import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createAgent,
  deleteAgent,
  discardAgentDraft,
  fetchAgent,
  fetchAgentDeletionCheck,
  fetchAgentHistory,
  fetchAgentPublishImpact,
  fetchAgentReferences,
  fetchAgentRun,
  fetchAgentRuns,
  fetchAgents,
  fetchAgentsPage,
  fetchAgentVersion,
  fetchAgentVersions,
  publishAgent,
  revertAgent,
  testAgent,
  updateAgent,
  updateAgentActive,
  type AgentListParams,
  type AgentTestTarget,
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

export function useAgentRunDetailQuery(agentId: string, runId: string | null) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), agentId, "runs", runId], queryFn: () => fetchAgentRun(agentId, runId!), enabled: runId !== null })
}

export function useAgentVersionsQuery(agentId: string | null) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), agentId, "versions"], queryFn: () => fetchAgentVersions(agentId!), enabled: agentId !== null })
}

export function useAgentVersionQuery(agentId: string, versionId: string | null) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), agentId, "versions", versionId], queryFn: () => fetchAgentVersion(agentId, versionId!), enabled: versionId !== null })
}

export function useAgentDeletionCheckQuery(agentId: string | null) {
  return useQuery({ queryKey: [...adminQueryKeys.agents(), agentId, "deletion-check"], queryFn: () => fetchAgentDeletionCheck(agentId!), enabled: agentId !== null, staleTime: 0 })
}

/**
 * Prévia da publicação — buscada a cada abertura do "Publicar" (`agentId` null = fechado), sempre fresca: consumidores e mudanças
 * podem ter mudado desde a última vez.
 */
export function useAgentPublishImpactQuery(agentId: string | null, revertToVersionId?: string) {
  return useQuery({
    queryKey: [...adminQueryKeys.agents(), agentId, "publish-impact", revertToVersionId ?? "draft"],
    queryFn: () => fetchAgentPublishImpact(agentId!, revertToVersionId),
    enabled: agentId !== null,
    staleTime: 0,
  })
}

/** Nome, status e versões de agentes citados (inclusive inativos) — sem abrir o cadastro de inativo (PEN-068). */
export function useAgentReferencesQuery(ids: string[]) {
  const key = [...new Set(ids)].sort()
  return useQuery({ queryKey: [...adminQueryKeys.agents(), "references", key], queryFn: () => fetchAgentReferences(key), enabled: key.length > 0 })
}

export function usePublishAgentMutation() {
  return useAdminMutation({
    mutationFn: ({ id, expectedDraftRevision }: { id: string; expectedDraftRevision?: number }) => publishAgent(id, expectedDraftRevision),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Versão publicada.",
    silentErrorCodes: ["AGENT_DRAFT_CONFLICT"],
  })
}

export function useDiscardAgentDraftMutation() {
  return useAdminMutation({
    mutationFn: ({ id, expectedDraftRevision }: { id: string; expectedDraftRevision?: number }) => discardAgentDraft(id, expectedDraftRevision),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Rascunho descartado.",
    silentErrorCodes: ["AGENT_DRAFT_CONFLICT"],
  })
}

export function useRevertAgentMutation() {
  return useAdminMutation({
    mutationFn: ({ id, versionId, discardDraft, expectedDraftRevision }: { id: string; versionId: string; discardDraft: boolean; expectedDraftRevision?: number }) => revertAgent(id, versionId, { discardDraft, expectedDraftRevision }),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Versão anterior publicada como versão nova.",
    silentErrorCodes: ["AGENT_DRAFT_PENDING", "AGENT_DRAFT_CONFLICT"],
  })
}

export function useTestAgentMutation(agentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, target }: { input: string; target?: AgentTestTarget }) => testAgent(agentId, input, target),
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
    mutationFn: ({ id, input, expectedDraftRevision }: { id: string; input: CreateAgentInput; expectedDraftRevision?: number }) => updateAgent(id, input, expectedDraftRevision),
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Rascunho salvo. Produção continua na versão vigente até você publicar.",
    silentErrorCodes: ["AGENT_DRAFT_CONFLICT"],
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
    silentErrorCodes: ["AGENT_DELETE_BLOCKED"],
    invalidateKey: adminQueryKeys.agents(),
    successMessage: "Agente excluído.",
  })
}
