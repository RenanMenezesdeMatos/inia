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
