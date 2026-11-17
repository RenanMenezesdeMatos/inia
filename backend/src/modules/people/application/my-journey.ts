import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { resolveWorkdaysBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { buildJourneyDays, type JourneyActivityInput, type JourneyDay, type JourneyDayInput, type JourneyException, type JourneyWorkShiftInput } from "../domain/my-journey.js"
import type { ScheduleActivityType } from "../domain/schedule-activity.js"
import { SCHEDULE_EXCEPTION_ORIGIN_LABELS } from "../domain/schedule-exception.js"
import { weekdayOf } from "../domain/work-schedule.js"
import { listScheduleExceptions } from "./schedule-exception-service.js"

/**
 * MINHA JORNADA — a escala da PRÓPRIA pessoa logada, uma semana (segunda a domingo) por vez. Consulta, nunca escrita.
 *
 * Quem é a pessoa vem SÓ da sessão (`user.personId`): não existe parâmetro de pessoa, matrícula ou id — nem na rota, nem na
 * query. Não depende de `calendar.manage` nem do escopo de gestão; o Calendário da equipe continua como está.
 *
 * Reaproveita o resolvedor único do dia (`resolveWorkdaysBySubject`: situação funcional, exceções, escala, feriado do fallback),
 * a listagem de exceções do Calendário da equipe e as tabelas que a Central de Dados alimenta (Escalas de trabalho, Jornadas
 * de trabalho, Exceções de calendário e Atividades escaladas — login, pausas e outras atividades).
 *
 * `pauses.available` = a organização recebe atividades escaladas (há feed do contrato WORK_SCHEDULE_ACTIVITIES ou atividade
 * gravada). Sem isso a tela avisa que o detalhamento não chega; com isso, um dia sem atividades é "sem pausas informadas".
 */
export type MyJourneyView = {
  today: string
  timeZone: string
  generatedAt: string
  week: { from: string; to: string; previous: string; next: string; containsToday: boolean }
  pauses: { available: boolean; message: string }
  days: JourneyDay[]
}

export const PAUSES_UNAVAILABLE_MESSAGE = "O detalhamento das pausas ainda não chega à INIA. Por enquanto, a linha do tempo mostra só a entrada e a saída da sua escala."
export const PAUSES_AVAILABLE_MESSAGE = "Pausas e atividades conforme a escala publicada."

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Segunda-feira da semana (pt-BR: a semana começa na segunda). */
export function mondayOf(date: string): string {
  const weekday = weekdayOf(date)
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

export async function buildMyJourney(db: Database, user: AuthTokenPayload, input: { weekOf?: string | undefined; now?: Date }): Promise<MyJourneyView> {
  const now = input.now ?? new Date()
  const timeZone = await resolveOrganizationTimezone(db, user.organizationId)
  const today = localDateOf(now, timeZone)
  const from = mondayOf(input.weekOf ?? today)
  const to = addDays(from, 6)
  const dayBefore = addDays(from, -1)
  const personId = user.personId
  const window = { start: startOfLocalDate(dayBefore, timeZone), end: startOfLocalDate(addDays(to, 1), timeZone) }

  const [workdays, exceptions, schedule, shifts, activities, activitySource] = await Promise.all([
    resolveWorkdaysBySubject(db, [personId], window, timeZone, { now }),
    listScheduleExceptions(db, { organizationId: user.organizationId, personIds: [personId], from: dayBefore, to }),
    db.query<{ schedule_date: string; shift_start: string | null; shift_end: string | null }>(
      `select schedule_date::text schedule_date, shift_start::text shift_start, shift_end::text shift_end
         from employee_schedule_days
        where organization_id = $1 and person_id = $2 and schedule_date between $3::date and $4::date`,
      [user.organizationId, personId, dayBefore, to],
    ),
    db.query<{ start_time: string; work_minutes: number; effective_from: string; effective_to: string | null }>(
      `select start_time::text start_time, work_minutes, effective_from::text effective_from, effective_to::text effective_to
         from employee_work_shifts
        where organization_id = $1 and person_id = $2 and effective_from <= $4::date and (effective_to is null or effective_to >= $3::date)
        order by effective_from desc`,
      [user.organizationId, personId, dayBefore, to],
    ),
    db.query<{ schedule_date: string; activity_type: ScheduleActivityType; activity_name: string; start_time: string; end_time: string }>(
      `select schedule_date::text schedule_date, activity_type, activity_name, start_time::text start_time, end_time::text end_time
         from employee_schedule_activities
        where organization_id = $1 and person_id = $2 and schedule_date between $3::date and $4::date and active
        order by schedule_date, start_time`,
      [user.organizationId, personId, dayBefore, to],
    ),
    db.query<{ available: boolean }>(
      `select exists(select 1 from data_feeds where organization_id = $1 and contract_key = 'WORK_SCHEDULE_ACTIVITIES' and deleted_at is null)
           or exists(select 1 from employee_schedule_activities where organization_id = $1) available`,
      [user.organizationId],
    ),
  ])

  const activitiesByDate = new Map<string, JourneyActivityInput[]>()
  for (const row of activities.rows) activitiesByDate.set(row.schedule_date, [...(activitiesByDate.get(row.schedule_date) ?? []), { type: row.activity_type, name: row.activity_name, start: row.start_time, end: row.end_time }])
  const scheduleByDate = new Map(schedule.rows.map((row) => [row.schedule_date, { start: row.shift_start, end: row.shift_end }]))
  const exceptionsByDate = new Map<string, JourneyException[]>()
  for (const exception of exceptions) {
    if (!exception.active) continue
    exceptionsByDate.set(exception.date, [...(exceptionsByDate.get(exception.date) ?? []), { id: exception.id, code: exception.code, label: exception.label, originLabel: SCHEDULE_EXCEPTION_ORIGIN_LABELS[exception.origin] }])
  }
  // Jornada vigente na data: a de início mais recente que já começou e ainda não terminou (mesma regra de `loadShiftsOn`).
  const workShiftOn = (date: string): JourneyWorkShiftInput => {
    const row = shifts.rows.find((shift) => shift.effective_from <= date && (shift.effective_to === null || shift.effective_to >= date))
    return row ? { startTime: row.start_time, workMinutes: row.work_minutes } : null
  }

  const resolvedDays = workdays.get(personId)?.days ?? []
  const inputs: JourneyDayInput[] = resolvedDays.map((resolved) => ({ resolved, exceptions: exceptionsByDate.get(resolved.date) ?? [], scheduleDay: scheduleByDate.get(resolved.date) ?? null, workShift: workShiftOn(resolved.date), activities: activitiesByDate.get(resolved.date) ?? [] }))
  // O resolvedor devolve todas as datas da janela, a começar pela véspera da segunda (só serve à jornada que cruza a meia-noite).
  const days = inputs[0]?.resolved.date === dayBefore ? buildJourneyDays(inputs) : []

  return {
    today,
    timeZone,
    generatedAt: now.toISOString(),
    week: { from, to, previous: addDays(from, -7), next: addDays(from, 7), containsToday: today >= from && today <= to },
    pauses: activitySource.rows[0]?.available ? { available: true, message: PAUSES_AVAILABLE_MESSAGE } : { available: false, message: PAUSES_UNAVAILABLE_MESSAGE },
    days: days.filter((day) => day.date >= from && day.date <= to),
  }
}
