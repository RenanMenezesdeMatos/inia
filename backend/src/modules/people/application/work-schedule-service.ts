import type { Database } from "../../../infrastructure/database/pool.js"
import { addDaysToDate } from "../domain/employment-status.js"
import { nextScheduledDayOff, resolveScheduledDay, SCHEDULE_BASIS_LABELS, SCHEDULE_TYPE_LABELS, type ScheduleBasis, type ScheduleDay, type ScheduleType } from "../domain/work-schedule.js"
import { SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "../domain/schedule-exception.js"
import { describeStatusSource, resolveWorkScheduleFreshness, type EmploymentStatusFreshness } from "./employment-status-freshness.js"

/**
 * LEITURA da escala de um colaborador para perfil/admin — só o que a fonte informou:
 * regime vigente (employee_work_shifts.schedule_type, com vigência), calendário explícito a
 * partir de hoje (employee_schedule_days) e a próxima folga PROGRAMADA (nunca inferida do regime).
 * A regra de elegibilidade por dia continua ÚNICA em people/domain/work-schedule.ts e é aplicada
 * pelo resolvedor operacional — aqui é apresentação.
 */
export type WorkScheduleSummary = {
  scheduleType: ScheduleType | null
  scheduleTypeLabel: string | null
  basis: ScheduleBasis
  basisLabel: string
  nextDayOff: string | null
  knownDaysAhead: number
  freshness: { state: EmploymentStatusFreshness["state"]; lastSuccessAt: string | null; cadenceLabel: string | null; sourceName: string | null; feedName: string | null }
  origin: { sourceName: string; feedName: string; feedId: string; sourceId: string } | null
  /** Id do registro de calendário de hoje (lineage), quando existe. */
  todayScheduleId: string | null
  /** Até que data a fonte informou o calendário desta pessoa (null = nenhum dia conhecido a partir de hoje). */
  knownUntil: string | null
  /** Exceções individuais vigentes (banco de horas, day off, folga extraordinária) de hoje em diante, no horizonte. */
  upcomingExceptions: { id: string; date: string; code: ScheduleExceptionCode; label: string; rawReason: string | null }[]
  /** Exceção de hoje, se houver — explica "por que hoje não é elegível". */
  todayException: { id: string; code: ScheduleExceptionCode; label: string; rawReason: string | null } | null
}

const HORIZON_DAYS = 60

/**
 * HORIZONTE DO CALENDÁRIO da organização — "até que data a INIA conhece a escala?". Conceito
 * DIFERENTE de freshness (quando a última carga chegou) e de saúde da conexão: a fonte pode estar
 * saudável e recém-carregada e o calendário terminar amanhã. Derivado do próprio calendário
 * (`employee_schedule_days`), sem tabela nova: primeira/última data conhecidas, quantos dias restam a
 * partir de hoje e se cruzou o limite de aviso configurado (organizations.schedule_horizon_warning_days).
 */
export type WorkScheduleHorizon = {
  configured: boolean
  coverageFrom: string | null
  coverageUntil: string | null
  /** Dias de calendário conhecidos a partir de hoje (inclusive); 0 = termina hoje ou já terminou. */
  daysRemaining: number | null
  warningDays: number
  /** true quando há calendário e ele termina em ≤ warningDays dias. */
  endingSoon: boolean
  /** Pessoas com pelo menos um dia de calendário conhecido a partir de hoje. */
  peopleWithCalendarAhead: number
}

export async function resolveWorkScheduleHorizon(db: Database, organizationId: string, today: string): Promise<WorkScheduleHorizon> {
  const [range, settings] = await Promise.all([
    db.query<{ coverage_from: string | null; coverage_until: string | null; people_ahead: number }>(
      `select min(schedule_date)::text coverage_from, max(schedule_date)::text coverage_until, count(distinct person_id) filter (where schedule_date >= $2::date)::int people_ahead
         from employee_schedule_days where organization_id = $1`,
      [organizationId, today],
    ),
    db.query<{ schedule_horizon_warning_days: number }>(`select schedule_horizon_warning_days from organizations where id = $1`, [organizationId]),
  ])
  const row = range.rows[0]
  const warningDays = settings.rows[0]?.schedule_horizon_warning_days ?? 7
  const until = row?.coverage_until ?? null
  const daysRemaining = until ? Math.max(0, daysBetween(today, until) + 1) : null
  return {
    configured: until !== null,
    coverageFrom: row?.coverage_from ?? null,
    coverageUntil: until,
    daysRemaining,
    warningDays,
    endingSoon: daysRemaining !== null && daysRemaining <= warningDays,
    peopleWithCalendarAhead: row?.people_ahead ?? 0,
  }
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000)
}

