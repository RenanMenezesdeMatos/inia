"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/services/notifications/notifications-service"

import { notificationKeys } from "./notifications-query-keys"

/** Sem WebSocket/SSE no produto: o sino se atualiza por polling moderado + foco de janela +
 * invalidação explícita depois de decisões (ver use-pending-actions). */
export const NOTIFICATIONS_REFETCH_MS = 60_000

export function useNotificationsQuery(enabled = true) {
  return useQuery({ queryKey: notificationKeys.summary(), queryFn: fetchNotifications, enabled, refetchInterval: NOTIFICATIONS_REFETCH_MS, refetchOnWindowFocus: true, staleTime: 15_000 })
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() }),
  })
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.summary() }),
  })
}
