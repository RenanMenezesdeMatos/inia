import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { fetchUserShift, updateUserShift } from "@/services/admin/user-account-service"

import { adminQueryKeys } from "./admin-query-keys"

/** Jornada PREVISTA do colaborador (evolução do Trigger "Por agenda" relativo ao expediente). */
export function useUserShiftQuery(personId: string) {
  return useQuery({
    queryKey: adminQueryKeys.userShift(personId),
    queryFn: () => fetchUserShift(personId),
    enabled: Boolean(personId),
  })
}

export function useUpdateUserShiftMutation(personId: string) {
  return useAdminMutation({
    mutationFn: updateUserShift,
    invalidateKey: adminQueryKeys.userShift(personId),
    successMessage: "Jornada atualizada.",
  })
}
