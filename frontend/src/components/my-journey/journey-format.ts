import { BriefcaseBusiness, CalendarCheck2, CalendarOff, CalendarX2, ClipboardList, Coffee, Headset, Palmtree, PartyPopper, UserRoundX, type LucideIcon } from "lucide-react"

import type { Tone } from "@/components/ui/surface"
import type { JourneyBlock, JourneyBlockKind, JourneyDay, JourneyDayKind } from "@/schemas/my-journey/my-journey.schema"

/**
 * Apresentação da "Minha jornada" (só formatação e leitura do que veio do backend — o tipo do dia e os blocos são decididos lá).
 * Horas no formato falado no Brasil: "8h00", "14h20".
 */
export function formatClock(clock: string): string {
  const [hours, minutes] = clock.split(":")
  return `${Number(hours)}h${minutes}`
}

export function minuteToClock(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440
  return `${Math.floor(normalized / 60)}h${String(normalized % 60).padStart(2, "0")}`
}

/** "6h20", "45 min", "1h". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`
}

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
const WEEKDAYS_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"]
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

/** Dia da semana de uma data civil, sem passar pelo fuso do navegador. */
function weekdayIndex(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(date)]!
}

export function weekdayLong(date: string): string {
  return WEEKDAYS_LONG[weekdayIndex(date)]!
}

/** "17/11". */
export function dayMonth(date: string): string {
  const [, month, day] = date.split("-")
  return `${day}/${month}`
}

/** "17 a 23 de nov" / "29 de dez a 4 de jan". */
export function weekRangeLabel(from: string, to: string): string {
  const [, fromMonth, fromDay] = from.split("-").map(Number)
  const [, toMonth, toDay] = to.split("-").map(Number)
  if (fromMonth === toMonth) return `${fromDay} a ${toDay} de ${MONTHS_SHORT[toMonth! - 1]}`
  return `${fromDay} de ${MONTHS_SHORT[fromMonth! - 1]} a ${toDay} de ${MONTHS_SHORT[toMonth! - 1]}`
}

/** Data civil e minuto do dia AGORA no fuso da escala (o da organização), não no do navegador. */
export function nowInTimeZone(now: Date, timeZone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00"
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) }
}

export const BLOCK_STYLE: Record<JourneyBlockKind, { icon: LucideIcon; tone: Tone; bar: string }> = {
  SHIFT: { icon: BriefcaseBusiness, tone: "info", bar: "bg-primary/45" },
  LOGGED_IN: { icon: Headset, tone: "info", bar: "bg-primary/85" },
  BREAK: { icon: Coffee, tone: "warning", bar: "bg-amber-400 dark:bg-amber-300" },
  OTHER: { icon: ClipboardList, tone: "neutral", bar: "bg-sky-500/70 dark:bg-sky-400/70" },
  NON_WORKING: { icon: Palmtree, tone: "success", bar: "bg-emerald-500/60 dark:bg-emerald-400/50" },
}

export const DAY_KIND_STYLE: Record<JourneyDayKind, { icon: LucideIcon; tone: Tone }> = {
  WORK: { icon: BriefcaseBusiness, tone: "info" },
  DAY_OFF: { icon: Palmtree, tone: "success" },
  EXCEPTION: { icon: CalendarCheck2, tone: "success" },
  HOLIDAY: { icon: PartyPopper, tone: "success" },
  EMPLOYMENT_STATUS: { icon: UserRoundX, tone: "neutral" },
  NO_SCHEDULE: { icon: CalendarX2, tone: "warning" },
  BEFORE_HIRE: { icon: CalendarOff, tone: "neutral" },
}

/**
 * Próxima pausa a partir de um minuto do dia: a que está acontecendo agora ou a primeira que ainda vai começar. Sem minuto (outro
 * dia), a primeira pausa do dia. `null` = nenhuma (pela frente).
 */
export function nextBreak(blocks: JourneyBlock[], minute: number | null): { block: JourneyBlock; current: boolean } | null {
  const breaks = blocks.filter((block) => block.kind === "BREAK")
  if (minute === null) return breaks[0] ? { block: breaks[0], current: false } : null
  const ongoing = breaks.find((block) => minute >= block.startMinute && minute < block.endMinute)
  if (ongoing) return { block: ongoing, current: true }
  const upcoming = breaks.find((block) => block.startMinute > minute)
  return upcoming ? { block: upcoming, current: false } : null
}

/** "2 pausas" / "1 pausa" / null. */
export function breaksCountLabel(day: JourneyDay): string | null {
  const count = day.activities.filter((activity) => activity.type === "BREAK").length
  if (count === 0) return null
  return count === 1 ? "1 pausa" : `${count} pausas`
}

/** Linha curta do dia para a semana: horário, ou o lançamento que vale. */
export function dayHeadline(day: JourneyDay): string {
  if (day.kind === "WORK") return day.shift ? `${formatClock(day.shift.start)} – ${formatClock(day.shift.end)}${day.shift.crossesMidnight && day.shift.end !== "00:00" ? " (+1)" : ""}` : "Horário não informado"
  return day.label
}
