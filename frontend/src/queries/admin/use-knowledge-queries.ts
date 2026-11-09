import { useEffect, useRef } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { AdminApiError } from "@/lib/admin/admin-api"
import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { isKnowledgeBusy, type KnowledgeDocumentDetail, type KnowledgeDocumentUpdate } from "@/schemas/admin/knowledge.schema"
import {
  archiveKnowledgeDocument,
  compareKnowledgeVersions,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  discardKnowledgeDraft,
  fetchKnowledgeAiPreview,
  fetchKnowledgeDocument,
  fetchKnowledgeDocumentPreview,
  fetchKnowledgeDocuments,
  fetchKnowledgeDocumentsPage,
  fetchKnowledgeFile,
  fetchKnowledgeVersion,
  fetchKnowledgeVersionFile,
  fetchKnowledgeVersionPreview,
  fetchKnowledgeVersions,
  publishKnowledgeDocument,
  reactivateKnowledgeDocument,
  reprocessKnowledgeDocument,
  replaceKnowledgeDraftFile,
  retryKnowledgeVersion,
  revertKnowledgeVersion,
  updateKnowledgeDocument,
  type KnowledgeListParams,
  type PublishKnowledgeInput,
  type RevertKnowledgeInput,
  type UpdateKnowledgeInput,
} from "@/services/admin/knowledge-service"

import { adminQueryKeys } from "./admin-query-keys"

const PROCESSING_REFETCH_MS = 3_000

const detailKey = (id: string | null) => [...adminQueryKeys.knowledge(), id] as const

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

/** Detalhe da base. Enquanto uma atualização estiver em processamento ou o PDF digitalizado estiver sendo lido, atualiza sozinho e para quando termina. */
export function useKnowledgeDocumentQuery(id: string | null) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: () => fetchKnowledgeDocument(id!),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data && isKnowledgeBusy(query.state.data) ? PROCESSING_REFETCH_MS : false),
  })
}

/**
 * Quando uma atualização termina sem nenhuma ação na tela, a lista e o histórico em cache ainda mostram "Processando": atualiza o que
 * depende da base (arquivo e prévia são por versão, então a versão nova nunca reaproveita o binário da anterior).
 */
export function useRefreshKnowledgeWhenProcessingEnds(detail: KnowledgeDocumentDetail | undefined) {
  const queryClient = useQueryClient()
  const processing = detail ? isKnowledgeBusy(detail) : false
  const wasProcessing = useRef(false)
  useEffect(() => {
    if (wasProcessing.current && !processing) void queryClient.invalidateQueries({ queryKey: adminQueryKeys.knowledge() })
    wasProcessing.current = processing
  }, [processing, queryClient])
}

/** De qual versão vem o arquivo. A versão em uso continua pelas rotas de sempre (`/file`, `/preview`); as demais, pelas rotas da versão. */
export type KnowledgeFileRef = { documentId: string; versionId: string; inUse: boolean }

// Binário do arquivo original — não muda depois do upload, então fica em cache enquanto a página
// de visualização estiver aberta em vez de ser baixado de novo a cada zoom/troca de página.
export function useKnowledgeFileQuery(ref: KnowledgeFileRef | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), ref?.documentId ?? null, "file", ref?.versionId ?? null],
    queryFn: () => (ref!.inUse ? fetchKnowledgeFile(ref!.documentId) : fetchKnowledgeVersionFile(ref!.documentId, ref!.versionId)),
    enabled: ref !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useKnowledgeDocumentPreviewQuery(ref: KnowledgeFileRef | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), ref?.documentId ?? null, "preview", ref?.versionId ?? null],
    queryFn: () => (ref!.inUse ? fetchKnowledgeDocumentPreview(ref!.documentId) : fetchKnowledgeVersionPreview(ref!.documentId, ref!.versionId)),
    enabled: ref !== null,
    staleTime: Infinity,
    retry: false,
  })
}

export function useKnowledgeVersionsQuery(id: string) {
  return useQuery({ queryKey: [...adminQueryKeys.knowledge(), id, "versions"], queryFn: () => fetchKnowledgeVersions(id) })
}

export function useKnowledgeVersionQuery(documentId: string, versionId: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), documentId, "versions", versionId],
    queryFn: () => fetchKnowledgeVersion(documentId, versionId!),
    enabled: versionId !== null,
    retry: false,
  })
}

export function useKnowledgeAiPreviewQuery(documentId: string, versionId: string | null) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), documentId, "versions", versionId, "ai-preview"],
    queryFn: () => fetchKnowledgeAiPreview(documentId, versionId!),
    enabled: versionId !== null,
    retry: false,
  })
}

