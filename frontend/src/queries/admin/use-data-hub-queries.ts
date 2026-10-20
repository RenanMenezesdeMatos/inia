import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { RUN_ACTIVE_STATUSES } from "@/schemas/admin/data-hub.schema"
import {
  cancelRun,
  createFeed,
  createPushToken,
  createSource,
  deleteFeed,
  deleteSource,
  fetchContract,
  fetchContracts,
  fetchDatabaseColumns,
  fetchDatabaseObjects,
  fetchFeed,
  fetchLineage,
  fetchOverview,
  fetchQuality,
  fetchRejectionsPage,
  fetchRun,
  fetchRunsPage,
  fetchSource,
  fetchSources,
  importFile,
  reprocessRun,
  resetFeedCheckpoint,
  revokePushToken,
  rotatePushToken,
  rotateSourceSecrets,
  setFeedStatus,
  setSourceStatus,
  syncFeedNow,
  testSourceConnection,
  updateFeed,
  updateSource,
  type FeedInput,
  type PushTokenInput,
  type RunListParams,
  type SourceInput,
} from "@/services/admin/data-hub-service"

import { adminQueryKeys } from "./admin-query-keys"

/** Polling curto enquanto há carga em andamento — padrão de status por consulta, sem WebSocket. */
const LIVE_REFETCH_MS = 4000

export function useDataHubOverviewQuery() {
  return useQuery({
    queryKey: adminQueryKeys.dataHubOverview(),
    queryFn: fetchOverview,
    refetchInterval: (query) => (query.state.data?.cards.queuedRuns ? LIVE_REFETCH_MS : 30_000),
  })
}

export function useDataHubQualityQuery() {
  return useQuery({ queryKey: adminQueryKeys.dataHubQuality(), queryFn: fetchQuality })
}

export function useDataContractsQuery() {
  return useQuery({ queryKey: adminQueryKeys.dataHubContracts(), queryFn: fetchContracts, staleTime: 5 * 60_000 })
}

export function useDataContractQuery(key: string | null) {
  return useQuery({ queryKey: adminQueryKeys.dataHubContract(key ?? ""), queryFn: () => fetchContract(key!), enabled: Boolean(key), staleTime: 5 * 60_000 })
}

export function useDataSourcesQuery() {
  return useQuery({ queryKey: adminQueryKeys.dataHubSources(), queryFn: fetchSources, refetchInterval: 30_000 })
}

export function useDataSourceQuery(id: string) {
  return useQuery({ queryKey: adminQueryKeys.dataHubSource(id), queryFn: () => fetchSource(id), refetchInterval: 15_000 })
}

export function useDataFeedQuery(id: string) {
  return useQuery({ queryKey: adminQueryKeys.dataHubFeed(id), queryFn: () => fetchFeed(id) })
}

export function useDataRunsPageQuery(params: RunListParams) {
  return useQuery({
    queryKey: adminQueryKeys.dataHubRunsList(params),
    queryFn: () => fetchRunsPage(params),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((run) => RUN_ACTIVE_STATUSES.includes(run.status)) ? LIVE_REFETCH_MS : false),
  })
}

export function useDataRunQuery(id: string) {
  return useQuery({
    queryKey: adminQueryKeys.dataHubRun(id),
    queryFn: () => fetchRun(id),
    refetchInterval: (query) => (query.state.data && RUN_ACTIVE_STATUSES.includes(query.state.data.status) ? 2000 : false),
  })
}

export function useDataRejectionsPageQuery(runId: string, params: { page: number; pageSize: number; search?: string; errorCode: string[] }) {
  return useQuery({ queryKey: adminQueryKeys.dataHubRejections(runId, params), queryFn: () => fetchRejectionsPage(runId, params), placeholderData: keepPreviousData })
}

export function useLineageQuery(entityType: string, entityId: string | null) {
  return useQuery({ queryKey: adminQueryKeys.dataHubLineage(entityType, entityId ?? ""), queryFn: () => fetchLineage(entityType, entityId!), enabled: Boolean(entityId) })
}

/** Tabelas/visões que o usuário do banco externo pode ler (consulta ao catálogo do próprio banco, zero escrita). */
export function useDatabaseObjectsQuery(sourceId: string | null, search: string) {
  return useQuery({ queryKey: adminQueryKeys.dataHubDatabaseObjects(sourceId ?? "", search), queryFn: () => fetchDatabaseObjects(sourceId!, search), enabled: Boolean(sourceId), placeholderData: keepPreviousData, staleTime: 60_000, retry: false })
}

