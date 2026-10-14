import type { OperatorIndicatorHistory } from "@/schemas/operator"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"

/**
 * Timeline do Acompanhamento: as duas fontes do feed (feedbacks publicados e feedbacks de atendimento entregues) numa ÚNICA
 * ordem — MAIS RECENTE PRIMEIRO pelo instante canônico de cada fonte (`occurredAt` = publicação do feedback; `deliveredAt` =
 * entrega), com desempate determinístico por id. As entregas chegam inteiras; os feedbacks publicados chegam por página
 * (cursor) — `boundFollowUpTimeline` corta a timeline enquanto houver página por vir. O feed revela N por vez da lista JÁ
 * ordenada: página 1 = os mais recentes, "carregar mais" = progressivamente mais antigos.
 * Só o Acompanhamento usa isto — o chat da INIA continua em ordem de conversa.
 */
export type FollowUpEntry =
  | { key: string; at: number; source: "history"; item: OperatorIndicatorHistory }
  | { key: string; at: number; source: "delivered"; item: DeliveredFeedback }

const instant = (value: string | null | undefined) => {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}

export function buildFollowUpTimeline(history: readonly OperatorIndicatorHistory[], delivered: readonly DeliveredFeedback[]): FollowUpEntry[] {
  const entries: FollowUpEntry[] = [
    ...history.map((item) => ({ key: `history:${item.id}`, at: instant(item.occurredAt), source: "history" as const, item })),
    ...delivered.map((item) => ({ key: `delivered:${item.id}`, at: instant(item.deliveredAt), source: "delivered" as const, item })),
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
