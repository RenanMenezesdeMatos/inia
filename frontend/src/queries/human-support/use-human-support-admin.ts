"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ScopeState, SettingsView } from "@/schemas/human-support/admin.schema"
import {
  fetchAnjoPresenceTimeline,
  fetchAnjosActivity,
  fetchAnjosNow,
  fetchSupportAnjos,
  fetchSupportFunnel,
  fetchSupportRequestDetail,
  fetchSupportRequests,
  fetchSupportScopes,
  fetchSupportSettings,
  fetchUnavailableAttempts,
  saveAnjoCapacity,
  saveSupportScopeState,
  saveSupportSettings,
  type PanelFilter,
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
export const useSupportRequestsQuery = (filter: PanelFilter & { status?: string | null; origin?: string | null; cursor?: string | null }) => useQuery({ queryKey: [...MONITORING_KEY, "requests", filter], queryFn: () => fetchSupportRequests(filter) })
export const useSupportRequestDetailQuery = (requestId: string | null) => useQuery({ queryKey: [...MONITORING_KEY, "request", requestId], queryFn: () => fetchSupportRequestDetail(requestId!), enabled: Boolean(requestId) })
export const useUnavailableAttemptsQuery = (filter: PanelFilter & { cursor?: string | null }) => useQuery({ queryKey: [...MONITORING_KEY, "attempts", filter], queryFn: () => fetchUnavailableAttempts(filter) })
export const useAnjosActivityQuery = (filter: PanelFilter) => useQuery({ queryKey: [...MONITORING_KEY, "anjos", filter], queryFn: () => fetchAnjosActivity(filter) })
/** Situação dos Anjos agora: atualiza sozinha a cada 15 s (e ao voltar para a aba), como a lista de Anjos da configuração. */
export const ANJOS_NOW_REFRESH_MS = 15_000
export const useAnjosNowQuery = (filter: { teamId?: string | null; subteamId?: string | null }) =>
  useQuery({ queryKey: [...MONITORING_KEY, "anjos-now", filter], queryFn: () => fetchAnjosNow(filter), refetchInterval: ANJOS_NOW_REFRESH_MS })
export const useAnjoPresenceTimelineQuery = (personId: string | null, period: { from: string; to: string }) => useQuery({ queryKey: [...MONITORING_KEY, "presence", personId, period], queryFn: () => fetchAnjoPresenceTimeline(personId!, period), enabled: Boolean(personId) })
