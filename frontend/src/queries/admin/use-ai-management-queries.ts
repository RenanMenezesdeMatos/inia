import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { AiPermission } from "@/schemas/admin/ai-management.schema"
import {
  activateAiRoutingDraft,
  addAiModelPricing,
  createAiBudget,
  createAiConnection,
  createAiModel,
  deactivateAiRoutingPolicy,
  deleteAiBudget,
  deleteAiConnection,
  deleteAiModel,
  discardAiRoutingDraft,
  fetchAiBudgets,
  fetchAiConnections,
  fetchAiModelPricing,
  fetchAiModels,
  fetchAiOverview,
  fetchAiPermissions,
  fetchAiProviders,
  fetchAiRouting,
  fetchAiUseCases,
  removeAiConnectionSecret,
  replaceAiConnectionHeaders,
  replaceAiConnectionSecret,
  saveAiRoutingDraft,
  syncAiConnectionModels,
  testAiConnection,
  testAiModel,
  testAiRouting,
  updateAiBudget,
  updateAiConnection,
  updateAiModel,
  type AiUsageParams,
} from "@/services/admin/ai-management-service"

import { adminQueryKeys } from "./admin-query-keys"

const invalidateKey = adminQueryKeys.ai()

// ---------------------------------------------------------------- Leituras

/** Permissões de IA calculadas no backend a cada request (papel + escopo real) — a UI só esconde/desabilita. */
export function useAiPermissionsQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiMe(), queryFn: fetchAiPermissions, staleTime: 60_000 })
}

export function useAiCan(): (permission: AiPermission) => boolean {
  const query = useAiPermissionsQuery()
  const permissions = query.data ?? []
  return (permission) => permissions.includes(permission)
}

export function useAiProvidersQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiProviders(), queryFn: fetchAiProviders, staleTime: 5 * 60_000 })
}

export function useAiUseCasesQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiUseCases(), queryFn: fetchAiUseCases, staleTime: 5 * 60_000 })
}

export function useAiOverviewQuery(params: AiUsageParams, enabled = true) {
  return useQuery({ queryKey: adminQueryKeys.aiOverview(params), queryFn: () => fetchAiOverview(params), placeholderData: keepPreviousData, enabled })
}

export function useAiConnectionsQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiConnections(), queryFn: fetchAiConnections })
}

export function useAiModelsQuery(connectionId: string | null = null) {
  return useQuery({ queryKey: adminQueryKeys.aiModels(connectionId), queryFn: () => fetchAiModels(connectionId ?? undefined), placeholderData: keepPreviousData })
}

export function useAiModelPricingQuery(modelId: string | null) {
  return useQuery({ queryKey: adminQueryKeys.aiModelPricing(modelId ?? ""), queryFn: () => fetchAiModelPricing(modelId!), enabled: Boolean(modelId) })
}

export function useAiRoutingQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiRouting(), queryFn: fetchAiRouting })
}

export function useAiBudgetsQuery() {
  return useQuery({ queryKey: adminQueryKeys.aiBudgets(), queryFn: fetchAiBudgets })
}

// ---------------------------------------------------------------- Conexões

export function useCreateAiConnectionMutation() {
  return useAdminMutation({ mutationFn: createAiConnection, invalidateKey, successMessage: "Conexão criada." })
}

export function useUpdateAiConnectionMutation(successMessage = "Conexão atualizada.") {
  return useAdminMutation({ mutationFn: updateAiConnection, invalidateKey, successMessage })
}

export function useDeleteAiConnectionMutation() {
  // 409 AI_CONNECTION_IN_USE é exibido no próprio diálogo, com as dependências.
  return useAdminMutation({ mutationFn: deleteAiConnection, invalidateKey, successMessage: "Conexão excluída.", silentErrorCodes: ["AI_CONNECTION_IN_USE"] })
}

export function useReplaceAiConnectionSecretMutation() {
  return useAdminMutation({ mutationFn: replaceAiConnectionSecret, invalidateKey, successMessage: "Chave salva. O valor não é exibido novamente." })
}

export function useRemoveAiConnectionSecretMutation() {
  return useAdminMutation({ mutationFn: removeAiConnectionSecret, invalidateKey, successMessage: "Chave removida.", silentErrorCodes: ["AI_CONNECTION_IN_USE"] })
}

export function useReplaceAiConnectionHeadersMutation() {
  return useAdminMutation({ mutationFn: replaceAiConnectionHeaders, invalidateKey, successMessage: "Cabeçalhos salvos." })
}

export function useTestAiConnectionMutation() {
  return useAdminMutation({ mutationFn: testAiConnection, invalidateKey })
}

export function useSyncAiConnectionModelsMutation() {
  return useAdminMutation({ mutationFn: syncAiConnectionModels, invalidateKey })
}

// ---------------------------------------------------------------- Modelos

export function useCreateAiModelMutation() {
  return useAdminMutation({ mutationFn: createAiModel, invalidateKey, successMessage: "Modelo cadastrado." })
}

export function useUpdateAiModelMutation() {
  // 409 AI_MODEL_IN_USE_ACTIVE vira diálogo de confirmação (reenvio com acknowledgeActivePolicyImpact).
  return useAdminMutation({ mutationFn: updateAiModel, invalidateKey, successMessage: "Modelo atualizado.", silentErrorCodes: ["AI_MODEL_IN_USE_ACTIVE"] })
}

export function useDeleteAiModelMutation() {
  return useAdminMutation({ mutationFn: deleteAiModel, invalidateKey, successMessage: "Modelo excluído.", silentErrorCodes: ["AI_MODEL_IN_USE"] })
}

export function useTestAiModelMutation() {
  return useAdminMutation({ mutationFn: testAiModel, invalidateKey })
}

export function useAddAiModelPricingMutation() {
  return useAdminMutation({ mutationFn: addAiModelPricing, invalidateKey, successMessage: "Nova versão de preço registrada." })
}

// ---------------------------------------------------------------- Roteamento

export function useSaveAiRoutingDraftMutation() {
  return useAdminMutation({ mutationFn: saveAiRoutingDraft, invalidateKey, successMessage: "Rascunho salvo." })
}

export function useDiscardAiRoutingDraftMutation() {
  return useAdminMutation({ mutationFn: discardAiRoutingDraft, invalidateKey, successMessage: "Rascunho descartado." })
}

export function useActivateAiRoutingDraftMutation() {
  return useAdminMutation({ mutationFn: activateAiRoutingDraft, invalidateKey, successMessage: "Política ativada." })
}

export function useDeactivateAiRoutingPolicyMutation() {
  return useAdminMutation({ mutationFn: deactivateAiRoutingPolicy, invalidateKey, successMessage: "Política desativada — o Use Case voltou para a configuração legada do ambiente." })
}

export function useTestAiRoutingMutation() {
  return useAdminMutation({ mutationFn: testAiRouting, invalidateKey: adminQueryKeys.aiRouting() })
}

// ---------------------------------------------------------------- Orçamentos

export function useCreateAiBudgetMutation() {
  return useAdminMutation({ mutationFn: createAiBudget, invalidateKey, successMessage: "Orçamento criado." })
}

export function useUpdateAiBudgetMutation() {
  return useAdminMutation({ mutationFn: updateAiBudget, invalidateKey, successMessage: "Orçamento atualizado." })
}

export function useDeleteAiBudgetMutation() {
  return useAdminMutation({ mutationFn: deleteAiBudget, invalidateKey, successMessage: "Orçamento excluído." })
}
