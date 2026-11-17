import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import type { AlignmentDetail, AlignmentFormValues, AlignmentRelation } from "@/schemas/operational-alignments/operational-alignment.schema"
import {
  createAlignment,
  deleteAlignment,
  discardAlignmentDraft,
  endAlignment,
  fetchAffectedAssessments,
  fetchAlignment,
  createReason,
  createRequestReason,
  fetchAlignmentsPage,
  fetchReasons,
  fetchRequestReasons,
  updateReason,
  fetchProcessOptions,
  fetchAlignmentScopeOptions,
  fetchPublicationPreview,
  publishAlignment,
  saveAlignmentDraft,
  type AlignmentListParams,
  type ProcessOptionParams, fetchResponsibleOptions } from "@/services/operational-alignments/operational-alignment-service"

export const alignmentKeys = {
  all: ["admin", "operational-alignments"] as const,
  list: (params: AlignmentListParams) => [...alignmentKeys.all, "list", params] as const,
  processes: (params: ProcessOptionParams) => [...alignmentKeys.all, "processes", params] as const,
  detail: (id: string) => [...alignmentKeys.all, "detail", id] as const,
  scopeOptions: () => [...alignmentKeys.all, "scope-options"] as const,
  preview: (id: string) => [...alignmentKeys.all, "preview", id] as const,
  affected: (id: string) => [...alignmentKeys.all, "affected", id] as const,
  reasons: () => [...alignmentKeys.all, "reasons"] as const,
  requestReasons: () => [...alignmentKeys.all, "request-reasons"] as const,
}

export function useAlignmentsPageQuery(params: AlignmentListParams) {
  return useQuery({ queryKey: alignmentKeys.list(params), queryFn: () => fetchAlignmentsPage(params), placeholderData: keepPreviousData })
}
/** Seletor de processos: cada busca/página é uma consulta ao servidor; a anterior fica na tela enquanto a próxima chega. */
export function useProcessOptionsQuery(params: ProcessOptionParams, enabled = true) {
  return useQuery({ queryKey: alignmentKeys.processes(params), queryFn: () => fetchProcessOptions(params), placeholderData: keepPreviousData, enabled })
}
export function useAlignmentQuery(id: string | null) {
  return useQuery({ queryKey: alignmentKeys.detail(id ?? ""), queryFn: () => fetchAlignment(id!), enabled: id !== null })
}
export function useAlignmentScopeOptionsQuery() {
  return useQuery({ queryKey: alignmentKeys.scopeOptions(), queryFn: fetchAlignmentScopeOptions })
}
export function usePublicationPreviewQuery(id: string | null) {
  return useQuery({ queryKey: alignmentKeys.preview(id ?? ""), queryFn: () => fetchPublicationPreview(id!), enabled: id !== null, staleTime: 0 })
}
export function useAffectedAssessmentsQuery(id: string | null) {
  return useQuery({ queryKey: alignmentKeys.affected(id ?? ""), queryFn: () => fetchAffectedAssessments(id!), enabled: id !== null })
}

function useStoreDetail() {
  const queryClient = useQueryClient()
  return (detail: AlignmentDetail) => queryClient.setQueryData(alignmentKeys.detail(detail.id), detail)
}

export function useCreateAlignmentMutation() {
  const store = useStoreDetail()
  return useAdminMutation({ mutationFn: createAlignment, invalidateKey: alignmentKeys.all, successMessage: "Alinhamento salvo como rascunho.", silentErrors: true, onSuccess: store })
}
export function useSaveAlignmentDraftMutation() {
  const store = useStoreDetail()
  return useAdminMutation({ mutationFn: ({ id, values }: { id: string; values: AlignmentFormValues }) => saveAlignmentDraft(id, values), invalidateKey: alignmentKeys.all, successMessage: "Rascunho salvo.", silentErrors: true, onSuccess: store })
}
export function useDiscardAlignmentDraftMutation() {
  return useAdminMutation({ mutationFn: discardAlignmentDraft, invalidateKey: alignmentKeys.all, successMessage: "Rascunho descartado." })
}
/** Conflito, relação pendente e assunto proibido aparecem no próprio diálogo — sem toast repetindo. */
export function usePublishAlignmentMutation() {
  const store = useStoreDetail()
  return useAdminMutation({
    mutationFn: ({ id, relations }: { id: string; relations: { alignmentId: string; relation: AlignmentRelation }[] }) => publishAlignment(id, relations),
    invalidateKey: alignmentKeys.all,
    successMessage: "Alinhamento publicado.",
    silentErrors: true,
    onSuccess: store,
  })
}
/** Exclusão lógica: deixa de valer agora e sai da lista (volta por Consultar dados › Itens excluídos). */
export function useDeleteAlignmentMutation() {
  return useAdminMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => deleteAlignment(id, reason), invalidateKey: alignmentKeys.all, successMessage: "Alinhamento excluído. Deixou de valer a partir de agora." })
}
export function useEndAlignmentMutation() {
  const store = useStoreDetail()
  return useAdminMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => endAlignment(id, reason), invalidateKey: alignmentKeys.all, successMessage: "Alinhamento encerrado.", onSuccess: store })
}

export function useAlignmentReasonsQuery() {
  return useQuery({ queryKey: alignmentKeys.reasons(), queryFn: fetchReasons })
}
export function useRequestReasonsQuery() {
  return useQuery({ queryKey: alignmentKeys.requestReasons(), queryFn: fetchRequestReasons })
}
export function useCreateReasonMutation() {
  return useAdminMutation({ mutationFn: createReason, invalidateKey: alignmentKeys.reasons(), successMessage: "Motivo incluído." })
}
export function useUpdateReasonMutation() {
  return useAdminMutation({ mutationFn: ({ id, input }: { id: string; input: { name?: string; active?: boolean } }) => updateReason(id, input), invalidateKey: alignmentKeys.reasons(), successMessage: "Motivo atualizado." })
}
export function useCreateRequestReasonMutation() {
  return useAdminMutation({ mutationFn: createRequestReason, invalidateKey: alignmentKeys.requestReasons(), successMessage: "Pedido do cliente incluído." })
}

/** Responsável pela orientação: busca no servidor (lideranças ativas), atualizada conforme o nome digitado. */
export function useResponsibleOptionsQuery(search: string, enabled = true) {
  return useQuery({ queryKey: ["operational-alignments", "responsible-options", search], queryFn: () => fetchResponsibleOptions(search), enabled, staleTime: 60_000 })
}

