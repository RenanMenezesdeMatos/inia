import { useQuery } from "@tanstack/react-query"

import { fetchConversationAgentRecords } from "@/services/admin/assistant-conversations-service"

export const assistantConversationKeys = {
  agentRecords: (conversationId: string) => ["admin-assistant-conversations", conversationId, "agent-records"] as const,
}

/** "Ver histórico desta conversa" (PEN-071) — só busca quando a lista é aberta. */
export function useConversationAgentRecordsQuery(conversationId: string, enabled = true) {
  return useQuery({ queryKey: assistantConversationKeys.agentRecords(conversationId), queryFn: () => fetchConversationAgentRecords(conversationId), enabled })
}
