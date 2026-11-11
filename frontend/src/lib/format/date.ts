/**
 * Formatação de datas compartilhada pela interface (pt-BR). Só formata — nunca decide fuso nem período.
 *
 * Duas naturezas de valor que nunca se misturam:
 * - DATA CIVIL ("AAAA-MM-DD"): o dia já foi resolvido pelo backend no fuso da organização. Não passa por
 *   `Date` — converter deslocaria o dia para quem está em outro fuso.
 * - INSTANTE (ISO 8601): um momento absoluto, exibido no fuso de quem está vendo (ou no fuso pedido).
 */

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }

/** Data civil "AAAA-MM-DD" (ou ISO que comece por ela) → "dd/mm/aaaa", sem conversão de fuso. */
export function formatCivilDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/** Instante ISO → "dd/mm/aaaa, hh:mm" no fuso do navegador. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", DATE_TIME_OPTIONS)
}

/** Instante ISO → "dd/mm, hh:mm" — a hora de publicação na linha "INIA · …" de um item do Acompanhamento (colaborador e estrutura). */
export function formatFeedTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export type FormatShortDateTimeOptions = {
  timeZone?: string
  withYear?: boolean
  withWeekday?: boolean
}

function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? ""
}

/**
 * Instante ISO → "dd/mm às hh:mm" (com `withYear`: "dd/mm/aaaa às hh:mm"; com `withWeekday`: "seg dd/mm às hh:mm").
 * Valor inválido vira "" — quem chama decide o que mostrar no lugar.
 */
export function formatShortDateTime(value: string, options: FormatShortDateTimeOptions = {}): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    ...(options.withWeekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "2-digit",
    ...(options.withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  })
  const parts = formatter.formatToParts(date)

  const weekday = partOf(parts, "weekday").replace(".", "")
  const datePart = options.withYear
    ? `${partOf(parts, "day")}/${partOf(parts, "month")}/${partOf(parts, "year")}`
    : `${partOf(parts, "day")}/${partOf(parts, "month")}`
  const timePart = `${partOf(parts, "hour")}:${partOf(parts, "minute")}`

  return options.withWeekday && weekday ? `${weekday} ${datePart} às ${timePart}` : `${datePart} às ${timePart}`
}

/** Instante ISO → "hh:mm" no fuso do navegador (ex.: "Seu pedido fica na fila até 14:35"). Valor inválido vira "". */
export function formatClockTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false })
}

/** Cronômetro "mm:ss" (abaixo de 1 h) ou "h:mm:ss": tempo decorrido em ms, nunca negativo. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** O mesmo tempo por extenso, para leitores de tela: "1 h 5 min", "12 min 4 s", "40 s". */
export function describeElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

// Rótulos de dia e hora de conversas e listas de mensagens ("Conversas com a INIA", painel do Apoio com Anjo).
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" })
/** Chave do dia LOCAL (separadores de data). */
export const dayKey = (iso: string) => dayKeyFormatter.format(new Date(iso))

/** Rótulo do separador de data: "Hoje", "Ontem" ou "29 de setembro de 2026". */
export function dateSeparatorLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso)
  if (key === dayKeyFormatter.format(now)) return "Hoje"
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKeyFormatter.format(yesterday)) return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))
}

export const messageTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

/** Última atividade compacta para listas: hora (hoje), "Ontem" ou a data. */
export function lastActivityLabel(iso: string, now: Date = new Date()): string {
  const label = dateSeparatorLabel(iso, now)
  if (label === "Hoje") return messageTime(iso)
  if (label === "Ontem") return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso))
}
