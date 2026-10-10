import type { Database } from "../../../infrastructure/database/pool.js"
import { isOperatorEligibleForWorkflow, loadEligibleOperator } from "./workflow-eligibility.js"

/** Conexão/cliente com `query` — a ingestão roda dentro de uma transação (client), o restante
 * usa o pool; ambos expõem a mesma assinatura. */
type Queryable = Pick<Database, "query">

export type FlagEnrollmentInput = {
  organizationId: string
  interactionId: string
  operatorId: string
  channelFlagId: string
  flagName: string
  value: boolean | number
}

/**
 * Matrícula produtiva por Flag de canal (chamada pela ingestão de interações): pra cada Workflow
 * publicado disparado por esta flag, matricula SÓ se o operador da interação é elegível pela
 * Abrangência (ALL_TEAMS / TEAM / SUBTEAM) E pelo Filtro Populacional — a MESMA regra do checador
 * de agenda e do QA Lab (workflow-eligibility.ts). Decisão pontual por operador: nunca carrega a
 * população inteira por interação. Só matricula: quem avalia a Condition (valor da flag,
 * comparador) e roda a ação é o motor de workflow (engine.ts), em ticks periódicos.
 */
export async function enrollFlagWorkflows(db: Queryable, input: FlagEnrollmentInput): Promise<number> {
  const isBoolean = typeof input.value === "boolean"
  const candidates = await db.query<{ id: string; active_version_id: string; scope_type: string; team_id: string | null; subteam_id: string | null; population_filter: unknown }>(
    `select id, active_version_id, scope_type, team_id, subteam_id, population_filter
     from workflows
     where organization_id = $1 and active and active_version_id is not null
       and trigger_config->>'kind' = 'channel_flag' and trigger_config->>'channelFlagId' = $2`,
    [input.organizationId, input.channelFlagId],
  )
  if (candidates.rows.length === 0) return 0
  // Operador carregado UMA vez pra todos os candidatos deste evento (nunca N+1 na mesma pessoa).
  const operator = await loadEligibleOperator(db as Database, input.organizationId, input.operatorId)
  let enrolled = 0
  for (const workflow of candidates.rows) {
    const population = { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id, populationFilter: workflow.population_filter }
    if (!(await isOperatorEligibleForWorkflow(db as Database, input.organizationId, population, input.operatorId, operator))) continue
    const versionResult = await db.query<{ graph: { nodes: { id: string; type: string }[] } }>(`select graph from workflow_versions where id = $1`, [workflow.active_version_id])
    const triggerNode = versionResult.rows[0]?.graph.nodes.find((node) => node.type === "trigger")
    if (!triggerNode) continue
    await db.query(
      `insert into workflow_enrollments(organization_id, workflow_id, version_id, interaction_id, current_node_id, matched_flag_name, matched_value_boolean, matched_value_numeric)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.organizationId, workflow.id, workflow.active_version_id, input.interactionId, triggerNode.id, input.flagName, isBoolean ? input.value : null, isBoolean ? null : input.value],
    )
    enrolled += 1
  }
  return enrolled
}
