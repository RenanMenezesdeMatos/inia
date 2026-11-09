import type { Database } from "../../../infrastructure/database/pool.js"
import { createEnrollmentLookups, type EnrollmentLookups } from "./enrollment-lookups.js"
import { isOperatorEligibleForWorkflow } from "./workflow-eligibility.js"

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
 * carregado uma vez por medição, nunca a população inteira. `lookups` = leituras lembradas (candidatos, operador, estratégia,
 * grafo, estrutura): ausente, uma instância só para esta medição; a carga em lote passa a do lote (enrollment-lookups.ts).
 */
export async function enrollIndicatorWorkflows(db: Queryable, input: IndicatorEnrollmentInput, lookups: EnrollmentLookups = createEnrollmentLookups(db)): Promise<number> {
  const candidates = await lookups.indicatorCandidates(input.organizationId, input.indicatorCode)
  if (candidates.length === 0) return 0
  const operator = await lookups.operator(input.organizationId, input.operatorId)
  const strategy = await lookups.strategy(input.organizationId, input.indicatorCode)
  let enrolled = 0
  for (const workflow of candidates) {
    const population = { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id, populationFilter: workflow.population_filter }
    if (!(await isOperatorEligibleForWorkflow(db as Database, input.organizationId, population, input.operatorId, operator, lookups.structureMembers))) continue
    const triggerNode = await lookups.triggerNode(workflow.active_version_id)
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
