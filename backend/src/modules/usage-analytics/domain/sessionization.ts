/**
 * SESSÃO DE USO e TEMPO ATIVO — regras puras (a projeção chama estas funções; reprocessar = rodar de novo sobre os eventos).
 *
 * Sessão de uso = período de utilização autenticada de UMA conta num navegador (o id é compartilhado entre as abas pelo
 * próprio navegador; outro dispositivo tem outro id, mas a pessoa continua única nos ativos). Começa na primeira atividade
 * humana qualificada (tela apresentada em primeiro plano, acionamento, rolagem, ação, busca) e termina:
 *   - no logout/troca de identidade (o navegador avisa antes de sair), ou
 *   - INFERIDA, 30 min depois da última atividade qualificada (nova ação após isso abre outra sessão).
 * Heartbeat não estende a sessão sozinho: só conta o instante da interação que ele atesta (`lastInteractionAt`).
 *
 * Duração da sessão (fim − início) ≠ tempo ativo observado (união dos intervalos de atenção confirmados por heartbeat).
 */
export const SESSION_INACTIVITY_MINUTES = 30
export const SESSION_INACTIVITY_MS = SESSION_INACTIVITY_MINUTES * 60_000

export type SessionInputEvent = {
  usageSessionId: string
  /** Instante efetivo (já corrigido pelo desvio de relógio). */
  occurredAt: Date
  /** Instante de atividade humana atestada por este evento (null = o evento não estende a sessão). */
  activityAt: Date | null
  /** Saída explícita por logout/troca de conta. */
  logout: boolean
  admin: boolean
}

export type DerivedSession = {
  usageSessionId: string
  seq: number
  startedAt: Date
  lastActivityAt: Date
  endedAt: Date
  endReason: "LOGOUT" | "INACTIVITY_INFERRED" | "OPEN"
  activityCount: number
  hasProductActivity: boolean
  hasAdminActivity: boolean
}

/**
 * Divide os eventos de uma conta em sessões. Agrupa por id do navegador e, dentro de cada id, abre outra sessão quando a
 * próxima atividade chega mais de 30 min depois da anterior ou depois de um logout. `now` decide se a última ainda está aberta.
 */
export function deriveSessions(events: readonly SessionInputEvent[], now: Date): DerivedSession[] {
  const byId = new Map<string, SessionInputEvent[]>()
  for (const event of events) byId.set(event.usageSessionId, [...(byId.get(event.usageSessionId) ?? []), event])
  const sessions: DerivedSession[] = []
  for (const [usageSessionId, group] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...group].sort((a, b) => (a.activityAt ?? a.occurredAt).getTime() - (b.activityAt ?? b.occurredAt).getTime())
    let current: DerivedSession | null = null
    let seq = 0
    const close = (session: DerivedSession) => sessions.push(session)
    for (const event of ordered) {
      if (event.logout) {
        if (current && event.occurredAt.getTime() >= current.startedAt.getTime()) {
          close({ ...current, endedAt: event.occurredAt, endReason: "LOGOUT" })
          current = null
        }
        continue
      }
      const at = event.activityAt
      if (!at) continue
      if (current && at.getTime() - current.lastActivityAt.getTime() > SESSION_INACTIVITY_MS) {
        close({ ...current, endedAt: current.lastActivityAt, endReason: "INACTIVITY_INFERRED" })
        current = null
      }
      if (!current) {
        current = { usageSessionId, seq: seq++, startedAt: at, lastActivityAt: at, endedAt: at, endReason: "OPEN", activityCount: 0, hasProductActivity: false, hasAdminActivity: false }
      }
      current.lastActivityAt = at.getTime() > current.lastActivityAt.getTime() ? at : current.lastActivityAt
      current.activityCount += 1
      if (event.admin) current.hasAdminActivity = true
      else current.hasProductActivity = true
    }
    if (current) {
      const expired = now.getTime() - current.lastActivityAt.getTime() > SESSION_INACTIVITY_MS
      close({ ...current, endedAt: current.lastActivityAt, endReason: expired ? "INACTIVITY_INFERRED" : "OPEN" })
    }
  }
  return sessions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
}

export type Span = { start: Date; end: Date }

/** União de intervalos (sobreposições de abas/dispositivos contam uma vez) recortada a [from, to), em segundos. */
export function unionSeconds(spans: readonly Span[], from?: Date, to?: Date): number {
  const clipped = spans
    .map((span) => ({ start: Math.max(span.start.getTime(), from?.getTime() ?? -Infinity), end: Math.min(span.end.getTime(), to?.getTime() ?? Infinity) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start)
  let total = 0
  let cursorStart = -Infinity
  let cursorEnd = -Infinity
  for (const span of clipped) {
    if (span.start > cursorEnd) {
      if (cursorEnd > cursorStart) total += cursorEnd - cursorStart
      cursorStart = span.start
      cursorEnd = span.end
    } else if (span.end > cursorEnd) cursorEnd = span.end
  }
  if (cursorEnd > cursorStart) total += cursorEnd - cursorStart
  return Math.round(total / 1000)
}

/** Divide um intervalo entre os dias atravessados (segundos por data local). */
export function splitByDays(span: Span, days: readonly { date: string; start: Date; end: Date }[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const day of days) {
    const seconds = unionSeconds([span], day.start, day.end)
    if (seconds > 0) result.set(day.date, seconds)
  }
  return result
}
