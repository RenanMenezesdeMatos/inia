import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createUserAccount,
  fetchUserAccounts,
  fetchCreationPolicy,
  fetchUserAccountsPage,
  fetchUserDetail,
  linkUserToSourcePerson,
  updateUserActive,
  updateUserDetails,
  updateUserRole,
  type UserListParams,
} from "@/services/admin/user-account-service"
import type { PlatformRole } from "@/schemas/auth/auth.schema"

import { accessQueryRootKey } from "@/queries/access/use-access"

import { adminQueryKeys } from "./admin-query-keys"

export function useUserAccountsQuery() {
  return useQuery({ queryKey: adminQueryKeys.users(), queryFn: fetchUserAccounts })
}

export function useUserAccountsPageQuery(params: UserListParams) {
  return useQuery({ queryKey: adminQueryKeys.usersList(params), queryFn: () => fetchUserAccountsPage(params), placeholderData: keepPreviousData })
}

export function useUserDetailQuery(personId: string | null) {
  return useQuery({ queryKey: adminQueryKeys.userDetail(personId ?? ""), queryFn: () => fetchUserDetail(personId!), enabled: personId !== null })
}

export function useCreationPolicyQuery(enabled: boolean) {
  return useQuery({ queryKey: [...adminQueryKeys.users(), "creation-policy"] as const, queryFn: fetchCreationPolicy, enabled })
}

export function useCreateUserAccountMutation() {
  return useAdminMutation({
    mutationFn: createUserAccount,
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Usuário criado.",
    // Matrícula que já existe: a tela mostra a saída ("Habilitar acesso" da pessoa) no próprio formulário.
    silentErrorCodes: ["PERSON_MATRICULA_IN_USE"],
  })
}

/** Vincular à pessoa da base: muda pessoas E acessos (a conta trocou de pessoa). */
export function useLinkUserToSourcePersonMutation(personId: string) {
  const queryClient = useQueryClient()
  return useAdminMutation({
    mutationFn: (targetPersonId: string) => linkUserToSourcePerson(personId, targetPersonId),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Pessoa vinculada à base. A conta e os papéis foram para a pessoa da base.",
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: accessQueryRootKey }),
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
