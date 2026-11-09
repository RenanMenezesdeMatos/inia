import { z } from "zod"

/**
 * "Ver histórico desta conversa" (PEN-071) — `GET /api/v1/admin/assistant-conversations/:id/agent-records`: os agentes que
 * atuaram NESTA conversa, com a versão usada e, quando a chamada foi impedida (agente inativo ou — desde a revisão de 03/11/2026 —
 * versão vigente não autorizada para o contexto), a orientação do backend (`guidance`). Só para quem acompanha a conversa; o chat
 * da própria pessoa nunca mostra este motivo.
 */
export const conversationAgentRecordSchema = z.object({
  interactionId: z.string(),
  occurredAt: z.coerce.string(),
  role: z.enum(["ORCHESTRATOR_AGENT", "SPECIALIST"]).catch("SPECIALIST"),
  outcome: z.enum(["EXECUTED", "BLOCKED_INACTIVE", "BLOCKED_UNAUTHORIZED", "FAILED"]).catch("EXECUTED"),
  agentId: z.string(),
  agentName: z.string(),
  agentActive: z.boolean(),
  agentVersionNumber: z.number().nullable().catch(null),
  orchestratorName: z.string().nullable().catch(null),
  orchestratorVersionNumber: z.number().nullable().catch(null),
  guidance: z.string().nullable().catch(null),
})
export type ConversationAgentRecord = z.infer<typeof conversationAgentRecordSchema>

export const CONVERSATION_AGENT_ROLE_LABELS: Record<ConversationAgentRecord["role"], string> = {
  ORCHESTRATOR_AGENT: "Agente orquestrador",
  SPECIALIST: "Especialista",
}

export const CONVERSATION_AGENT_OUTCOME_LABELS: Record<ConversationAgentRecord["outcome"], string> = {
  EXECUTED: "Atuou",
  BLOCKED_INACTIVE: "Chamada impedida — agente inativo",
  BLOCKED_UNAUTHORIZED: "Chamada impedida — acesso não autorizado",
  FAILED: "Falhou",
}
