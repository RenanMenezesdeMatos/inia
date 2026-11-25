import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createUserAccount,
  fetchCreationPolicy,
  fetchJobPositionOptions,
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
import { keepSameList } from "@/queries/scope-units/keep-same-list"

import { adminQueryKeys } from "./admin-query-keys"

/** Recorte de um seletor de pessoas: nível, Grupos, universo (os ainda sem universo continuam) e só ativas. */
export type UserOptionsSearch = { search?: string | undefined; role?: PlatformRole | undefined; teamIds?: string[] | undefined; universe?: string | null | undefined; active?: boolean | undefined }
const USER_OPTIONS_PAGE = 30
const userOptionsParams = ({ search, role, teamIds, universe, active }: UserOptionsSearch) => ({
  ...(search ? { search } : {}),
  role: role ? [role] : [],
  ...(teamIds ? { teamIds } : {}),
  ...(universe ? { operatingUniverse: [universe, "PENDING"] as UserListParams["operatingUniverse"] } : {}),
  ...(active !== undefined ? { active } : {}),
  lastLoginAt: {},
})

/** Pessoas de um seletor, em lotes. Só busca com o seletor aberto (`enabled`). */
export function useUserOptionsInfiniteQuery(search: UserOptionsSearch, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...adminQueryKeys.users(), "options", search] as const,
    queryFn: ({ pageParam, signal }) => fetchUserAccountsPage({ ...userOptionsParams(search), page: pageParam, pageSize: USER_OPTIONS_PAGE }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepSameList(search),
    enabled,
    staleTime: 30_000,
  })
}

/** Uma pessoa já escolhida, mesmo fora do lote carregado; fora do escopo não volta. */
export function useUserOptionQuery(id: string | null | undefined) {
  return useQuery({ queryKey: [...adminQueryKeys.users(), "option", id ?? ""] as const, queryFn: async () => (await fetchUserAccountsPage({ ...userOptionsParams({}), ids: [id!], page: 1, pageSize: 1 })).items[0] ?? null, enabled: Boolean(id), staleTime: 30_000 })
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

export function useJobPositionOptionsQuery(enabled = true) {
  return useQuery({ queryKey: [...adminQueryKeys.users(), "job-positions"] as const, queryFn: fetchJobPositionOptions, enabled, staleTime: 0 })
}

/** Mudou uma pessoa ou a conta dela: a aba Acessos mostra os mesmos dados. */
function useInvalidateAccessList() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: accessQueryRootKey })
}

export function useCreateUserAccountMutation() {
  const invalidateAccess = useInvalidateAccessList()
  return useAdminMutation({
    onSuccess: invalidateAccess,
    mutationFn: createUserAccount,
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Usuário criado.",
    // Matrícula que já existe: a tela mostra a saída ("Habilitar acesso" da pessoa) no próprio formulário.
    silentErrorCodes: ["PERSON_MATRICULA_IN_USE"],
  })
}

/** Vincular à pessoa da base: muda pessoas E acessos (a conta trocou de pessoa). */
export function useLinkUserToSourcePersonMutation(personId: string) {
  const invalidateAccess = useInvalidateAccessList()
  return useAdminMutation({
    mutationFn: (targetPersonId: string) => linkUserToSourcePerson(personId, targetPersonId),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Pessoa vinculada à base. A conta e os papéis foram para a pessoa da base.",
    onSuccess: invalidateAccess,
  })
}

export function useUpdateUserDetailsMutation() {
  const invalidateAccess = useInvalidateAccessList()
  return useAdminMutation({
    onSuccess: invalidateAccess,
    mutationFn: updateUserDetails,
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Usuário atualizado.",
  })
}

export function useUpdateUserRoleMutation() {
  const invalidateAccess = useInvalidateAccessList()
  return useAdminMutation({
    onSuccess: invalidateAccess,
    mutationFn: ({ personId, ...position }: { personId: string; role: PlatformRole; jobPositionId: string | null }) => updateUserRole(personId, position),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Cargo atualizado.",
  })
}

export function useUpdateUserActiveMutation() {
  const invalidateAccess = useInvalidateAccessList()
  return useAdminMutation({
    onSuccess: invalidateAccess,
    mutationFn: ({ personId, active }: { personId: string; active: boolean }) => updateUserActive(personId, active),
    invalidateKey: adminQueryKeys.users(),
    successMessage: "Status atualizado.",
  })
}
