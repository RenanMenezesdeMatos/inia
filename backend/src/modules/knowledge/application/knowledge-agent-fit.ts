import type { ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"

/**
 * A BASE CABE NO AGENTE? Regra ÚNICA do Grupo (achado A-F07; run-8, ARQ-03; vários vínculos desde a 249, 23/11/2026): agente de "todos
 * os Grupos" aceita qualquer base da organização; agente de Grupos/Subgrupos aceita base global ou que valha para CADA um dos Grupos
 * efetivos dele (o Grupo de um vínculo de Subgrupo é o pai dele — "Subgrupo leva o Grupo-pai", como antes; a base de Subgrupo conta pelo
 * Grupo-pai do Subgrupo dela). Base de um Grupo que o agente não atende levaria o conteúdo dela às respostas para gente de fora desse
 * Grupo — e a recuperação não sabe quem pergunta, só o agente. Por isso, com vários vínculos vale "todos", nunca "algum" (run-10
 * QA-01/SEA-02: com "algum", a base só do Grupo A chegava a quem é do Grupo B por um agente de A + B). Com um vínculo só, é a regra de sempre.
 *
 * Os cinco usos leem daqui: a recusa ao salvar o agente (`agent-config-rules.ts`), a autorização de cada execução
 * (`agent-execution-authorization.ts`), os agentes que a base oferece (`agent-knowledge-links.ts`), as bases que o seletor do agente
 * oferece (`agent-knowledge-options.ts`) e a recuperação a cada pergunta (`retrieve-knowledge.ts`). A tela repete a regra só para avisar
 * antes de salvar (`picker-rules.ts`, `fitsAgentScope`); o caderno `knowledge/testing/knowledge-agent-fit-cases.ts` roda contra esta SQL
 * (prova de banco) e contra a cópia da tela.
 */

/**
 * Expressões SQL do alcance do agente: `scopeType` (texto: ALL_TEAMS, GROUPS ou o legado TEAM/SUBTEAM) e `teamIds` (uuid[] dos Grupos
 * efetivos — o Grupo de cada vínculo). Use `agentTeamIdsOf` (parâmetro), `liveAgentTeamIdsSql` (linha viva) ou `configAgentTeamIdsSql` (JSON).
 */
export type AgentScopeSql = { scopeType: string; teamIds: string }

/** Grupos efetivos de um alcance (cada vínculo leva o Grupo dele; Subgrupo → o Grupo-pai). ALL_TEAMS = nenhum (tratado à parte). */
export function agentTeamIdsOf(scope: ResourceScope): string[] {
  return [...new Set(scope.links.map((link) => link.teamId))]
}

/** Grupos efetivos da linha viva do agente (`agent_scope_links`). */
export const liveAgentTeamIdsSql = (agentIdExpr: string) => `array(select fit_asl.team_id from agent_scope_links fit_asl where fit_asl.agent_id = ${agentIdExpr})`

/**
 * Grupos efetivos de uma configuração guardada em JSON (rascunho/versão): `scopeLinks` (249) ou o formato legado TEAM/SUBTEAM (com o
 * Grupo-pai gravado; sem ele, o pai real do Subgrupo).
 */
export const configAgentTeamIdsSql = (configExpr: string) =>
  `array(select (fit_l->>'teamId')::uuid from jsonb_array_elements(case when jsonb_typeof(${configExpr}->'scopeLinks') = 'array' then ${configExpr}->'scopeLinks' else '[]'::jsonb end) fit_l
         union select coalesce((${configExpr}->>'teamId')::uuid, (select fit_cs.team_id from subteams fit_cs where fit_cs.id = (${configExpr}->>'subteamId')::uuid))
          where ${configExpr}->>'scopeType' in ('TEAM', 'SUBTEAM'))`

/**
 * Condição SQL: a base `documentId` (expressão) cabe no agente com o alcance `agent` — global, ou valendo para CADA Grupo efetivo do
 * agente. Agente sem vínculo nenhum só aceita base global (ausência nunca vira "todos").
 */
export function knowledgeFitsAgentSql(documentId: string, agent: AgentScopeSql): string {
  return `(${agent.scopeType} = 'ALL_TEAMS'
    or exists (select 1 from knowledge_document_org_scopes fit_og where fit_og.knowledge_document_id = ${documentId} and fit_og.scope_type = 'ALL_TEAMS')
    or (cardinality(${agent.teamIds}) > 0 and not exists (
      select 1 from unnest(${agent.teamIds}) fit_t(team_id)
       where not exists (
         select 1 from knowledge_document_org_scopes fit_os left join subteams fit_ost on fit_ost.id = fit_os.subteam_id
          where fit_os.knowledge_document_id = ${documentId} and coalesce(fit_os.team_id, fit_ost.team_id) = fit_t.team_id))))`
}
