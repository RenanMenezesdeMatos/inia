import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction, type TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import type { TriggerConfig } from "../domain/trigger-config-schema.js"
import type { WorkflowConfiguration } from "../domain/workflow-configuration.js"
import { workflowLiveScopeLinksSql, workflowResourceScope } from "../domain/workflow-scope.js"
import type { ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"

type Queryable = Pick<Database, "query">

/**
 * Linha do Workflow como o editor e a publicação precisam dela: a configuração do RASCUNHO nos campos
 * "planos" (`scopeType`, `triggerConfig`, … — é o que se edita e o que a validação de publicação
 * confere, junto com `draftGraph`) e a configuração PUBLICADA em `live` (o que o runtime lê hoje;
 * ver domain/workflow-configuration.ts). Sem versão publicada, as duas são a mesma.
 */
export type WorkflowConfigurationRow = {
  scopeType: string
  /** Vínculos da Abrangência do rascunho (`draft_scope_links`; vazio em ALL_TEAMS). */
  scopeLinks: ScopeLink[]
  /** Legado (anterior à 249) — sempre null no banco; só dublês de teste o preenchem. */
  teamId?: string | null
  subteamId?: string | null
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  operatingUniverse: string | null
  /** "Somente quem tem acesso ativo à INIA" (rascunho). */
  requireActiveAccess: boolean
  draftGraph: unknown
  live: WorkflowConfiguration
  active: boolean
  published: boolean
}

type RawRow = {
  scopeType: string
  scopeLinks?: { teamId: string | null; subteamId: string | null }[] | null
  teamId?: string | null
  subteamId?: string | null
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  draftGraph: unknown
  liveScopeType?: string
  liveScopeLinks?: { teamId: string | null; subteamId: string | null }[] | null
  liveTeamId?: string | null
  liveSubteamId?: string | null
  liveTriggerConfig?: TriggerConfig
  liveConsolidatedStructure?: ConsolidatedStructure | null
  livePopulationFilter?: PopulationFilter | null
  liveOperatingUniverse?: string | null
  operatingUniverse?: string | null
  requireActiveAccess?: boolean
  liveRequireActiveAccess?: boolean
  active?: boolean
  activeVersionId?: string | null
}

const CONFIGURATION_SELECT = `
  select scope_type "liveScopeType", ${workflowLiveScopeLinksSql("workflows.id")} "liveScopeLinks", team_id "liveTeamId", subteam_id "liveSubteamId", trigger_config "liveTriggerConfig",
         consolidated_structure "liveConsolidatedStructure", population_filter "livePopulationFilter", operating_universe "liveOperatingUniverse",
         draft_operating_universe "operatingUniverse",
         require_active_access "liveRequireActiveAccess", draft_require_active_access "requireActiveAccess",
         draft_scope_type "scopeType", draft_scope_links "scopeLinks", draft_team_id "teamId", draft_subteam_id "subteamId", draft_trigger_config "triggerConfig",
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
    scopeLinks: linksOf(row.scopeType, row.scopeLinks, row.teamId, row.subteamId),
    teamId: row.teamId ?? null,
    subteamId: row.subteamId ?? null,
    consolidatedStructure: row.consolidatedStructure ?? null,
    populationFilter: row.populationFilter ?? null,
    operatingUniverse: row.operatingUniverse ?? null,
    requireActiveAccess: row.requireActiveAccess === true,
  }
  // Linhas sem as colunas vivas só existem em dublês de teste antigos — tratadas como nunca publicadas.
  const live: WorkflowConfiguration =
    row.liveScopeType === undefined
      ? draft
      : {
          triggerConfig: row.liveTriggerConfig as TriggerConfig,
          scopeType: row.liveScopeType,
          scopeLinks: linksOf(row.liveScopeType, row.liveScopeLinks, row.liveTeamId, row.liveSubteamId),
          teamId: row.liveTeamId ?? null,
          subteamId: row.liveSubteamId ?? null,
          consolidatedStructure: row.liveConsolidatedStructure ?? null,
          populationFilter: row.livePopulationFilter ?? null,
          operatingUniverse: row.liveOperatingUniverse ?? null,
          requireActiveAccess: row.liveRequireActiveAccess === true,
        }
  return { ...draft, requireActiveAccess: draft.requireActiveAccess === true, draftGraph: row.draftGraph, live, active: row.active === true, published: Boolean(row.activeVersionId) }
}

/** Vínculos da Abrangência (GROUPS) — o formato legado vira o vínculo equivalente (SUBTEAM sem Grupo-pai fica sem vínculo). */
function linksOf(scopeType: string, links: RawRow["scopeLinks"], teamId: string | null | undefined, subteamId: string | null | undefined): ScopeLink[] {
  return workflowResourceScope({ scopeType, scopeLinks: links ?? [], teamId: teamId ?? null, subteamId: subteamId ?? null }).links
}

/** Grupos de campos que cada tela grava — um grupo omitido nunca é tocado (duas telas abertas não se sobrescrevem). */
export type DraftConfigurationPatch = {
  trigger?: TriggerConfig
  /** Abrangência já validada (`resolveResourceScopeForWrite`): ALL_TEAMS ou GROUPS + vínculos normalizados. */
  scope?: { scopeType: "ALL_TEAMS" | "GROUPS"; scopeLinks: readonly ScopeLink[] }
  /** `requireActiveAccess` omitido = a opção fica como está (quem grava só a estrutura/o filtro não a apaga). */
  analysis?: { consolidatedStructure: ConsolidatedStructure | null; populationFilter: PopulationFilter | null; requireActiveAccess?: boolean }
  /** Universo de atuação (parte da Abrangência). */
  universe?: { operatingUniverse: string | null }
}

/**
 * Grava a configuração no RASCUNHO. Num Workflow nunca publicado grava também a configuração viva (não
 * há runtime sem versão publicada — todo leitor exige `active_version_id`), para a listagem e o
 * "Executar agora" mostrarem o que será publicado. Num Workflow publicado, NADA que o runtime lê muda
 * aqui: só `POST /:id/publish` copia o rascunho para a configuração viva.
 */
export async function writeDraftConfiguration(db: TransactionSource | Queryable, organizationId: string, workflowId: string, patch: DraftConfigurationPatch): Promise<boolean> {
  // Abrangência num Workflow nunca publicado mexe em `workflow_scope_links`: trava a linha ANTES do comando, numa transação, para o
  // instantâneo do comando já ver os vínculos de quem gravou antes (run-10 DADOS-04: dois salvamentos simultâneos deixavam a UNIÃO dos
  // vínculos, diferente de `draft_scope_links`). Sem Abrangência no pedido, o comando único continua bastando.
  if (patch.scope !== undefined && canOpenTransaction(db)) {
    return inTransaction(db, async (client) => {
      await client.query(`select 1 from workflows where id = $1 and organization_id = $2 for update`, [workflowId, organizationId])
      return writeDraftConfigurationStatement(client, organizationId, workflowId, patch)
    })
  }
  return writeDraftConfigurationStatement(db, organizationId, workflowId, patch)
}

const canOpenTransaction = (db: TransactionSource | Queryable): db is TransactionSource =>
  typeof (db as { connect?: unknown }).connect === "function" || typeof (db as { release?: unknown }).release === "function"

async function writeDraftConfigurationStatement(db: Queryable, organizationId: string, workflowId: string, patch: DraftConfigurationPatch): Promise<boolean> {
  const links = patch.scope?.scopeType === "GROUPS" ? patch.scope.scopeLinks : []
  // Um comando só (atômico também sem transação aberta por quem chama): o rascunho, e — num Workflow nunca publicado — a configuração
  // viva, inclusive os vínculos publicados (`workflow_scope_links`; o gatilho da 144 não enxerga essa tabela). Remove só os vínculos que
  // saíram e acrescenta os novos (nunca apaga e reinsere o mesmo vínculo no mesmo comando).
  const result = await db.query(
    `with updated as (
       update workflows set
       draft_trigger_config = case when $1::boolean then $2::jsonb else draft_trigger_config end,
       draft_scope_type = case when $3::boolean then $4 else draft_scope_type end,
       draft_scope_links = case when $3::boolean then $5::jsonb else draft_scope_links end,
       draft_team_id = case when $3::boolean then null else draft_team_id end,
       draft_subteam_id = case when $3::boolean then null else draft_subteam_id end,
       draft_consolidated_structure = case when $6::boolean then $7::jsonb else draft_consolidated_structure end,
       draft_population_filter = case when $6::boolean then $8::jsonb else draft_population_filter end,
       trigger_config = case when active_version_id is null and $1::boolean then $2::jsonb else trigger_config end,
       scope_type = case when active_version_id is null and $3::boolean then $4 else scope_type end,
       team_id = case when active_version_id is null and $3::boolean then null else team_id end,
       subteam_id = case when active_version_id is null and $3::boolean then null else subteam_id end,
       consolidated_structure = case when active_version_id is null and $6::boolean then $7::jsonb else consolidated_structure end,
       population_filter = case when active_version_id is null and $6::boolean then $8::jsonb else population_filter end,
       draft_operating_universe = case when $11::boolean then $12::text else draft_operating_universe end,
       operating_universe = case when active_version_id is null and $11::boolean then $12::text else operating_universe end,
       draft_require_active_access = case when $6::boolean and $13::boolean is not null then $13::boolean else draft_require_active_access end,
       require_active_access = case when active_version_id is null and $6::boolean and $13::boolean is not null then $13::boolean else require_active_access end,
       updated_at = now()
     where id = $9 and organization_id = $10
     returning id, organization_id, active_version_id
     ),
     wanted as (select t, s from unnest($14::uuid[], $15::uuid[]) as l(t, s)),
     removed as (
       delete from workflow_scope_links wsl using updated u
        where $3::boolean and u.active_version_id is null and wsl.workflow_id = u.id
          and not exists (select 1 from wanted w where w.t = wsl.team_id and w.s is not distinct from wsl.subteam_id)
     ),
     added as (
       insert into workflow_scope_links (workflow_id, organization_id, team_id, subteam_id)
       select u.id, u.organization_id, w.t, w.s from updated u cross join wanted w where $3::boolean and u.active_version_id is null
       on conflict do nothing
     )
     select id from updated`,
    [
      patch.trigger !== undefined,
      patch.trigger ? JSON.stringify(patch.trigger) : null,
      patch.scope !== undefined,
      patch.scope?.scopeType ?? null,
      JSON.stringify(links.map((link) => ({ teamId: link.teamId, subteamId: link.subteamId }))),
      patch.analysis !== undefined,
      patch.analysis?.consolidatedStructure ? JSON.stringify(patch.analysis.consolidatedStructure) : null,
      patch.analysis?.populationFilter ? JSON.stringify(patch.analysis.populationFilter) : null,
      workflowId,
      organizationId,
      patch.universe !== undefined,
      patch.universe?.operatingUniverse ?? null,
      patch.analysis?.requireActiveAccess ?? null,
      links.map((link) => link.teamId),
      links.map((link) => link.subteamId),
    ],
  )
  return (result.rowCount ?? 0) > 0
}

/** "Descartar alterações": o rascunho volta a ser a configuração publicada. Sem versão publicada não há o que descartar. */
export async function discardDraftConfiguration(db: Queryable, organizationId: string, workflowId: string): Promise<boolean> {
  const result = await db.query(
    `update workflows set
       draft_trigger_config = trigger_config, draft_scope_type = scope_type, draft_team_id = team_id, draft_subteam_id = subteam_id,
       draft_scope_links = ${workflowLiveScopeLinksSql("workflows.id")}::jsonb,
       draft_consolidated_structure = consolidated_structure, draft_population_filter = population_filter, draft_operating_universe = operating_universe,
       draft_require_active_access = require_active_access, updated_at = now()
     where id = $1 and organization_id = $2 and active_version_id is not null
     returning id`,
    [workflowId, organizationId],
  )
  return (result.rowCount ?? 0) > 0
}
