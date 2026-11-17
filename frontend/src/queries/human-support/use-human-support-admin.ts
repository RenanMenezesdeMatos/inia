"use client"

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ScopeState, SettingsView } from "@/schemas/human-support/admin.schema"
import { isOpenRequestStatus } from "@/schemas/human-support/catalogs.schema"
import type { Productivity } from "@/schemas/human-support/monitoring.schema"
import {
  fetchAnjoPresenceTimeline,
  fetchSupportAbandonment,
  fetchAnjosNow,
  fetchMyAnjoHistory,
  fetchQueueWaiting,
  fetchResponseTimes,
  fetchSupportDemand,
  fetchOperationHistory,
  fetchSupportAnjos,
  fetchSupportFunnel,
  fetchSupportRequestDetail,
  fetchSupportRequests,
  fetchSupportScopes,
  fetchSupportSettings,
  fetchTransferCandidates,
  fetchUnavailableAttempts,
  transferSupportAttendance,
  saveAnjoCapacity,
  saveSupportScopeState,
  saveSupportSettings,
  saveResponseTimes,
  type SaveResponseTimesInput,
  type PanelFilter,
  type RequestListFilter,
} from "@/services/human-support/human-support-service"

/** Configuração do Apoio com Anjo (Administrador geral) e painel do apoio (Coordenador de Anjos e Administrador geral). */
const ADMIN_KEY = ["human-support", "admin"] as const
const MONITORING_KEY = ["human-support", "monitoring"] as const

export const useSupportSettingsQuery = () => useQuery({ queryKey: [...ADMIN_KEY, "settings"], queryFn: fetchSupportSettings })
export const useSupportScopesQuery = () => useQuery({ queryKey: [...ADMIN_KEY, "scopes"], queryFn: fetchSupportScopes })
export const useSupportAnjosQuery = (filter: { teamId?: string | null; subteamId?: string | null }) => useQuery({ queryKey: [...ADMIN_KEY, "anjos", filter], queryFn: () => fetchSupportAnjos(filter), refetchInterval: 30_000 })

export function useSaveSupportSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: SettingsView) => saveSupportSettings(input), onSettled: () => queryClient.invalidateQueries({ queryKey: ADMIN_KEY }) })
}
export function useSaveSupportScopeMutation() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: { scopeType: "group" | "subgroup"; id: string; state: ScopeState }) => saveSupportScopeState(input.scopeType, input.id, input.state), onSettled: () => queryClient.invalidateQueries({ queryKey: ADMIN_KEY }) })
}
export function useSaveAnjoCapacityMutation() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: { personId: string; maxConcurrent: number | null }) => saveAnjoCapacity(input.personId, input.maxConcurrent), onSettled: () => queryClient.invalidateQueries({ queryKey: [...ADMIN_KEY, "anjos"] }) })
}

export const useSupportFunnelQuery = (filter: PanelFilter) => useQuery({ queryKey: [...MONITORING_KEY, "funnel", filter], queryFn: () => fetchSupportFunnel(filter) })
/** A lista de pedidos se atualiza nesse intervalo enquanto só a primeira página está aberta (como a lista de "Conversas com a INIA"). */
export const REQUESTS_REFRESH_MS = 20_000
/**
 * Pedidos em páginas pelo cursor do servidor ("Carregar mais"). A atualização automática só roda com uma página: com várias, refazer as
 * páginas seguintes pelo cursor antigo pularia os pedidos que mudaram de página.
 */
