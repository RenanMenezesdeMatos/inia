import type { Database } from "../../../infrastructure/database/pool.js"

export type WorkflowCitationStatus = "ACTIVE" | "INACTIVE" | "DRAFT"

export type WorkflowCitation = {
  id: string
  name: string
  scope_type: string
  team_id: string | null
  subteam_id: string | null
  status: WorkflowCitationStatus
  /** Etapas do Workflow que citam o recurso. */
  labels: string[]
}

/**
 * Regra única de "este Workflow depende do recurso", usada pela exclusão de Orquestrador. A citação fica no grafo, sem chave
 * estrangeira. Contam o rascunho, a versão publicada vigente e a versão de uma execução ainda em andamento, com o Workflow ativo,
 * inativo ou nunca publicado. Versão antiga sem execução em andamento não conta.
 */
export async function loadWorkflowsCitingNode(
  db: Pick<Database, "query">,
  organizationId: string,
  citation: { configKey: "agentId" | "orchestratorId"; id: string; defaultLabel: string },
): Promise<WorkflowCitation[]> {
  return (
    await db.query<WorkflowCitation>(
      `with graphs as (
         select w.id, w.draft_graph graph from workflows w where w.organization_id = $1
         union all
         select w.id, v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.organization_id = $1
         union all
         select distinct w.id, v.graph from workflow_enrollments e join workflow_versions v on v.id = e.version_id join workflows w on w.id = v.workflow_id
          where w.organization_id = $1 and e.status in ('active', 'waiting')
       ), hits as (
         select g.id, coalesce(nullif(n->>'label', ''), $4::text) label
           from graphs g cross join lateral jsonb_array_elements(coalesce(g.graph->'nodes', '[]'::jsonb)) n
          where n->'config'->>($3::text) = $2
       )
       select w.id, w.name, w.scope_type, w.team_id, w.subteam_id,
              case when w.active then 'ACTIVE' when w.active_version_id is null then 'DRAFT' else 'INACTIVE' end "status",
              array_agg(distinct h.label order by h.label) "labels"
         from hits h join workflows w on w.id = h.id
        group by w.id, w.name, w.scope_type, w.team_id, w.subteam_id, w.active, w.active_version_id
        order by w.name`,
      [organizationId, citation.id, citation.configKey, citation.defaultLabel],
    )
  ).rows
}

/**
 * Workflows cujo gatilho usa a flag, publicado ou em rascunho, ou que têm execução em andamento numa versão que a cita. Sem isto, excluir a flag faria o Workflow parar de disparar sem aviso:
 * a carga passa a recusar a flag, e nada no Workflow diz por quê.
 */
export async function loadWorkflowsCitingFlag(db: Pick<Database, "query">, organizationId: string, channelFlagId: string): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `with docs as (
       select w.id, w.draft_graph doc from workflows w where w.organization_id = $1
       union all
       select w.id, w.trigger_config from workflows w where w.organization_id = $1 and w.trigger_config is not null
       union all
       select w.id, w.draft_trigger_config from workflows w where w.organization_id = $1 and w.draft_trigger_config is not null
       union all
       select w.id, v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.organization_id = $1
       union all
       select w.id, v.graph from workflow_enrollments e join workflow_versions v on v.id = e.version_id join workflows w on w.id = v.workflow_id where w.organization_id = $1 and e.status in ('active', 'waiting')
     )
     select distinct w.name from docs d join workflows w on w.id = d.id
      where jsonb_path_exists(d.doc, '$.** ? (@.channelFlagId == $id)', jsonb_build_object('id', $2::text))
      order by w.name`,
    [organizationId, channelFlagId],
  )
  return rows.rows.map((row) => row.name)
}
