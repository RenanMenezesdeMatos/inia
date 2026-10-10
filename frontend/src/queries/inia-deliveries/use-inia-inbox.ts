"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchIniaInbox } from "@/services/inia-deliveries/inia-deliveries-service"

export const iniaInboxKey = ["inia-deliveries", "inbox"] as const

/** Sem push no produto: polling moderado + foco de janela (mesmo padrão do sino). Cache compartilhado pelos chats
 * montados (desktop e mobile) — uma requisição por intervalo. */
export const INIA_INBOX_REFETCH_MS = 30_000

export function useIniaInboxQuery(enabled = true) {
  return useQuery({ queryKey: iniaInboxKey, queryFn: fetchIniaInbox, enabled, refetchInterval: INIA_INBOX_REFETCH_MS, refetchOnWindowFocus: true, staleTime: 10_000 })
}
