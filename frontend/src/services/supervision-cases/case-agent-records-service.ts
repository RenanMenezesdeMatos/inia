import { z } from "zod"

import { apiGet } from "@/lib/api/api-client"
import { caseAgentRecordSchema, type CaseAgentRecord } from "@/schemas/supervision-cases/case-agent-record.schema"

/**
 * Execuções de agente que geraram o caso (PEN-071), pela sessão do navegador. Fica fora do `index.ts` desta pasta: aquele
 * reexporta a leitura do caso no servidor (`next/headers`), que não pode entrar num componente de cliente.
 */
export async function fetchCaseAgentRecords(caseId: string): Promise<CaseAgentRecord[]> {
  return z.array(caseAgentRecordSchema).parse(await apiGet<unknown>(`/api/v1/supervision-cases/${caseId}/agent-records`))
}
