import { useQuery } from "@tanstack/react-query"

import { fetchCaseAgentRecords } from "@/services/supervision-cases/case-agent-records-service"

export const supervisionCaseKeys = {
  agentRecords: (caseId: string) => ["supervision-cases", caseId, "agent-records"] as const,
}

/** "Ver histórico deste caso" (PEN-071) — só busca quando a lista é aberta. */
export function useCaseAgentRecordsQuery(caseId: string, enabled = true) {
  return useQuery({ queryKey: supervisionCaseKeys.agentRecords(caseId), queryFn: () => fetchCaseAgentRecords(caseId), enabled })
}
