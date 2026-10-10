import { addDays, localDateParts, zonedTimeToIso } from "../../workflows/application/schedule-recurrence.js"

/**
 * TEMPO da Monitoria de usabilidade — regras únicas, usadas por API, painel e exportação.
 *
 *  - Instantes são guardados em UTC; agregação e apresentação usam o fuso da organização (`operations.timezone`, fallback
 *    America/Fortaleza — exibido na tela).
 *  - Intervalos internos são [início inclusivo, fim exclusivo). A data final escolhida na tela INCLUI aquele dia civil: o fim
 *    é o início do dia seguinte. Hoje entra parcial (até agora) e isso é dito na tela.
 *  - Comparação: período anterior de MESMA duração, alinhado ao início do dia. Se o período atual termina em "agora" (hoje
 *    parcial), o anterior termina no mesmo horário do dia correspondente — nunca um dia parcial contra um dia completo.
 */
export const PERIOD_PRESETS = ["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "CURRENT_MONTH", "CUSTOM"] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]
/** Maior intervalo consultável (dias) — mesma janela da retenção dos fatos (13 meses). */
export const MAX_PERIOD_DAYS = 400

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  TODAY: "Hoje",
  YESTERDAY: "Ontem",
  LAST_7_DAYS: "Últimos 7 dias",
  LAST_30_DAYS: "Últimos 30 dias",
  CURRENT_MONTH: "Mês atual",
  CUSTOM: "Intervalo personalizado",
}

export type ResolvedPeriod = {
  preset: PeriodPreset
  /** Datas civis LOCAIS, inclusivas (o que a tela mostra). */
  fromDate: string
  toDate: string
  /** Instantes UTC do intervalo interno [start, end). `end` = agora quando hoje está incluído. */
  start: Date
  end: Date
  includesPartialToday: boolean
  timeZone: string
  dates: string[]
}

export type PeriodRequest = { preset: PeriodPreset; from?: string | null | undefined; to?: string | null | undefined }

export const localDateOf = (instant: Date, timeZone: string) => localDateParts(instant, timeZone).date
export const startOfLocalDate = (date: string, timeZone: string) => new Date(zonedTimeToIso(date, "00:00", timeZone))
export { addDays }

export function datesBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) dates.push(date)
  return dates
}

export class PeriodError extends Error {
  constructor(message: string, readonly code: "INVALID_PERIOD" | "PERIOD_TOO_LONG" | "PERIOD_IN_FUTURE") {
    super(message)
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function resolvePeriod(request: PeriodRequest, now: Date, timeZone: string): ResolvedPeriod {
  const today = localDateOf(now, timeZone)
  let fromDate: string
  let toDate: string
  switch (request.preset) {
    case "TODAY":
      fromDate = toDate = today
      break
    case "YESTERDAY":
      fromDate = toDate = addDays(today, -1)
      break
    case "LAST_7_DAYS":
      fromDate = addDays(today, -6)
      toDate = today
      break
    case "LAST_30_DAYS":
      fromDate = addDays(today, -29)
      toDate = today
      break
    case "CURRENT_MONTH":
      fromDate = `${today.slice(0, 7)}-01`
      toDate = today
      break
    case "CUSTOM": {
      if (!request.from || !request.to || !DATE_PATTERN.test(request.from) || !DATE_PATTERN.test(request.to)) throw new PeriodError("Informe as datas inicial e final (AAAA-MM-DD).", "INVALID_PERIOD")
      if (request.from > request.to) throw new PeriodError("A data inicial é posterior à final.", "INVALID_PERIOD")
      if (request.from > today) throw new PeriodError("O período começa no futuro.", "PERIOD_IN_FUTURE")
      fromDate = request.from
      toDate = request.to > today ? today : request.to
      break
    }
  }
  const dates = datesBetween(fromDate, toDate)
  if (dates.length > MAX_PERIOD_DAYS) throw new PeriodError(`O período máximo é de ${MAX_PERIOD_DAYS} dias.`, "PERIOD_TOO_LONG")
  const includesPartialToday = toDate === today
  const start = startOfLocalDate(fromDate, timeZone)
  const end = includesPartialToday ? now : startOfLocalDate(addDays(toDate, 1), timeZone)
  return { preset: request.preset, fromDate, toDate, start, end, includesPartialToday, timeZone, dates }
}

export type ComparisonPeriod = { start: Date; end: Date; fromDate: string; toDate: string; partialAligned: boolean; label: string }

/**
 * Período anterior de MESMA duração. Atual completo (dias inteiros) → os N dias anteriores. Atual com hoje parcial → os N
 * dias anteriores, com o último cortado no MESMO horário de agora (duração idêntica, rotulado como alinhado).
 */
export function comparisonPeriodOf(period: ResolvedPeriod): ComparisonPeriod {
  const days = period.dates.length
  const fromDate = addDays(period.fromDate, -days)
  const toDate = addDays(period.toDate, -days)
  const start = startOfLocalDate(fromDate, period.timeZone)
  const end = period.includesPartialToday ? new Date(start.getTime() + (period.end.getTime() - period.start.getTime())) : startOfLocalDate(addDays(toDate, 1), period.timeZone)
  const time = period.includesPartialToday ? localDateParts(period.end, period.timeZone).time : null
  const label = time ? `${formatBr(fromDate)} a ${formatBr(toDate)} até ${time} (mesma duração)` : `${formatBr(fromDate)} a ${formatBr(toDate)}`
  return { start, end, fromDate, toDate, partialAligned: period.includesPartialToday, label }
}

export const formatBr = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`

export function describePeriod(period: ResolvedPeriod): string {
  const range = period.fromDate === period.toDate ? formatBr(period.fromDate) : `${formatBr(period.fromDate)} a ${formatBr(period.toDate)}`
  const time = period.includesPartialToday ? localDateParts(period.end, period.timeZone).time : null
  return time ? `${range} (hoje parcial, até ${time})` : range
}

/** Fronteiras [início, fim) de cada dia local do intervalo — base para dividir durações entre os dias atravessados. */
export function dayBoundaries(fromDate: string, toDate: string, timeZone: string): { date: string; start: Date; end: Date }[] {
  return datesBetween(fromDate, toDate).map((date) => ({ date, start: startOfLocalDate(date, timeZone), end: startOfLocalDate(addDays(date, 1), timeZone) }))
}

/** Janelas móveis de DAU/WAU/MAU no dia de referência (7 e 30 dias civis até ele, inclusive). */
export function rollingWindows(referenceDate: string) {
  return {
    dau: { fromDate: referenceDate, toDate: referenceDate },
    wau: { fromDate: addDays(referenceDate, -6), toDate: referenceDate },
    mau: { fromDate: addDays(referenceDate, -29), toDate: referenceDate },
  }
}
