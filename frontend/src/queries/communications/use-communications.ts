"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { EditCommunicationInput, PublishCommunicationInput } from "@/schemas/communications/communication.schema"
import { editCommunication, fetchCommunication, fetchReceivedCommunications, publishCommunication, retireCommunication } from "@/services/communications/communication-service"

export const receivedCommunicationsKey = ["communications", "received"] as const
export const communicationKey = (id: string) => ["communications", "detail", id] as const

export function useReceivedCommunicationsQuery() {
  return useQuery({ queryKey: receivedCommunicationsKey, queryFn: fetchReceivedCommunications, refetchOnWindowFocus: true })
}

/** Conteúdo inteiro de um comunicado recebido — só quando a pessoa o abre (`enabled`). */
export function useCommunicationQuery(id: string, enabled: boolean) {
  return useQuery({ queryKey: communicationKey(id), queryFn: () => fetchCommunication(id), enabled })
}

/** Publicar/editar/retirar: o feed da estrutura (todas as páginas e recortes), a lista de recebidos e os conteúdos abertos voltam a ler do servidor. */
function useRefreshCommunications() {
  const queryClient = useQueryClient()
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: ["analytics", "follow-ups"] }), queryClient.invalidateQueries({ queryKey: ["communications"] })])
}

export function usePublishCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: (input: PublishCommunicationInput) => publishCommunication(input), onSuccess: refresh })
}

export function useEditCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: EditCommunicationInput }) => editCommunication(id, input), onSuccess: refresh })
}

export function useRetireCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: (id: string) => retireCommunication(id), onSuccess: refresh })
}
