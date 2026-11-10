import type { PauseReason, PresenceStatus } from "./catalogs.js"

/**
 * STATUS OPERACIONAL DE UM ANJO AGORA (aba Anjos do painel). Deriva só do que o sistema registra: o estado declarado (Disponível,
 * Em pausa com motivo, Indisponível), a conexão da área do Anjo e os atendimentos. "Em atendimento" = Disponível com ao menos um
 * atendimento em andamento (em pausa, o Anjo continua "Em pausa", com os atendimentos abertos contados à parte).
 *
 * "Desde quando" é a TRANSIÇÃO REAL para o status mostrado, nunca o momento em que a tela abriu:
 *  - Em pausa: a última troca de estado ou de motivo (`status_since`);
 *  - Em atendimento: o início da sequência atual de atendimentos sem intervalo livre (atendimentos que se sobrepõem contam como uma
 *    sequência só), e nunca antes de ficar Disponível;
 *  - Disponível: o fim do último atendimento depois de ficar Disponível, ou a hora em que ficou Disponível;
 *  - Indisponível: sem tempo (não há contador).
 */
export type OperationalStatus = "AVAILABLE" | "IN_ATTENDANCE" | "PAUSED" | "UNAVAILABLE"
export type AttendanceSpan = { startedAt: Date; endedAt: Date | null }
export type PresenceSnapshot = { status: PresenceStatus; pauseReason: PauseReason | null; statusSince: Date | null }

export function operationalStatusOf(presence: PresenceSnapshot | null, attendances: readonly AttendanceSpan[]): { status: OperationalStatus; pauseReason: PauseReason | null; since: Date | null } {
  if (!presence || presence.status === "OFFLINE") return { status: "UNAVAILABLE", pauseReason: null, since: null }
  if (presence.status === "PAUSED") return { status: "PAUSED", pauseReason: presence.pauseReason, since: presence.statusSince }
  const active = attendances.filter((span) => span.endedAt === null)
  if (active.length > 0) {
    let start = Math.min(...active.map((span) => span.startedAt.getTime()))
    // Volta no tempo enquanto um atendimento já encerrado cobria o início da sequência (sem nenhum instante livre entre eles).
    for (let changed = true; changed; ) {
      changed = false
      for (const span of attendances) {
        if (span.endedAt && span.startedAt.getTime() < start && span.endedAt.getTime() >= start) {
          start = span.startedAt.getTime()
          changed = true
        }
      }
    }
    return { status: "IN_ATTENDANCE", pauseReason: null, since: latest(presence.statusSince, new Date(start)) }
  }
  const lastEnd = attendances.reduce<number | null>((max, span) => (span.endedAt && (max === null || span.endedAt.getTime() > max) ? span.endedAt.getTime() : max), null)
  return { status: "AVAILABLE", pauseReason: null, since: latest(presence.statusSince, lastEnd === null ? null : new Date(lastEnd)) }
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}
