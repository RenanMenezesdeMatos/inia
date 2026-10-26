import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type PageResult } from "@/lib/admin/list-query"
import { channelFlagSchema, type CallOutcome, type ChannelFlag, type FlagValueType } from "@/schemas/admin/channel-flag.schema"

export async function fetchChannelFlags(): Promise<ChannelFlag[]> {
  return z.array(channelFlagSchema).parse(await adminGet("/api/v1/admin/channel-flags"))
}

export type ChannelFlagListParams = ListParams & { channel: string[]; valueType: FlagValueType[]; active?: boolean; createdAt: DateRangeFilter }

export async function fetchChannelFlagsPage(params: ChannelFlagListParams): Promise<PageResult<ChannelFlag>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(channelFlagSchema).parse(
    await adminGet(`/api/v1/admin/channel-flags${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`),
  )
}

export async function fetchChannelFlagChannels(): Promise<string[]> {
  return z.array(z.string()).parse(await adminGet("/api/v1/admin/channel-flags/channels"))
}

export type CreateChannelFlagInput = {
  channel: string
  flagName: string
  valueType: string
  description?: string
  /** Nome de exibição e ícone no Acompanhamento ("Monitoria · Rechamada"); null = padrão. */
  label: string | null
  iconKey: string | null
  /** Boas práticas: chamada boa × ruim (null = o sinal não compara chamadas) e indicador relacionado. */
  callOutcome: CallOutcome | null
  relatedIndicatorId: string | null
}

export async function createChannelFlag(input: CreateChannelFlagInput): Promise<{ id: string }> {
  return adminSend("/api/v1/admin/channel-flags", "POST", input)
}

export type UpdateChannelFlagInput = {
  id: string
  channel: string
  flagName: string
  description?: string
  label: string | null
  iconKey: string | null
  callOutcome: CallOutcome | null
  relatedIndicatorId: string | null
}

export async function updateChannelFlag(input: UpdateChannelFlagInput): Promise<{ id: string }> {
  return adminSend(`/api/v1/admin/channel-flags/${input.id}`, "PATCH", {
    channel: input.channel,
    flagName: input.flagName,
    description: input.description,
    label: input.label,
    iconKey: input.iconKey,
    callOutcome: input.callOutcome,
    relatedIndicatorId: input.relatedIndicatorId,
  })
}

export async function setChannelFlagActive(id: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/channel-flags/${id}`, "PATCH", { active })
}

export async function deleteChannelFlag(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/channel-flags/${id}`, "DELETE")
}
