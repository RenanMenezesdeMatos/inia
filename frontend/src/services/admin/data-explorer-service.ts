import { adminGet, adminPostForBlob, adminSend, AdminApiError } from "@/lib/admin/admin-api"
import {
  cancellationListSchema,
  cancellationPreviewSchema,
  cancellationResultSchema,
  deletedItemListSchema,
  explorerCatalogSchema,
  explorerCountSchema,
  explorerDatasetSchema,
  explorerPageSchema,
  reactivationPreviewSchema,
  reactivationResultSchema,
  restorationPreviewSchema,
  restorationResultSchema,
  type CancellationList,
  type CancellationPreview,
  type CancellationResult,
  type CancellationScope,
  type DeletedItemList,
  type ExplorerCatalog,
  type ExplorerCount,
  type ExplorerDataset,
  type ExplorerPage,
  type ExplorerRequest,
  type ReactivationPreview,
  type ReactivationResult,
  type RestorationPreview,
  type RestorationResult,
} from "@/schemas/admin/data-explorer.schema"

const BASE = "/api/v1/admin/data-explorer"

export async function fetchExplorerCatalog(): Promise<ExplorerCatalog> {
  return explorerCatalogSchema.parse(await adminGet<unknown>(`${BASE}/datasets`))
}

export async function fetchExplorerDataset(code: string): Promise<ExplorerDataset> {
  return explorerDatasetSchema.parse(await adminGet<unknown>(`${BASE}/datasets/${encodeURIComponent(code)}`))
}

export async function runExplorerQuery(request: ExplorerRequest): Promise<ExplorerPage> {
  return explorerPageSchema.parse(await adminSend<unknown>(`${BASE}/query`, "POST", request))
}

export async function runExplorerCount(request: ExplorerRequest): Promise<ExplorerCount> {
  return explorerCountSchema.parse(await adminSend<unknown>(`${BASE}/count`, "POST", request))
}

/** Exportação: se o servidor cortar a conexão no meio (limite de tamanho ou de tempo), o `blob()` falha, e nunca sobra arquivo cortado para baixar. */
export async function exportExplorerCsv(request: ExplorerRequest): Promise<{ blob: Blob; filename: string | null }> {
  try {
    return await adminPostForBlob(`${BASE}/export`, request)
  } catch (error) {
    if (error instanceof AdminApiError) throw error
    throw new AdminApiError("A exportação foi interrompida antes de terminar. Restrinja os filtros e tente de novo.", "DATA_EXPLORER_EXPORT_INTERRUPTED")
  }
}

export async function previewRecordCancellation(scope: CancellationScope): Promise<CancellationPreview> {
  return cancellationPreviewSchema.parse(await adminSend<unknown>(`${BASE}/cancellations/preview`, "POST", scope))
}

/** `expectedFingerprint` é o que a prévia mostrou: se os registros mudaram, o servidor recusa, e nada é cancelado sem a pessoa ver de novo. */
export async function cancelRecords(input: CancellationScope & { reason: string; expectedFingerprint: string }): Promise<CancellationResult> {
  return cancellationResultSchema.parse(await adminSend<unknown>(`${BASE}/cancellations`, "POST", input))
}

export async function fetchCancellations(dataset: string): Promise<CancellationList> {
  return cancellationListSchema.parse(await adminGet<unknown>(`${BASE}/cancellations?dataset=${encodeURIComponent(dataset)}`))
}

export async function previewReactivation(id: string): Promise<ReactivationPreview> {
  return reactivationPreviewSchema.parse(await adminGet<unknown>(`${BASE}/cancellations/${encodeURIComponent(id)}/reactivation`))
}

export async function fetchDeletedItems(filters: { type?: string | undefined; search?: string | undefined }): Promise<DeletedItemList> {
  const query = new URLSearchParams()
  if (filters.type) query.set("type", filters.type)
  if (filters.search) query.set("search", filters.search)
  const suffix = query.size > 0 ? `?${query.toString()}` : ""
  return deletedItemListSchema.parse(await adminGet<unknown>(`${BASE}/deleted-items${suffix}`))
}

const restorationPath = (type: string, id: string) => `${BASE}/deleted-items/${encodeURIComponent(type)}/${encodeURIComponent(id)}/restoration`

export async function previewRestoration(type: string, id: string): Promise<RestorationPreview> {
  return restorationPreviewSchema.parse(await adminGet<unknown>(restorationPath(type, id)))
}

export async function restoreDeletedItem(type: string, id: string): Promise<RestorationResult> {
  return restorationResultSchema.parse(await adminSend<unknown>(restorationPath(type, id), "POST", {}))
}

export async function reactivateRecords(id: string, expectedRows: number): Promise<ReactivationResult> {
  return reactivationResultSchema.parse(await adminSend<unknown>(`${BASE}/cancellations/${encodeURIComponent(id)}/reactivation`, "POST", { expectedRows }))
}
