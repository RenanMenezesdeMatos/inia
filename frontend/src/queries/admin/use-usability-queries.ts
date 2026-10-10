import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import {
  classifyUsabilityPerson,
  fetchUsabilityContext,
  fetchUsabilityPerson,
  fetchUsabilityTab,
  fetchUsabilityTimeline,
  reprocessUsability,
  searchUsabilityPeople,
  unclassifyUsabilityPerson,
  updateUsabilitySettings,
  type UsabilityQuery,
  type UsabilityTab,
} from "@/services/admin/usability-service"

/**
 * Chaves da Monitoria de usabilidade: CONTA + permissões efetivas + recorte. Trocar de conta (ou ganhar/perder uma
 * permissão) nunca reaproveita o cache de quem via mais — o mesmo recorte com outro alcance é outra consulta.
 */
function useViewerKey() {
  const user = useCurrentUserQuery().data
  const capabilities = user?.access.capabilities
  const permissions = capabilities
    ? [capabilities.canViewUsability, capabilities.canViewUsabilityPeople, capabilities.canExportUsability, capabilities.canViewUsabilityComments, capabilities.canManageUsability].map((value) => (value ? "1" : "0")).join("")
    : null
  return { ready: Boolean(user), key: [user?.sub ?? "anonymous", permissions ?? ""] as const }
}

const usabilityRoot = ["admin", "usability"] as const

export function useUsabilityContextQuery() {
  const viewer = useViewerKey()
  return useQuery({ queryKey: [...usabilityRoot, ...viewer.key, "context"], queryFn: fetchUsabilityContext, enabled: viewer.ready, staleTime: 60_000 })
}

export function useUsabilityTabQuery<T extends UsabilityTab>(tab: T, query: UsabilityQuery, enabled = true) {
  const viewer = useViewerKey()
  return useQuery({
    queryKey: [...usabilityRoot, ...viewer.key, "tab", tab, query],
    queryFn: () => fetchUsabilityTab(tab, query),
    enabled: viewer.ready && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (failures, error) => failures < 2 && !(error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"),
  })
}

export function useUsabilityPersonQuery(personId: string, query: UsabilityQuery) {
  const viewer = useViewerKey()
  return useQuery({ queryKey: [...usabilityRoot, ...viewer.key, "person", personId, query], queryFn: () => fetchUsabilityPerson(personId, query), enabled: viewer.ready, retry: false })
}

export function useUsabilityTimelineQuery(personId: string, query: UsabilityQuery, enabled: boolean) {
  const viewer = useViewerKey()
  return useQuery({ queryKey: [...usabilityRoot, ...viewer.key, "timeline", personId, query], queryFn: () => fetchUsabilityTimeline(personId, query), enabled: viewer.ready && enabled, placeholderData: keepPreviousData, retry: false })
}

export function useUsabilityPeopleSearch(search: string) {
  const viewer = useViewerKey()
  const term = search.trim()
  return useQuery({ queryKey: [...usabilityRoot, ...viewer.key, "people-options", term], queryFn: () => searchUsabilityPeople(term), enabled: viewer.ready && term.length >= 2, staleTime: 30_000 })
}

const invalidateKey = usabilityRoot

export const useUpdateUsabilitySettingsMutation = () => useAdminMutation({ mutationFn: updateUsabilitySettings, invalidateKey, successMessage: "Configuração da monitoria salva." })
export const useClassifyUsabilityPersonMutation = () => useAdminMutation({ mutationFn: classifyUsabilityPerson, invalidateKey, successMessage: "Classificação registrada." })
export const useUnclassifyUsabilityPersonMutation = () => useAdminMutation({ mutationFn: ({ personId, reason }: { personId: string; reason: string }) => unclassifyUsabilityPerson(personId, reason), invalidateKey, successMessage: "Classificação removida." })
export const useReprocessUsabilityMutation = () => useAdminMutation({ mutationFn: reprocessUsability, invalidateKey, successMessage: "Reprocessamento agendado." })
