import type { HistoricalPeriod } from "../domain/graph-schema.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "./organization-timezone.js"
import { addDays, localDateParts, zonedTimeToIso } from "./schedule-recurrence.js"

/**
 * Abstração ÚNICA de janela temporal das medições operacionais — Condition, Ranking, quartil
 * operacional, QA Lab, área Indicadores e contexto de Agent resolvem a janela aqui, nunca cada
 * um por conta. Toda a matemática é feita no calendário LOCAL de uma timezone IANA
 * (`operations.timezone`, ex.: America/Fortaleza; fallback documentado em
 * organization-timezone.ts) — nunca em offset fixo, nunca UTC silencioso. Horário de verão, se
 * existir na timezone, é tratado pelo runtime (`Intl`), não por lógica manual.
 *
 * Semântica documentada:
 *  - ROLLING_DAYS N ("Últimos N dias"): os N DIAS DE CALENDÁRIO terminando HOJE, com hoje
 *    parcial: [início do dia local de hoje − (N−1) dias, agora). "Últimos 7 dias" em 15/09 =
 *    09/09 00:00 local → 15/09 agora. Dias corridos (dias sem medição só não somam).
 *  - CALENDAR DAY/WEEK/MONTH/TWO_MONTHS/QUARTER/FOUR_MONTHS/SEMESTER, PREVIOUS: período civil anterior
 *    completo (Ontem, Semana anterior, Mês anterior…); CURRENT: período civil corrente, parcial
 *    até agora (Hoje, Semana corrente, Mês corrente). Semana = segunda a domingo.
 *  - Janela anterior (comparação): a janela imediatamente anterior de MESMO tamanho — pra
 *    ROLLING_DAYS N, os N dias antes do início; pra CALENDAR, o período civil anterior completo.
 *  - Pertencimento: uma medição está na janela se o intervalo dela SOBREPÕE a janela.
 * CLOSURES ("Últimos N fechamentos/meses fechados") não é uma janela contínua — é tratado à
 * parte pelo resolvedor de fechamentos (que usa `closedCalendarMonths`).
 */
export type TimeWindow = { start: Date; end: Date }
export type CalendarUnit = "DAY" | "WEEK" | "MONTH" | "TWO_MONTHS" | "QUARTER" | "FOUR_MONTHS" | "SEMESTER"

/** Tamanho, em meses, dos períodos civis multi-mês (bimestre = jan–fev, mar–abr…; trimestre = jan–mar…). */
const MONTHS_PER_UNIT: Record<Extract<CalendarUnit, "TWO_MONTHS" | "QUARTER" | "FOUR_MONTHS" | "SEMESTER">, number> = { TWO_MONTHS: 2, QUARTER: 3, FOUR_MONTHS: 4, SEMESTER: 6 }
export type CalendarPhase = "CURRENT" | "PREVIOUS"

/** "AAAA-MM-DD" local do instante, na timezone. */
export function localDateOf(date: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  return localDateParts(date, timeZone).date
}

/** Instante do início (00:00 local) de uma data local. */
export function startOfLocalDate(dateStr: string, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): Date {
  return new Date(zonedTimeToIso(dateStr, "00:00", timeZone))
}

function firstOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

function shiftMonths(dateStr: string, months: number): string {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(5, 7))
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** Início local (AAAA-MM-DD) do período civil que contém `dateStr`. */
function periodStartDate(unit: CalendarUnit, dateStr: string): string {
  switch (unit) {
    case "DAY":
      return dateStr
    case "WEEK": {
      const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
      return addDays(dateStr, -(weekday === 0 ? 6 : weekday - 1))
    }
    case "MONTH":
      return firstOfMonth(dateStr)
    case "TWO_MONTHS":
    case "QUARTER":
    case "FOUR_MONTHS":
    case "SEMESTER": {
      const size = MONTHS_PER_UNIT[unit]
      const month = Number(dateStr.slice(5, 7)) - 1
      return `${dateStr.slice(0, 4)}-${String(Math.floor(month / size) * size + 1).padStart(2, "0")}-01`
    }
  }
}

/** Início local do período civil ANTERIOR ao que começa em `startDate`. */
function previousPeriodStartDate(unit: CalendarUnit, startDate: string): string {
  switch (unit) {
    case "DAY":
      return addDays(startDate, -1)
    case "WEEK":
      return addDays(startDate, -7)
    case "MONTH":
      return shiftMonths(startDate, -1)
    case "TWO_MONTHS":
    case "QUARTER":
    case "FOUR_MONTHS":
    case "SEMESTER":
      return shiftMonths(startDate, -MONTHS_PER_UNIT[unit])
  }
}

/** Início local do período civil SEGUINTE ao que começa em `startDate`. */
function nextPeriodStartDate(unit: CalendarUnit, startDate: string): string {
  switch (unit) {
    case "DAY":
      return addDays(startDate, 1)
    case "WEEK":
      return addDays(startDate, 7)
    case "MONTH":
      return shiftMonths(startDate, 1)
    case "TWO_MONTHS":
    case "QUARTER":
    case "FOUR_MONTHS":
    case "SEMESTER":
      return shiftMonths(startDate, MONTHS_PER_UNIT[unit])
  }
}

/** O período civil corrente INTEIRO [início, início do próximo) — pra dizer "17 de 61 dias" quando a janela CURRENT é parcial. */
export function resolveFullCurrentCalendarPeriod(unit: CalendarUnit, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  const currentStart = periodStartDate(unit, localDateOf(now, timeZone))
  return { start: startOfLocalDate(currentStart, timeZone), end: startOfLocalDate(nextPeriodStartDate(unit, currentStart), timeZone) }
}

