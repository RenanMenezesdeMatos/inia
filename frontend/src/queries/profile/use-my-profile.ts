"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { currentUserKeys } from "@/queries/auth/use-current-user"
import type { MyProfile } from "@/schemas/profile/my-profile.schema"
import { fetchMyProfile, updateMyProfile, type ProfileUpdateInput } from "@/services/profile/profile-service"

export const myProfileKeys = { me: ["profile", "me"] as const }

export function useMyProfileQuery(initialData?: MyProfile | null) {
  return useQuery({ queryKey: myProfileKeys.me, queryFn: fetchMyProfile, staleTime: 30_000, ...(initialData ? { initialData } : {}) })
}

/**
 * Salvar atualiza TUDO que mostra a pessoa, sem novo login: a query do perfil recebe a resposta, a sessão (`/auth/me` —
 * cabeçalho global) é relida e as páginas de servidor são recarregadas. O chat usa o novo nome na próxima mensagem.
 */
export function useUpdateMyProfileMutation() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: (input: ProfileUpdateInput) => updateMyProfile(input),
    onSuccess: async (profile) => {
      queryClient.setQueryData(myProfileKeys.me, profile)
      await queryClient.invalidateQueries({ queryKey: currentUserKeys.me })
      router.refresh()
    },
  })
}
