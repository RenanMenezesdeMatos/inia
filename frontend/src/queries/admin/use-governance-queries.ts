import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createGlossaryTerm,
  createProhibitedTopic,
  fetchGlossaryTermsPage,
  fetchProhibitedTopics,
  fetchProhibitedTopicsPage,
  updateGlossaryTerm,
  updateProhibitedTopic,
  type GovernanceListParams,
} from "@/services/admin/governance-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useProhibitedTopicsQuery() {
  return useQuery({ queryKey: adminQueryKeys.prohibitedTopics(), queryFn: fetchProhibitedTopics })
}

export function useProhibitedTopicsPageQuery(params: GovernanceListParams) {
  return useQuery({
    queryKey: adminQueryKeys.prohibitedTopicsList(params),
    queryFn: () => fetchProhibitedTopicsPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useGlossaryTermsPageQuery(params: GovernanceListParams) {
  return useQuery({ queryKey: adminQueryKeys.glossaryList(params), queryFn: () => fetchGlossaryTermsPage(params), placeholderData: keepPreviousData })
}

export function useCreateProhibitedTopicMutation() {
  return useAdminMutation({
    mutationFn: ({ name, requiredBehavior }: { name: string; requiredBehavior: string }) => createProhibitedTopic(name, requiredBehavior),
    invalidateKey: adminQueryKeys.prohibitedTopics(),
    successMessage: "Assunto proibido adicionado.",
  })
}

export function useUpdateProhibitedTopicMutation() {
  return useAdminMutation({
    mutationFn: ({ id, name, requiredBehavior }: { id: string; name: string; requiredBehavior: string }) =>
      updateProhibitedTopic(id, name, requiredBehavior),
    invalidateKey: adminQueryKeys.prohibitedTopics(),
    successMessage: "Assunto proibido atualizado.",
  })
}

export function useCreateGlossaryTermMutation() {
  return useAdminMutation({
    mutationFn: ({ term, definition, feedbackApplication }: { term: string; definition: string; feedbackApplication: string }) =>
      createGlossaryTerm(term, definition, feedbackApplication),
    invalidateKey: adminQueryKeys.glossary(),
    successMessage: "Termo do glossário adicionado.",
  })
}

export function useUpdateGlossaryTermMutation() {
  return useAdminMutation({
    mutationFn: ({ id, term, definition, feedbackApplication }: { id: string; term: string; definition: string; feedbackApplication: string }) =>
      updateGlossaryTerm(id, term, definition, feedbackApplication),
    invalidateKey: adminQueryKeys.glossary(),
    successMessage: "Termo do glossário atualizado.",
  })
}
