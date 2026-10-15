import type { Database } from "../../../infrastructure/database/pool.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import type { TriggerConfig } from "../domain/trigger-config-schema.js"
import type { WorkflowConfiguration } from "../domain/workflow-configuration.js"

type Queryable = Pick<Database, "query">

/**
 * Linha do Workflow como o editor e a publicação precisam dela: a configuração do RASCUNHO nos campos
 * "planos" (`scopeType`, `triggerConfig`, … — é o que se edita e o que a validação de publicação
 * confere, junto com `draftGraph`) e a configuração PUBLICADA em `live` (o que o runtime lê hoje;
 * ver domain/workflow-configuration.ts). Sem versão publicada, as duas são a mesma.
 */
export type WorkflowConfigurationRow = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  draftGraph: unknown
  live: WorkflowConfiguration
  active: boolean
  published: boolean
}

type RawRow = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  draftGraph: unknown
  liveScopeType?: string
  liveTeamId?: string | null
  liveSubteamId?: string | null
  liveTriggerConfig?: TriggerConfig
  liveConsolidatedStructure?: ConsolidatedStructure | null
  livePopulationFilter?: PopulationFilter | null
  active?: boolean
  activeVersionId?: string | null
}

const CONFIGURATION_SELECT = `
  select scope_type "liveScopeType", team_id "liveTeamId", subteam_id "liveSubteamId", trigger_config "liveTriggerConfig",
         consolidated_structure "liveConsolidatedStructure", population_filter "livePopulationFilter",
         draft_scope_type "scopeType", draft_team_id "teamId", draft_subteam_id "subteamId", draft_trigger_config "triggerConfig",
         draft_consolidated_structure "consolidatedStructure", draft_population_filter "populationFilter",
         draft_graph "draftGraph", active, active_version_id "activeVersionId"
  from workflows where id = $1 and organization_id = $2`

export async function loadWorkflowConfigurationRow(db: Queryable, organizationId: string, workflowId: string, options: { forUpdate?: boolean } = {}): Promise<WorkflowConfigurationRow | null> {
  const result = await db.query<RawRow>(`${CONFIGURATION_SELECT}${options.forUpdate ? " for update" : ""}`, [workflowId, organizationId])
  const row = result.rows[0]
  if (!row) return null
  const draft: WorkflowConfiguration = {
    triggerConfig: row.triggerConfig,
    scopeType: row.scopeType,
    teamId: row.teamId ?? null,
    subteamId: row.subteamId ?? null,
    consolidatedStructure: row.consolidatedStructure ?? null,
    populationFilter: row.populationFilter ?? null,
  }
  // Linhas sem as colunas vivas só existem em dublês de teste antigos — tratadas como nunca publicadas.
  const live: WorkflowConfiguration =
    row.liveScopeType === undefined
      ? draft
      : {
          triggerConfig: row.liveTriggerConfig as TriggerConfig,
          scopeType: row.liveScopeType,
          teamId: row.liveTeamId ?? null,
          subteamId: row.liveSubteamId ?? null,
          consolidatedStructure: row.liveConsolidatedStructure ?? null,
          populationFilter: row.livePopulationFilter ?? null,
        }
  return { ...draft, draftGraph: row.draftGraph, live, active: row.active === true, published: Boolean(row.activeVersionId) }
}

/** Grupos de campos que cada tela grava — um grupo omitido nunca é tocado (duas telas abertas não se sobrescrevem). */
export type DraftConfigurationPatch = {
  trigger?: TriggerConfig
  scope?: { scopeType: string; teamId: string | null; subteamId: string | null }
  analysis?: { consolidatedStructure: ConsolidatedStructure | null; populationFilter: PopulationFilter | null }
}

/**
 * Grava a configuração no RASCUNHO. Num Workflow nunca publicado grava também a configuração viva (não
 * há runtime sem versão publicada — todo leitor exige `active_version_id`), para a listagem e o
 * "Executar agora" mostrarem o que será publicado. Num Workflow publicado, NADA que o runtime lê muda
 * aqui: só `POST /:id/publish` copia o rascunho para a configuração viva.
 */
export async function writeDraftConfiguration(db: Queryable, organizationId: string, workflowId: string, patch: DraftConfigurationPatch): Promise<boolean> {
  const result = await db.query(
    `update workflows set
       draft_trigger_config = case when $1::boolean then $2::jsonb else draft_trigger_config end,
       draft_scope_type = case when $3::boolean then $4 else draft_scope_type end,
       draft_team_id = case when $3::boolean then $5::uuid else draft_team_id end,
       draft_subteam_id = case when $3::boolean then $6::uuid else draft_subteam_id end,
       draft_consolidated_structure = case when $7::boolean then $8::jsonb else draft_consolidated_structure end,
       draft_population_filter = case when $7::boolean then $9::jsonb else draft_population_filter end,
       trigger_config = case when active_version_id is null and $1::boolean then $2::jsonb else trigger_config end,
       scope_type = case when active_version_id is null and $3::boolean then $4 else scope_type end,
       team_id = case when active_version_id is null and $3::boolean then $5::uuid else team_id end,
       subteam_id = case when active_version_id is null and $3::boolean then $6::uuid else subteam_id end,
       consolidated_structure = case when active_version_id is null and $7::boolean then $8::jsonb else consolidated_structure end,
       population_filter = case when active_version_id is null and $7::boolean then $9::jsonb else population_filter end,
       updated_at = now()
     where id = $10 and organization_id = $11
     returning id`,
    [
      patch.trigger !== undefined,
      patch.trigger ? JSON.stringify(patch.trigger) : null,
      patch.scope !== undefined,
      patch.scope?.scopeType ?? null,
      patch.scope?.teamId ?? null,
      patch.scope?.subteamId ?? null,
      patch.analysis !== undefined,
      patch.analysis?.consolidatedStructure ? JSON.stringify(patch.analysis.consolidatedStructure) : null,
      patch.analysis?.populationFilter ? JSON.stringify(patch.analysis.populationFilter) : null,
      workflowId,
      organizationId,
    ],
  )
  return (result.rowCount ?? 0) > 0
}

/** "Descartar alterações": o rascunho volta a ser a configuração publicada. Sem versão publicada não há o que descartar. */
export async function discardDraftConfiguration(db: Queryable, organizationId: string, workflowId: string): Promise<boolean> {
  const result = await db.query(
    `update workflows set
       draft_trigger_config = trigger_config, draft_scope_type = scope_type, draft_team_id = team_id, draft_subteam_id = subteam_id,
       draft_consolidated_structure = consolidated_structure, draft_population_filter = population_filter, updated_at = now()
     where id = $1 and organization_id = $2 and active_version_id is not null
     returning id`,
    [workflowId, organizationId],
  )
  return (result.rowCount ?? 0) > 0
}
