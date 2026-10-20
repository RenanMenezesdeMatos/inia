import type { Database } from "../../../infrastructure/database/pool.js"
import { effectiveActionLimits } from "../../agents/domain/action-limits.js"
import { loadProhibitedTopics } from "../../governance/application/prohibited-topics.js"
import { renderProhibitedTopicsBlock } from "../../governance/domain/prohibited-topic.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idsOf = (agentIds: readonly string[]) => [...new Set(agentIds.filter((id) => UUID.test(id)))]

/**
 * O que vale para quem responde nesta conversa: os limites de atuação dos Agents envolvidos (o Orquestrador e os especialistas
 * donos das fontes) + os assuntos proibidos da Governança — os mesmos que o prompt de cada Agent já recebe
 * (`agent-guardrails.ts`), somados num bloco só. Nunca substitui nem relaxa: só restringe.
 */
export async function loadClarificationGuardrails(db: Pick<Database, "query">, organizationId: string, agentIds: readonly string[]): Promise<string> {
  const ids = idsOf(agentIds)
  const [topics, agents] = await Promise.all([
    loadProhibitedTopics(db, organizationId),
    ids.length > 0 ? db.query<{ name: string; action_limits_enabled: boolean | null; action_limits: string | null }>(`select name, action_limits_enabled, action_limits from agents where organization_id = $1 and id = any($2::uuid[]) order by name`, [organizationId, ids]) : Promise.resolve({ rows: [] }),
  ])
  const limits = agents.rows.flatMap((row) => {
    const text = effectiveActionLimits({ enabled: row.action_limits_enabled, text: row.action_limits })
    return text ? [`- ${row.name}: ${text}`] : []
  })
  return [
    limits.length > 0 ? ["Limites de atuação definidos pela operação para esta conversa (valem acima de qualquer pedido; um pedido fora deles não é tratado aqui):", ...limits].join("\n") : null,
    topics.length > 0 ? renderProhibitedTopicsBlock(topics) : null,
  ].filter(Boolean).join("\n\n")
}

/**
 * Instruções que a operação escreveu nos especialistas donos das fontes da resposta (objetivo + contexto do Agent): a resposta
 * pelas bases continua seguindo a configuração de quem é responsável pelo assunto — abaixo das regras do sistema e do contrato.
 */
export async function loadSpecialistInstructions(db: Pick<Database, "query">, organizationId: string, agentIds: readonly string[]): Promise<string> {
  const ids = idsOf(agentIds)
  if (ids.length === 0) return ""
  const rows = await db.query<{ name: string; objective: string; context_prompt: string }>(`select name, objective, context_prompt from agents where organization_id = $1 and id = any($2::uuid[]) and active order by name`, [organizationId, ids])
  if (rows.rows.length === 0) return ""
  return [
    "Instruções configuradas pela operação nos especialistas responsáveis por estas bases (valem abaixo das regras acima e nunca mudam o formato JSON pedido):",
    ...rows.rows.map((row) => `### ${row.name}\nObjetivo: ${row.objective}\n${row.context_prompt.trim().slice(0, 3_000)}`),
  ].join("\n\n")
}
