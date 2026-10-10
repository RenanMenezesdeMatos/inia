import type { Database } from "../../../infrastructure/database/pool.js"

/** LEITOR ANALÍTICO do Sino (Monitoria de usabilidade): destinatário e leitura oficial (`alerts.read_at`) de cada notificação. */
type Queryable = Pick<Database, "query">

export async function recipientsOfAlerts(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; recipient_id: string }>(`select id, recipient_id from alerts where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.recipient_id]))
}

/** Colunas: alert_id, recipient_person_id, created_at, read_at, resolved_at, alert_type. */
export function alertsSql(organizationParam: string): string {
  return `select a.id alert_id, a.recipient_id recipient_person_id, a.created_at, a.read_at, a.resolved_at, a.alert_type from alerts a where a.organization_id = ${organizationParam}`
}
