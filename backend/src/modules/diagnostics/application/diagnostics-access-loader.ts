import type { Database } from "../../../infrastructure/database/pool.js"
import { canViewDiagnostics } from "../domain/diagnostics-access.js"

/**
 * Projeção para o `/auth/me` (a interface só mostra/esconde a área). A rota revalida com o escopo completo a cada request;
 * as duas usam a MESMA regra (`canViewDiagnostics`).
 */
export async function loadDiagnosticsAccess(db: Pick<Database, "query">, input: { organizationId: string; personId: string; canViewIndicators: boolean }): Promise<boolean> {
  if (input.canViewIndicators) return canViewDiagnostics({ leadsActiveReports: false, hasIndicatorsGrant: true })
  const result = await db.query<{ leads: boolean }>(
    `select exists(select 1 from people where organization_id = $1 and reports_to_id = $2 and active) leads`,
    [input.organizationId, input.personId],
  )
  return canViewDiagnostics({ leadsActiveReports: result.rows[0]?.leads === true, hasIndicatorsGrant: false })
}
