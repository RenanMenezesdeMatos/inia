import type { Database } from "../../../infrastructure/database/pool.js"

/** LEITOR ANALÍTICO de casos (Monitoria de usabilidade): colaborador de cada caso (validação de eventos do navegador). */
type Queryable = Pick<Database, "query">

export async function operatorsOfCases(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; operator_id: string }>(`select id, operator_id from supervision_cases where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.operator_id]))
}