export const useSupportRequestsInfiniteQuery = (filter: RequestListFilter, { enabled = true }: { enabled?: boolean } = {}) =>
  useInfiniteQuery({
    queryKey: [...MONITORING_KEY, "requests", filter],
    queryFn: ({ pageParam }) => fetchSupportRequests({ ...filter, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 1 ? false : REQUESTS_REFRESH_MS),
    enabled,
  })
/** Pedido na fila ou em atendimento: a conversa aberta no painel se atualiza nesse intervalo (o registro LGPD do servidor não repete a mesma leitura por 10 min). */
export const REQUEST_DETAIL_REFRESH_MS = 10_000
export const useSupportRequestDetailQuery = (requestId: string | null) =>
  useQuery({
    queryKey: [...MONITORING_KEY, "request", requestId],
    queryFn: () => fetchSupportRequestDetail(requestId!),
    enabled: Boolean(requestId),
    refetchInterval: (query) => (query.state.data && isOpenRequestStatus(query.state.data.status) ? REQUEST_DETAIL_REFRESH_MS : false),
  })
/** Destinos da transferência: só com o diálogo aberto, e lidos de novo a cada 10 s (o estado dos Anjos muda). */
export const useTransferCandidatesQuery = (requestId: string, enabled: boolean) =>
  useQuery({ queryKey: [...MONITORING_KEY, "transfer-candidates", requestId], queryFn: () => fetchTransferCandidates(requestId), enabled, refetchInterval: enabled ? 10_000 : false })
export function useTransferAttendanceMutation(requestId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { toAnjoPersonId: string | null; reason: string }) => transferSupportAttendance(requestId, input),
    onSuccess: (detail) => queryClient.setQueryData([...MONITORING_KEY, "request", requestId], detail),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MONITORING_KEY }),
  })
}
export const useUnavailableAttemptsQuery = (filter: PanelFilter & { cursor?: string | null }) => useQuery({ queryKey: [...MONITORING_KEY, "attempts", filter], queryFn: () => fetchUnavailableAttempts(filter) })
/** Abandonos: `live` = Monitoria Online (o dia de hoje, relido junto com a "Operação agora"); sem ele, o período de Indicadores. */
export const useSupportAbandonmentQuery = (filter: PanelFilter, live = false) =>
  useQuery({ queryKey: [...MONITORING_KEY, "abandonment", filter], queryFn: () => fetchSupportAbandonment(filter), refetchInterval: live ? ANJOS_NOW_REFRESH_MS : false, refetchOnReconnect: live ? "always" : true })
/** Situação dos Anjos agora: atualiza sozinha a cada 15 s (e ao voltar para a aba), como a lista de Anjos da configuração. */
/** Situação agora: relê a cada 5 s e, ao voltar a conexão ou o foco, na hora (o servidor é a fonte da verdade). */
export const ANJOS_NOW_REFRESH_MS = 5_000
export const useAnjosNowQuery = (filter: { teamId?: string | null; subteamId?: string | null }) =>
  useQuery({
    queryKey: [...MONITORING_KEY, "anjos-now", filter],
    queryFn: () => fetchAnjosNow(filter),
    refetchInterval: ANJOS_NOW_REFRESH_MS,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  })
/** Acionamentos do período (aba Indicadores). */
export const useSupportDemandQuery = (filter: PanelFilter & { productivity?: Productivity | null }) =>
  // Ao clicar em produtivos/não produtivos, o resto da seção continua na tela até o novo recorte chegar.
  useQuery({ queryKey: [...MONITORING_KEY, "demand", filter], queryFn: () => fetchSupportDemand(filter), placeholderData: (previous) => previous })
/** Tempos de resposta (migration 193). */
export const useResponseTimesQuery = () => useQuery({ queryKey: [...MONITORING_KEY, "response-times"], queryFn: fetchResponseTimes })
export function useSaveResponseTimesMutation() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: SaveResponseTimesInput) => saveResponseTimes(input), onSettled: () => queryClient.invalidateQueries({ queryKey: [...MONITORING_KEY, "response-times"] }) })
}
/** Quem está na fila (aberto ao clicar no indicador de fila); relê junto com a "Operação agora". */
export const useQueueWaitingQuery = (filter: { teamId?: string | null; subteamId?: string | null }, enabled: boolean) =>
  useQuery({ queryKey: [...MONITORING_KEY, "queue", filter], queryFn: () => fetchQueueWaiting(filter), enabled, refetchInterval: enabled ? ANJOS_NOW_REFRESH_MS : false })
/** Histórico da operação: da coordenação (alcance de quem lê, com o consolidado) ou o próprio, do Anjo. */
export const useOperationHistoryQuery = (filter: PanelFilter & { anjoPersonId?: string | null }, source: "coordination" | "anjo" = "coordination") =>
  useQuery({
    queryKey: source === "anjo" ? ["human-support", "anjo", "history", filter.from, filter.to] : [...MONITORING_KEY, "history", filter],
    queryFn: () => (source === "anjo" ? fetchMyAnjoHistory({ from: filter.from, to: filter.to }) : fetchOperationHistory(filter)),
  })
export const useAnjoPresenceTimelineQuery = (personId: string | null, period: { from: string; to: string }) => useQuery({ queryKey: [...MONITORING_KEY, "presence", personId, period], queryFn: () => fetchAnjoPresenceTimeline(personId!, period), enabled: Boolean(personId) })
