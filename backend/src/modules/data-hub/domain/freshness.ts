import { z } from "zod"
import { isDateDue, localDateParts } from "../../workflows/application/schedule-recurrence.js"
import { weekdaySchema } from "../../workflows/domain/trigger-config-schema.js"

/**
 * Saúde da conexão × atualidade dos dados — nunca a mesma coisa.
 *
 * - Connection health: "consigo chegar/autenticar na fonte?" (HEALTHY | ERROR | UNKNOWN).
 * - Data freshness: "quando chegou dado válido pela última vez?" (FRESH | STALE | NEVER),
 *   derivada da cadência esperada do feed — uma fonte pode estar HEALTHY e o feed STALE.
 * - Source status: Rascunho / Ativa / Pausada / Erro (decisão administrativa + falha).
 */
export const CONNECTION_HEALTHS = ["HEALTHY", "ERROR", "UNKNOWN"] as const
export type ConnectionHealth = (typeof CONNECTION_HEALTHS)[number]

export const FRESHNESS_STATES = ["FRESH", "STALE", "NEVER"] as const
export type FreshnessState = (typeof FRESHNESS_STATES)[number]

export const SOURCE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ERROR"] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export const FEED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "DEGRADED"] as const
export type FeedStatus = (typeof FEED_STATUSES)[number]

export const LOAD_MODES = ["DELTA", "SNAPSHOT"] as const
export type LoadMode = (typeof LOAD_MODES)[number]

/**
 * Menor intervalo que pode ser ESCOLHIDO entre duas cargas: um intervalo menor pesa no banco do cliente. O esquema ainda lê
 * 5–14 min porque a API aceitava até a periodicidade personalizada; um feed gravado assim continua rodando e salvando sem
 * reconfigurar, mas ninguém escolhe um valor novo abaixo do mínimo (`cadenceWriteProblem`).
 */
export const MIN_SYNC_INTERVAL_MINUTES = 15
const STORED_MIN_INTERVAL_MINUTES = 5
const MAX_CALENDAR_TIMES = 12
const MAX_EVERY_N_DAYS = 90
const WEEK_ORDER = weekdaySchema.options

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o horário no formato HH:mm.")

const minutesOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Dois horários colados furariam o intervalo mínimo; a distância vale também de um dia para o outro (23:55 e 00:05). */
function calendarTimesProblem(times: string[]): string | null {
  if (new Set(times).size !== times.length) return "Há horários repetidos."
  const minutes = times.map(minutesOfDay).sort((a, b) => a - b)
  // O primeiro horário do dia é comparado com o último de ontem; com um horário só, a distância é de 24 h.
  const gaps = minutes.map((value, index) => (index === 0 ? value + 24 * 60 - minutes[minutes.length - 1]! : value - minutes[index - 1]!))
  return gaps.some((gap) => gap < MIN_SYNC_INTERVAL_MINUTES) ? `Deixe ao menos ${MIN_SYNC_INTERVAL_MINUTES} minutos entre os horários.` : null
}

const calendarFrequencySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DAILY") }),
  // A contagem parte de uma data fixa: "a cada 3 dias" não escorrega por causa de uma carga manual ou de uma carga que virou a noite.
  z.object({
    type: z.literal("EVERY_N_DAYS"),
    days: z.number().int().min(1, `Informe de 1 a ${MAX_EVERY_N_DAYS} dias.`).max(MAX_EVERY_N_DAYS, `Informe de 1 a ${MAX_EVERY_N_DAYS} dias.`),
    startDate: z.iso.date("Informe a data de início."),
  }),
  z.object({
    type: z.literal("WEEKLY"),
    weekdays: z
      .array(weekdaySchema)
      .min(1, "Escolha ao menos um dia da semana.")
      .refine((days) => new Set(days).size === days.length, "Há dias da semana repetidos.")
      .transform((days) => [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))),
  }),
  // Mesma regra da agenda dos Workflows: mês sem o dia escolhido (31 em abril) não tem carga; quem quer todo mês usa LAST_DAY.
  z
    .object({ type: z.literal("MONTHLY"), mode: z.enum(["DAY_OF_MONTH", "LAST_DAY"]), day: z.number().int().min(1, "Informe um dia de 1 a 31.").max(31, "Informe um dia de 1 a 31.").optional() })
    .superRefine((frequency, context) => {
      if (frequency.mode === "DAY_OF_MONTH" && frequency.day === undefined) context.addIssue({ code: "custom", message: "Informe um dia de 1 a 31.", path: ["day"] })
    }),
])

/**
 * Cadência esperada — base do "próxima sincronização" e do ATRASADO. Periodicidade é QUANDO a carga roda; o SLA (`availability_policy`)
 * é QUANDO o dado de um dia já deveria ter chegado. Horários sempre no fuso da operação.
 */
