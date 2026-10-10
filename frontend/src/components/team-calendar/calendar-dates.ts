/** Aritmética de datas civis (AAAA-MM-DD) do Calendário da equipe — sem fuso, sem Date local. */
export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/** Segunda da semana civil que contém a data. */
export function startOfWeek(date: string): string {
  const weekday = weekdayOf(date)
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10)
}

export type CalendarMode = "WEEK" | "MONTH"

export function rangeFor(mode: CalendarMode, anchorDate: string): { from: string; to: string } {
  if (mode === "WEEK") {
    const from = startOfWeek(anchorDate)
    return { from, to: addDays(from, 6) }
  }
  return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) }
}

export function shiftRange(mode: CalendarMode, anchorDate: string, direction: -1 | 1): string {
  if (mode === "WEEK") return addDays(anchorDate, 7 * direction)
  const [year, month] = anchorDate.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1 + direction, 1)).toISOString().slice(0, 10)
}

export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]
export const MONTH_LABELS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

export function describeRange(mode: CalendarMode, range: { from: string; to: string }): string {
  if (mode === "MONTH") return `${MONTH_LABELS[Number(range.from.slice(5, 7)) - 1]} de ${range.from.slice(0, 4)}`
  return `${range.from.slice(8, 10)}/${range.from.slice(5, 7)} → ${range.to.slice(8, 10)}/${range.to.slice(5, 7)}`
}
