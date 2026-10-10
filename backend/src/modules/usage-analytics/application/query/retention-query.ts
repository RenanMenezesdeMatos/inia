import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { rate } from "../../domain/metric-value.js"
import { addDays, localDateOf } from "../../domain/usage-time.js"
import { allowedClasses, factStructureSql, type UsabilityContext } from "./usability-context.js"
import { scopeCtes } from "./activity-sql.js"

/**
 * RETENÇÃO — coortes do PRIMEIRO ACESSO COMPROVADO (marco observado pela monitoria, sem login conhecido anterior à coleta:
 * histórico desconhecido nunca vira "primeiro acesso da vida"). D1/D7/D30 = voltou EXATAMENTE no dia civil N depois; só entram
 * coortes cuja janela N já terminou (tamanho e período informados). Matriz semanal: semana do primeiro acesso × semanas
 * seguintes, com a mesma regra de maturidade.
 */
type Queryable = Pick<Database, "query">
const DAY_OFFSETS = [1, 7, 30] as const
const WEEK_OFFSETS = 8

export async function retentionQuery(db: Queryable, ctx: UsabilityContext) {
  const tz = ctx.settings.timezone
  const today = localDateOf(ctx.now, tz)
  const p = new SqlParams()
  const org = p.typed(ctx.organizationId, "uuid")
  const rows = await db.query<{ person_id: string; cohort_date: string; active_dates: string[] }>(
    `with ${scopeCtes(p, ctx)},
      cohort as (select m.person_id, to_char((m.first_observed_at at time zone ${p.add(tz)})::date, 'YYYY-MM-DD') cohort_date from usage_person_milestones m
        where m.organization_id = ${org} and m.legacy_last_login_at is null and m.first_observed_at >= ${p.typed(ctx.period.start, "timestamptz")} and m.first_observed_at < ${p.typed(ctx.period.end, "timestamptz")}
          and m.person_id in (select person_id from scope_fact))
      select c.person_id, c.cohort_date, coalesce(array_agg(to_char(pd.local_date, 'YYYY-MM-DD') order by pd.local_date) filter (where pd.local_date is not null), '{}') active_dates
      from cohort c left join usage_person_days pd on pd.organization_id = ${org} and pd.person_id = c.person_id and pd.local_date > c.cohort_date::date
        and (pd.active_product or (${p.add(ctx.filters.includeAdmin)}::boolean and pd.active_admin)) and pd.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, "pd")}
      group by c.person_id, c.cohort_date`,
    p.values,
  )
  const cohorts = rows.rows
  const days = DAY_OFFSETS.map((offset) => {
    const mature = cohorts.filter((cohort) => addDays(cohort.cohort_date, offset) < today)
    const returned = mature.filter((cohort) => cohort.active_dates.includes(addDays(cohort.cohort_date, offset)))
    return { offset, label: `D${offset}`, matureCohort: mature.length, immature: cohorts.length - mature.length, returned: returned.length, rate: rate(returned.length, mature.length), cumulativeReturned: mature.filter((cohort) => cohort.active_dates.some((date) => date <= addDays(cohort.cohort_date, offset))).length }
  })
  const weekStart = (date: string) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() // 0 = domingo
    return addDays(date, -((day + 6) % 7))
  }
  const byWeek = new Map<string, typeof cohorts>()
  for (const cohort of cohorts) byWeek.set(weekStart(cohort.cohort_date), [...(byWeek.get(weekStart(cohort.cohort_date)) ?? []), cohort])
  const currentWeek = weekStart(today)
  const weekly = [...byWeek].sort(([a], [b]) => a.localeCompare(b)).map(([week, members]) => ({
    week,
    size: members.length,
    weeks: Array.from({ length: WEEK_OFFSETS }, (_, index) => {
      const offset = index + 1
      const from = addDays(week, offset * 7)
      const to = addDays(from, 6)
      if (from > currentWeek || to >= today) return { offset, mature: false, returned: null, rate: null }
      const returned = members.filter((member) => member.active_dates.some((date) => date >= from && date <= to)).length
      return { offset, mature: true, returned, rate: rate(returned, members.length) }
    }),
  }))
  return { cohortSize: cohorts.length, basis: "Primeiro acesso comprovado no período (sem login conhecido antes da coleta)", days, weekly }
}
