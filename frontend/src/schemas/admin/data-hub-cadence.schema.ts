import { z } from "zod"

import { WEEKDAY_ORDER, weekdaySchema, type Weekday } from "@/schemas/admin/workflow.schema"

/**
 * Periodicidade das cargas da Central de Dados — espelho de `data-hub/domain/freshness.ts`. O backend é a autoridade (valida ao
 * gravar e calcula as próximas execuções); aqui ficam a frase legível e a validação imediata da tela. As duas pontas conferem a
 * mesma tabela de casos: `backend/src/modules/data-hub/testing/cadence-cases.json`.
 */
export const MIN_SYNC_INTERVAL_MINUTES = 15
export const MAX_SYNC_INTERVAL_MINUTES = 24 * 60
export const MAX_CALENDAR_TIMES = 12
export const MAX_EVERY_N_DAYS = 90

const calendarFrequencySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DAILY") }),
  z.object({ type: z.literal("EVERY_N_DAYS"), days: z.number(), startDate: z.string() }),
  z.object({ type: z.literal("WEEKLY"), weekdays: z.array(weekdaySchema) }),
  z.object({ type: z.literal("MONTHLY"), mode: z.enum(["DAY_OF_MONTH", "LAST_DAY"]), day: z.number().optional() }),
])
export type CalendarFrequency = z.infer<typeof calendarFrequencySchema>

export const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MANUAL") }),
  z.object({ kind: z.literal("INTERVAL"), minutes: z.number() }),
  z.object({ kind: z.literal("DAILY"), time: z.string() }),
  z.object({ kind: z.literal("CALENDAR"), times: z.array(z.string()), frequency: calendarFrequencySchema }),
])
export type Cadence = z.infer<typeof cadenceSchema>

export const cadencePreviewSchema = z.object({ label: z.string(), timeZone: z.string(), nextRuns: z.array(z.string()) })
export type CadencePreview = z.infer<typeof cadencePreviewSchema>

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`
}

const WEEKDAY_NAMES: Record<Weekday, string> = { MON: "seg", TUE: "ter", WED: "qua", THU: "qui", FRI: "sex", SAT: "sáb", SUN: "dom" }

/** "Seg a sex", "Seg, qua e sex", "Sáb e dom": três ou mais dias seguidos viram um trecho. */
function weekdaysLabel(weekdays: Weekday[]): string {
  if (weekdays.length === WEEKDAY_ORDER.length) return "Todos os dias"
  const positions = weekdays.map((day) => WEEKDAY_ORDER.indexOf(day)).sort((a, b) => a - b)
  const parts: string[] = []
  for (let start = 0; start < positions.length; ) {
    let end = start
    while (positions[end + 1] === positions[end]! + 1) end += 1
    const names = positions.slice(start, end + 1).map((position) => WEEKDAY_NAMES[WEEKDAY_ORDER[position]!])
    if (names.length >= 3) parts.push(`${names[0]} a ${names[names.length - 1]}`)
    else parts.push(...names)
    start = end + 1
  }
  const label = joinWithAnd(parts)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function calendarDaysLabel(frequency: CalendarFrequency): string {
  switch (frequency.type) {
    case "DAILY":
      return "Diário"
    case "EVERY_N_DAYS":
      return frequency.days === 1 ? "Diário" : `A cada ${frequency.days} dias`
    case "WEEKLY":
      return weekdaysLabel(frequency.weekdays)
    case "MONTHLY":
      return frequency.mode === "LAST_DAY" ? "Último dia do mês" : `Todo dia ${frequency.day}`
  }
}

export function cadenceLabel(cadence: Cadence): string {
  switch (cadence.kind) {
    case "MANUAL":
      return "Manual"
    case "INTERVAL":
      return cadence.minutes % 60 === 0 ? `A cada ${cadence.minutes / 60}h` : `A cada ${cadence.minutes} min`
    case "DAILY":
      return `Diário às ${cadence.time}`
    case "CALENDAR":
      return `${calendarDaysLabel(cadence.frequency)} às ${joinWithAnd([...cadence.times].sort())}`
  }
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/
const minutesOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

function timesProblem(times: string[]): string | null {
  if (times.length === 0) return "Informe ao menos um horário."
  if (times.length > MAX_CALENDAR_TIMES) return `Use no máximo ${MAX_CALENDAR_TIMES} horários.`
  if (times.some((time) => !TIME_OF_DAY.test(time))) return "Use o horário no formato HH:mm."
  if (new Set(times).size !== times.length) return "Há horários repetidos."
  const minutes = times.map(minutesOfDay).sort((a, b) => a - b)
  const gaps = minutes.map((value, index) => (index === 0 ? value + 24 * 60 - minutes[minutes.length - 1]! : value - minutes[index - 1]!))
  return gaps.some((gap) => gap < MIN_SYNC_INTERVAL_MINUTES) ? `Deixe ao menos ${MIN_SYNC_INTERVAL_MINUTES} minutos entre os horários.` : null
}

function frequencyProblem(frequency: CalendarFrequency): string | null {
  switch (frequency.type) {
    case "DAILY":
      return null
    case "EVERY_N_DAYS":
      if (!Number.isInteger(frequency.days) || frequency.days < 1 || frequency.days > MAX_EVERY_N_DAYS) return `Informe de 1 a ${MAX_EVERY_N_DAYS} dias.`
      return z.iso.date().safeParse(frequency.startDate).success ? null : "Informe a data de início."
    case "WEEKLY":
      if (frequency.weekdays.length === 0) return "Escolha ao menos um dia da semana."
      return new Set(frequency.weekdays).size === frequency.weekdays.length ? null : "Há dias da semana repetidos."
    case "MONTHLY": {
      if (frequency.mode === "LAST_DAY") return null
      const { day } = frequency
      return day !== undefined && Number.isInteger(day) && day >= 1 && day <= 31 ? null : "Informe um dia de 1 a 31."
    }
  }
}

/** O que impede de gravar esta periodicidade, na frase que a tela mostra. `null` = pode. O backend confere de novo ao gravar. */
export function cadenceProblem(cadence: Cadence): string | null {
  switch (cadence.kind) {
    case "MANUAL":
      return null
    case "INTERVAL":
      if (!Number.isInteger(cadence.minutes) || cadence.minutes < MIN_SYNC_INTERVAL_MINUTES) return `O intervalo mínimo entre cargas é de ${MIN_SYNC_INTERVAL_MINUTES} minutos.`
      return cadence.minutes > MAX_SYNC_INTERVAL_MINUTES ? "O intervalo máximo entre cargas é de 24 horas." : null
    case "DAILY":
      return timesProblem([cadence.time])
    case "CALENDAR":
      return timesProblem(cadence.times) ?? frequencyProblem(cadence.frequency)
  }
}

/** Como `cadenceProblem`, mas o valor já gravado continua valendo (feed antigo com menos de 15 minutos salva sem reconfigurar). */
export function cadenceSaveProblem(next: Cadence, saved?: Cadence): string | null {
  if (saved && JSON.stringify(next) === JSON.stringify(saved)) return null
  return cadenceProblem(next)
}
