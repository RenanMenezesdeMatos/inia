import type { Database } from "../../../infrastructure/database/pool.js"
import { executionDenialFor } from "../../agents/application/agent-execution-authorization.js"
import { resolveAgentVersionForRun } from "../../agents/application/agent-versions.js"
import type { AgentRuntimeSnapshot } from "../../agents/domain/agent-config.js"
import { toolNameForAgent } from "../domain/orchestrator-schema.js"
import type { ResolvedOrchestrator } from "./resolve-orchestrator.js"

/**
 * Autorização de um especialista na hora em que a execução dele vai começar — chat de texto e voz (PEN-070; aviso no chat
 * confirmado em 03/11/2026; condição de segurança da revisão da PEN-002/PEN-076 de 03/11/2026):
 * - versão VIGENTE de agora (uma publicação depois de a resposta começar já vale para a chamada nova);
 * - desativado → "Agente inativo"; versão vigente não autorizada para o alcance do Orquestrador → "acesso não autorizado".
 * Impedido, ele não roda: o colaborador lê/ouve só que a parte está indisponível (sem nome nem orientação administrativa) e o
 * motivo fica no registro da conversa, para quem pode lê-la.
 */
export type SpecialistAtCall = { snapshot: AgentRuntimeSnapshot } | { outcome: "BLOCKED_INACTIVE" | "BLOCKED_UNAUTHORIZED"; versionId: string | null }

export async function specialistAtCall(db: Database, orchestrator: Pick<ResolvedOrchestrator, "organizationId" | "consumerScope">, agentId: string): Promise<SpecialistAtCall> {
  const resolved = await resolveAgentVersionForRun(db, orchestrator.organizationId, agentId).catch(() => null)
  if (!resolved) return { outcome: "BLOCKED_UNAUTHORIZED", versionId: null }
  if (!resolved.active) return { outcome: "BLOCKED_INACTIVE", versionId: resolved.versionId }
  const snapshot: AgentRuntimeSnapshot = { agentId: resolved.agentId, organizationId: resolved.organizationId, versionId: resolved.versionId, versionNumber: resolved.versionNumber, config: resolved.config }
  if (orchestrator.consumerScope && (await executionDenialFor(db, snapshot, orchestrator.consumerScope))) return { outcome: "BLOCKED_UNAUTHORIZED", versionId: resolved.versionId }
  return { snapshot }
}

/** O que aparece na tela (e é falado) no lugar da parte indisponível — chat de voz. */
export const SPECIALIST_UNAVAILABLE_DISPLAY_TEXT = "Esta parte do pedido está indisponível no momento. Posso ajudar com outra coisa?"

/**
 * Voz: a sessão do Gemini Live recebeu as ferramentas na abertura e pode chamar a de um especialista que, na resolução de agora,
 * já não está disponível (desativado, ou versão vigente não autorizada). Devolve o agente configurado no Orquestrador para essa
 * ferramenta, para responder "indisponível" com o registro — ou null quando a ferramenta não é de especialista deste Orquestrador.
 */
export async function configuredSpecialistOf(db: Pick<Database, "query">, orchestrator: Pick<ResolvedOrchestrator, "orchestratorId" | "organizationId">, toolName: string): Promise<string | null> {
  const row = (await db.query<{ agent_id: string }>(
    `select s.agent_id from assistant_orchestrator_specialists s join agents a on a.id = s.agent_id
      where s.orchestrator_id = $1 and s.tool_name = $2 and a.organization_id = $3`,
    [orchestrator.orchestratorId, toolName, orchestrator.organizationId],
  )).rows[0]
  return row && toolNameForAgent(row.agent_id) === toolName ? row.agent_id : null
}
