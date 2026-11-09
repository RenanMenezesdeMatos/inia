import type { Database } from "../../../infrastructure/database/pool.js"
import { loadProhibitedTopics } from "../../governance/application/prohibited-topics.js"
import { renderProhibitedTopicsBlock, type ProhibitedTopic } from "../../governance/domain/prohibited-topic.js"
import { effectiveActionLimits, renderActionLimitsBlock } from "../domain/action-limits.js"
import { agentSnapshotFor } from "./agent-runtime-context.js"

/** O que um Agent nunca faz: os limites de atuação DELE (escritos no Agent) + os assuntos proibidos da organização. */
export type AgentGuardrails = { actionLimits: string | null; prohibitedTopics: ProhibitedTopic[] }

/** Leitura única — instruções do Agent (`build-system-prompt.ts`) e conversas cuja instrução não é o prompt de um Agent
 * (aplicação de feedback, chat/voz sem Orquestrador: `realtime-router.ts`). Sem Agent, só os assuntos proibidos. */
export async function loadAgentGuardrails(db: Pick<Database, "query">, organizationId: string, agentId: string | null): Promise<AgentGuardrails> {
  // Versão em execução (PEN-002): os limites são os DELA, não os da vigente.
  const snapshot = agentSnapshotFor(agentId)
  if (snapshot) {
    const topics = await loadProhibitedTopics(db, organizationId)
    return { actionLimits: effectiveActionLimits({ enabled: snapshot.config.actionLimitsEnabled, text: snapshot.config.actionLimits }), prohibitedTopics: topics }
  }
  const [topics, agent] = await Promise.all([
    loadProhibitedTopics(db, organizationId),
    agentId
      ? db.query<{ action_limits_enabled: boolean | null; action_limits: string | null }>(`select action_limits_enabled, action_limits from agents where id = $1 and organization_id = $2`, [agentId, organizationId])
      : Promise.resolve({ rows: [] }),
  ])
  const row = agent.rows[0]
  return { actionLimits: row ? effectiveActionLimits({ enabled: row.action_limits_enabled, text: row.action_limits }) : null, prohibitedTopics: topics }
}

/** Parte "restrições" das instruções do Agent: limites (quando ligados) antes dos assuntos proibidos (sempre presentes). */
export function renderAgentGuardrails(guardrails: AgentGuardrails): string {
  return [guardrails.actionLimits ? renderActionLimitsBlock(guardrails.actionLimits) : null, renderProhibitedTopicsBlock(guardrails.prohibitedTopics)].filter(Boolean).join("\n\n")
}

/** Anexo de uma conversa: vazio quando não há limite nem assunto — a instrução fica exatamente como era. */
export function renderConversationGuardrails(guardrails: AgentGuardrails): string {
  if (!guardrails.actionLimits && guardrails.prohibitedTopics.length === 0) return ""
  return `\n\n${renderAgentGuardrails(guardrails)}`
}
