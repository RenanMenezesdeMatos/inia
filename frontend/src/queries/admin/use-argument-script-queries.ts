import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { ArgumentScriptDetail } from "@/schemas/admin/argument-script.schema"
import {
  archiveArgumentScript,
  createArgumentScript,
  deleteArgumentScript,
  discardArgumentScriptDraft,
  fetchArgumentScript,
  fetchArgumentScriptScopeOptions,
  fetchArgumentScriptsPage,
  publishArgumentScript,
  reactivateArgumentScript,
  updateArgumentScript,
  type ArgumentScriptListParams,
  type UpdateArgumentScriptInput,
} from "@/services/admin/argument-script-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useArgumentScriptsPageQuery(params: ArgumentScriptListParams) {
  return useQuery({
    queryKey: adminQueryKeys.argumentScriptsList(params),
    queryFn: () => fetchArgumentScriptsPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useArgumentScriptQuery(id: string | null) {
  return useQuery({
    queryKey: adminQueryKeys.argumentScript(id ?? ""),
    queryFn: () => fetchArgumentScript(id!),
    enabled: id !== null,
  })
}

export function useArgumentScriptScopeOptionsQuery() {
  return useQuery({ queryKey: adminQueryKeys.argumentScriptScopeOptions(), queryFn: fetchArgumentScriptScopeOptions })
}

// Toda mutação devolve o detalhe atualizado: ele entra direto no cache (a tela não pisca esperando o refetch) e a key "pai"
// é invalidada para a listagem refletir a mudança.
function useStoreDetail() {
  const queryClient = useQueryClient()
  return (detail: ArgumentScriptDetail) => queryClient.setQueryData(adminQueryKeys.argumentScript(detail.id), detail)
}

export function useCreateArgumentScriptMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: createArgumentScript,
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Argumentário criado como rascunho.",
    onSuccess: storeDetail,
  })
}

export function useUpdateArgumentScriptMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateArgumentScriptInput }) => updateArgumentScript(id, input),
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Rascunho salvo.",
    onSuccess: storeDetail,
  })
}

export function useDiscardArgumentScriptDraftMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: discardArgumentScriptDraft,
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Rascunho descartado.",
    onSuccess: storeDetail,
  })
}

/** Pendências de publicação e data inválida são mostradas no próprio diálogo — sem toast repetindo a mesma coisa. */
export function usePublishArgumentScriptMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: ({ id, effectiveFrom }: { id: string; effectiveFrom?: string }) => publishArgumentScript(id, effectiveFrom ? { effectiveFrom } : {}),
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Argumentário publicado.",
    silentErrorCodes: ["ARGUMENT_SCRIPT_NOT_READY", "ARGUMENT_SCRIPT_RETROACTIVE", "ARGUMENT_SCRIPT_EFFECTIVE_ORDER"],
    onSuccess: storeDetail,
  })
}

export function useArchiveArgumentScriptMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: archiveArgumentScript,
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Argumentário encerrado.",
    onSuccess: storeDetail,
  })
}

export function useReactivateArgumentScriptMutation() {
  const storeDetail = useStoreDetail()
  return useAdminMutation({
    mutationFn: reactivateArgumentScript,
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Argumentário reativado.",
    onSuccess: storeDetail,
  })
}

export function useDeleteArgumentScriptMutation() {
  return useAdminMutation({
    mutationFn: deleteArgumentScript,
    invalidateKey: adminQueryKeys.argumentScripts(),
    successMessage: "Argumentário excluído.",
  })
}
