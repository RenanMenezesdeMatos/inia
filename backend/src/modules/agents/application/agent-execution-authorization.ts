import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { scopesAreCompatible, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import type { AgentRuntimeSnapshot } from "../domain/agent-config.js"

/**
 * Condição de segurança da revisão aprovada da PEN-002/PEN-076 (03/11/2026): com a atualização automática, a versão VIGENTE de
 * um agente passa a valer para todos os consumidores sem republicá-los — e por isso a autorização é conferida A CADA EXECUÇÃO,
 * no contexto dela, e nunca herdada da publicação:
 * - organização: só agente e bases da organização da execução (a leitura da versão já filtra pela organização);
 * - alcance: o consumidor (Workflow ou Orquestrador) precisa estar coberto pelo alcance da versão vigente — uma versão nova
 *   restrita a outro Grupo não passa a atender quem estava fora dele;
 * - bases: toda base da versão que existe precisa continuar autorizada para o alcance da versão (base que passou a valer só para
 *   outro Grupo bloqueia a execução — não é filtrada em silêncio);
 * - ferramentas e limites: valem os da versão, sempre dentro do consumidor (o nó do Workflow continua restringindo as
 *   ferramentas; as ferramentas investigam só o sujeito e a organização da execução).
 * Bloqueio = a execução não começa e o motivo fica registrado, sem expor o que é restrito. Publicar não concede permissão a
 * ninguém: nenhuma permissão de pessoa ou processo depende da versão.
 */

export type ExecutionDenialReason = "SCOPE" | "KNOWLEDGE"

export const EXECUTION_DENIAL_MESSAGES: Record<ExecutionDenialReason, string> = {
  SCOPE: "A versão vigente do agente não está autorizada para este contexto (alcance do agente).",
  KNOWLEDGE: "A versão vigente do agente usa uma base de conhecimento que não está autorizada para o alcance dele.",
}

/** Execução impedida pela autorização do contexto — o motor registra como "Bloqueada" com o motivo; o chat e a voz, como parte indisponível. */
export class AgentAccessBlockedError extends DomainError {
  constructor(
    readonly agentId: string,
    readonly agentName: string,
    readonly agentVersionId: string | null,
    readonly agentVersionNumber: number | null,
    readonly reason: ExecutionDenialReason,
  ) {
    super(EXECUTION_DENIAL_MESSAGES[reason], "AGENT_ACCESS_NOT_AUTHORIZED", 422, { agentId, reason })
  }
}

const scopeOf = (snapshot: AgentRuntimeSnapshot): ScopedTarget => ({ scopeType: snapshot.config.scopeType, teamId: snapshot.config.teamId, subteamId: snapshot.config.subteamId })

/** Motivo do bloqueio, ou null quando a versão pode executar para este consumidor. */
export async function executionDenialFor(db: Database, snapshot: AgentRuntimeSnapshot, consumer: ScopedTarget | null): Promise<ExecutionDenialReason | null> {
  if (consumer && !(await scopesAreCompatible(db, consumer, scopeOf(snapshot)))) return "SCOPE"
  const ids = [...new Set(snapshot.config.knowledgeDocumentIds)]
  if (ids.length === 0) return null
  const rows = (await db.query<{ id: string; same_org: boolean; allowed: boolean }>(
    `with agent_scope as (select $3::text scope_type, case when $3 = 'SUBTEAM' then (select st.team_id from subteams st where st.id = $5::uuid) else $4::uuid end team_id)
     select d.id, d.organization_id = $2 same_org,
            (a.scope_type = 'ALL_TEAMS' or exists (
              select 1 from knowledge_document_org_scopes os left join subteams st on st.id = os.subteam_id
               where os.knowledge_document_id = d.id and (os.scope_type = 'ALL_TEAMS' or coalesce(os.team_id, st.team_id) = a.team_id))) allowed
       from knowledge_documents d cross join agent_scope a
      where d.id = any($1::uuid[]) and d.deleted_at is null`,
    [ids, snapshot.organizationId, snapshot.config.scopeType, snapshot.config.teamId, snapshot.config.subteamId],
  )).rows
  return rows.some((row) => !row.same_org || !row.allowed) ? "KNOWLEDGE" : null
}

export async function assertExecutionAuthorized(db: Database, snapshot: AgentRuntimeSnapshot, consumer: ScopedTarget | null): Promise<void> {
  const reason = await executionDenialFor(db, snapshot, consumer)
  if (reason) throw new AgentAccessBlockedError(snapshot.agentId, snapshot.config.name, snapshot.versionId, snapshot.versionNumber, reason)
}

/**
 * Registro durável de um especialista deixado de fora pela autorização (orquestrador no chat, na voz ou no Workflow): um por
 * agente × versão × consumidor × motivo, sem repetir a cada mensagem. Visível na auditoria; não expõe nada ao colaborador.
 */
export async function recordExecutionDenial(db: Pick<Database, "query">, input: { organizationId: string; agentId: string; agentVersionId: string | null; consumerKind: "ORCHESTRATOR"; consumerId: string; reason: ExecutionDenialReason }): Promise<void> {
  await db.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
     select $1, null, 'AGENT_EXECUTION_BLOCKED', 'agent', $2, $3
      where not exists (select 1 from audit_logs where organization_id = $1 and action = 'AGENT_EXECUTION_BLOCKED' and entity_id = $2
                          and payload->>'agentVersionId' is not distinct from $4 and payload->>'consumerId' = $5 and payload->>'reason' = $6)`,
    [input.organizationId, input.agentId, JSON.stringify({ agentVersionId: input.agentVersionId, consumerKind: input.consumerKind, consumerId: input.consumerId, reason: input.reason }), input.agentVersionId, input.consumerId, input.reason],
  )
}
