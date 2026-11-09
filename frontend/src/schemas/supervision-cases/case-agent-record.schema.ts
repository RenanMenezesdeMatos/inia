import { z } from "zod"

/**
 * "Ver histórico deste caso" (PEN-071) — `GET /api/v1/supervision-cases/:id/agent-records`: as execuções de agente que geraram o
 * caso, com o agente identificado (inclusive inativo) e a versão usada. Mesma visibilidade do caso; nada além dele.
 */
export const caseAgentRecordSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  agentActive: z.boolean(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]).catch("COMPLETED"),
  source: z.string(),
  createdAt: z.coerce.string(),
  completedAt: z.coerce.string().nullable().catch(null),
  agentVersionNumber: z.number().nullable().catch(null),
  runTarget: z.enum(["VERSION", "DRAFT"]).nullable().catch(null),
})
export type CaseAgentRecord = z.infer<typeof caseAgentRecordSchema>

export const CASE_AGENT_RUN_STATUS_LABELS: Record<CaseAgentRecord["status"], string> = {
  PENDING: "Em andamento",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
}

/** Origem da execução — as de `agent_runs.source`; outra origem aparece pelo próprio código. */
export const CASE_AGENT_RUN_SOURCE_LABELS: Record<string, string> = {
  WORKFLOW: "Workflow de automação",
  MANUAL_TEST: "Teste manual",
}
