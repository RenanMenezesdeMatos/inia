import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { deleteMemberWindows, loadReadModelIndicatorCodes, rebuildMemberWindows } from "../infrastructure/operational-read-model.js"

/**
 * Tarefa `analytics-rollup` (worker, a cada 15 s, trava exclusiva): mantém o read model operacional do analytics da
 * liderança (migration 136) em dia, por organização.
 *  - RECONSTRUÇÃO COMPLETA quando muda o dia local (as janelas andam), o fuso, ou existe marca da organização inteira:
 *    todos os operadores ativos, em lotes; no fim, a organização passa para o novo dia e as marcas lidas no início saem.
 *  - INCREMENTAL no resto do tempo: as pessoas com marca pendente são recalculadas da fonte; saem exatamente as marcas lidas
 *    (marca que chega durante o cálculo fica para a próxima rodada — nunca se perde).
 * Só operadores ATIVOS têm linhas: são os únicos membros possíveis de uma estrutura. Quem deixa de ser tem as linhas
 * removidas. Idempotente: rodar de novo sobre os mesmos dados grava as mesmas linhas.
 */
export type AnalyticsRollupResult = { organizations: number; fullRebuilds: number; rebuiltPeople: number; removedPeople: number; marksCleared: number }

export type AnalyticsRollupOptions = { clock?: Clock; batchSize?: number; timeBudgetMs?: number; organizationId?: string; forceFull?: boolean }

const DEFAULT_BATCH_SIZE = 250
const DEFAULT_TIME_BUDGET_MS = 10_000

type OrganizationContext = { organizationId: string; now: Date; timeZone: string; today: string; codes: string[]; batchSize: number }

export async function runAnalyticsRollup(db: Database, options: AnalyticsRollupOptions = {}): Promise<AnalyticsRollupResult> {
  const clock = options.clock ?? systemClock
  const result: AnalyticsRollupResult = { organizations: 0, fullRebuilds: 0, rebuiltPeople: 0, removedPeople: 0, marksCleared: 0 }
  const organizations = await db.query<{ id: string }>(options.organizationId ? `select id from organizations where id = $1` : `select id from organizations order by id`, options.organizationId ? [options.organizationId] : [])
  for (const { id: organizationId } of organizations.rows) {
    result.organizations += 1
    const now = clock.now()
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const context: OrganizationContext = { organizationId, now, timeZone, today: localDateOf(now, timeZone), codes: await loadReadModelIndicatorCodes(db, organizationId), batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE }
    const [state, organizationMark] = await Promise.all([
      db.query<{ as_of_date: string | null; time_zone: string | null }>(`select as_of_date::text, time_zone from analytics_rollup_state where organization_id = $1`, [organizationId]),
      db.query(`select 1 from analytics_operational_dirty where organization_id = $1 and person_id is null limit 1`, [organizationId]),
    ])
    const current = state.rows[0]
    const needsFull = options.forceFull || !current || current.as_of_date !== context.today || current.time_zone !== timeZone || (organizationMark.rowCount ?? 0) > 0
    if (needsFull) {
      await fullRebuild(db, context, result)
      result.fullRebuilds += 1
    } else {
      await incremental(db, context, result, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS, clock)
    }
  }
  return result
}

async function activeOperatorsAmong(db: Database, organizationId: string, personIds: string[] | null): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    personIds === null
      ? `select id from people where organization_id = $1 and role = 'OPERATOR' and active order by id`
      : `select id from people where organization_id = $1 and role = 'OPERATOR' and active and id = any($2::uuid[]) order by id`,
    personIds === null ? [organizationId] : [organizationId, personIds],
  )
  return rows.rows.map((row) => row.id)
}

async function fullRebuild(db: Database, context: OrganizationContext, result: AnalyticsRollupResult): Promise<void> {
  const { organizationId } = context
  // Marcas visíveis AGORA: os dados delas já estão gravados, e os lotes abaixo leem depois — podem sair no fim.
  const marks = await db.query<{ id: string }>(`select id::text from analytics_operational_dirty where organization_id = $1`, [organizationId])
  await db.query(
    `insert into analytics_rollup_state (organization_id, full_build_started_at, updated_at) values ($1, $2, $2)
     on conflict (organization_id) do update set full_build_started_at = excluded.full_build_started_at, updated_at = excluded.updated_at`,
    [organizationId, context.now.toISOString()],
  )
  const operators = await activeOperatorsAmong(db, organizationId, null)
  for (let index = 0; index < operators.length; index += context.batchSize) {
    const batch = operators.slice(index, index + context.batchSize)
    await rebuildMemberWindows(db, { organizationId, personIds: batch, now: context.now, timeZone: context.timeZone, indicatorCodes: context.codes })
    result.rebuiltPeople += batch.length
  }
  const removed = await db.query<{ person_id: string }>(
    `select distinct person_id from analytics_member_window where organization_id = $1 and not (person_id = any($2::uuid[]))`,
    [organizationId, operators],
  )
  await deleteMemberWindows(db, organizationId, removed.rows.map((row) => row.person_id))
  result.removedPeople += removed.rowCount ?? 0
  await db.query(
    `update analytics_rollup_state set as_of_date = $2::date, time_zone = $3, generation = generation + 1, full_build_finished_at = now(), updated_at = now() where organization_id = $1`,
    [organizationId, context.today, context.timeZone],
  )
  result.marksCleared += await clearMarks(db, marks.rows.map((row) => row.id))
}

async function incremental(db: Database, context: OrganizationContext, result: AnalyticsRollupResult, timeBudgetMs: number, clock: Clock): Promise<void> {
  const { organizationId } = context
  const startedAt = clock.now().getTime()
  while (clock.now().getTime() - startedAt < timeBudgetMs) {
    const marks = await db.query<{ id: string; person_id: string }>(`select id::text, person_id from analytics_operational_dirty where organization_id = $1 and person_id is not null order by id limit 20000`, [organizationId])
    if (marks.rows.length === 0) return
    const people = [...new Set(marks.rows.map((row) => row.person_id))].slice(0, context.batchSize)
    const chosen = new Set(people)
    const operators = await activeOperatorsAmong(db, organizationId, people)
    const operatorSet = new Set(operators)
    await rebuildMemberWindows(db, { organizationId, personIds: operators, now: context.now, timeZone: context.timeZone, indicatorCodes: context.codes })
    const others = people.filter((personId) => !operatorSet.has(personId))
    await deleteMemberWindows(db, organizationId, others)
    result.rebuiltPeople += operators.length
    result.removedPeople += others.length
    await db.query(`update analytics_rollup_state set generation = generation + 1, updated_at = now() where organization_id = $1`, [organizationId])
    result.marksCleared += await clearMarks(db, marks.rows.filter((row) => chosen.has(row.person_id)).map((row) => row.id))
  }
}

async function clearMarks(db: Database, ids: string[]): Promise<number> {
  let cleared = 0
  for (let index = 0; index < ids.length; index += 20_000) {
    const deleted = await db.query(`delete from analytics_operational_dirty where id = any($1::bigint[])`, [ids.slice(index, index + 20_000)])
    cleared += deleted.rowCount ?? 0
  }
  return cleared
}
