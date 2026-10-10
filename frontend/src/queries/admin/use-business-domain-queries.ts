import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createBusinessDomain,
  deleteBusinessDomain,
  fetchBusinessDomainDependencies,
  fetchBusinessDomains,
  fetchBusinessDomainsPage,
  setBusinessDomainActive,
  updateBusinessDomain,
  type BusinessDomainListParams,
} from "@/services/admin/business-domain-service"

import { adminQueryKeys } from "./admin-query-keys"

/** Catálogo para seletores — dinâmico: um domínio criado na tela aparece aqui sem deploy. */
export function useBusinessDomainsQuery(options: { includeInactive?: boolean } = {}) {
  return useQuery({ queryKey: adminQueryKeys.businessDomainsCatalog(Boolean(options.includeInactive)), queryFn: () => fetchBusinessDomains(options) })
}

export function useBusinessDomainsPageQuery(params: BusinessDomainListParams) {
  return useQuery({ queryKey: adminQueryKeys.businessDomainsList(params), queryFn: () => fetchBusinessDomainsPage(params), placeholderData: keepPreviousData })
}

export function useBusinessDomainDependenciesQuery(id: string | null) {
  return useQuery({ queryKey: adminQueryKeys.businessDomainDependencies(id ?? ""), queryFn: () => fetchBusinessDomainDependencies(id!), enabled: Boolean(id) })
}

export function useCreateBusinessDomainMutation() {
  return useAdminMutation({ mutationFn: createBusinessDomain, invalidateKey: adminQueryKeys.businessDomains(), successMessage: "Domínio de negócio criado." })
}

export function useUpdateBusinessDomainMutation() {
  return useAdminMutation({ mutationFn: updateBusinessDomain, invalidateKey: adminQueryKeys.businessDomains(), successMessage: "Domínio de negócio atualizado." })
}

export function useSetBusinessDomainActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setBusinessDomainActive(id, active),
    invalidateKey: adminQueryKeys.businessDomains(),
    successMessage: "Status atualizado.",
  })
}

export function useDeleteBusinessDomainMutation() {
  return useAdminMutation({ mutationFn: deleteBusinessDomain, invalidateKey: adminQueryKeys.businessDomains(), successMessage: "Domínio de negócio excluído." })
}
