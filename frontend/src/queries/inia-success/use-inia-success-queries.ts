"use client"

import { useQuery } from "@tanstack/react-query"

import type { SuccessFilter } from "@/schemas/inia-success/inia-success.schema"
import { fetchCompliance, fetchFeedback, fetchReplies, fetchResponseTime, fetchRoutes, fetchSuccessContext, fetchSupport } from "@/services/inia-success/inia-success-service"

/**
 * Um query por bloco: cada um carrega, falha e fica vazio por conta própria (um bloco com erro não apaga os outros). Bloco sem
 * permissão nunca é chamado (`enabled`). Os mesmos filtros entram na chave de todos.
 */
const KEY = ["inia-success"] as const
const STALE_MS = 60_000

export const useSuccessContextQuery = () => useQuery({ queryKey: [...KEY, "context"], queryFn: fetchSuccessContext, staleTime: 5 * 60_000 })
export const useResponseTimeQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "response-time", filter], queryFn: () => fetchResponseTime(filter), enabled, staleTime: STALE_MS })
export const useRoutesQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "routes", filter], queryFn: () => fetchRoutes(filter), enabled, staleTime: STALE_MS })
export const useRepliesQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "replies", filter], queryFn: () => fetchReplies(filter), enabled, staleTime: STALE_MS })
export const useSupportQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "support", filter], queryFn: () => fetchSupport(filter), enabled, staleTime: STALE_MS })
export const useFeedbackQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "feedback", filter], queryFn: () => fetchFeedback(filter), enabled, staleTime: STALE_MS })
export const useComplianceQuery = (filter: SuccessFilter, enabled: boolean) => useQuery({ queryKey: [...KEY, "compliance", filter], queryFn: () => fetchCompliance(filter), enabled, staleTime: STALE_MS })
