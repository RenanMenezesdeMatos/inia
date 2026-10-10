import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { scopesAreCompatible } from "../../../auth/application/manageable-scopes.js"
import type { FlowGraph } from "../../domain/graph-schema.js"
import type { TriggerConfig } from "../../domain/trigger-config-schema.js"
import type { ConsolidatedStructure } from "../../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../../domain/population-filter-schema.js"


export const NOT_FOUND = { error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow não encontrado." } }

export const WORKFLOW_LIST_SELECT = `
  select
    w.id, w.name, w.description, w.scope_type "scopeType", w.team_id "teamId", t.name "teamName",
    w.subteam_id "subteamId", st.name "subteamName", w.active, w.created_at "createdAt",
    (w.active_version_id is not null) "published",
    w.consolidated_structure "consolidatedStructure", w.population_filter "populationFilter",
    case
      when w.trigger_config ->> 'kind' = 'indicator' then
        jsonb_build_object('kind', 'indicator', 'indicatorCode', idef.code, 'indicatorName', idef.name, 'unit', idef.unit, 'valueType', 'NUMERIC')
      when w.trigger_config ->> 'kind' = 'manual' then
        jsonb_strip_nulls(jsonb_build_object(
          'kind', 'manual', 'context', w.trigger_config ->> 'context',
          'indicatorCode', idef.code, 'indicatorName', idef.name, 'unit', idef.unit
        ))
      when w.trigger_config ->> 'kind' = 'schedule' then
        -- jsonb_strip_nulls: quando não há frequency no trigger_config (workflow legado), o
        -- operador -> devolve SQL NULL. Sem o strip, o objeto sairia com "frequency": null, que
        -- o schema do frontend (opcional, não anulável) rejeitaria. Removendo a chave por
        -- completo, fica idêntico a "ausente" (o mesmo shape legado que sempre existiu).
        jsonb_strip_nulls(jsonb_build_object(
          'kind', 'schedule', 'times', w.trigger_config -> 'times',
          'intervalDays', coalesce(w.trigger_config -> 'intervalDays', '1'::jsonb),
          'anchorDate', w.trigger_config -> 'anchorDate',
          'frequency', w.trigger_config -> 'frequency',
          'mode', w.trigger_config -> 'mode',
          'relative', w.trigger_config -> 'relative'
        ))
      else
        jsonb_build_object('kind', 'channel_flag', 'channelFlagId', cf.id, 'channel', cf.channel, 'flagName', cf.flag_name, 'valueType', cf.value_type)
    end "trigger",
    (select count(*) from workflow_enrollments we where we.workflow_id = w.id and we.status in ('active', 'waiting'))::int "activeEnrollments"
  from workflows w
  left join teams t on t.id = w.team_id
  left join subteams st on st.id = w.subteam_id
  left join channel_flags cf on cf.id = (w.trigger_config ->> 'channelFlagId')::uuid
  left join indicator_definitions idef on idef.code = (w.trigger_config ->> 'indicatorCode') and idef.organization_id = w.organization_id
  where w.organization_id = $1
`

type ScopedWorkflowRow = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
  populationFilter: PopulationFilter | null
  draftGraph: FlowGraph
}

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

// Um Trigger só permite Estrutura Consolidada/Filtro Populacional quando é Agenda — e, no caso da
// Estrutura Consolidada, só quando a Agenda é de Calendário (Relativa ao expediente é sempre
// individual, a jornada pertence ao colaborador). Reaproveitados por `PUT /:id/analysis-config`
// (valida a config nova) e por `PATCH /:id` (revalida a config já existente quando só o Trigger
// muda — antes disso, essa combinação não era revalidada nessa rota).
// Gatilho Manual = UM colaborador escolhido por disparo: nunca Consolidado nem Filtro Populacional (a pessoa é escolhida).
export function triggerAllowsConsolidatedMode(trigger: TriggerConfig): boolean {
  return trigger.kind === "schedule" && trigger.mode !== "RELATIVE_TO_SHIFT"
}
export function triggerAllowsPopulationFilter(trigger: TriggerConfig): boolean {
  return trigger.kind === "schedule"
}

export async function fetchScopedRow(db: Database, organizationId: string, id: string): Promise<ScopedWorkflowRow | null> {
  const result = await db.query<ScopedWorkflowRow>(
    `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId", trigger_config "triggerConfig",
            consolidated_structure "consolidatedStructure", population_filter "populationFilter", draft_graph "draftGraph"
     from workflows where id = $1 and organization_id = $2`,
    [id, organizationId],
  )
  return result.rows[0] ?? null
}

export type WorkflowRouterOptions = {
  /** Chamado depois de um disparo manual NOVO — por padrão acorda o worker do motor (quem clicou está olhando a tela). */
  onManualRunCreated: (enrollmentId: string) => void
}
