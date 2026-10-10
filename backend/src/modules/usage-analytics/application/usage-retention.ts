import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * RETENÇÃO da monitoria — escopo RESTRITO às tabelas novas (usage_*), em lotes, com registro. Eventos brutos e lotes:
 * `raw_retention_days` (padrão 90); sessões e fatos pessoa × dia (× tela): `fact_retention_months` (padrão 13). NUNCA apaga
 * dado de negócio (feedbacks, avaliações, ciência, conversas, workflows) nem os MARCOS de acesso (usage_person_milestones) e a
 * elegibilidade — expirar eventos nunca transforma alguém em "nunca acessou". Configuração operacional, não declaração de
 * conformidade legal.
 */
type Queryable = Pick<Database, "query">

const BATCH = 5_000

async function deleteInBatches(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  let total = 0
  for (let round = 0; round < 1_000; round += 1) {
    const result = await db.query(sql, params)
    total += result.rowCount ?? 0
    if ((result.rowCount ?? 0) < BATCH) break
  }
  return total
}

export async function runUsageRetention(db: Queryable, now = new Date()) {
  const startedAt = new Date()
  const orgs = await db.query<{ id: string; raw_days: number; fact_months: number }>(
    `select o.id, coalesce(s.raw_retention_days, 90) raw_days, coalesce(s.fact_retention_months, 13) fact_months from organizations o left join usage_settings s on s.organization_id = o.id`,
  )
  const details: Record<string, { events: number; batches: number; sessions: number; personDays: number; screenDays: number }> = {}
  for (const org of orgs.rows) {
    const rawCutoff = new Date(now.getTime() - org.raw_days * 86_400_000)
    const factCutoff = new Date(now)
    factCutoff.setUTCMonth(factCutoff.getUTCMonth() - org.fact_months)
    const events = await deleteInBatches(db, `delete from usage_events where id in (select id from usage_events where organization_id = $1 and received_at < $2 limit ${BATCH})`, [org.id, rawCutoff])
    const batches = await deleteInBatches(db, `delete from usage_ingest_batches where id in (select id from usage_ingest_batches where organization_id = $1 and received_at < $2 limit ${BATCH})`, [org.id, rawCutoff])
    const sessions = await deleteInBatches(db, `delete from usage_sessions where id in (select id from usage_sessions where organization_id = $1 and started_at < $2 limit ${BATCH})`, [org.id, factCutoff])
    const personDays = await deleteInBatches(db, `delete from usage_person_days where ctid in (select ctid from usage_person_days where organization_id = $1 and local_date < $2::date limit ${BATCH})`, [org.id, factCutoff.toISOString().slice(0, 10)])
    const screenDays = await deleteInBatches(db, `delete from usage_screen_person_days where ctid in (select ctid from usage_screen_person_days where organization_id = $1 and local_date < $2::date limit ${BATCH})`, [org.id, factCutoff.toISOString().slice(0, 10)])
    details[org.id] = { events, batches, sessions, personDays, screenDays }
  }
  await db.query(`delete from usage_projection_runs where started_at < $1`, [new Date(now.getTime() - 90 * 86_400_000)])
  const processed = Object.values(details).reduce((sum, item) => sum + item.events + item.batches + item.sessions + item.personDays + item.screenDays, 0)
  await db.query(`insert into usage_projection_runs (kind, started_at, finished_at, processed, details) values ('RETENTION', $1, $2, $3, $4)`, [startedAt, new Date(), processed, JSON.stringify(details)])
  return details
}
