import type { Database } from "../../../infrastructure/database/pool.js"
import { ineligibleScopeUnits } from "../../org-structure/application/scope-unit-options.js"

/**
 * Grupos que as provas de banco podem escolher num alcance NOVO de agente (249): vínculo novo precisa ter ao menos um operador "Em
 * produção" (`assertNewScopeLinksAdmissible`). Antes as provas pegavam "os dois primeiros Grupos pelo nome", e um Grupo sem operador em
 * produção na massa de teste passou a ser recusado (422 SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS). Ordem: nome.
 */
export async function eligibleProofTeamIds(db: Pick<Database, "query">, organizationId: string, count: number): Promise<string[]> {
  const teams = (await db.query<{ id: string }>(`select id from teams where organization_id = $1 order by name`, [organizationId])).rows.map((row) => row.id)
  const ineligible = new Set((await ineligibleScopeUnits(db, organizationId, teams.map((teamId) => ({ teamId, subteamId: null })))).map((unit) => unit.teamId))
  const eligible = teams.filter((id) => !ineligible.has(id)).slice(0, count)
  if (eligible.length < count) throw new Error(`A massa de teste tem ${eligible.length} Grupo(s) com operador em produção; a prova precisa de ${count}.`)
  return eligible
}

/**
 * Workflow inserido direto no banco por uma prova, no formato da 249: ALL_TEAMS, ou GROUPS + um vínculo com o Grupo inteiro em
 * `workflow_scope_links` (as colunas `team_id`/`subteam_id` ficam nulas — check constraint).
 */
export async function linkProofWorkflowToTeam(db: Pick<Database, "query">, organizationId: string, workflowId: string, teamId: string | null): Promise<void> {
  if (!teamId) return
  await db.query(`insert into workflow_scope_links (workflow_id, organization_id, team_id) values ($1, $2, $3)`, [workflowId, organizationId, teamId])
  await db.query(`update workflows_all set draft_scope_links = jsonb_build_array(jsonb_build_object('teamId', $2::text, 'subteamId', null)) where id = $1`, [workflowId, teamId])
}

/** Snapshot da versão do Workflow inserida pela prova (249): o mesmo alcance da linha (GROUPS + o Grupo inteiro), como a publicação grava. */
export async function linkProofWorkflowVersionToTeam(db: Pick<Database, "query">, versionId: string, teamId: string | null): Promise<void> {
  if (!teamId) return
  await db.query(`update workflow_versions set scope_type = 'GROUPS', scope_links = jsonb_build_array(jsonb_build_object('teamId', $2::text, 'subteamId', null)) where id = $1`, [versionId, teamId])
}
