import type { ScheduleFrequency } from "../domain/trigger-config-schema.js"

/**
 * Calculadora de recorrência do Trigger "Por agenda" — a ÚNICA lógica que decide "essa data bate
 * com a recorrência configurada?". Módulo puro (sem banco, sem I/O), reaproveitado tanto pelo
 * checador real (`schedule-check.ts`, pergunta sobre "hoje") quanto pelo preview de próximas
 * execuções (`nextOccurrences`, exposto via endpoint pro frontend) — nunca duas implementações
 * divergentes de "quando isso dispara".
 */
export type ScheduleRecurrenceConfig = {
  times: string[]
  intervalDays: number
  anchorDate: string | null
  frequency?: ScheduleFrequency | undefined
}

const WEEKDAY_BY_UTC_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const

/** `frequency` ausente no trigger_config = comportamento legado (workflows criados antes desta
 * evolução): intervalDays > 1 sempre significava "a cada N dias", senão "todo dia". */
export function effectiveFrequency(config: { intervalDays: number; frequency?: ScheduleFrequency | undefined }): ScheduleFrequency {
  if (config.frequency) return config.frequency
  return config.intervalDays > 1 ? { type: "EVERY_N_DAYS" } : { type: "DAILY" }
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const fromMs = Date.parse(`${fromDateStr}T00:00:00Z`)
  const toMs = Date.parse(`${toDateStr}T00:00:00Z`)
  return Math.round((toMs - fromMs) / 86_400_000)
}

export function weekdayOf(dateStr: string): (typeof WEEKDAY_BY_UTC_DAY)[number] {
  return WEEKDAY_BY_UTC_DAY[new Date(`${dateStr}T00:00:00Z`).getUTCDay()]!
}

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10))
}

/** Dia 0 do mês seguinte == último dia do mês corrente (truque padrão de calendário, sem timezone
 * nenhuma envolvida — `dateStr` já é uma data de calendário local, não um instante). */
function daysInMonth(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(5, 7))
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * `dateStr` é uma data de calendário LOCAL já resolvida (formato "YYYY-MM-DD") — quem chama já
 * cuidou da timezone (ver `localDateParts`/`schedule-check.ts`). Um dia-do-mês que não existe no
 * mês corrente (ex.: 31 em abril) nunca bate com nenhum `dateStr` real daquele mês — a ocorrência
 * é pulada automaticamente, nunca cai silenciosamente pro dia 30 nem escorrega pro mês seguinte
 * (Parte 7 do pedido).
 */
export function isDateDue(config: ScheduleRecurrenceConfig, dateStr: string): boolean {
  const frequency = effectiveFrequency(config)
  switch (frequency.type) {
    case "DAILY":
      return true
    case "EVERY_N_DAYS": {
      // Sem âncora ainda definida: nunca deveria acontecer pra um workflow já publicado (o
      // backend sempre carimba `anchorDate` na criação/1ª edição — ver `withScheduleAnchor` em
      // workflow-router.ts), mas por segurança nunca bloqueia silenciosamente: dispara todo dia.
      if (!config.anchorDate) return true
      const diff = daysBetween(config.anchorDate, dateStr)
      return diff >= 0 && diff % config.intervalDays === 0
    }
    case "WEEKLY":
      return frequency.weekdays.includes(weekdayOf(dateStr))
    case "MONTHLY":
      if (frequency.mode === "LAST_DAY") return dayOfMonth(dateStr) === daysInMonth(dateStr)
      // `day` ausente com mode DAY_OF_MONTH é um estado tecnicamente inválido (bloqueado por
      // `validateScheduleTrigger` no publish/criação) — nunca dispara, nunca crasha.
      return frequency.day !== undefined && dayOfMonth(dateStr) === frequency.day
  }
}

/** Componentes de calendário LOCAIS (data + hora) de um instante, numa timezone IANA — sem
 * dependência externa, via `Intl.DateTimeFormat`. */
export function localDateParts(date: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` }
}

/** Offset (em minutos) de uma timezone IANA em relação a UTC, no instante `date` — formata o
 * mesmo instante como se os números lidos já fossem UTC; a diferença pro instante real É o
 * offset. Técnica padrão pra converter timezone sem biblioteca externa; funciona com horário de
 * verão se algum dia existir (o projeto não tem nenhuma lib de data hoje — Parte 33 do pedido:
 * não introduzir infraestrutura nova sem necessidade). */
function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return (asUtc - date.getTime()) / 60_000
}

/** Instante ISO (UTC) correspondente a uma data+hora de parede LOCAL numa timezone IANA — o
 * inverso de `localDateParts`. Usado tanto pra `scheduled_for` (schedule-check.ts) quanto pro
 * preview (`nextOccurrences`). */
export function zonedTimeToIso(dateStr: string, time: string, timeZone: string): string {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(5, 7))
  const day = Number(dateStr.slice(8, 10))
  const [hour, minute] = time.split(":").map(Number) as [number, number]
  // Chute de offset usando meio-dia UTC daquele dia (evita ficar perto de uma virada de dia
  // local, que distorceria a leitura caso o offset mude entre os dois instantes).
  const offsetMinutes = timezoneOffsetMinutes(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)), timeZone)
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000).toISOString()
}

export function addDays(dateStr: string, amount: number): string {
  const year = Number(dateStr.slice(0, 4))
  const month = Number(dateStr.slice(5, 7))
  const day = Number(dateStr.slice(8, 10))
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

export type ScheduleOccurrence = { date: string; time: string; iso: string }

/**
 * Preview de próximas execuções (Parte 10 do pedido) — varre dia a dia a partir de `from`
 * chamando `isDateDue` (a MESMA função que o checador real usa), até juntar `count` ocorrências
 * ou estourar `maxDaysAhead`. Nunca reimplementa a regra de recorrência.
 */
export function nextOccurrences(
  config: ScheduleRecurrenceConfig,
  options: { timezone: string; from: Date; count: number; maxDaysAhead?: number },
): ScheduleOccurrence[] {
  const { timezone, from, count, maxDaysAhead = 400 } = options
  const sortedTimes = [...config.times].sort()
  const results: ScheduleOccurrence[] = []
  let candidateDate = localDateParts(from, timezone).date

  for (let day = 0; day <= maxDaysAhead && results.length < count; day++) {
    if (isDateDue(config, candidateDate)) {
      for (const time of sortedTimes) {
        if (results.length >= count) break
        const iso = zonedTimeToIso(candidateDate, time, timezone)
        if (new Date(iso).getTime() < from.getTime()) continue
        results.push({ date: candidateDate, time, iso })
      }
    }
    candidateDate = addDays(candidateDate, 1)
  }
  return results
}
