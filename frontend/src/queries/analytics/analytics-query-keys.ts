import type { SubjectRef } from "@/lib/analytics/subject-params"

/**
 * Chaves da área de analytics. Tudo que depende de competência/sujeito carrega os dois na chave —
 * trocar o período invalida SÓ estas queries (nunca perfil/avatar/feed do operador).
 */
export const analyticsKeys = {
  context: (subject: SubjectRef | null) => ["analytics", "context", subject] as const,
  indicators: (subject: SubjectRef | null, period: string | null, comparison: string | null) => ["analytics", "indicators", subject, period, comparison] as const,
  breakdown: (subject: SubjectRef | null, period: string | null, groupBy: string) => ["analytics", "breakdown", subject, period, groupBy] as const,
  indicatorMembers: (subject: SubjectRef | null, period: string | null, code: string, params: unknown) => ["analytics", "indicator-members", subject, period, code, params] as const,
  team: (subject: SubjectRef | null, period: string | null) => ["analytics", "team", subject, period] as const,
  teamMembers: (subject: SubjectRef | null, period: string | null, params: unknown) => ["analytics", "team-members", subject, period, params] as const,
  followUps: (subject: SubjectRef | null, limit: number, unacknowledgedOnly: boolean) => ["analytics", "follow-ups", subject, limit, unacknowledgedOnly] as const,
}
