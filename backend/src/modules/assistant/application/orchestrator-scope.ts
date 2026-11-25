import { type OrgUnitFilter } from "../../../shared/infrastructure/database/unit-filter.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { resourceScopeOf, type ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import type { SqlFilter } from "../../../shared/presentation/list-query.js"
import { scopesAreCompatible, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { loadResourceScopeLinks, scopedTargetOf } from "../../org-structure/application/resource-scope-links.js"

/**
 * ALCANCE DO ORQUESTRADOR (migration 249, 23/11/2026): `ALL_TEAMS` (todos os Grupos e Subgrupos do universo dele, inclusive os criados
 * depois) ou `GROUPS` com N vínculos em `assistant_orchestrator_scope_links` (cada um um Grupo inteiro ou UM Subgrupo). As colunas
 * `team_id`/`subteam_id` do registro ficam sempre nulas; snapshots de versão antigos ainda trazem TEAM/SUBTEAM (lidos por `resourceScopeOf`).
 */

type Queryable = Pick<Database, "query">

/** Alcance gravado de vários Agentes (coluna `scope_type` + vínculos), para conferir especialistas contra o Orquestrador. */
export async function loadAgentScopedTargets(db: Queryable, agentIds: readonly string[]): Promise<Map<string, { name: string; target: ScopedTarget }>> {
  const unique = [...new Set(agentIds)]
  const result = new Map<string, { name: string; target: ScopedTarget }>()
  if (unique.length === 0) return result
  const rows = (await db.query<{ id: string; name: string; scope_type: string; team_id: string | null; subteam_id: string | null }>(
    `select id, name, scope_type, team_id, subteam_id from agents where id = any($1::uuid[])`,
    [unique],
  )).rows
  const links = await loadResourceScopeLinks(db, "AGENT", rows.filter((row) => row.scope_type === "GROUPS").map((row) => row.id))
  for (const row of rows) {
    // GROUPS = os vínculos gravados; formato legado (anterior à 249) lido com o mesmo alcance.
    const scope: ResourceScope = row.scope_type === "GROUPS" ? { scopeType: "GROUPS", links: links.get(row.id) ?? [] } : resourceScopeOf({ scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id })
    result.set(row.id, { name: row.name, target: scopedTargetOf(scope) })
  }
  return result
}

/**
 * Lista de Orquestradores (coluna `q.id`/`q."scopeType"` do SELECT): só o que quem consulta administra INTEIRO — `ALL_TEAMS` exige a
 * organização; `GROUPS` exige que TODOS os vínculos estejam no escopo (a mesma regra de `canManageScope`, no banco para a paginação).
 */
export function applyOrchestratorManageableFilter(scopes: ManageableScopes, filter: SqlFilter, alias = "q") {
  if (scopes.unrestricted || scopes.allTeams) return
  const teamIds = filter.param([...scopes.teamIds])
  const subteamIds = filter.param([...scopes.subteamIds])
  filter.add(
    `(${alias}."scopeType" = 'GROUPS'
      and exists (select 1 from assistant_orchestrator_scope_links l where l.orchestrator_id = ${alias}.id)
      and not exists (select 1 from assistant_orchestrator_scope_links l where l.orchestrator_id = ${alias}.id
                        and not coalesce((l.subteam_id is null and l.team_id = any(${teamIds}::uuid[])) or l.subteam_id = any(${subteamIds}::uuid[]), false)))`,
  )
}

/** Filtros de Grupo/Subgrupo da lista: Grupo = algum vínculo naquele Grupo (inteiro ou Subgrupo dele); Subgrupo = vínculo naquele Subgrupo. */
export function applyOrchestratorScopeListFilter(filter: SqlFilter, input: OrgUnitFilter & { scopeType?: string | undefined }, alias = "q") {
  const units = filter.units({ team: "l.team_id", subteam: "l.subteam_id" }, input)
  if (units) filter.add(`exists (select 1 from assistant_orchestrator_scope_links l where l.orchestrator_id = ${alias}.id and ${units})`)
  else if (input.scopeType === "ALL_TEAMS") filter.add(`${alias}."scopeType" = 'ALL_TEAMS'`)
}

const ORGANIZATION_LOCK_PREFIX = "assistant_orchestrator_interactive_scope:"

export type OrchestratorScopeConflict = { orchestratorId: string; name: string; units: string[] }

/**
 * UM Orquestrador por pessoa no chat/voz: gravar ou ativar um Orquestrador INTERACTIVE/BOTH com um vínculo IDÊNTICO a um vínculo de
 * outro ativo INTERACTIVE/BOTH da mesma organização e do mesmo universo é recusado (409 `ORCHESTRATOR_SCOPE_OVERLAP`, com os nomes e
 * os Grupos/Subgrupos em conflito) — a mesma regra dos alinhamentos (`sharedLinks`). Grupo inteiro × Subgrupo dele NÃO é conflito: no
 * Subgrupo, o vínculo dele é mais específico e vence (`resolveOrchestratorForSubject`). "Todos os Grupos" × "Todos os Grupos" do mesmo
 * universo também é recusado aqui (`ORCHESTRATOR_SCOPE_TAKEN`; o índice `uq_assistant_orchestrator_active_all_teams` é a rede de segurança).
 *
 * Lê o estado FINAL do registro (chamar depois de gravar tudo, na mesma transação) e trava a organização com `pg_advisory_xact_lock`:
 * duas gravações simultâneas nunca passam as duas (o índice único não cobre os vínculos).
 */
export async function assertNoInteractiveScopeOverlap(client: Queryable, organizationId: string, orchestratorId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`${ORGANIZATION_LOCK_PREFIX}${organizationId}`])
  const self = (await client.query<{ scope_type: string; active: boolean; invocation_mode: string; operating_universe: string | null }>(
    `select scope_type, active, invocation_mode, operating_universe from assistant_orchestrators where id = $1 and organization_id = $2`,
    [orchestratorId, organizationId],
  )).rows[0]
  if (!self || !self.active || !["INTERACTIVE", "BOTH"].includes(self.invocation_mode)) return
  if (self.scope_type === "ALL_TEAMS") {
    const taken = (await client.query<{ name: string }>(
      `select name from assistant_orchestrators
        where organization_id = $1 and id <> $2 and active and invocation_mode in ('INTERACTIVE', 'BOTH') and scope_type = 'ALL_TEAMS'
          and (operating_universe is not distinct from $3 or operating_universe is null or $3::text is null)
        order by name`,
      [organizationId, orchestratorId, self.operating_universe],
    )).rows
    if (taken.length > 0) {
      throw new DomainError(
        `Já existe um orquestrador ativo atendendo o chat/voz em "Todos os Grupos e Subgrupos" neste universo: "${taken.map((row) => row.name).join('", "')}". Desative-o, ou restrinja um dos dois a "Só workflows", pra evitar que os dois disputem quem responde o operador.`,
        "ORCHESTRATOR_SCOPE_TAKEN",
        409,
        { conflicts: taken.map((row) => ({ name: row.name })) },
      )
    }
    return
  }
  const rows = (await client.query<{ orchestrator_id: string; name: string; team_id: string; subteam_id: string | null; unit_name: string }>(
    `select other.id orchestrator_id, other.name, ol.team_id, ol.subteam_id,
            case when ol.subteam_id is null then t.name else t.name || ' › ' || st.name end unit_name
       from assistant_orchestrator_scope_links mine
       join assistant_orchestrator_scope_links ol on ol.team_id = mine.team_id and ol.subteam_id is not distinct from mine.subteam_id and ol.orchestrator_id <> mine.orchestrator_id
       join assistant_orchestrators other on other.id = ol.orchestrator_id
       join teams t on t.id = ol.team_id
       left join subteams st on st.id = ol.subteam_id
      where mine.orchestrator_id = $1 and other.organization_id = $2 and other.active and other.invocation_mode in ('INTERACTIVE', 'BOTH')
        and other.scope_type = 'GROUPS' and (other.operating_universe is not distinct from $3 or other.operating_universe is null or $3::text is null)
      order by other.name, t.name, st.name nulls first`,
    [orchestratorId, organizationId, self.operating_universe],
  )).rows
  if (rows.length === 0) return
  const conflicts = new Map<string, OrchestratorScopeConflict>()
  for (const row of rows) {
    const entry = conflicts.get(row.orchestrator_id) ?? { orchestratorId: row.orchestrator_id, name: row.name, units: [] }
    entry.units.push(row.unit_name)
    conflicts.set(row.orchestrator_id, entry)
  }
  const list = [...conflicts.values()]
  throw new DomainError(
    `Outro orquestrador ativo já atende o chat/voz nos mesmos Grupos/Subgrupos: ${list.map((entry) => `"${entry.name}" (${entry.units.join(", ")})`).join("; ")}. Tire esses Grupos/Subgrupos de um dos dois, desative um deles ou restrinja um a "Só workflows". Um Subgrupo dentro de um Grupo inteiro do outro pode ficar: ali o do Subgrupo vence.`,
    "ORCHESTRATOR_SCOPE_OVERLAP",
    409,
    { conflicts: list },
  )
}

