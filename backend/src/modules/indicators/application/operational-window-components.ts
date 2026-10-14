import type { Database } from "../../../infrastructure/database/pool.js"
import { NON_ELIGIBLE_EMPLOYMENT_STATUSES } from "../../people/domain/employment-status.js"
import { localDatesInWindow, type TimeWindow } from "../../workflows/application/time-window.js"
import {
  aggregateColumns,
  eligibilityFactsOf,
  eligibleDayRanges,
  eligibleMeasurementSql,
  resolveWorkdaysBySubject,
  summarizeWorkdays,
  unjustifiedAbsenceDays,
  type EligibilityResult,
  type MeasurementWindowRow,
  type WindowEligibilityFacts,
} from "./operational-measurement-resolver.js"

/**
 * COMPONENTES BRUTOS de várias janelas × várias pessoas × vários indicadores numa consulta — a matéria-prima do read model
 * do analytics da liderança (performance-analytics/infrastructure/operational-read-model.ts). É a MESMA regra das janelas
 * do resolvedor único, aplicada em lote:
 *  - elegibilidade por `resolveWorkdaysBySubject` UMA vez na união das janelas e recortada por janela com `summarizeWorkdays`
 *    (a elegibilidade de um dia não depende da janela nem do "agora");
 *  - medições pelo mesmo predicado (`eligibleMeasurementSql`), com a data local exigida dentro das datas da janela — o que a
 *    consulta original já garantia, porque os intervalos elegíveis dela só cobriam a janela;
 *  - colunas de `aggregateColumns` (as mesmas expressões) + o desempate do último valor (`period_end`, `id`) para que a
 *    estrutura possa recombinar pessoas.
 * Numéricos voltam como TEXTO do banco: somar componentes fora daqui só é exato em `numeric`.
 */
export type ComponentWindow = { key: string; window: TimeWindow }

export type WindowComponentRow = MeasurementWindowRow & {
  window_key: string
  subject_id: string
  indicator_code: string
  /** `period_end` do último valor elegível (texto do banco, sem perder microssegundos) e o `id` que desempata. */
  latest_period_end: string | null
  latest_id: string | null
}

export type WindowComponents = {
  /** Fatos de elegibilidade por janela × pessoa (todas as pessoas pedidas, com ou sem medição). */
  eligibility: Map<string, Map<string, WindowEligibilityFacts>>
  /** Uma linha por janela × pessoa × indicador com alguma medição sobreposta à janela (elegível ou não). */
  rows: WindowComponentRow[]
}

export async function resolveWindowComponentsBySubject(
  db: Database,
  input: { subjectIds: string[]; windows: ComponentWindow[]; indicatorCodes: string[]; timeZone: string; now: Date },
): Promise<WindowComponents> {
  const eligibility = new Map<string, Map<string, WindowEligibilityFacts>>(input.windows.map((entry) => [entry.key, new Map()]))
  if (input.subjectIds.length === 0 || input.windows.length === 0) return { eligibility, rows: [] }
  const union: TimeWindow = {
    start: new Date(Math.min(...input.windows.map((entry) => entry.window.start.getTime()))),
    end: new Date(Math.max(...input.windows.map((entry) => entry.window.end.getTime()))),
  }
  const workdays = await resolveWorkdaysBySubject(db, input.subjectIds, union, input.timeZone, { now: input.now })
  const windowDates = input.windows.map((entry) => ({ key: entry.key, dates: localDatesInWindow(entry.window, input.timeZone) }))
  const unionEligibility = new Map<string, EligibilityResult>()
  for (const [subjectId, subject] of workdays) {
    unionEligibility.set(subjectId, summarizeWorkdays(subject))
    for (const { key, dates } of windowDates) {
      const inWindow = new Set(dates)
      eligibility.get(key)!.set(subjectId, eligibilityFactsOf(summarizeWorkdays({ ...subject, days: subject.days.filter((day) => inWindow.has(day.date)) })))
    }
  }
  if (input.indicatorCodes.length === 0) return { eligibility, rows: [] }
  const ranges = eligibleDayRanges(unionEligibility)
  const absence = unjustifiedAbsenceDays(unionEligibility)
  const sql = eligibleMeasurementSql({ alias: "m", timeZoneParam: "$9", personIdsParam: "$10", fromParam: "$11", toParam: "$12", statusesParam: "$13", absencePersonIdsParam: "$14", absenceDatesParam: "$15" })
  const localDate = `(m.period_start at time zone $9)::date`
  const result = await db.query<WindowComponentRow>(
    `with windows(window_key, window_start, window_end, first_date, last_date) as (
       select * from unnest($3::text[], $4::timestamptz[], $5::timestamptz[], $6::date[], $7::date[])
     ),
     ${sql.cte},
     scoped as (
       select w.window_key, i.code indicator_code, m.*,
              (${sql.predicate}) and (m.granularity not in ('DAILY', 'HOURLY', 'INTERACTION') or ${localDate} between w.first_date and w.last_date) eligible,
              ${sql.absencePredicate} and ${localDate} between w.first_date and w.last_date on_absence_day
         from indicator_measurements m
         join indicator_definitions i on i.id = m.indicator_definition_id
         join windows w on m.period_start < w.window_end and m.period_end > w.window_start
         ${sql.join}
        where i.code = any($1::text[]) and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[]) and m.period_start < $8::timestamptz and m.period_end > $16::timestamptz)
     select m.window_key, m.subject_id, m.indicator_code, ${aggregateColumns("m", "$9")},
            (array_agg(m.period_end::text order by m.period_end desc, m.id desc) filter (where m.eligible))[1] latest_period_end,
            (array_agg(m.id::text order by m.period_end desc, m.id desc) filter (where m.eligible))[1] latest_id
       from scoped m
      group by m.window_key, m.subject_id, m.indicator_code`,
    [
      input.indicatorCodes,
      input.subjectIds,
      input.windows.map((entry) => entry.key),
      input.windows.map((entry) => entry.window.start.toISOString()),
      input.windows.map((entry) => entry.window.end.toISOString()),
      windowDates.map(({ dates }) => dates[0] ?? "infinity"),
      windowDates.map(({ dates }) => dates[dates.length - 1] ?? "-infinity"),
      union.end.toISOString(),
      input.timeZone,
      ranges.personIds,
      ranges.from,
      ranges.to,
      NON_ELIGIBLE_EMPLOYMENT_STATUSES,
      absence.personIds,
      absence.dates,
      union.start.toISOString(),
    ],
  )
  return { eligibility, rows: result.rows }
}
