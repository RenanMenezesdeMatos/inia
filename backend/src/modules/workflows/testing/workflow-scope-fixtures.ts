import type { Database } from "../../../infrastructure/database/pool.js"

type Queryable = Pick<Database, "query">

/**
 * Provas que inserem Workflow por SQL direto (249): a Abrangência por Grupo/Subgrupo é `scope_type = 'GROUPS'` + vínculos em
 * `workflow_scope_links` (publicada) e `draft_scope_links` (rascunho) — `team_id`/`subteam_id` do Workflow ficam nulos (check constraint).
 * Subgrupo sem Grupo informado recebe o Grupo-pai real.
 */
export async function linkWorkflowScope(db: Queryable, workflowId: string, links: readonly { teamId?: string | null; subteamId?: string | null }[]): Promise<void> {
  if (links.length === 0) return
  await db.query(
    `with wanted as (
       select coalesce(l.t, (select st.team_id from subteams st where st.id = l.s)) team_id, l.s subteam_id
         from unnest($2::uuid[], $3::uuid[]) as l(t, s)
     ), inserted as (
       insert into workflow_scope_links (workflow_id, organization_id, team_id, subteam_id)
       select w.id, w.organization_id, wanted.team_id, wanted.subteam_id from workflows_all w cross join wanted where w.id = $1
       on conflict do nothing
     )
     update workflows_all w
        set scope_type = 'GROUPS', draft_scope_type = 'GROUPS',
            draft_scope_links = (select jsonb_agg(jsonb_build_object('teamId', wanted.team_id, 'subteamId', wanted.subteam_id)) from wanted)
      where w.id = $1`,
    [workflowId, links.map((link) => link.teamId ?? null), links.map((link) => link.subteamId ?? null)],
  )
}