/** Janela [início, fim) do período civil: PREVIOUS = anterior completo; CURRENT = corrente parcial até `now`. */
export function resolveCalendarWindow(unit: CalendarUnit, now: Date, phase: CalendarPhase = "PREVIOUS", timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  const currentStart = periodStartDate(unit, localDateOf(now, timeZone))
  if (phase === "CURRENT") return { start: startOfLocalDate(currentStart, timeZone), end: now }
  const previousStart = previousPeriodStartDate(unit, currentStart)
  return { start: startOfLocalDate(previousStart, timeZone), end: startOfLocalDate(currentStart, timeZone) }
}

/** O período civil completo imediatamente anterior à janela devolvida por `resolveCalendarWindow`. */
export function resolvePreviousCalendarWindow(unit: CalendarUnit, now: Date, phase: CalendarPhase = "PREVIOUS", timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  const current = resolveCalendarWindow(unit, now, phase, timeZone)
  const currentStart = localDateOf(current.start, timeZone)
  const previousStart = previousPeriodStartDate(unit, currentStart)
  return { start: startOfLocalDate(previousStart, timeZone), end: current.start }
}

export function resolveTimeWindow(period: HistoricalPeriod, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  if (period.kind === "ROLLING_DAYS") {
    const today = localDateOf(now, timeZone)
    return { start: startOfLocalDate(addDays(today, -(period.days - 1)), timeZone), end: now }
  }
  if (period.kind === "CLOSURES") throw new Error("Últimos N fechamentos não é uma janela contínua — use o resolvedor de fechamentos.")
  return resolveCalendarWindow(period.unit, now, period.phase ?? "PREVIOUS", timeZone)
}

export function resolvePreviousTimeWindow(period: HistoricalPeriod, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  if (period.kind === "ROLLING_DAYS") {
    const current = resolveTimeWindow(period, now, timeZone)
    const currentStart = localDateOf(current.start, timeZone)
    return { start: startOfLocalDate(addDays(currentStart, -period.days), timeZone), end: current.start }
  }
  if (period.kind === "CLOSURES") throw new Error("Comparação com período anterior não está disponível para Últimos N fechamentos.")
  return resolvePreviousCalendarWindow(period.unit, now, period.phase ?? "PREVIOUS", timeZone)
}

/**
 * Os N meses civis já FECHADOS antes de `now` (mais recente primeiro), como janelas locais — o
 * mês corrente nunca entra, mesmo parcial. Base tanto de "Últimos N meses fechados" quanto da
 * regra "fechamento oficial só para mês completo" (ver reference-period.ts / massa demo).
 */
export function closedCalendarMonths(now: Date, count: number, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow[] {
  const months: TimeWindow[] = []
  let cursor = resolveCalendarWindow("MONTH", now, "PREVIOUS", timeZone)
  months.push(cursor)
  for (let index = 1; index < count; index += 1) {
    cursor = resolvePreviousCalendarWindow("MONTH", cursor.end, "PREVIOUS", timeZone)
    months.push(cursor)
  }
  return months
}

/** Competência ("AAAA-MM") do último mês civil FECHADO antes de `now`. */
export function lastClosedPeriod(now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  return localDateOf(closedCalendarMonths(now, 1, timeZone)[0]!.start, timeZone).slice(0, 7)
}

/** Datas locais (AAAA-MM-DD) cobertas pela janela, em ordem. */
export function localDatesInWindow(window: TimeWindow, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string[] {
  const dates: string[] = []
  const last = localDateOf(new Date(window.end.getTime() - 1), timeZone)
  let cursor = localDateOf(window.start, timeZone)
  let guard = 0
  while (cursor <= last && guard < 4000) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return dates
}

/** Dias úteis (seg–sex, calendário local) cobertos pela janela — base da COBERTURA. */
export function businessDaysInWindow(window: TimeWindow, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): number {
  return businessDatesInWindow(window, timeZone).length
}

export function businessDatesInWindow(window: TimeWindow, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string[] {
  return localDatesInWindow(window, timeZone).filter((dateStr) => {
    const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
    return weekday !== 0 && weekday !== 6
  })
}

/** "09/09/2026 → 15/09/2026" (datas locais, fim inclusivo quando a janela termina "agora"). */
export function describeTimeWindow(window: TimeWindow, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): string {
  const format = (date: Date) => {
    const local = localDateOf(date, timeZone)
    return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)}`
  }
  return `${format(window.start)} → ${format(new Date(window.end.getTime() - 1))}`
}

export function describePeriod(period: HistoricalPeriod): string {
  if (period.kind === "ROLLING_DAYS") return period.days === 1 ? "Hoje" : `Últimos ${period.days} dias`
  if (period.kind === "CLOSURES") return `Últimos ${period.count} fechamentos`
  const phase = period.phase ?? "PREVIOUS"
  const labels: Record<string, [string, string]> = {
    DAY: ["Hoje", "Ontem"],
    WEEK: ["Semana corrente", "Semana anterior"],
    MONTH: ["Mês corrente", "Mês anterior"],
    TWO_MONTHS: ["Bimestre corrente", "Bimestre anterior"],
    QUARTER: ["Trimestre corrente", "Trimestre anterior"],
    FOUR_MONTHS: ["Quadrimestre corrente", "Quadrimestre anterior"],
    SEMESTER: ["Semestre corrente", "Semestre anterior"],
  }
  return labels[period.unit]?.[phase === "CURRENT" ? 0 : 1] ?? period.unit
}
