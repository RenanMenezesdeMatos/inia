import type { Database } from "../../../infrastructure/database/pool.js"
import { canManageScope, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { loadPoliciesCiting } from "../../interventions/application/policy-references.js"

/**
 * O que já depende de um indicador — base da proteção de alteração semântica e da exclusão.
 * Medições, metas e fechamentos apontam por FK (`indicator_definition_id`); Workflows apontam
 * por CÓDIGO dentro do grafo (Condition/Ranking/critério/agendamento) e do gatilho
 * (`trigger_config.indicatorCode`, publicado ou em rascunho) — por isso o código também é um campo semântico: renomear
 * quebraria referências silenciosamente.
 */
export type IndicatorDependencies = {
  measurements: number
  goals: number
  officialClosures: number
  /** Workflows (rascunho, versão ativa ou gatilho publicado/em rascunho) que referenciam o código. */
  workflows: { id: string; name: string }[]
  hasHistory: boolean
}

async function queryDependencies(db: Pick<Database, "query">, organizationId: string, definition: { id: string; code: string }): Promise<Omit<IndicatorDependencies, "workflows"> & { workflows: ({ id: string; name: string } & ScopedTarget)[] }> {
  const counts = await db.query<{ measurements: string; goals: string; official_closures: string }>(
    `select
       (select count(*) from indicator_measurements where indicator_definition_id = $1)::text measurements,
       (select count(*) from goals where indicator_definition_id = $1)::text goals,
       (select count(*) from employee_indicator_performance where indicator_definition_id = $1)::text official_closures`,
    [definition.id],
  )
  const workflows = await db.query<{ id: string; name: string } & ScopedTarget>(
    `select w.id, w.name, w.scope_type "scopeType", w.team_id "teamId", w.subteam_id "subteamId" from workflows w
      where w.organization_id = $1 and (
        jsonb_path_exists(w.draft_graph, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text))
        or (w.trigger_config is not null and jsonb_path_exists(w.trigger_config, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text)))
        or (w.draft_trigger_config is not null and jsonb_path_exists(w.draft_trigger_config, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text)))
        or exists (select 1 from workflow_versions v where v.id = w.active_version_id and jsonb_path_exists(v.graph, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text)))
      )
      order by w.name`,
    [organizationId, definition.code],
  )
  const row = counts.rows[0]!
  const measurements = Number(row.measurements)
  const goals = Number(row.goals)
  const officialClosures = Number(row.official_closures)
  return { measurements, goals, officialClosures, workflows: workflows.rows, hasHistory: measurements > 0 || goals > 0 || officialClosures > 0 || workflows.rows.length > 0 }
}

/** Todas as dependências — trava semântica e exclusão (escritas que já exigem a organização inteira). */
export async function loadIndicatorDependencies(db: Pick<Database, "query">, organizationId: string, definition: { id: string; code: string }): Promise<IndicatorDependencies> {
  const dependencies = await queryDependencies(db, organizationId, definition)
  return { ...dependencies, workflows: dependencies.workflows.map(({ id, name }) => ({ id, name })) }
}

/**
 * Dependências para quem CONSULTA a definição (lote 2 da 4ª auditoria): administrador de Grupo/Subgrupo vê pelo nome só os
 * Workflows que abriria na lista dele (`workflows.manage` na Abrangência publicada, a mesma regra de `canManageWorkflow`);
 * os outros entram só na contagem. `hasHistory` continua considerando todos — a trava vale para todo mundo.
 */
export async function loadVisibleIndicatorDependencies(db: Database, organizationId: string, definition: { id: string; code: string }, scopes: ManageableScopes): Promise<IndicatorDependencies & { workflowsOutOfScope: number }> {
  const dependencies = await queryDependencies(db, organizationId, definition)
  const visible = dependencies.workflows.filter((workflow) => canManageScope(scopes, workflow))
  return { ...dependencies, workflows: visible.map(({ id, name }) => ({ id, name })), workflowsOutOfScope: dependencies.workflows.length - visible.length }
}

/**
 * O que impede a EXCLUSÃO: só o que depende do indicador agora. Medição, meta, fechamento, investigação e diagnóstico são histórico: continuam guardados, saem dos painéis e voltam se o
 * indicador for restaurado. Workflow que cita o código está em `IndicatorDependencies.workflows`. Execução em andamento leria o indicador durante a execução.
 */
export type IndicatorDeletionBlockers = { runningExecutions: number; policies: string[] }

export async function loadIndicatorDeletionBlockers(db: Pick<Database, "query">, organizationId: string, indicator: { id: string; code: string }): Promise<IndicatorDeletionBlockers> {
  const running = await db.query<{ total: number }>(
    `select count(distinct e.id)::int total from workflow_enrollments e
       left join indicator_measurements_all m on m.id = e.indicator_measurement_id
       left join indicator_diagnostic_strategy_versions v on v.id = e.indicator_diagnostic_strategy_version_id
       left join indicator_diagnostic_strategies s on s.id = v.strategy_id
      where e.organization_id = $1 and e.status in ('active', 'waiting') and (m.indicator_definition_id = $2 or s.indicator_definition_id = $2)`,
    [organizationId, indicator.id],
  )
  return { runningExecutions: running.rows[0]?.total ?? 0, policies: await loadPoliciesCiting(db, organizationId, { key: "indicatorCode", value: indicator.code }) }
}

export function describeDeletionBlockers({ runningExecutions, policies }: IndicatorDeletionBlockers): string {
  const parts: string[] = []
  if (runningExecutions > 0) parts.push(`${runningExecutions} execução(ões) de Workflow em andamento`)
  if (policies.length > 0) parts.push(`política(s) de acompanhamento: ${policies.slice(0, 3).join(", ")}${policies.length > 3 ? "…" : ""}`)
  return parts.join("; ")
}

export function describeDependencies(dependencies: IndicatorDependencies): string {
  const parts: string[] = []
  if (dependencies.measurements > 0) parts.push(`${dependencies.measurements.toLocaleString("pt-BR")} medições`)
  if (dependencies.goals > 0) parts.push(`${dependencies.goals} metas`)
  if (dependencies.officialClosures > 0) parts.push(`${dependencies.officialClosures.toLocaleString("pt-BR")} fechamentos oficiais`)
  if (dependencies.workflows.length > 0) parts.push(`${dependencies.workflows.length} Workflow(s): ${dependencies.workflows.map((workflow) => workflow.name).slice(0, 3).join(", ")}${dependencies.workflows.length > 3 ? "…" : ""}`)
  return parts.join("; ")
}
