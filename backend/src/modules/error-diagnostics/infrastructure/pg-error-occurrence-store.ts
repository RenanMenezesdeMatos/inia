import type { Database } from "../../../infrastructure/database/pool.js"
import { serviceName, serviceRelease } from "../../../shared/application/observability/service-identity.js"
import type { OccurrenceInput, OccurrenceRecord } from "../domain/error-occurrence.js"

type Queryable = Pick<Database, "query">

type Row = {
  reference: string
  code: string
  source: OccurrenceRecord["source"]
  http_status: number | null
  severity: OccurrenceRecord["severity"]
  service: string
  release: string
  method: string | null
  route: string | null
  authenticated: boolean
  occurred_at: Date
  details: Record<string, unknown>
}

const toRecord = (row: Row): OccurrenceRecord => ({
  reference: row.reference,
  code: row.code,
  source: row.source,
  httpStatus: row.http_status,
  severity: row.severity,
  service: row.service,
  release: row.release,
  method: row.method,
  route: row.route,
  authenticated: row.authenticated,
  occurredAt: row.occurred_at.toISOString(),
  details: row.details ?? {},
})

export async function insertOccurrence(db: Queryable, input: OccurrenceInput, identity: { service?: string } = {}): Promise<void> {
  await db.query(
    `insert into error_occurrences (reference, code, source, http_status, severity, service, release, method, route, organization_id, authenticated, occurred_at, details)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [input.reference, input.code.slice(0, 80), input.source, input.httpStatus, input.severity, (identity.service ?? serviceName()).slice(0, 40), serviceRelease().slice(0, 64), input.method?.slice(0, 10) ?? null, input.route?.slice(0, 200) ?? null, input.organizationId ?? null, input.authenticated, input.occurredAt ?? new Date(), JSON.stringify(input.details ?? {})],
  )
}

/**
 * Ocorrências de uma referência, no ESCOPO de quem consulta: da própria organização, mais as sem organização (antes do login,
 * jobs, processo) — essas só para quem administra a organização inteira (a rota já exige escopo de organização).
 */
export async function findOccurrencesByReference(db: Queryable, reference: string, organizationId: string): Promise<OccurrenceRecord[]> {
  const result = await db.query<Row>(
    `select reference, code, source, http_status, severity, service, release, method, route, authenticated, occurred_at, details
       from error_occurrences
      where reference = $1 and (organization_id = $2 or organization_id is null)
      order by occurred_at asc
      limit 20`,
    [reference, organizationId],
  )
  return result.rows.map(toRecord)
}

/** Últimas ocorrências de um código (mesmo escopo), para ver se é um caso isolado ou recorrente. */
export async function recentOccurrencesByCode(db: Queryable, code: string, organizationId: string, limit = 20): Promise<{ total24h: number; recent: OccurrenceRecord[] }> {
  const [recent, total] = await Promise.all([
    db.query<Row>(
      `select reference, code, source, http_status, severity, service, release, method, route, authenticated, occurred_at, details
         from error_occurrences
        where code = $1 and (organization_id = $2 or organization_id is null)
        order by occurred_at desc
        limit $3`,
      [code, organizationId, limit],
    ),
    db.query<{ total: string }>(`select count(*)::text as total from error_occurrences where code = $1 and (organization_id = $2 or organization_id is null) and occurred_at > now() - interval '24 hours'`, [code, organizationId]),
  ])
  return { total24h: Number(total.rows[0]?.total ?? 0), recent: recent.rows.map(toRecord) }
}

/** Retenção: apaga em lotes as mais antigas que `days`. */
export async function purgeOldOccurrences(db: Queryable, days: number): Promise<number> {
  const result = await db.query(`delete from error_occurrences where id in (select id from error_occurrences where occurred_at < now() - make_interval(days => $1) limit 5000)`, [days])
  return result.rowCount ?? 0
}
