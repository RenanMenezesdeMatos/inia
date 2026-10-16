import { addDays, localDateParts, weekdayOf, zonedTimeToIso } from "../../workflows/application/schedule-recurrence.js"
import type { ReportSchedule } from "./report-definition.js"

/**
 * AGENDA de um report — módulo puro, sem biblioteca de datas (como a agenda dos Workflows, cujas funções de fuso reaproveita).
 * Datas são de calendário LOCAL do fuso configurado; horários HH:mm locais viram instantes UTC por `zonedTimeToIso`.
 * Mês sem o dia escolhido (ex.: 31 em abril): `onMissingDay` decide — SKIP pula aquele mês; LAST_DAY usa o último dia. Nunca
 * escorrega para o mês seguinte.
 */
function daysInMonth(dateStr: string): number {
  return new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)), 0)).getUTCDate()
}

export function isScheduleDateDue(schedule: ReportSchedule, dateStr: string): boolean {
  if (schedule.frequency === "DAILY") return true
  if (schedule.frequency === "WEEKLY") return (schedule.weekdays ?? []).includes(weekdayOf(dateStr))
  const day = Number(dateStr.slice(8, 10))
  const lastDay = daysInMonth(dateStr)
  if (schedule.dayOfMonth === "LAST") return day === lastDay
  const wanted = schedule.dayOfMonth ?? 1
  if (wanted <= lastDay) return day === wanted
  return schedule.onMissingDay === "LAST_DAY" && day === lastDay
}

const sortedTimes = (schedule: ReportSchedule) => [...new Set(schedule.times)].sort()

/** Próximo instante agendado ESTRITAMENTE depois de `from` (até ~13 meses à frente). */
export function nextRunAfter(schedule: ReportSchedule, timeZone: string, from: Date): Date | null {
  const today = localDateParts(from, timeZone).date
  for (let offset = 0; offset <= 400; offset += 1) {
    const date = addDays(today, offset)
    if (!isScheduleDateDue(schedule, date)) continue
    for (const time of sortedTimes(schedule)) {
      const instant = new Date(zonedTimeToIso(date, time, timeZone))
      if (instant.getTime() > from.getTime()) return instant
    }
  }
  return null
}

/** O último horário agendado até `now` (inclusive), olhando no máximo `lookbackDays` para trás — usado para não acumular
 * execuções atrasadas: o worker parado por dias gera UMA execução (a do último horário vencido). */
export function latestDueAtOrBefore(schedule: ReportSchedule, timeZone: string, now: Date, lookbackDays = 40): Date | null {
  const today = localDateParts(now, timeZone).date
  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    const date = addDays(today, -offset)
    if (!isScheduleDateDue(schedule, date)) continue
    for (const time of sortedTimes(schedule).reverse()) {
      const instant = new Date(zonedTimeToIso(date, time, timeZone))
      if (instant.getTime() <= now.getTime()) return instant
    }
  }
  return null
}

/** Próximas `count` execuções (prévia no formulário). */
export function upcomingRuns(schedule: ReportSchedule, timeZone: string, from: Date, count = 3): Date[] {
  const runs: Date[] = []
  let cursor = from
  while (runs.length < count) {
    const next = nextRunAfter(schedule, timeZone, cursor)
    if (!next) break
    runs.push(next)
    cursor = next
  }
  return runs
}

const WEEKDAY_LABELS: Record<string, string> = { MON: "seg", TUE: "ter", WED: "qua", THU: "qui", FRI: "sex", SAT: "sáb", SUN: "dom" }

export function describeSchedule(schedule: ReportSchedule, timeZone: string): string {
  const times = sortedTimes(schedule).join(", ")
  const when =
    schedule.frequency === "DAILY"
      ? "Todos os dias"
      : schedule.frequency === "WEEKLY"
        ? `Toda semana (${(schedule.weekdays ?? []).map((day) => WEEKDAY_LABELS[day]).join(", ")})`
        : schedule.dayOfMonth === "LAST"
          ? "Todo mês, no último dia"
          : `Todo mês, dia ${schedule.dayOfMonth}${typeof schedule.dayOfMonth === "number" && schedule.dayOfMonth > 28 ? (schedule.onMissingDay === "LAST_DAY" ? " (ou o último dia, nos meses sem ele)" : " (pula os meses sem esse dia)") : ""}`
  return `${when}, às ${times} (${timeZone})`
}
