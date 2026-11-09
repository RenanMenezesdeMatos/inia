import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { IndicatorCorrectionFields } from "@/schemas/admin/indicator-definition.schema"
import {
  applyIndicatorCorrection,
  createIndicatorDefinition,
  deleteIndicatorDefinition,
  deleteIndicatorRule,
  fetchIndicatorCatalog,
  fetchIndicatorDependencies,
  fetchIndicatorsWithRules,
  fetchIndicatorsWithRulesPage,
  previewIndicatorCorrection,
  saveIndicatorGlossary,
  saveIndicatorRule,
  setIndicatorDefinitionActive,
  setIndicatorRuleActive,
  updateIndicatorDefinition,
  type IndicatorListParams,
} from "@/services/admin/indicator-rule-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useIndicatorsWithRulesQuery() {
  return useQuery({ queryKey: adminQueryKeys.indicatorRules(), queryFn: fetchIndicatorsWithRules })
}

/** Catálogo de comportamentos (unidades, estratégias, granularidades) — dirige o formulário de indicador. */
export function useIndicatorCatalogQuery() {
  return useQuery({ queryKey: [...adminQueryKeys.indicatorRules(), "catalog"], queryFn: fetchIndicatorCatalog, staleTime: 5 * 60 * 1000 })
}

/** O que já depende do indicador — decide quais campos ficam bloqueados na edição. */
export function useIndicatorDependenciesQuery(id: string | null) {
  return useQuery({ queryKey: [...adminQueryKeys.indicatorRules(), "dependencies", id], queryFn: () => fetchIndicatorDependencies(id!), enabled: id !== null })
}

/** Prévia do impacto da correção: sempre lida de novo no servidor, porque medições e Workflows mudam enquanto a tela está aberta. */
export function useIndicatorCorrectionPreviewQuery(id: string, fields: IndicatorCorrectionFields | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.indicatorRules(), "correction-preview", id, fields],
    queryFn: () => previewIndicatorCorrection(id, fields!),
    enabled: fields !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  })
}

export function useApplyIndicatorCorrectionMutation() {
  return useAdminMutation({
    mutationFn: applyIndicatorCorrection,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Indicador corrigido. Os resultados já seguem a regra nova.",
    // A tela mostra o motivo junto do formulário, e recarrega a prévia.
    silentErrorCodes: ["INDICATOR_CORRECTION_BLOCKED", "INDICATOR_CORRECTION_CONFIRMATION_MISMATCH"],
  })
}

export function useIndicatorsWithRulesPageQuery(params: IndicatorListParams) {
  return useQuery({
    queryKey: adminQueryKeys.indicatorRulesList(params),
    queryFn: () => fetchIndicatorsWithRulesPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useSaveIndicatorRuleMutation() {
  return useAdminMutation({
    mutationFn: saveIndicatorRule,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Regra de cálculo salva.",
  })
}

export function useSetIndicatorRuleActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ ruleId, active }: { ruleId: string; active: boolean }) => setIndicatorRuleActive(ruleId, active),
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Status da regra atualizado.",
  })
}

export function useDeleteIndicatorRuleMutation() {
  return useAdminMutation({
    mutationFn: deleteIndicatorRule,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Regra de cálculo excluída.",
  })
}

export function useCreateIndicatorDefinitionMutation() {
  return useAdminMutation({
    mutationFn: createIndicatorDefinition,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Indicador criado.",
  })
}

export function useUpdateIndicatorDefinitionMutation() {
  return useAdminMutation({
    mutationFn: updateIndicatorDefinition,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Indicador atualizado.",
  })
}

export function useSetIndicatorDefinitionActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setIndicatorDefinitionActive(id, active),
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Status do indicador atualizado.",
  })
}

export function useDeleteIndicatorDefinitionMutation() {
  return useAdminMutation({
    mutationFn: deleteIndicatorDefinition,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Indicador excluído.",
  })
}

export function useSaveIndicatorGlossaryMutation() {
  return useAdminMutation({
    mutationFn: saveIndicatorGlossary,
    invalidateKey: adminQueryKeys.indicatorRules(),
    successMessage: "Glossário salvo.",
  })
}
