import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createUserAccount,
  fetchUserAccounts,
  fetchUserAccountsPage,
  updateUserActive,
  updateUserDetails,
  updateUserRole,
  type UserListParams,
} from "@/services/admin/user-account-service"
import type { PlatformRole } from "@/schemas/auth/auth.schema"

import { adminQueryKeys } from "./admin-query-keys"

export function useUserAccountsQuery() {
  return useQuery({ queryKey: adminQueryKeys.users(), queryFn: fetchUserAccounts })
}

export function useUserAccountsPageQuery(params: UserListParams) {
  return useQuery({ queryKey: adminQueryKeys.usersList(params), queryFn: () => fetchUserAccountsPage(params), placeholderData: keepPreviousData })
}

export function useCreateUserAccountMutation() {
  return useAdminMutation({
    mutationFn: createUserAccount,
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Usuário criado.",
  })
}

export function useUpdateUserDetailsMutation() {
  return useAdminMutation({
    mutationFn: updateUserDetails,
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Usuário atualizado.",
  })
}

export function useUpdateUserRoleMutation() {
  return useAdminMutation({
    mutationFn: ({ personId, role }: { personId: string; role: PlatformRole }) => updateUserRole(personId, role),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Perfil atualizado.",
  })
}

export function useUpdateUserActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ personId, active }: { personId: string; active: boolean }) => updateUserActive(personId, active),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Status atualizado.",
  })
}