export function useKnowledgeVersionComparisonQuery(documentId: string, fromVersionId: string, toVersionId: string) {
  return useQuery({
    queryKey: [...adminQueryKeys.knowledge(), documentId, "compare", fromVersionId, toVersionId],
    queryFn: () => compareKnowledgeVersions(documentId, fromVersionId, toVersionId),
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

/**
 * O aviso depende do que aconteceu de verdade: a API processa na hora quando consegue, então a resposta pode já vir pronta, ainda em
 * processamento ou com falha. Nunca diz que uma versão está em uso só porque a publicação foi pedida.
 */
function announceKnowledgeOutcome(detail: KnowledgeDocumentDetail, update: KnowledgeDocumentUpdate | undefined = detail.updates[0]) {
  if (update?.status === "FAILED") {
    toast.error(`A V${update.version} não ficou pronta${update.errorMessage ? `: ${update.errorMessage}` : "."}`)
    return
  }
  if (update?.status === "PROCESSING") {
    toast.success(`V${update.version} em processamento: a IA passa a usá-la quando ficar pronta.`)
    return
  }
  if (detail.inUse) toast.success(`V${detail.inUse.version} em uso pela IA.`)
}

/** Ações do ciclo de vida: a resposta já é o detalhe atualizado. Um 409 quer dizer que a base mudou: atualiza a tela para mostrar como ela está. */
function useKnowledgeLifecycleMutation<TVariables>(options: {
  mutationFn: (variables: TVariables) => Promise<KnowledgeDocumentDetail>
  successMessage?: string
  announceOutcome?: boolean
  silentErrorCodes?: string[]
  onSaved?: (detail: KnowledgeDocumentDetail, variables: TVariables) => void
}) {
  const queryClient = useQueryClient()
  return useAdminMutation<KnowledgeDocumentDetail, TVariables>({
    mutationFn: options.mutationFn,
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: options.successMessage,
    silentErrorCodes: options.silentErrorCodes,
    onSuccess: (detail, variables) => {
      queryClient.setQueryData(detailKey(detail.id), detail)
      if (options.announceOutcome) announceKnowledgeOutcome(detail)
      options.onSaved?.(detail, variables)
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code?.startsWith("KNOWLEDGE_")) void queryClient.invalidateQueries({ queryKey: adminQueryKeys.knowledge() })
    },
  })
}

export function useUpdateKnowledgeDocumentMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKnowledgeInput }) => updateKnowledgeDocument(id, input),
    onSaved: (detail) => {
      if (!detail.draft) {
        toast.success("Nada mudou em relação à versão atual: nenhum rascunho foi criado.")
        return
      }
      toast.success(detail.inUse ? `Rascunho V${detail.draft.version} salvo. A IA continua usando a V${detail.inUse.version}.` : `Rascunho V${detail.draft.version} salvo. Ainda não está disponível para a IA.`)
    },
  })
}

export function useReplaceKnowledgeDraftFileMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => replaceKnowledgeDraftFile(id, file),
    successMessage: "Arquivo trocado no rascunho. O que a IA usa não mudou.",
  })
}

export function usePublishKnowledgeMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, input }: { id: string; input: PublishKnowledgeInput }) => publishKnowledgeDocument(id, input),
    announceOutcome: true,
    silentErrorCodes: ["KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED", "KNOWLEDGE_NOTHING_TO_PUBLISH"],
  })
}

export function useArchiveKnowledgeMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: archiveKnowledgeDocument,
    successMessage: "Base arquivada: a IA deixou de consultá-la. O rascunho, se houver, foi mantido.",
  })
}

export function useReactivateKnowledgeMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: reactivateKnowledgeDocument,
    silentErrorCodes: ["KNOWLEDGE_NOT_ARCHIVED"],
    // Uma falha antiga por cima da versão reativada não tira o sucesso da reativação.
    onSaved: (detail) => {
      if (detail.inUse) toast.success(`Base reativada: V${detail.inUse.version} em uso pela IA.`)
      else announceKnowledgeOutcome(detail)
    },
  })
}

export function useDiscardKnowledgeDraftMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: discardKnowledgeDraft,
    successMessage: "Rascunho descartado. O que a IA usa não mudou.",
    silentErrorCodes: ["KNOWLEDGE_DRAFT_ONLY", "KNOWLEDGE_NO_DRAFT"],
  })
}

export function useReprocessKnowledgeMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, overwriteDraft }: { id: string; overwriteDraft?: boolean }) => reprocessKnowledgeDocument(id, overwriteDraft ? { overwriteDraft: true } : {}),
    silentErrorCodes: ["KNOWLEDGE_DRAFT_PENDING"],
  })
}

export function useRetryKnowledgeVersionMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, versionId, reactivate }: { id: string; versionId: string; reactivate?: boolean }) => retryKnowledgeVersion(id, versionId, reactivate ? { reactivate: true } : {}),
    silentErrorCodes: ["KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED"],
    onSaved: (detail, { versionId }) => announceKnowledgeOutcome(detail, detail.updates.find((update) => update.id === versionId)),
  })
}

export function useRevertKnowledgeVersionMutation() {
  return useKnowledgeLifecycleMutation({
    mutationFn: ({ id, versionId, input }: { id: string; versionId: string; input: RevertKnowledgeInput }) => revertKnowledgeVersion(id, versionId, input),
    announceOutcome: true,
    silentErrorCodes: ["KNOWLEDGE_DRAFT_PENDING", "KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED", "KNOWLEDGE_VERSION_ALREADY_CURRENT", "KNOWLEDGE_VERSION_NOT_REVERTIBLE"],
  })
}

export function useDeleteKnowledgeDocumentMutation() {
  return useAdminMutation({
    mutationFn: deleteKnowledgeDocument,
    invalidateKey: adminQueryKeys.knowledge(),
    successMessage: "Base de conhecimento excluída.",
  })
}
