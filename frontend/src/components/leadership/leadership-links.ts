import { subjectToRef } from "@/lib/analytics/subject-params"
import type { AnalyticsSubject, MemberSituation } from "@/schemas/analytics/analytics.schema"
import type { PriorityTarget } from "@/schemas/leadership/leadership.schema"

/**
 * Rotas de aprofundamento dos cartões da liderança — a tela decide a rota (o backend só manda sujeito, competência, indicador e
 * pessoa). Todas preservam o contexto: a mesma estrutura, a mesma competência e, quando há, o mesmo indicador.
 */

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const text = search.toString()
  return text ? `?${text}` : ""
}

function subjectParams(subject: AnalyticsSubject | null) {
  if (!subject) return {}
  const ref = subjectToRef(subject)
  return { subjectKind: ref.kind, subjectId: ref.id }
}

/** Aba Indicadores da estrutura com o indicador aberto (todas as pessoas, do menor atingimento ao maior). */
export function indicatorHref(subject: AnalyticsSubject | null, period: string | null, indicatorCode: string): string {
  return `/supervisor${query({ tab: "indicators", ...subjectParams(subject), period, indicator: indicatorCode })}`
}

/** Aba Equipe/Estrutura da unidade, já filtrada pela situação (`situation`) ou pelo indicador em atenção (`attention`). */
export function teamHref(subject: AnalyticsSubject | null, period: string | null, filters: { situation?: MemberSituation | null; attention?: string | null } = {}): string {
  return `/supervisor${query({ tab: "people", ...subjectParams(subject), period, situation: filters.situation ?? null, attention: filters.attention ?? null })}`
}

export function personHref(personId: string, period: string | null): string {
  return `/supervisor/operators/${personId}${query({ tab: "indicators", period })}`
}

export function pendingHref(operatorId: string | null = null): string {
  return `/supervisor${query({ tab: "pending", operator: operatorId })}`
}

export function caseHref(caseId: string): string {
  return `/supervisor/cases/${caseId}`
}

export const AWAITING_ACK_HREF = "/supervisor?ack=pending"

export function priorityHref(target: PriorityTarget): string {
  switch (target.kind) {
    case "PENDING":
      return target.caseId ? caseHref(target.caseId) : pendingHref(target.operatorId)
    case "INDICATOR":
      return indicatorHref(target.subject, target.period, target.indicatorCode)
    case "TEAM":
      return target.indicatorCode ? indicatorHref(target.subject, target.period, target.indicatorCode) : teamHref(target.subject, target.period, { situation: target.situation })
    case "FOLLOW_UP_PENDING_ACK":
      return AWAITING_ACK_HREF
  }
}

export const PRIORITY_ACTION_LABELS: Record<PriorityTarget["kind"], string> = {
  PENDING: "Abrir",
  INDICATOR: "Ver pessoas",
  TEAM: "Abrir estrutura",
  FOLLOW_UP_PENDING_ACK: "Ver feedbacks",
}
