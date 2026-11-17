import type { OperatorIndicatorHistory } from "@/schemas/operator"
import type { ReceivedCommunication } from "@/schemas/communications/communication.schema"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"

/**
 * Timeline do Acompanhamento: as fontes do feed (feedbacks publicados, feedbacks de atendimento entregues e comunicados da
 * liderança recebidos) numa ÚNICA ordem — MAIS RECENTE PRIMEIRO pelo instante canônico de cada fonte (`occurredAt` = publicação do
 * feedback; `deliveredAt` = entrega; `publishedAt` = publicação do comunicado), com desempate determinístico por id. As entregas e os
 * comunicados (os 200 mais recentes) chegam inteiros; os feedbacks publicados chegam por página
 * (cursor) — `boundFollowUpTimeline` corta a timeline enquanto houver página por vir. O feed revela N por vez da lista JÁ
 * ordenada: página 1 = os mais recentes, "carregar mais" = progressivamente mais antigos.
 * Só o Acompanhamento usa isto — o chat da INIA continua em ordem de conversa.
 */
export type FollowUpEntry =
  | { key: string; at: number; source: "history"; item: OperatorIndicatorHistory }
  | { key: string; at: number; source: "delivered"; item: DeliveredFeedback }
  | { key: string; at: number; source: "notice"; item: ReceivedCommunication }

const instant = (value: string | null | undefined) => {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}

export function buildFollowUpTimeline(history: readonly OperatorIndicatorHistory[], delivered: readonly DeliveredFeedback[], notices: readonly ReceivedCommunication[] = []): FollowUpEntry[] {
  const entries: FollowUpEntry[] = [
    ...history.map((item) => ({ key: `history:${item.id}`, at: instant(item.occurredAt), source: "history" as const, item })),
    ...delivered.map((item) => ({ key: `delivered:${item.id}`, at: instant(item.deliveredAt), source: "delivered" as const, item })),
    ...notices.map((item) => ({ key: `notice:${item.id}`, at: instant(item.publishedAt), source: "notice" as const, item })),
  ]
  return entries.sort((a, b) => (b.at !== a.at ? (b.at > a.at ? 1 : -1) : b.key < a.key ? -1 : b.key > a.key ? 1 : 0))
}

/**
 * Enquanto o servidor ainda tem feedbacks publicados mais antigos que o último carregado, nada mais antigo que esse último pode
 * aparecer: uma entrega anterior a ele seria mostrada ANTES de feedbacks que ainda não chegaram. Sem página por vir, a timeline
 * vale inteira.
 */
export function boundFollowUpTimeline(timeline: FollowUpEntry[], hasMoreHistory: boolean): FollowUpEntry[] {
  if (!hasMoreHistory) return timeline
  const oldestLoaded = timeline.reduce((oldest, entry) => (entry.source === "history" && entry.at < oldest ? entry.at : oldest), Number.POSITIVE_INFINITY)
  return timeline.filter((entry) => entry.at > oldestLoaded || (entry.source === "history" && entry.at === oldestLoaded))
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** Rótulo do dia no fuso de quem lê: "Hoje", "Ontem" ou "segunda-feira, 28/09" (ano só quando não é o corrente). */
export function followUpDayLabel(at: number, now: Date = new Date()): string {
  if (!Number.isFinite(at)) return "Sem data"
  const date = new Date(at)
  if (dayKey(date) === dayKey(now)) return "Hoje"
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return "Ontem"
  const label = date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export { dayKey as followUpDayKey }

/** Recorte do calendário do Acompanhamento em datas civis "AAAA-MM-DD" (o valor do `DateRangePicker`); vazio = visão inicial, tudo. */
export type FollowUpPeriod = { from?: string | undefined; to?: string | undefined }

/**
 * Limites do recorte em instantes, no fuso de quem lê — o mesmo de `followUpDayLabel`, então o item cai no dia em que aparece
 * rotulado. `[since, until)`: o fim é o começo do dia seguinte ao último dia escolhido. Só o início = aquele dia.
 */
export function followUpPeriodBounds(period: FollowUpPeriod): { since: number; until: number } | null {
  const from = civilStart(period.from)
  if (from === null) return null
  const last = civilStart(period.to) ?? from
  const lastDay = new Date(last)
  return { since: from, until: new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1).getTime() }
}

export const isWithinFollowUpPeriod = (at: number, bounds: { since: number; until: number } | null) => bounds === null || (at >= bounds.since && at < bounds.until)

function civilStart(value: string | undefined): number | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : null
}
