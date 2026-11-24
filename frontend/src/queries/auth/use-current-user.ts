"use client"

import { useSyncExternalStore } from "react"
import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import type { CurrentUser } from "@/schemas/auth/auth.schema"
import { fetchCurrentUser } from "@/services/auth/auth-service"

/**
 * Sessão atual (`/auth/me`): identidade + acesso calculado AO VIVO dos papéis + módulos ligados. Query única e invalidável —
 * atribuir/revogar papel invalida esta chave, e menus/links dependentes atualizam sem logout (V1.5.8a).
 */
export const currentUserKeys = { me: ["auth", "me"] as const }

const subscribe = () => () => undefined
const PENDING = { data: undefined, isSuccess: false, isPending: true, isLoading: true, status: "pending" } as const

/**
 * O servidor desenha a tela sem a sessão. Uma parte da página que o React hidrata depois (dentro de um `Suspense`) encontrava a sessão já
 * carregada pelo cabeçalho, desenhava diferente do servidor (uma aba ou um botão a mais) e o React descartava a página para refazê-la.
 * Durante a hidratação a resposta é a mesma do servidor; logo depois vale a sessão.
 */
export function useCurrentUserQuery(): UseQueryResult<CurrentUser | null> {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  const query = useQuery({ queryKey: currentUserKeys.me, queryFn: fetchCurrentUser, staleTime: 30_000 })
  return hydrated ? query : ({ ...query, ...PENDING } as UseQueryResult<CurrentUser | null>)
}