export async function loadWorkScheduleSummary(db: Database, organizationId: string, personId: string, today: string, now: Date, timeZone: string, freshness?: EmploymentStatusFreshness): Promise<WorkScheduleSummary> {
  type RegimeRow = { schedule_type: string }
  type DayRow = { id: string; schedule_date: string; scheduled_to_work: boolean; shift_start: string | null; shift_end: string | null; source: string; schedule_type: string | null }
  type ExceptionRow = { id: string; exception_date: string; code: ScheduleExceptionCode; raw_reason: string | null }
  const horizonEnd = addDaysToDate(today, HORIZON_DAYS)
  const [regime, days, exceptions, scheduleFreshness] = await Promise.all([
    db.query<RegimeRow>(`select schedule_type from employee_work_shifts where person_id = $1 and schedule_type is not null and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date) order by effective_from desc limit 1`, [personId, today]),
    db.query<DayRow>(`select id, schedule_date::text schedule_date, scheduled_to_work, shift_start::text shift_start, shift_end::text shift_end, source, schedule_type from employee_schedule_days where person_id = $1 and schedule_date between $2::date and $3::date order by schedule_date`, [personId, today, horizonEnd]),
    db.query<ExceptionRow>(`select id, exception_date::text exception_date, code, raw_reason from employee_schedule_exceptions where person_id = $1 and active and exception_date between $2::date and $3::date order by exception_date`, [personId, today, horizonEnd]),
    freshness ? Promise.resolve(freshness) : resolveWorkScheduleFreshness(db, organizationId, now, timeZone),
  ])
  // Regime: pela jornada (vigência) e, na falta, pelo que o calendário explícito informou por dia.
  const scheduleType = ((regime.rows[0]?.schedule_type ?? days.rows.find((row) => row.schedule_type)?.schedule_type) as ScheduleType | undefined) ?? null
  const explicit: ScheduleDay[] = days.rows.map((row) => ({ date: row.schedule_date, scheduledToWork: row.scheduled_to_work, shiftStart: row.shift_start, shiftEnd: row.shift_end }))
  const todayRow = days.rows.find((row) => row.schedule_date === today) ?? null
  const basis = resolveScheduledDay({ date: today, explicit: explicit.find((day) => day.date === today), scheduleType, holiday: false }).basis
  const consideredFeed = scheduleFreshness.feeds.find((feed) => scheduleFreshness.consideredFeedIds.includes(feed.feedId)) ?? null
  const originSource = todayRow?.source ?? days.rows[0]?.source ?? null
  const todayException = exceptions.rows.find((row) => row.exception_date === today) ?? null
  return {
    scheduleType,
    scheduleTypeLabel: scheduleType ? SCHEDULE_TYPE_LABELS[scheduleType] : null,
    basis,
    basisLabel: SCHEDULE_BASIS_LABELS[basis],
    nextDayOff: nextScheduledDayOff(explicit, today)?.date ?? null,
    knownDaysAhead: explicit.length,
    freshness: { state: scheduleFreshness.state, lastSuccessAt: scheduleFreshness.lastSuccessAt, cadenceLabel: consideredFeed?.cadenceLabel ?? null, sourceName: consideredFeed?.sourceName ?? null, feedName: consideredFeed?.feedName ?? null },
    origin: describeStatusSource(scheduleFreshness, originSource),
    todayScheduleId: todayRow?.id ?? null,
    knownUntil: days.rows.length > 0 ? days.rows[days.rows.length - 1]!.schedule_date : null,
    upcomingExceptions: exceptions.rows.map((row) => ({ id: row.id, date: row.exception_date, code: row.code, label: SCHEDULE_EXCEPTION_LABELS[row.code], rawReason: row.raw_reason })),
    todayException: todayException ? { id: todayException.id, code: todayException.code, label: SCHEDULE_EXCEPTION_LABELS[todayException.code], rawReason: todayException.raw_reason } : null,
  }
}
