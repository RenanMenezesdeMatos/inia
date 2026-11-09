import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Registros de agente vistos A PARTIR de um contexto autorizado (PEN-071): quem pode ver o caso vê a execução do agente que o
 * gerou — com o agente identificado (inclusive inativo) e a versão usada —, e nada além dos registros desse caso.
 */
export async function loadCaseAgentRecords(db: Pick<Database, "query">, organizationId: string, caseId: string): Promise<unknown[]> {
  const rows = await db.query(
    `select ar.id, ar.agent_id "agentId", a.name "agentName", a.active "agentActive", ar.status, ar.source, ar.created_at "createdAt", ar.completed_at "completedAt",
            av.version_number "agentVersionNumber", ar.run_target "runTarget"
       from agent_runs ar join agents_all a on a.id = ar.agent_id left join agent_versions av on av.id = ar.agent_version_id
      where ar.case_id = $1 and ar.organization_id = $2
      order by ar.created_at`,
    [caseId, organizationId],
  )
  return rows.rows
}
