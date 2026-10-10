import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { applyEmploymentStatus, fetchEmploymentStatus, updateUserOperationalCapital } from "@/services/admin/user-account-service"

import { adminQueryKeys } from "./admin-query-keys"

const employmentStatusKey = (personId: string) => [...adminQueryKeys.all, "users", personId, "employment-status"] as const

/** Situação funcional atual + histórico por período do colaborador. */
export function useEmploymentStatusQuery(personId: string) {
  return useQuery({
    queryKey: employmentStatusKey(personId),
    queryFn: () => fetchEmploymentStatus(personId),
    enabled: Boolean(personId),
  })
}

export function useApplyEmploymentStatusMutation(personId: string) {
  return useAdminMutation({
    mutationFn: applyEmploymentStatus,
    invalidateKey: employmentStatusKey(personId),
    successMessage: "Situação registrada.",
  })
}

export function useUpdateOperationalCapitalMutation(personId: string) {
  return useAdminMutation({
    mutationFn: (code: string | null) => updateUserOperationalCapital(personId, code),
    invalidateKey: [...adminQueryKeys.all, "users"] as const,
    successMessage: "Capital operacional atualizada.",
  })
}
