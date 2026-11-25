"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import { currentUserKeys } from "@/queries/auth/use-current-user"
import { feedbackReviewKeys } from "@/queries/feedback-review/feedback-review-query-keys"

import type { AssignRoleInput } from "@/schemas/access/access.schema"
import { applyNetworkEnable, assignAccessRole, checkNetworkLogin, disableUserAccess, enableUserAccess, fetchAccessAccount, fetchAccessRoles, fetchIdentifiedUsers, fetchScopeOptions, issueTemporaryPassword, previewNetworkEnable, revokeAccessRole, type IdentifiedUsersParams } from "@/services/access/access-service"

const keys = { all: ["admin-access"] as const, users: (params: object) => ["admin-access", "users", params] as const, account: (id: string) => ["admin-access", "account", id] as const, roles: ["admin-access", "roles"] as const, scopes: ["admin-access", "scopes"] as const }
/** Raiz das queries de acesso — para quem muda contas fora daqui (ex.: vincular a pessoa da base) invalidar. */
export const accessQueryRootKey = keys.all

export const useIdentifiedUsersQuery = (params: IdentifiedUsersParams) => useQuery({ queryKey: keys.users(params), queryFn: () => fetchIdentifiedUsers(params), placeholderData: keepPreviousData })
export const useAccessAccountQuery = (accountId: string | null) => useQuery({ queryKey: keys.account(accountId ?? ""), queryFn: () => fetchAccessAccount(accountId!), enabled: accountId !== null })
export const useAccessRolesQuery = () => useQuery({ queryKey: keys.roles, queryFn: fetchAccessRoles })
export const useScopeOptionsQuery = (enabled: boolean) => useQuery({ queryKey: keys.scopes, queryFn: fetchScopeOptions, enabled })

/**
 * Toda mudança de acesso recarrega a lista e o detalhe (a verdade é o backend, que valida delegação e escopo) E tudo que
 * depende dos papéis de alguém: a sessão (`/auth/me` → menus "Administração"/"QA Lab"), o acesso do QA de feedback e os
 * componentes de servidor (sidebar da Administração, guardas de página) via `router.refresh()` — sem logout, sem esperar
 * o cache (V1.5.8a). Invalidar é barato e a regra fica simples: não adivinhamos se a conta alterada é a própria.
 */
function useInvalidateAccess() {
  const client = useQueryClient()
  const router = useRouter()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: keys.all }),
      // O cadastro de Pessoas mostra a conta de cada um.
      client.invalidateQueries({ queryKey: adminQueryKeys.users() }),
      client.invalidateQueries({ queryKey: currentUserKeys.me }),
      client.invalidateQueries({ queryKey: feedbackReviewKeys.all() }),
    ])
    router.refresh()
  }
}
export function useAssignRoleMutation(accountId: string) {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: (input: AssignRoleInput) => assignAccessRole(accountId, input), onSuccess: () => void invalidate() })
}
export function useRevokeRoleMutation(accountId: string) {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: ({ assignmentId, reason }: { assignmentId: string; reason?: string }) => revokeAccessRole(accountId, assignmentId, reason), onSuccess: () => void invalidate() })
}
// Liberação de acesso. A senha temporária volta só no resultado da mutação (quem chama mostra uma vez e descarta) — nunca
// entra no cache de queries.
export function useEnableUserAccessMutation() {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: ({ personId, email }: { personId: string; email?: string }) => enableUserAccess(personId, email), onSuccess: () => void invalidate() })
}
export function useIssueTemporaryPasswordMutation() {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: (accountId: string) => issueTemporaryPassword(accountId), onSuccess: () => void invalidate() })
}
export function useDisableUserAccessMutation() {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: (accountId: string) => disableUserAccess(accountId), onSuccess: () => void invalidate() })
}
// Habilitar em massa pela rede: a prévia não muda nada; aplicar recarrega acessos (e o cadastro de Pessoas, que mostra a conta).
export const usePreviewNetworkEnableMutation = () => useMutation({ mutationFn: previewNetworkEnable })
export function useApplyNetworkEnableMutation() {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: applyNetworkEnable, onSuccess: () => void invalidate() })
}
export const useCheckNetworkLoginMutation = () => useMutation({ mutationFn: checkNetworkLogin })
