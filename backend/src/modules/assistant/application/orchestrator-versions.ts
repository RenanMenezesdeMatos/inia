import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { toolNameForAgent } from "../domain/orchestrator-schema.js"

/**
 * Versões do Orquestrador (PEN-076, com a revisão aprovada da PEN-002/PEN-076 de 03/11/2026; migrations 164 e 166). Toda gravação
 * do Orquestrador publica uma versão NOVA e imutável da CONFIGURAÇÃO dele (especialistas, política, resultado estruturado,
 * materiais). As versões NÃO congelam as versões dos agentes: o agente orquestrador e os especialistas rodam sempre na versão
 * vigente deles, resolvida e registrada a cada execução. Versões antigas que registraram versões de agente continuam como estão
 * (histórico imutável). Agente nunca publicado não entra em uso de produção (PEN-047, ponto decidido).
 */

type Queryable = Pick<Database, "query">

export type OrchestratorActor = { personId: string | null; name: string }

/** PEN-050 para o Orquestrador: a edição diz em qual versão se baseou; outra gravação no meio = nada é gravado. */
export async function assertOrchestratorVersion(client: Queryable, orchestratorId: string, expectedVersionId: string | null | undefined): Promise<void> {
  if (expectedVersionId === undefined) return
  const current = (await client.query<{ current_version_id: string | null; name: string | null }>(
    `select o.current_version_id, v.published_by_name name from assistant_orchestrators o left join assistant_orchestrator_versions v on v.id = o.current_version_id where o.id = $1 for update of o`,
    [orchestratorId],
  )).rows[0]
  if (current && current.current_version_id !== expectedVersionId) {
    throw new DomainError(
      "Outra pessoa gravou este orquestrador depois que você o abriu. Atualize para ver a versão atual; o que você alterou continua na tela.",
      "ORCHESTRATOR_VERSION_CONFLICT",
      409,
      { currentVersionId: current.current_version_id, publishedByName: current.name },
    )
  }
}

/** Todos os agentes existem na organização e já foram publicados (PEN-047: "Não publicado" não entra em produção). */
export async function assertAgentsPublished(client: Queryable, organizationId: string, agentIds: string[]): Promise<void> {
  const unique = [...new Set(agentIds)]
  if (unique.length === 0) return
  const rows = (await client.query<{ id: string; name: string; current_version_id: string | null }>(`select id, name, current_version_id from agents where id = any($1::uuid[]) and organization_id = $2`, [unique, organizationId])).rows
  for (const agentId of unique) {
    const agent = rows.find((row) => row.id === agentId)
    if (!agent) throw new DomainError("Um dos agentes selecionados não existe mais.", "ORCHESTRATOR_AGENT_NOT_FOUND", 404)
    if (!agent.current_version_id) throw new DomainError(`O agente "${agent.name}" ainda não foi publicado. Publique-o antes de usá-lo num orquestrador.`, "ORCHESTRATOR_AGENT_NOT_PUBLISHED", 422, { agentId })
  }
}

/** Especialistas do Orquestrador (substitui a lista inteira). Nenhuma versão de agente é fixada: vale a vigente de cada um. */
export async function syncSpecialists(client: Queryable, organizationId: string, orchestratorId: string, specialistAgentIds: string[]): Promise<void> {
  const unique = [...new Set(specialistAgentIds)]
  await assertAgentsPublished(client, organizationId, unique)
  await client.query(`delete from assistant_orchestrator_specialists where orchestrator_id = $1`, [orchestratorId])
  for (const agentId of unique) {
    await client.query(`insert into assistant_orchestrator_specialists(orchestrator_id, agent_id, tool_name) values ($1,$2,$3)`, [orchestratorId, agentId, toolNameForAgent(agentId)])
  }
}

/** Publica a configuração gravada como versão nova, imutável e vigente do Orquestrador. */
export async function publishOrchestratorVersion(client: Queryable, organizationId: string, orchestratorId: string, actor: OrchestratorActor): Promise<{ id: string; number: number }> {
  const created = await client.query<{ id: string; number: number }>(
    `insert into assistant_orchestrator_versions (organization_id, orchestrator_id, version_number, config, origin, published_by_person_id, published_by_name)
     select o.organization_id, o.id,
            coalesce((select max(v.version_number) from assistant_orchestrator_versions v where v.orchestrator_id = o.id), 0) + 1,
            jsonb_build_object(
              'name', o.name, 'scopeType', o.scope_type, 'teamId', o.team_id, 'subteamId', o.subteam_id,
              'invocationMode', o.invocation_mode, 'outputInstructions', o.output_instructions, 'outputSchema', o.output_schema,
              'policyKind', o.policy_kind, 'policyDomains', to_jsonb(o.policy_domains), 'routingPolicy', o.routing_policy,
              'routingDomains', to_jsonb(o.routing_domains), 'structuredOutput', o.structured_output,
              'recommendSupportMaterials', o.recommend_support_materials,
              'domainIds', coalesce((select jsonb_agg(d.business_domain_id order by d.business_domain_id) from assistant_orchestrator_domains d where d.orchestrator_id = o.id), '[]'::jsonb),
              'orchestratorAgentId', o.orchestrator_agent_id,
              'specialists', coalesce((select jsonb_agg(jsonb_build_object('agentId', s.agent_id, 'toolName', s.tool_name) order by s.agent_id)
                                         from assistant_orchestrator_specialists s where s.orchestrator_id = o.id), '[]'::jsonb)
            ),
            'PUBLISH', $3, $4
       from assistant_orchestrators o where o.id = $1 and o.organization_id = $2
     returning id, version_number "number"`,
    [orchestratorId, organizationId, actor.personId, actor.name],
  )
  const version = created.rows[0]!
  await client.query(`update assistant_orchestrators set current_version_id = $2 where id = $1`, [orchestratorId, version.id])
  return version
}

/** `agentVersionNumber` só aparece nas versões gravadas antes da revisão de 03/11/2026, que registravam a versão do agente (histórico). */
export type OrchestratorVersionSummary = { id: string; number: number; origin: "MIGRATION" | "PUBLISH"; publishedAt: string; publishedByName: string; current: boolean; specialists: { agentId: string; agentName: string | null; agentVersionId: string | null; agentVersionNumber: number | null }[]; orchestratorAgentVersionNumber: number | null }

export async function listOrchestratorVersions(db: Queryable, organizationId: string, orchestratorId: string): Promise<OrchestratorVersionSummary[]> {
  return (await db.query<OrchestratorVersionSummary>(
    `select v.id, v.version_number "number", v.origin, v.published_at "publishedAt", v.published_by_name "publishedByName", (o.current_version_id = v.id) "current",
            (select av.version_number from agent_versions av where av.id = (v.config->>'orchestratorAgentVersionId')::uuid) "orchestratorAgentVersionNumber",
            coalesce((select json_agg(json_build_object('agentId', s->>'agentId', 'agentName', a.name, 'agentVersionId', s->>'agentVersionId', 'agentVersionNumber', av.version_number) order by a.name)
                        from jsonb_array_elements(coalesce(v.config->'specialists', '[]'::jsonb)) s
                        left join agents_all a on a.id = (s->>'agentId')::uuid
                        left join agent_versions av on av.id = (s->>'agentVersionId')::uuid), '[]') "specialists"
       from assistant_orchestrator_versions v join assistant_orchestrators o on o.id = v.orchestrator_id
      where v.orchestrator_id = $1 and v.organization_id = $2
      order by v.version_number desc`,
    [orchestratorId, organizationId],
  )).rows
}
