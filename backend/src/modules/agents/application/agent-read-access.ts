import type { Database } from "../../../infrastructure/database/pool.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import type { ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { canReadAgentConfig, type AgentScopeLike } from "./agent-config-rules.js"
import { loadAgentLifecycle } from "./agent-versions.js"

/**
 * LEITURA POR ALCANCE do que o agente guarda de outras configurações: execuções e alcances de versões antigas. A regra é a de
 * `canReadAgentConfig`; aqui ficam os casos em que o alcance não foi guardado (registros antigos), que falham fechado. Saiu do router de
 * agentes (run-8, ARQ-02).
 */

/** Alcance de uma configuração guardada em JSON (versão, conteúdo testado), sem o resto dela — formato legado ou 249 (`scopeLinks`). */
export const configScopeSql = (config: string) =>
  `case when ${config} is null then null else jsonb_build_object('scopeType', ${config}->>'scopeType', 'teamId', ${config}->>'teamId', 'subteamId', ${config}->>'subteamId', 'scopeLinks', coalesce(${config}->'scopeLinks', '[]'::jsonb)) end`

/** Quem lê alcança todos os alcances que o agente já teve: o da linha viva, o do rascunho e o de cada versão publicada. */
export async function readsEveryAgentScope(db: Pick<Database, "query">, organizationId: string, agentId: string, access: { scope: ResourceScope; scopes: ManageableScopes }): Promise<boolean> {
  if (access.scopes.unrestricted || access.scopes.allTeams) return true
  const versions = await db.query<NonNullable<AgentScopeLike>>(
    `select distinct v.config->>'scopeType' "scopeType", v.config->>'teamId' "teamId", v.config->>'subteamId' "subteamId", coalesce(v.config->'scopeLinks', '[]'::jsonb) "scopeLinks"
       from agent_versions v where v.agent_id = $1 and v.organization_id = $2`,
    [agentId, organizationId],
  )
  const draft = (await loadAgentLifecycle(db, organizationId, agentId))?.draftConfig ?? null
  return [access.scope, draft, ...versions.rows].every((scope) => canReadAgentConfig(access.scopes, scope))
}

export type AgentRunRow = {
  id: string; source: string; inputContext: string | null; outputText: string | null; status: string; errorMessage: string | null; model: string | null; caseId: string | null
  createdAt: string; completedAt: string | null; agentVersionId: string | null; agentVersionNumber: number | null; runTarget: string | null; hasTestedConfig: boolean; configScope: AgentScopeLike | null
}

/**
 * Execução de uma configuração de outro alcance: só id, origem, situação, datas e versão — a entrada e a saída também ficam de fora.
 * Execução anterior à migration 164 (sem versão nem conteúdo testado) não guarda o alcance: falha fechado como o histórico antigo — o
 * conteúdo dela só sai para quem alcança TODOS os alcances que o agente já teve (`readsLegacyRuns` = `readsEveryAgentScope`).
 */
export function readableRun(scopes: ManageableScopes, { configScope, ...run }: AgentRunRow, readsLegacyRuns: boolean) {
  if (configScope ? canReadAgentConfig(scopes, configScope) : readsLegacyRuns) return { ...run, restricted: false }
  return { ...run, inputContext: null, outputText: null, errorMessage: null, model: null, caseId: null, hasTestedConfig: false, restricted: true }
}
