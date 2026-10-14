import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { CompetencyInput, InterventionTypeDefinition, PolicyDefinition } from "@/schemas/admin/intervention-policy.schema"
import {
  createCompetency,
  createInterventionType,
  createPolicy,
  discardInterventionTypeDraft,
  discardPolicyDraft,
  fetchCapabilityCatalog,
  fetchCompetencies,
  fetchEditorCatalog,
  searchPatternOptions,
  fetchInterventionTypes,
  fetchPolicies,
  fetchPolicy,
  fetchPolicyAudit,
  fetchPolicyEvaluations,
  fetchPublishedPolicySummaries,
  publishInterventionType,
  publishPolicy,
  reevaluate,
  saveInterventionTypeDraft,
  savePolicyDraft,
  searchSimulationPeople,
  setCompetencyActive,
  setInterventionTypeActive,
  setPolicyActive,
  updateCompetency,
  updatePolicyHeader,
} from "@/services/admin/intervention-policy-service"

import { adminQueryKeys } from "./admin-query-keys"

// Catálogo técnico (fixo em código) e catálogos administráveis.
export const useCapabilityCatalogQuery = () => useQuery({ queryKey: adminQueryKeys.interventionCapabilities(), queryFn: fetchCapabilityCatalog, staleTime: Infinity })
export const useEditorCatalogQuery = () => useQuery({ queryKey: adminQueryKeys.interventionEditorCatalog(), queryFn: fetchEditorCatalog, staleTime: 60_000 })
/** Práticas/critérios pelo nome: busca (a partir de 2 letras) e os rótulos dos já escolhidos. */
export const usePatternOptionsQuery = (search: string, keys: string[]) =>
  useQuery({ queryKey: [...adminQueryKeys.interventionEditorCatalog(), "patterns", search.trim(), [...keys].sort().join(",")], queryFn: () => searchPatternOptions({ search: search.trim().length >= 2 ? search : "", keys }), enabled: search.trim().length >= 2 || keys.length > 0, staleTime: 60_000 })
export const useInterventionTypesQuery = () => useQuery({ queryKey: adminQueryKeys.interventionTypes(), queryFn: fetchInterventionTypes })
export const useCompetenciesQuery = () => useQuery({ queryKey: adminQueryKeys.competencies(), queryFn: fetchCompetencies })
export const usePoliciesQuery = () => useQuery({ queryKey: adminQueryKeys.interventionPolicyList(), queryFn: fetchPolicies })
export const usePolicyQuery = (id: string | null) => useQuery({ queryKey: adminQueryKeys.interventionPolicy(id ?? ""), queryFn: () => fetchPolicy(id!), enabled: Boolean(id) })
/** Para o nó "Avaliar política de acompanhamento" (lido com `workflows.manage`). */
export const usePublishedPolicySummariesQuery = (enabled = true) => useQuery({ queryKey: adminQueryKeys.publishedPolicySummaries(), queryFn: fetchPublishedPolicySummaries, enabled })
export const usePolicyAuditQuery = (entityId: string | null, enabled = true) => useQuery({ queryKey: adminQueryKeys.interventionPolicyAudit(entityId), queryFn: () => fetchPolicyAudit(entityId ?? undefined), enabled })
export const usePolicyEvaluationsQuery = (id: string, enabled = true) => useQuery({ queryKey: adminQueryKeys.interventionPolicyEvaluations(id), queryFn: () => fetchPolicyEvaluations(id), enabled })
export const useSimulationPeopleQuery = (search: string, enabled = true) => useQuery({ queryKey: adminQueryKeys.simulationPeople(search), queryFn: () => searchSimulationPeople(search), enabled })

const invalidate = adminQueryKeys.interventionPolicies()
export const useCreateInterventionTypeMutation = () => useAdminMutation({ mutationFn: createInterventionType, invalidateKey: invalidate, successMessage: "Tipo de intervenção criado como rascunho." })
export const useSaveInterventionTypeDraftMutation = () => useAdminMutation({ mutationFn: ({ id, definition }: { id: string; definition: InterventionTypeDefinition }) => saveInterventionTypeDraft(id, definition), invalidateKey: invalidate, successMessage: "Rascunho salvo." })
export const usePublishInterventionTypeMutation = () => useAdminMutation({ mutationFn: publishInterventionType, invalidateKey: invalidate, successMessage: "Tipo publicado.", silentErrorCodes: ["INTERVENTION_TYPE_INVALID_FOR_PUBLISH"] })
export const useDiscardInterventionTypeDraftMutation = () => useAdminMutation({ mutationFn: discardInterventionTypeDraft, invalidateKey: invalidate, successMessage: "Rascunho descartado." })
export const useSetInterventionTypeActiveMutation = () => useAdminMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setInterventionTypeActive(id, active), invalidateKey: invalidate })
export const useCreateCompetencyMutation = () => useAdminMutation({ mutationFn: createCompetency, invalidateKey: invalidate, successMessage: "Competência criada." })
export const useUpdateCompetencyMutation = () => useAdminMutation({ mutationFn: ({ id, input }: { id: string; input: CompetencyInput }) => updateCompetency(id, input), invalidateKey: invalidate, successMessage: "Competência atualizada." })
export const useSetCompetencyActiveMutation = () => useAdminMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setCompetencyActive(id, active), invalidateKey: invalidate })
export const useCreatePolicyMutation = () => useAdminMutation({ mutationFn: createPolicy, invalidateKey: invalidate, successMessage: "Política criada como rascunho." })
export const useUpdatePolicyHeaderMutation = () => useAdminMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => updatePolicyHeader(id, { name }), invalidateKey: invalidate, successMessage: "Política atualizada." })
/** Escopo da política (só antes da primeira publicação — o backend devolve 409 INTERVENTION_POLICY_SCOPE_LOCKED depois). */
export const useUpdatePolicyScopeMutation = () =>
  useAdminMutation({
    mutationFn: ({ id, name, scopeType, teamId, subteamId }: { id: string; name: string; scopeType: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId: string | null; subteamId: string | null }) => updatePolicyHeader(id, { name, scopeType, teamId, subteamId }),
    invalidateKey: invalidate,
    successMessage: "Escopo atualizado.",
  })
export const useSavePolicyDraftMutation = () => useAdminMutation({ mutationFn: ({ id, definition }: { id: string; definition: PolicyDefinition }) => savePolicyDraft(id, definition), invalidateKey: invalidate, successMessage: "Rascunho salvo." })
export const usePublishPolicyMutation = () => useAdminMutation({ mutationFn: ({ id, effectiveFrom }: { id: string; effectiveFrom: string | null }) => publishPolicy(id, effectiveFrom), invalidateKey: invalidate, successMessage: "Versão publicada.", silentErrorCodes: ["INTERVENTION_POLICY_INVALID_FOR_PUBLISH"] })
export const useDiscardPolicyDraftMutation = () => useAdminMutation({ mutationFn: discardPolicyDraft, invalidateKey: invalidate, successMessage: "Rascunho descartado." })
export const useSetPolicyActiveMutation = () => useAdminMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setPolicyActive(id, active), invalidateKey: invalidate })
export const useReevaluateMutation = () => useAdminMutation({ mutationFn: ({ evaluationId, reason }: { evaluationId: string; reason: string }) => reevaluate(evaluationId, reason), invalidateKey: invalidate, successMessage: "Reavaliação registrada (a avaliação original foi preservada)." })
