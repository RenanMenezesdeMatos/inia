/**
 * A BASE CABE NO AGENTE? Regra ÚNICA do Grupo (achado A-F07; run-8, ARQ-03): agente de "todos os Grupos" aceita qualquer base da
 * organização; agente de Grupo ou de Subgrupo aceita base global ou do MESMO Grupo (o Grupo do agente de Subgrupo é o pai dele; a base
 * de Subgrupo conta pelo Grupo-pai do Subgrupo dela). Base de outro Grupo levaria o conteúdo dela às respostas que o agente dá para
 * gente de fora desse Grupo.
 *
 * Os cinco usos leem daqui: a recusa ao salvar o agente (`agent-config-rules.ts`), a autorização de cada execução
 * (`agent-execution-authorization.ts`), os agentes que a base oferece (`agent-knowledge-links.ts`), as bases que o seletor do agente
 * oferece (`agent-knowledge-options.ts`) e a recuperação a cada pergunta (`retrieve-knowledge.ts`). A tela repete a regra só para avisar
 * antes de salvar (`picker-rules.ts`, `fitsAgentScope`); o caderno `knowledge/testing/knowledge-agent-fit-cases.ts` roda contra esta SQL
 * (prova de banco) e contra a cópia da tela.
 */

/** Expressões SQL do alcance do agente (colunas, parâmetros com o tipo, ou literais). */
export type AgentScopeSql = { scopeType: string; teamId: string; subteamId: string }

/** Grupo do agente em SQL: o próprio (TEAM) ou o pai do Subgrupo (SUBTEAM). Sem sentido para ALL_TEAMS. */
const agentTeamSql = (agent: AgentScopeSql) =>
  `case when ${agent.scopeType} = 'SUBTEAM' then (select fit_ast.team_id from subteams fit_ast where fit_ast.id = ${agent.subteamId}) else ${agent.teamId} end`

/** Condição SQL: a base `documentId` (expressão) cabe no agente com o alcance `agent`. */
export function knowledgeFitsAgentSql(documentId: string, agent: AgentScopeSql): string {
  return `(${agent.scopeType} = 'ALL_TEAMS' or exists (
    select 1 from knowledge_document_org_scopes fit_os left join subteams fit_ost on fit_ost.id = fit_os.subteam_id
     where fit_os.knowledge_document_id = ${documentId}
       and (fit_os.scope_type = 'ALL_TEAMS' or coalesce(fit_os.team_id, fit_ost.team_id) = ${agentTeamSql(agent)})))`
}
