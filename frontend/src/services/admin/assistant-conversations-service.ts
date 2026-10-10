import { apiGet } from "@/lib/api/api-client"
import type { ConversationMessage, ConversationSummary } from "@/lib/realtime/gemini-text-client"

/**
 * "Conversas com a INIA" (Administração, somente leitura) — `/api/v1/admin/assistant-conversations`. O backend aplica o
 * escopo da conta em cada chamada (lista, filtros, paginação, detalhe e mensagens); fora do alcance = 404.
 */
const BASE = "/api/v1/admin/assistant-conversations"

export type MonitoredOwner = { personId: string; name: string; jobTitle: string | null; avatarUrl: string | null; teamName: string | null; subteamName: string | null }
/** `voiceMessageCount` = quantas mensagens foram trocadas por voz (só a contagem; o áudio nunca é guardado). */
export type MonitoredConversation = ConversationSummary & { owner: MonitoredOwner; voiceMessageCount?: number }
export const MONITORING_STATUS_LABELS = { ACTIVE: "Em andamento", CLOSED: "Encerradas", LEGACY: "Histórico anterior" } as const
export type MonitoringStatus = keyof typeof MONITORING_STATUS_LABELS
export const MONITORING_ORIGIN_LABELS = { USER: "Conversas livres", FEEDBACK: "Sessões de feedback", WORKFLOW: "Recados da INIA" } as const
export type MonitoringOrigin = keyof typeof MONITORING_ORIGIN_LABELS

export type MonitoringFilters = {
  search?: string | undefined
  ownerPersonId?: string | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  status?: MonitoringStatus | undefined
  origin?: MonitoringOrigin | undefined
  from?: string | undefined
  to?: string | undefined
  page: number
  pageSize: number
}

export type MonitoredConversationPage = {
  items: MonitoredConversation[]
  total: number
  page: number
  pageSize: number
  filterOptions: { operators: { id: string; name: string }[]; teams: { id: string; name: string }[]; subteams: { id: string; name: string; teamId: string | null }[] }
}

export function fetchMonitoredConversations(filters: MonitoringFilters): Promise<MonitoredConversationPage> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value))
  return apiGet(`${BASE}?${params}`)
}

export function fetchMonitoredMessages(conversationId: string, options: { before?: string; after?: string; limit?: number } = {}): Promise<{ conversation: MonitoredConversation; messages: ConversationMessage[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) })
  if (options.before) params.set("before", options.before)
  if (options.after) params.set("after", options.after)
  return apiGet(`${BASE}/${conversationId}/messages?${params}`)
}
