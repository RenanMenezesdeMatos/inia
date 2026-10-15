import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { canManageScope, scopesAreCompatible, type ManageableScopes } from "../../../auth/application/manageable-scopes.js"
import type { PopulationFilter } from "../../domain/population-filter-schema.js"
import { loadWorkflowConfigurationRow, type WorkflowConfigurationRow } from "../../application/workflow-configuration-store.js"


export const NOT_FOUND = { error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow não encontrado." } }

/** Projeção do gatilho para a API (nomes da flag/indicador resolvidos) — a MESMA para a configuração
 * publicada (colunas vivas) e a do rascunho (`draft_trigger_config`). */
function triggerJsonSql(column: string, flag: string, indicator: string): string {
  return `case
      when ${column} ->> 'kind' = 'indicator' then
        jsonb_build_object('kind', 'indicator', 'indicatorCode', ${indicator}.code, 'indicatorName', ${indicator}.name, 'unit', ${indicator}.unit, 'valueType', 'NUMERIC')
      when ${column} ->> 'kind' = 'manual' then
        jsonb_strip_nulls(jsonb_build_object(
          'kind', 'manual', 'context', ${column} ->> 'context',
          'indicatorCode', ${indicator}.code, 'indicatorName', ${indicator}.name, 'unit', ${indicator}.unit
        ))
      when ${column} ->> 'kind' = 'schedule' then
        -- jsonb_strip_nulls: quando não há frequency no trigger_config (workflow legado), o
        -- operador -> devolve SQL NULL. Sem o strip, o objeto sairia com "frequency": null, que
        -- o schema do frontend (opcional, não anulável) rejeitaria. Removendo a chave por
        -- completo, fica idêntico a "ausente" (o mesmo shape legado que sempre existiu).
        jsonb_strip_nulls(jsonb_build_object(
          'kind', 'schedule', 'times', ${column} -> 'times',
          'intervalDays', coalesce(${column} -> 'intervalDays', '1'::jsonb),
          'anchorDate', ${column} -> 'anchorDate',
          'frequency', ${column} -> 'frequency',
          'mode', ${column} -> 'mode',
          'relative', ${column} -> 'relative'
        ))
      else
        jsonb_build_object('kind', 'channel_flag', 'channelFlagId', ${flag}.id, 'channel', ${flag}.channel, 'flagName', ${flag}.flag_name, 'valueType', ${flag}.value_type)
    end`
}

/** Topo = configuração PUBLICADA (a que o runtime lê); `draftConfiguration` = a do rascunho que o editor edita. */
export const WORKFLOW_LIST_SELECT = `
  select
    w.id, w.name, w.description, w.scope_type "scopeType", w.team_id "teamId", t.name "teamName",
    w.subteam_id "subteamId", st.name "subteamName", w.active, w.created_at "createdAt",
    (w.active_version_id is not null) "published",
    w.consolidated_structure "consolidatedStructure", w.population_filter "populationFilter",
    ${triggerJsonSql("w.trigger_config", "cf", "idef")} "trigger",
    (select count(*) from workflow_enrollments we where we.workflow_id = w.id and we.status in ('active', 'waiting'))::int "activeEnrollments",
    -- Configuração do RASCUNHO (o que o editor edita; só vale no runtime depois de Publicar) e o que
    -- difere da publicada. Sem versão publicada as duas são a mesma (lista vazia).
    jsonb_build_object(
      'trigger', ${triggerJsonSql("w.draft_trigger_config", "dcf", "didef")},
      'scopeType', w.draft_scope_type, 'teamId', w.draft_team_id, 'teamName', dt.name,
      'subteamId', w.draft_subteam_id, 'subteamName', dst.name,
      'consolidatedStructure', w.draft_consolidated_structure, 'populationFilter', w.draft_population_filter
    ) "draftConfiguration",
    (select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
       from (values
         (1, 'TRIGGER', w.draft_trigger_config is distinct from w.trigger_config),
         (2, 'SCOPE', (w.draft_scope_type, w.draft_team_id, w.draft_subteam_id) is distinct from (w.scope_type, w.team_id, w.subteam_id)),
         (3, 'ANALYSIS', (w.draft_consolidated_structure, w.draft_population_filter) is distinct from (w.consolidated_structure, w.population_filter))
       ) as c(ord, change, differs)
      where c.differs and w.active_version_id is not null) "configurationChanges"
  from workflows w
  left join teams t on t.id = w.team_id
  left join subteams st on st.id = w.subteam_id
  left join channel_flags cf on cf.id = (w.trigger_config ->> 'channelFlagId')::uuid
  left join indicator_definitions idef on idef.code = (w.trigger_config ->> 'indicatorCode') and idef.organization_id = w.organization_id
  left join teams dt on dt.id = w.draft_team_id
  left join subteams dst on dst.id = w.draft_subteam_id
  left join channel_flags dcf on dcf.id = (w.draft_trigger_config ->> 'channelFlagId')::uuid
  left join indicator_definitions didef on didef.code = (w.draft_trigger_config ->> 'indicatorCode') and didef.organization_id = w.organization_id
  where w.organization_id = $1
`

/**
 * Valida que uma âncora (pessoa, via `anchorId`) ou um grupo (Subgrupo/Grupo, via `groupRef`) —
 * nunca os dois ao mesmo tempo — está dentro da Abrangência de destino. Reaproveitada pela troca
 * de Abrangência de um Workflow existente (revalida Estrutura Consolidada e Filtro Populacional)
 * e por `PUT /:id/analysis-config` (valida a configuração nova antes de gravar).
 */
export async function assertAnchorInScope(
  db: Database,
  organizationId: string,
  anchorId: string | null,
  groupRef: { teamId?: string; subteamId?: string } | null,
  targetScope: { scopeType: string; teamId: string | null; subteamId: string | null },
  message: string,
  code: string,
  status: number,
): Promise<void> {
  if (anchorId) {
    const anchorResult = await db.query<{ teamId: string | null; subteamId: string | null }>(
      `select team_id "teamId", subteam_id "subteamId" from people where id = $1 and organization_id = $2`,
      [anchorId, organizationId],
    )
    const anchorPerson = anchorResult.rows[0]
    const anchorScope = { scopeType: "TEAM", teamId: anchorPerson?.teamId ?? null, subteamId: anchorPerson?.subteamId ?? null }
    if (!anchorPerson || !(await scopesAreCompatible(db, anchorScope, targetScope))) throw new DomainError(message, code, status)
    return
  }
  if (groupRef) {
    const groupScope = groupRef.subteamId
      ? { scopeType: "SUBTEAM", teamId: null, subteamId: groupRef.subteamId }
      : { scopeType: "TEAM", teamId: groupRef.teamId ?? null, subteamId: null }
    if (!(await scopesAreCompatible(db, groupScope, targetScope))) throw new DomainError(message, code, status)
  }
}

// Gatilho × Estrutura Consolidada/Filtro Populacional: a regra mora na validação de publicação, que a confere de novo
// ao publicar (é a configuração do rascunho que passa a valer); as rotas de edição usam a mesma.
export { triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter } from "../../application/validate-workflow-for-publish.js"

/** Linha do Workflow com a configuração do RASCUNHO (o que se edita/valida) e a PUBLICADA (`live`). */
export function fetchScopedRow(db: Database, organizationId: string, id: string): Promise<WorkflowConfigurationRow | null> {
  return loadWorkflowConfigurationRow(db, organizationId, id)
}

/** Quem enxerga/edita um Workflow: quem gerencia a Abrangência PUBLICADA (a que o runtime usa; sem versão publicada é a
 * do rascunho). A publicação exige também a do rascunho (publish-workflow.ts). */
export function canManageWorkflow(scopes: ManageableScopes, row: WorkflowConfigurationRow): boolean {
  return canManageScope(scopes, row.live)
}

/** Filtro "Todos os colaboradores elegíveis" e ausência de filtro são a mesma população — gravados como null. */
export function normalizedPopulationFilter(filter: PopulationFilter | null): PopulationFilter | null {
  return filter && filter.kind !== "ALL" ? filter : null
}

export type WorkflowRouterOptions = {
  /** Chamado depois de um disparo manual NOVO — por padrão acorda o worker do motor (quem clicou está olhando a tela). */
  onManualRunCreated: (enrollmentId: string) => void
}