export const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MANUAL") }),
  z.object({ kind: z.literal("INTERVAL"), minutes: z.number().int().min(STORED_MIN_INTERVAL_MINUTES).max(24 * 60) }),
  z.object({ kind: z.literal("DAILY"), time: timeOfDaySchema }),
  z.object({
    kind: z.literal("CALENDAR"),
    times: z
      .array(timeOfDaySchema)
      .min(1, "Informe ao menos um horário.")
      .max(MAX_CALENDAR_TIMES, `Use no máximo ${MAX_CALENDAR_TIMES} horários.`)
      .superRefine((times, context) => {
        const problem = calendarTimesProblem(times)
        if (problem) context.addIssue({ code: "custom", message: problem })
      })
      .transform((times) => [...times].sort()),
    frequency: calendarFrequencySchema,
  }),
])
export type Cadence = z.infer<typeof cadenceSchema>
type CalendarCadence = Extract<Cadence, { kind: "CALENDAR" }>

/** Regra de ESCRITA: o valor já gravado continua valendo; um valor novo respeita o mínimo. `null` = pode gravar. */
export function cadenceWriteProblem(next: Cadence, current?: Cadence): string | null {
  if (next.kind !== "INTERVAL" || next.minutes >= MIN_SYNC_INTERVAL_MINUTES) return null
  if (current?.kind === "INTERVAL" && current.minutes === next.minutes) return null
  return `O intervalo mínimo entre cargas é de ${MIN_SYNC_INTERVAL_MINUTES} minutos.`
}

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`
}

const WEEKDAY_NAMES: Record<(typeof WEEK_ORDER)[number], string> = { MON: "seg", TUE: "ter", WED: "qua", THU: "qui", FRI: "sex", SAT: "sáb", SUN: "dom" }

/** "Seg a sex", "Seg, qua e sex", "Sáb e dom": três ou mais dias seguidos viram um trecho. */
function weekdaysLabel(weekdays: readonly (typeof WEEK_ORDER)[number][]): string {
  if (weekdays.length === WEEK_ORDER.length) return "Todos os dias"
  const positions = weekdays.map((day) => WEEK_ORDER.indexOf(day)).sort((a, b) => a - b)
  const parts: string[] = []
  for (let start = 0; start < positions.length; ) {
    let end = start
    while (positions[end + 1] === positions[end]! + 1) end += 1
    const names = positions.slice(start, end + 1).map((position) => WEEKDAY_NAMES[WEEK_ORDER[position]!])
    if (names.length >= 3) parts.push(`${names[0]} a ${names[names.length - 1]}`)
    else parts.push(...names)
    start = end + 1
  }
  const label = joinWithAnd(parts)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function calendarDaysLabel(frequency: CalendarCadence["frequency"]): string {
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

/**
 * Intervalo fixo entre cargas, em minutos. `null` = não há intervalo fixo: manual nunca fica atrasado por cadência, e a agenda
 * por calendário (seg a sex, dia 5…) calcula o atraso pelos próprios horários (`computeFeedFreshness`).
 */
export function expectedIntervalMinutes(cadence: Cadence): number | null {
  switch (cadence.kind) {
    case "MANUAL":
    case "CALENDAR":
      return null
    case "INTERVAL":
      return cadence.minutes
    case "DAILY":
      return 24 * 60
  }
}

function asCalendar(cadence: Extract<Cadence, { kind: "DAILY" | "CALENDAR" }>): CalendarCadence {
  return cadence.kind === "DAILY" ? { kind: "CALENDAR", times: [cadence.time], frequency: { type: "DAILY" } } : cadence
}

/** A data bate com a agenda? Mesma regra da agenda dos Workflows (`isDateDue`), nunca uma segunda implementação. */
function isCalendarDateDue({ times, frequency }: CalendarCadence, date: string): boolean {
  if (frequency.type === "EVERY_N_DAYS") return isDateDue({ times, intervalDays: frequency.days, anchorDate: frequency.startDate, frequency: { type: "EVERY_N_DAYS" } }, date)
  return isDateDue({ times, intervalDays: 1, anchorDate: null, frequency }, date)
}

/** Maior espaço possível entre duas datas da agenda (31 só em meses que têm 31, a cada 90 dias) mais a volta do ano. */
const CALENDAR_SCAN_DAYS = 400

/** Próximo horário ESTRITAMENTE depois de `from`. O dia e o dia da semana são os do fuso da operação, nunca os de UTC. */
function nextCalendarRun(cadence: CalendarCadence, from: Date, timeZone: string): Date | null {
  const today = localDateParts(from, timeZone).date
  const { frequency } = cadence
  const firstDate = frequency.type === "EVERY_N_DAYS" && frequency.startDate > today ? frequency.startDate : today
  for (let offset = 0; offset <= CALENDAR_SCAN_DAYS; offset += 1) {
    const date = addDays(firstDate, offset)
    if (!isCalendarDateDue(cadence, date)) continue
    const candidates = cadence.times.map((time) => localToInstant(date, time, timeZone)).filter((instant) => instant.getTime() > from.getTime())
    if (candidates.length > 0) return candidates.reduce((earliest, instant) => (instant.getTime() < earliest.getTime() ? instant : earliest))
  }
  return null
}

/** Próxima execução a partir de `from` (UTC) — os horários são os do fuso informado. */
export function nextSyncAt(cadence: Cadence, from: Date, timeZone: string): Date | null {
  switch (cadence.kind) {
    case "MANUAL":
      return null
    case "INTERVAL":
      return new Date(from.getTime() + cadence.minutes * 60_000)
    case "DAILY":
    case "CALENDAR":
      return nextCalendarRun(asCalendar(cadence), from, timeZone)
  }
}

/** As próximas execuções — o que a tela mostra antes de salvar, calculado pela mesma função que o agendador usa. */
export function upcomingSyncs(cadence: Cadence, from: Date, timeZone: string, count: number): Date[] {
  const runs: Date[] = []
  let cursor = from
  while (runs.length < count) {
    const next = nextSyncAt(cadence, cursor, timeZone)
    if (!next) break
    runs.push(next)
    cursor = next
  }
  return runs
}

/**
 * Ao retomar uma fonte pausada: quem escolheu horários espera o próximo (uma carga fora de hora pode cair em cima das rotinas do
 * cliente); intervalo roda em seguida, como sempre foi; quem quer antes usa "Sincronizar agora".
 */
export function syncAtSourceResume(cadence: Cadence, now: Date, timeZone: string): Date | null {
  return cadence.kind === "INTERVAL" ? now : nextSyncAt(cadence, now, timeZone)
}

export function addDays(date: string, amount: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1, d + amount))
  return next.toISOString().slice(0, 10)
}

export function localToInstant(date: string, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(":").map(Number) as [number, number]
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  const asLocal = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  }
  let instant = guess - (asLocal(guess) - guess)
  instant = guess - (asLocal(instant) - instant)
  return new Date(instant)
}

/**
 * Atualidade: FRESH se a última carga bem-sucedida está dentro de 2× o intervalo esperado
 * (tolerância a um ciclo perdido); STALE se passou disso; NEVER se nunca houve sucesso.
 * Feed manual sem cadência nunca fica STALE por tempo — só NEVER ou FRESH.
 */
export function computeFreshness(lastSuccessAt: Date | null, expectedInterval: number | null, now: Date): FreshnessState {
  if (!lastSuccessAt) return "NEVER"
  if (expectedInterval === null) return "FRESH"
  const ageMinutes = (now.getTime() - lastSuccessAt.getTime()) / 60_000
  return ageMinutes > expectedInterval * 2 ? "STALE" : "FRESH"
}

/** Tempo para a carga do horário terminar (com as novas tentativas automáticas) antes de ela contar como perdida. */
const CALENDAR_STALE_MARGIN_MS = 60 * 60_000

/**
 * Atualidade de um feed pela agenda real. Intervalo e manual seguem `computeFreshness`. Com dias e horários, tolera o mesmo
 * "um ciclo perdido": fica STALE só depois do SEGUNDO horário da agenda (mais a margem) sem carga bem-sucedida — seg a sex com
 * sucesso na sexta segue FRESH o fim de semana inteiro, e um feed mensal não atrasa no dia seguinte.
 */
export function computeFeedFreshness(feed: { lastSuccessAt: Date | null; cadence: Cadence; expectedIntervalMinutes: number | null }, now: Date, timeZone: string): FreshnessState {
  const { lastSuccessAt, cadence } = feed
  if (cadence.kind !== "DAILY" && cadence.kind !== "CALENDAR") return computeFreshness(lastSuccessAt, feed.expectedIntervalMinutes ?? expectedIntervalMinutes(cadence), now)
  if (!lastSuccessAt) return "NEVER"
  const firstMissed = nextSyncAt(cadence, lastSuccessAt, timeZone)
  const secondMissed = firstMissed && nextSyncAt(cadence, firstMissed, timeZone)
  if (!secondMissed) return "FRESH"
  return now.getTime() > secondMissed.getTime() + CALENDAR_STALE_MARGIN_MS ? "STALE" : "FRESH"
}
