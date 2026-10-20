/**
 * Encerramento da sessão por inatividade — a regra que a tela segue (o servidor encerra de qualquer forma, ver
 * SESSION_IDLE_TIMEOUT_MINUTES no backend). Interação = clique, toque, tecla, rolagem ou uma ação que altera algo; as leituras
 * automáticas da tela (sino, avisos) não contam.
 */

/** A tela avisa o servidor da interação no máximo uma vez por minuto (o servidor também só grava uma vez por minuto). */
export const ACTIVITY_REPORT_INTERVAL_MS = 60_000
/** Aviso "vai encerrar" antes do fim. */
export const IDLE_WARNING_BEFORE_MS = 2 * 60_000
/** Evento que outras partes da tela disparam quando a pessoa age sem clicar/teclar (ex.: um turno da conversa por voz). */
export const ACTIVITY_EVENT = "inia:activity"
/** Última interação compartilhada entre as abas abertas (uma aba em uso mantém as outras vivas). */
export const LAST_INTERACTION_STORAGE_KEY = "inia:last-interaction"

export type IdlePhase = "active" | "warning" | "expired"

export function idlePhase(lastInteractionAt: number, now: number, timeoutMs: number): IdlePhase {
  if (timeoutMs <= 0) return "active"
  const idle = now - lastInteractionAt
  if (idle >= timeoutMs) return "expired"
  if (idle >= timeoutMs - Math.min(IDLE_WARNING_BEFORE_MS, timeoutMs / 2)) return "warning"
  return "active"
}

export function shouldReportActivity(lastReportAt: number | null, now: number): boolean {
  return lastReportAt === null || now - lastReportAt >= ACTIVITY_REPORT_INTERVAL_MS
}

/** Minutos inteiros que faltam (nunca menos de 1) — para o texto do aviso. */
export function minutesLeft(lastInteractionAt: number, now: number, timeoutMs: number): number {
  return Math.max(1, Math.ceil((timeoutMs - (now - lastInteractionAt)) / 60_000))
}

/** Avisa a tela de que a pessoa agiu sem clicar nem teclar. */
export function signalUserActivity() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACTIVITY_EVENT))
}
