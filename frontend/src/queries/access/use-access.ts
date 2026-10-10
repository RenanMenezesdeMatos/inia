"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { currentUserKeys } from "@/queries/auth/use-current-user"
import { feedbackReviewKeys } from "@/queries/feedback-review/feedback-review-query-keys"

import type { AccessStatus, AssignRoleInput } from "@/schemas/access/access.schema"
import { assignAccessRole, disableUserAccess, enableUserAccess, fetchAccessAccount, fetchAccessRoles, fetchIdentifiedUsers, fetchScopeOptions, grantRoleToLeaders, issueTemporaryPassword, revokeAccessRole } from "@/services/access/access-service"

const keys = { all: ["admin-access"] as const, users: (params: object) => ["admin-access", "users", params] as const, account: (id: string) => ["admin-access", "account", id] as const, roles: ["admin-access", "roles"] as const, scopes: ["admin-access", "scopes"] as const }

export const useIdentifiedUsersQuery = (params: { search?: string | undefined; status?: AccessStatus | undefined; page: number; pageSize: number }) => useQuery({ queryKey: keys.users(params), queryFn: () => fetchIdentifiedUsers(params), placeholderData: keepPreviousData })
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

export function useGrantRoleToLeadersMutation() {
  const invalidate = useInvalidateAccess()
  return useMutation({ mutationFn: (roleCode: string) => grantRoleToLeaders(roleCode), onSuccess: () => void invalidate() })
}
