import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { CancellationScope, ExplorerRequest } from "@/schemas/admin/data-explorer.schema"
import { cancelRecords, fetchCancellations, fetchDeletedItems, fetchExplorerCatalog, fetchExplorerDataset, previewReactivation, previewRecordCancellation, previewRestoration, reactivateRecords, restoreDeletedItem, runExplorerQuery } from "@/services/admin/data-explorer-service"

/**
 * Cada consulta conta no limite por minuto e grava uma linha de auditoria: só vai ao servidor quando a pessoa pede. Sem refazer ao voltar para a janela e sem
 * nova tentativa automática (um 429 ou uma consulta lenta não melhoram insistindo).
 */
export const dataExplorerKeys = {
  catalog: ["data-explorer", "catalog"] as const,
  dataset: (code: string) => ["data-explorer", "dataset", code] as const,
  page: (request: ExplorerRequest) => ["data-explorer", "page", request] as const,
  pages: ["data-explorer", "page"] as const,
  cancellationPreview: (scope: CancellationScope) => ["data-explorer", "cancellation-preview", scope] as const,
  cancellations: (dataset: string) => ["data-explorer", "cancellations", dataset] as const,
  reactivationPreview: (id: string) => ["data-explorer", "reactivation-preview", id] as const,
  deletedItems: (filters: { type?: string | undefined; search?: string | undefined }) => ["data-explorer", "deleted-items", filters] as const,
  restorationPreview: (type: string, id: string) => ["data-explorer", "restoration-preview", type, id] as const,
}

export function useExplorerCatalogQuery() {
  return useQuery({ queryKey: dataExplorerKeys.catalog, queryFn: fetchExplorerCatalog, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false })
}

export function useExplorerDatasetQuery(code: string | null) {
  return useQuery({ queryKey: dataExplorerKeys.dataset(code ?? ""), queryFn: () => fetchExplorerDataset(code!), enabled: code !== null, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false })
}

export function useExplorerPageQuery(request: ExplorerRequest) {
  return useQuery({
    queryKey: dataExplorerKeys.page(request),
    queryFn: () => runExplorerQuery(request),
    // Mantém a página anterior enquanto a próxima chega, mas nunca as linhas de outro conjunto debaixo das colunas deste.
    placeholderData: (previous, previousQuery) => ((previousQuery?.queryKey[2] as ExplorerRequest | undefined)?.dataset === request.dataset ? previous : undefined),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** Prévia só com o diálogo aberto e sempre nova: a confirmação vale pelo que ela acabou de mostrar. */
export function useCancellationPreviewQuery(scope: CancellationScope, enabled: boolean) {
  return useQuery({ queryKey: dataExplorerKeys.cancellationPreview(scope), queryFn: () => previewRecordCancellation(scope), enabled, staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false })
}

export function useCancellationsQuery(dataset: string, enabled: boolean) {
  return useQuery({ queryKey: dataExplorerKeys.cancellations(dataset), queryFn: () => fetchCancellations(dataset), enabled, staleTime: 30_000, retry: false, refetchOnWindowFocus: false })
}

export function useReactivationPreviewQuery(id: string, enabled: boolean) {
  return useQuery({ queryKey: dataExplorerKeys.reactivationPreview(id), queryFn: () => previewReactivation(id), enabled, staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false })
}

export function useDeletedItemsQuery(filters: { type?: string | undefined; search?: string | undefined }) {
  return useQuery({ queryKey: dataExplorerKeys.deletedItems(filters), queryFn: () => fetchDeletedItems(filters), staleTime: 30_000, retry: false, refetchOnWindowFocus: false })
}

/** Prévia sempre nova: o nome ou o objeto de que este item depende pode ter mudado desde a última vez. */
export function useRestorationPreviewQuery(type: string, id: string) {
  return useQuery({ queryKey: dataExplorerKeys.restorationPreview(type, id), queryFn: () => previewRestoration(type, id), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false })
}

/**
 * O objeto volta para a tela dele, qualquer que seja: tudo fica desatualizado, mas só o que está aberto agora busca de novo. A prévia fica de fora: o diálogo ainda está aberto, e o item
 * que acabou de voltar responderia "não encontrado".
 */
export function useRestoreDeletedItemMutation() {
  const client = useQueryClient()
  return useMutation({ mutationFn: ({ type, id }: { type: string; id: string }) => restoreDeletedItem(type, id), onSuccess: () => client.invalidateQueries({ predicate: (query) => query.queryKey[1] !== "restoration-preview" }) })
}

function useRefreshAfterWrite(dataset: string) {
  const client = useQueryClient()
  return () => Promise.all([client.invalidateQueries({ queryKey: dataExplorerKeys.pages }), client.invalidateQueries({ queryKey: dataExplorerKeys.cancellations(dataset) })])
}

export function useCancelRecordsMutation(dataset: string) {
  const refresh = useRefreshAfterWrite(dataset)
  return useMutation({ mutationFn: (input: Parameters<typeof cancelRecords>[0]) => cancelRecords(input), onSuccess: refresh })
}

export function useReactivateRecordsMutation(dataset: string) {
  const refresh = useRefreshAfterWrite(dataset)
  return useMutation({ mutationFn: ({ id, expectedRows }: { id: string; expectedRows: number }) => reactivateRecords(id, expectedRows), onSuccess: refresh })
}
