import type { Database } from "../../../infrastructure/database/pool.js"
import { isOperatorEligibleForWorkflow, loadEligibleOperator } from "./workflow-eligibility.js"
import { loadEffectiveStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"

type Queryable = Pick<Database, "query">

export type IndicatorEnrollmentInput = {
  organizationId: string
  measurementId: string
  operatorId: string
  indicatorCode: string
  value: number
}

/**
 * Matrícula produtiva por Indicador (chamada pela ingestão de medições): pra cada Workflow
 * publicado disparado por ESTE indicador, matricula só se o operador da medição é elegível pela
 * Abrangência (ALL_TEAMS / TEAM / SUBTEAM) E pelo Filtro Populacional — a MESMA regra do Trigger
 * por Flag, do checador de agenda e do QA Lab (workflow-eligibility.ts). A elegibilidade decide
 * "esta medição deste operador pode iniciar este Workflow?"; a Condition (valor x meta, histórico
 * etc.) continua sendo avaliada depois, pelo motor (engine.ts). Decisão pontual: o operador é
 * carregado uma vez por medição, nunca a população inteira.
 */
export async function enrollIndicatorWorkflows(db: Queryable, input: IndicatorEnrollmentInput): Promise<number> {
  const candidates = await db.query<{ id: string; active_version_id: string; scope_type: string; team_id: string | null; subteam_id: string | null; population_filter: unknown }>(
    `select id, active_version_id, scope_type, team_id, subteam_id, population_filter
     from workflows
     where organization_id = $1 and active and active_version_id is not null
       and trigger_config->>'kind' = 'indicator' and trigger_config->>'indicatorCode' = $2`,
    [input.organizationId, input.indicatorCode],
  )
  if (candidates.rows.length === 0) return 0
  const operator = await loadEligibleOperator(db as Database, input.organizationId, input.operatorId)
  // V1.6.2 — a versão da estratégia de diagnóstico EFETIVA agora fica presa na execução (nada "ao vivo" depois).
  const strategy = await loadEffectiveStrategy(db, input.organizationId, { code: input.indicatorCode })
  let enrolled = 0
  for (const workflow of candidates.rows) {
    const population = { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id, populationFilter: workflow.population_filter }
    if (!(await isOperatorEligibleForWorkflow(db as Database, input.organizationId, population, input.operatorId, operator))) continue
    const versionResult = await db.query<{ graph: { nodes: { id: string; type: string }[] } }>(`select graph from workflow_versions where id = $1`, [workflow.active_version_id])
    const triggerNode = versionResult.rows[0]?.graph.nodes.find((node) => node.type === "trigger")
    if (!triggerNode) continue
    await db.query(
      `insert into workflow_enrollments(organization_id, workflow_id, version_id, indicator_measurement_id, current_node_id, matched_value_numeric, indicator_diagnostic_strategy_version_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [input.organizationId, workflow.id, workflow.active_version_id, input.measurementId, triggerNode.id, input.value, strategy?.id ?? null],
    )
    enrolled += 1
  }
  return enrolled
}
