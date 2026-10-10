"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchCurrentUser } from "@/services/auth/auth-service"

/**
 * Sessão atual (`/auth/me`): identidade + acesso calculado AO VIVO dos papéis + módulos ligados. Query única e invalidável —
 * atribuir/revogar papel invalida esta chave, e menus/links dependentes atualizam sem logout (V1.5.8a).
 */
export const currentUserKeys = { me: ["auth", "me"] as const }

export function useCurrentUserQuery() {
  return useQuery({ queryKey: currentUserKeys.me, queryFn: fetchCurrentUser, staleTime: 30_000 })
}
