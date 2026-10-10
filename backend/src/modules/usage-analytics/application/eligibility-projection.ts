import type { Database } from "../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { populationSql } from "../../people/application/usage-analytics-reader.js"

/**
 * ELEGIBILIDADE REGISTRADA (pessoa ativa + conta habilitada) — daqui em diante, nunca reconstruída por suposição.
 *
 * A cada rodada compara o estado ATUAL do cadastro com os intervalos abertos:
 *   - elegível sem intervalo aberto → abre: conta criada depois do início do registro = desde a criação (ACCOUNT_CREATED);
 *     quem já existia na primeira rodada = desde o início do registro (COLLECTION_START); reabilitação observada = agora
 *     (STATE_CHANGE_OBSERVED);
 *   - intervalo aberto de quem deixou de ser elegível → fecha agora, com o motivo.
 * Detecção leva até uma rodada (1 min). Na PRIMEIRA rodada da organização, o último login conhecido de cada conta
 * (`user_accounts.last_login_at`) vira marco histórico comprovado (`legacy_last_login_at`) — prova que a pessoa já acessou;
 * nunca prova frequência nem tempo de uso.
 */
type Queryable = Pick<Database, "query">

export async function runEligibilityProjection(db: Queryable, now = new Date()): Promise<{ organizations: number; opened: number; closed: number }> {
  const orgs = await db.query<{ id: string }>(`select id from organizations order by id`)
  let opened = 0
  let closed = 0
  for (const org of orgs.rows) {
    const result = await projectOrganization(db, org.id, now)
    opened += result.opened
    closed += result.closed
  }
  return { organizations: orgs.rows.length, opened, closed }
}

export async function projectOrganization(db: Queryable, organizationId: string, now: Date) {
  const tracking = await db.query<{ started_at: Date; inserted: boolean }>(
    `with ins as (insert into usage_eligibility_tracking (organization_id, started_at) values ($1, $2) on conflict (organization_id) do nothing returning started_at)
     select started_at, true inserted from ins union all select started_at, false from usage_eligibility_tracking where organization_id = $1 and not exists (select 1 from ins)`,
    [organizationId, now],
  )
  const trackingStart = tracking.rows[0]!.started_at
  const firstRun = tracking.rows[0]!.inserted
  const p = new SqlParams()
  const population = await db.query<{ person_id: string; person_active: boolean; account_id: string | null; account_active: boolean | null; account_created_at: Date | null; last_login_at: Date | null }>(
    `select person_id, person_active, account_id, account_active, account_created_at, last_login_at from (${populationSql(p, organizationId)}) pop`,
    p.values,
  )
  if (firstRun) {
    const withLogin = population.rows.filter((row) => row.last_login_at !== null && row.last_login_at < trackingStart)
    if (withLogin.length > 0) {
      await db.query(
        `insert into usage_person_milestones (organization_id, person_id, legacy_last_login_at, updated_at)
         select $1, person, login, $4 from unnest($2::uuid[], $3::timestamptz[]) as t(person, login)
         on conflict (organization_id, person_id) do update set legacy_last_login_at = coalesce(usage_person_milestones.legacy_last_login_at, excluded.legacy_last_login_at)`,
        [organizationId, withLogin.map((row) => row.person_id), withLogin.map((row) => row.last_login_at), now],
      )
    }
  }
  const open = await db.query<{ id: string; person_id: string }>(`select id, person_id from usage_eligibility_periods where organization_id = $1 and eligible_until is null`, [organizationId])
  const openByPerson = new Map(open.rows.map((row) => [row.person_id, row.id]))
  const everOpened = new Set((await db.query<{ person_id: string }>(`select distinct person_id from usage_eligibility_periods where organization_id = $1`, [organizationId])).rows.map((row) => row.person_id))
  let opened = 0
  let closed = 0
  const byPerson = new Map(population.rows.map((row) => [row.person_id, row]))
  for (const row of population.rows) {
    const eligible = row.person_active && row.account_id !== null && row.account_active === true
    if (!eligible || openByPerson.has(row.person_id)) continue
    const createdAfterStart = row.account_created_at !== null && row.account_created_at >= trackingStart
    const [from, basis] = createdAfterStart && !everOpened.has(row.person_id) ? [row.account_created_at!, "ACCOUNT_CREATED"] : everOpened.has(row.person_id) || !firstRun ? [now, "STATE_CHANGE_OBSERVED"] : [trackingStart, "COLLECTION_START"]
    await db.query(
      `insert into usage_eligibility_periods (organization_id, person_id, account_id, eligible_from, opened_basis) values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [organizationId, row.person_id, row.account_id, from, basis],
    )
    opened += 1
  }
  for (const [personId, periodId] of openByPerson) {
    const row = byPerson.get(personId)
    const reason = !row || row.account_id === null ? "ACCOUNT_REMOVED" : !row.person_active ? "PERSON_INACTIVE" : row.account_active !== true ? "ACCOUNT_DISABLED" : null
    if (!reason) continue
    await db.query(`update usage_eligibility_periods set eligible_until = $2, closed_basis = $3 where id = $1 and eligible_until is null`, [periodId, now, reason])
    closed += 1
  }
  return { opened, closed }
}
