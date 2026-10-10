import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  fetchKnowledgeDocument,
  fetchKnowledgeDocumentPreview,
  fetchKnowledgeDocuments,
  fetchKnowledgeDocumentsPage,
  fetchKnowledgeFile,
  setKnowledgeDocumentStatus,
  updateKnowledgeDocument,
  type KnowledgeListParams,
  type UpdateKnowledgeInput,
} from "@/services/admin/knowledge-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useKnowledgeDocumentsQuery() {
  return useQuery({ queryKey: adminQueryKeys.knowledge(), queryFn: fetchKnowledgeDocuments })
}

// Listagem paginada/filtrada. keepPreviousData mantém a página anterior na tela enquanto a
// próxima carrega, em vez de piscar o skeleton a cada troca de página ou filtro.
export function useKnowledgeDocumentsPageQuery(params: KnowledgeListParams) {
  return useQuery({
    queryKey: adminQueryKeys.knowledgeList(params),
    queryFn: () => fetchKnowledgeDocumentsPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useKnowledgeDocumentQuery(id: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), id],
    queryFn: () => fetchKnowledgeDocument(id!),
    enabled: id !== null,
  })
}

// Binário do arquivo original — não muda depois do upload, então fica em cache enquanto a página
// de visualização estiver aberta em vez de ser baixado de novo a cada zoom/troca de página.
export function useKnowledgeFileQuery(id: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), id, "file"],
    queryFn: () => fetchKnowledgeFile(id!),
    enabled: id !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useKnowledgeDocumentPreviewQuery(id: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), id, "preview"],
    queryFn: () => fetchKnowledgeDocumentPreview(id!),
    enabled: id !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useCreateKnowledgeDocumentMutation() {
  return useAdminMutation({
    mutationFn: createKnowledgeDocument,
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: "Base de conhecimento criada.",
  })
}

export function useUpdateKnowledgeDocumentMutation() {
  return useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKnowledgeInput }) => updateKnowledgeDocument(id, input),
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: "Base de conhecimento atualizada.",
  })
}

export function useSetKnowledgeDocumentStatusMutation() {
  return useAdminMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => setKnowledgeDocumentStatus(id, status),
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: "Status atualizado.",
  })
}

export function useDeleteKnowledgeDocumentMutation() {
  return useAdminMutation({
    mutationFn: deleteKnowledgeDocument,
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: "Base de conhecimento excluída.",
  })
}
