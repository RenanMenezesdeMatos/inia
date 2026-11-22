"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { currentUserKeys } from "@/queries/auth/use-current-user"
import { fetchNetworkLoginStatus, probeNetworkLoginServers, setNetworkLoginEnabled } from "@/services/access/network-login-service"

const keys = { status: ["admin-network-login"] as const }

export const useNetworkLoginStatusQuery = () => useQuery({ queryKey: keys.status, queryFn: fetchNetworkLoginStatus })
export const useProbeNetworkLoginMutation = () => useMutation({ mutationFn: () => probeNetworkLoginServers() })

/** Ligar/desligar muda como a ciência é confirmada (`credentialMode` do /auth/me): recarrega a sessão também. */
export function useSetNetworkLoginMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => setNetworkLoginEnabled(enabled),
    onSuccess: async (status) => {
      client.setQueryData(keys.status, status)
      await client.invalidateQueries({ queryKey: currentUserKeys.me })
    },
  })
}
