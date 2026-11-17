"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { CommunicationSegment, EditorialPayload } from "@/schemas/communications/communication.schema"
import {
  createCommunication,
  fetchAudienceOptions,
  fetchCommunication,
  fetchMyCommunication,
  fetchModerationCommunication,
  fetchModerationCommunications,
  fetchMyCommunications,
  moderateRetireCommunication,
  fetchReceivedCommunications,
  previewAudience,
  retireCommunication,
  setCommunicationArchived,
  updateCommunication,
} from "@/services/communications/communication-service"

export const receivedCommunicationsKey = ["communications", "received"] as const
export const communicationKey = (id: string) => ["communications", "detail", id] as const
export const myCommunicationsKey = ["communications", "mine"] as const
export const myCommunicationKey = (id: string) => ["communications", "mine", id] as const

export function useReceivedCommunicationsQuery() {
  return useQuery({ queryKey: receivedCommunicationsKey, queryFn: fetchReceivedCommunications, refetchOnWindowFocus: true })
}

/** Conteúdo inteiro de um comunicado recebido — só quando a pessoa o abre (`enabled`). */
export function useCommunicationQuery(id: string, enabled: boolean) {
  return useQuery({ queryKey: communicationKey(id), queryFn: () => fetchCommunication(id), enabled })
}

export function useMyCommunicationsQuery() {
  return useQuery({ queryKey: myCommunicationsKey, queryFn: fetchMyCommunications })
}

export function useMyCommunicationQuery(id: string | null) {
  return useQuery({ queryKey: myCommunicationKey(id ?? ""), queryFn: () => fetchMyCommunication(id!), enabled: Boolean(id), refetchOnWindowFocus: false })
}

export function useAudienceOptionsQuery() {
  return useQuery({ queryKey: ["communications", "audience-options"], queryFn: fetchAudienceOptions, staleTime: 5 * 60_000 })
}

/** Quantas pessoas o público alcançaria agora (leitura; recalculada quando o público muda). */
export function useAudiencePreviewQuery(input: { audience: EditorialPayload["audience"]; segment: CommunicationSegment | null }, enabled: boolean) {
  return useQuery({ queryKey: ["communications", "audience-preview", input], queryFn: () => previewAudience(input), enabled, placeholderData: keepPreviousData, staleTime: 30_000 })
}

/** Qualquer gravação: o feed da estrutura (todas as páginas e recortes), recebidos, a área editorial e os conteúdos voltam a ler do servidor. */
function useRefreshCommunications() {
  const queryClient = useQueryClient()
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: ["analytics", "follow-ups"] }), queryClient.invalidateQueries({ queryKey: ["communications"] })])
}

export function useCreateCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: (input: EditorialPayload) => createCommunication(input), onSuccess: refresh })
}

export function useUpdateCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<EditorialPayload> }) => updateCommunication(id, input), onSuccess: refresh })
}

export function useArchiveCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setCommunicationArchived(id, archived), onSuccess: refresh })
}

export function useRetireCommunicationMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: (id: string) => retireCommunication(id), onSuccess: refresh })
}

export function useModerationCommunicationsQuery(enabled: boolean) {
  return useQuery({ queryKey: ["communications", "moderation"], queryFn: fetchModerationCommunications, enabled })
}

export function useModerationCommunicationQuery(id: string) {
  return useQuery({ queryKey: ["communications", "moderation", id], queryFn: () => fetchModerationCommunication(id) })
}

export function useModerateRetireMutation() {
  const refresh = useRefreshCommunications()
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => moderateRetireCommunication(id, reason), onSuccess: refresh })
}