export function useDatabaseColumnsQuery(sourceId: string | null, object: { schema: string; name: string } | null) {
  return useQuery({ queryKey: adminQueryKeys.dataHubDatabaseColumns(sourceId ?? "", object?.schema ?? "", object?.name ?? ""), queryFn: () => fetchDatabaseColumns(sourceId!, object!), enabled: Boolean(sourceId && object), staleTime: 60_000, retry: false })
}

// ---- Mutações ---------------------------------------------------------------------------------
export function useCreateSourceMutation() {
  return useAdminMutation({ mutationFn: (input: SourceInput) => createSource(input), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Fonte criada." })
}

export function useUpdateSourceMutation() {
  return useAdminMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<SourceInput> }) => updateSource(id, input), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Fonte atualizada." })
}

export function useDeleteSourceMutation() {
  return useAdminMutation({ mutationFn: (id: string) => deleteSource(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Fonte removida." })
}

export function useTestConnectionMutation() {
  return useAdminMutation({ mutationFn: (id: string) => testSourceConnection(id), invalidateKey: adminQueryKeys.dataHub() })
}

export function useSetSourceStatusMutation() {
  return useAdminMutation({ mutationFn: ({ id, action }: { id: string; action: "ACTIVATE" | "PAUSE" | "RESUME" }) => setSourceStatus(id, action), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Status da fonte atualizado." })
}

export function useRotateSecretsMutation() {
  return useAdminMutation({ mutationFn: ({ id, secrets }: { id: string; secrets: Record<string, string | undefined> }) => rotateSourceSecrets(id, secrets), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Credencial rotacionada." })
}

export function useCreatePushTokenMutation() {
  return useAdminMutation({ mutationFn: ({ sourceId, ...input }: { sourceId: string } & PushTokenInput) => createPushToken(sourceId, { ...input, feedId: input.feedId ?? null }), invalidateKey: adminQueryKeys.dataHub() })
}

export function useRevokePushTokenMutation() {
  return useAdminMutation({ mutationFn: ({ sourceId, tokenId }: { sourceId: string; tokenId: string }) => revokePushToken(sourceId, tokenId), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Token revogado." })
}

export function useRotatePushTokenMutation() {
  return useAdminMutation({ mutationFn: ({ sourceId, tokenId }: { sourceId: string; tokenId: string }) => rotatePushToken(sourceId, tokenId), invalidateKey: adminQueryKeys.dataHub() })
}

export function useCreateFeedMutation() {
  return useAdminMutation({ mutationFn: ({ sourceId, input }: { sourceId: string; input: FeedInput }) => createFeed(sourceId, input), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Feed criado." })
}

export function useUpdateFeedMutation() {
  return useAdminMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<FeedInput> }) => updateFeed(id, input), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Feed atualizado." })
}

export function useDeleteFeedMutation() {
  return useAdminMutation({ mutationFn: (id: string) => deleteFeed(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Feed removido." })
}

export function useSetFeedStatusMutation() {
  return useAdminMutation({ mutationFn: ({ id, action }: { id: string; action: "ACTIVATE" | "PAUSE" | "RESUME" }) => setFeedStatus(id, action), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Status do feed atualizado." })
}

export function useSyncFeedMutation() {
  return useAdminMutation({ mutationFn: (id: string) => syncFeedNow(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Sincronização enfileirada." })
}

export function useImportFileMutation() {
  return useAdminMutation({ mutationFn: ({ feedId, rawObjectId }: { feedId: string; rawObjectId: string }) => importFile(feedId, rawObjectId), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Importação iniciada." })
}

export function useReprocessRunMutation() {
  return useAdminMutation({ mutationFn: (id: string) => reprocessRun(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Reprocessamento enfileirado." })
}

export function useResetFeedCheckpointMutation() {
  return useAdminMutation({ mutationFn: (id: string) => resetFeedCheckpoint(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Leitura reiniciada: a próxima carga relê tudo desde o início." })
}

export function useCancelRunMutation() {
  return useAdminMutation({ mutationFn: (id: string) => cancelRun(id), invalidateKey: adminQueryKeys.dataHub(), successMessage: "Carga cancelada." })
}
