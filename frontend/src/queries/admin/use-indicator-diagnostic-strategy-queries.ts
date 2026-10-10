import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  discardStrategyDraft,
  fetchSimulationOptions,
  fetchStrategyOverview,
  publishStrategyDraft,
  saveStrategyDraft,
  setStrategyActive,
  simulateStrategy,
} from "@/services/admin/indicator-diagnostic-strategy-service"

import { adminQueryKeys } from "./admin-query-keys"

// Chave DENTRO de indicatorRules: publicar/rascunho invalida também o status compacto da listagem de indicadores.
const strategyKey = (indicatorId: string) => [...adminQueryKeys.indicatorRules(), "diagnostic-strategy", indicatorId] as const

export function useStrategyOverviewQuery(indicatorId: string) {
  return useQuery({ queryKey: strategyKey(indicatorId), queryFn: () => fetchStrategyOverview(indicatorId) })
}
export function useSaveStrategyDraftMutation() {
  return useAdminMutation({ mutationFn: saveStrategyDraft, invalidateKey: adminQueryKeys.indicatorRules(), successMessage: "Rascunho da estratégia salvo." })
}
export function usePublishStrategyMutation() {
  return useAdminMutation({ mutationFn: publishStrategyDraft, invalidateKey: adminQueryKeys.indicatorRules(), successMessage: "Estratégia publicada.", silentErrorCodes: ["STRATEGY_INVALID_FOR_PUBLISH"] })
}
export function useDiscardStrategyDraftMutation() {
  return useAdminMutation({ mutationFn: discardStrategyDraft, invalidateKey: adminQueryKeys.indicatorRules(), successMessage: "Rascunho descartado." })
}
export function useSetStrategyActiveMutation() {
  return useAdminMutation({ mutationFn: setStrategyActive, invalidateKey: adminQueryKeys.indicatorRules() })
}
/** A busca por nome vai ao servidor: a lista traz no máximo 30 colaboradores do escopo. */
export function useSimulationOptionsQuery(indicatorId: string, enabled: boolean, search = "") {
  return useQuery({ queryKey: [...strategyKey(indicatorId), "simulation-options", search], queryFn: () => fetchSimulationOptions(indicatorId, search || undefined), enabled, placeholderData: keepPreviousData })
}
/** Simulação não altera nada no servidor: nenhuma invalidação. */
export function useSimulateStrategyMutation() {
  return useMutation({ mutationFn: simulateStrategy })
}
