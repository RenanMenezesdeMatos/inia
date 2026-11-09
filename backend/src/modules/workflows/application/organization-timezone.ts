import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Timezone IANA da organização — fonte oficial: `operations.timezone` (migration 001, já
 * populada). Fallback EXPLÍCITO e documentado quando não há operação cadastrada:
 * `DEFAULT_ORGANIZATION_TIMEZONE` — nunca UTC silencioso. Toda a matemática de calendário do
 * motor (janelas operacionais, agenda, fechamentos) parte daqui; nenhum módulo assume offset fixo.
 */
export const DEFAULT_ORGANIZATION_TIMEZONE = "America/Fortaleza"

export async function resolveOrganizationTimezone(db: Pick<Database, "query">, organizationId: string): Promise<string> {
  const result = await db.query<{ timezone: string }>(
    `select timezone from operations where organization_id = $1 order by created_at limit 1`,
    [organizationId],
  )
  return result.rows[0]?.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE
}
