import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions } from "@tanstack/react-query"
import { toast } from "sonner"

import { AdminApiError } from "@/lib/admin/admin-api"

type AdminMutationOptions<TData, TVariables> = Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn"> & {
  mutationFn: (variables: TVariables) => Promise<TData>
  invalidateKey: QueryKey
  successMessage?: string
  /** Códigos de erro que a tela trata sozinha (ex.: um 409 que vira diálogo de confirmação) —
   * sem toast, para não avisar duas vezes a mesma coisa. */
  silentErrorCodes?: string[]
}

export function useAdminMutation<TData, TVariables>({
  mutationFn,
  invalidateKey,
  successMessage,
  silentErrorCodes,
  onSuccess,
  onError,
  ...options
}: AdminMutationOptions<TData, TVariables>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: invalidateKey })
      if (successMessage) toast.success(successMessage)
      onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: (error, variables, onMutateResult, context) => {
      const silent = error instanceof AdminApiError && error.code !== null && silentErrorCodes?.includes(error.code)
      if (!silent) toast.error(error instanceof AdminApiError ? error.message : "Não foi possível concluir a ação.")
      onError?.(error, variables, onMutateResult, context)
    },
    ...options,
  })
}