/**
 * Nunca vazamento cross-group (Parte 6/24 do pedido): o agente orquestrador e cada especialista
 * de um Orchestrator precisam estar disponíveis pro escopo DELE — um Orchestrator FATURAS não
 * pode silenciosamente usar um Agent exclusivo de RETENÇÃO. Reaproveita scopesAreCompatible,
 * mesma função usada pra validar Orchestrator dentro de um Workflow.
 */
export async function assertAgentsCompatibleWithOrchestratorScope(db: Queryable, orchestratorScope: ScopedTarget, agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) return
  const uniqueIds = [...new Set(agentIds)]
  // Alcance de cada Agent pelos vínculos dele (249): o Agent serve se for de "Todos os Grupos" ou se os Grupos dele cobrirem TODOS os
  // Grupos do Orquestrador (`scopesAreCompatible`).
  const agents = await loadAgentScopedTargets(db, uniqueIds)
  const missingId = uniqueIds.find((id) => !agents.has(id))
  if (missingId) throw new DomainError("Um dos agentes selecionados não existe mais.", "ORCHESTRATOR_AGENT_NOT_FOUND", 404)
  for (const agent of agents.values()) {
    if (!(await scopesAreCompatible(db, orchestratorScope, agent.target))) {
      throw new DomainError(`O agente "${agent.name}" não atende todos os Grupos deste orquestrador (precisa ser de "Todos os Grupos" ou ter cada Grupo dele).`, "ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN", 422)
    }
  }
}
