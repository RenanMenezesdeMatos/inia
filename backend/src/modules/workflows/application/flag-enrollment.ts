import type { Database } from "../../../infrastructure/database/pool.js"
import { createEnrollmentLookups, type EnrollmentLookups } from "./enrollment-lookups.js"
import { isOperatorEligibleForWorkflow } from "./workflow-eligibility.js"

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
 * comparador) e roda a ação é o motor de workflow (engine.ts), em ticks periódicos. `lookups`: ver
 * enrollIndicatorWorkflows (ausente = só para este evento; a carga em lote passa a do lote).
 */
export async function enrollFlagWorkflows(db: Queryable, input: FlagEnrollmentInput, lookups: EnrollmentLookups = createEnrollmentLookups(db)): Promise<number> {
  const isBoolean = typeof input.value === "boolean"
  const candidates = await lookups.flagCandidates(input.organizationId, input.channelFlagId)
  if (candidates.length === 0) return 0
  // Operador carregado UMA vez pra todos os candidatos deste evento (nunca N+1 na mesma pessoa).
  const operator = await lookups.operator(input.organizationId, input.operatorId)
  let enrolled = 0
  for (const workflow of candidates) {
    const population = { scopeType: workflow.scope_type, teamId: workflow.team_id, subteamId: workflow.subteam_id, populationFilter: workflow.population_filter }
    if (!(await isOperatorEligibleForWorkflow(db as Database, input.organizationId, population, input.operatorId, operator, lookups.structureMembers))) continue
    const triggerNode = await lookups.triggerNode(workflow.active_version_id)
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
