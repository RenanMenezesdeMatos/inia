import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import {
  createChannelFlag,
  deleteChannelFlag,
  fetchChannelFlagChannels,
  fetchChannelFlags,
  fetchChannelFlagsPage,
  setChannelFlagActive,
  updateChannelFlag,
  type ChannelFlagListParams,
} from "@/services/admin/channel-flag-service"

import { adminQueryKeys } from "./admin-query-keys"

export function useChannelFlagsQuery() {
  return useQuery({ queryKey: adminQueryKeys.channelFlags(), queryFn: fetchChannelFlags })
}

export function useChannelFlagsPageQuery(params: ChannelFlagListParams) {
  return useQuery({
    queryKey: adminQueryKeys.channelFlagsList(params),
    queryFn: () => fetchChannelFlagsPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useChannelFlagChannelsQuery() {
  return useQuery({ queryKey: adminQueryKeys.channelFlagChannels(), queryFn: fetchChannelFlagChannels })
}

export function useCreateChannelFlagMutation() {
  return useAdminMutation({
    mutationFn: createChannelFlag,
    invalidateKey: adminQueryKeys.channelFlags(),
    successMessage: "Flag cadastrada.",
  })
}

export function useUpdateChannelFlagMutation() {
  return useAdminMutation({
    mutationFn: updateChannelFlag,
    invalidateKey: adminQueryKeys.channelFlags(),
    successMessage: "Flag atualizada.",
  })
}

export function useSetChannelFlagActiveMutation() {
  return useAdminMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setChannelFlagActive(id, active),
    invalidateKey: adminQueryKeys.channelFlags(),
    successMessage: "Status atualizado.",
  })
}

export function useDeleteChannelFlagMutation() {
  return useAdminMutation({
    mutationFn: deleteChannelFlag,
    invalidateKey: adminQueryKeys.channelFlags(),
    successMessage: "Flag excluída.",
  })
}
