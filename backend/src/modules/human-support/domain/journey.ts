import { PAUSE_REASONS_V1, type PauseReason, type PresenceStatus } from "./catalogs.js"

/**
 * JORNADA DO ANJO (migration 191; regras do responsável em 2026-11-11). Reparte o tempo do período em estados MUTUAMENTE EXCLUSIVOS,
 * a partir só do que o servidor registrou — eventos de presença (estado declarado e conexão) e atendimentos —, cortando nos limites do
 * filtro e na meia-noite do fuso da organização (os dias chegam prontos, calculados no banco). Precedência, do mais forte:
 *
 *  1. UNAVAILABLE — Indisponível, que é o MESMO estado que offline (decisão do responsável em 11/11): Indisponível declarado (pelo
 *     Anjo ou pelo sistema) ou sem conexão (área do Anjo fechada, sem sinal, sessão encerrada), mesmo com atendimento aberto;
 *  2. IN_ATTENDANCE — ao menos um atendimento acolhido em andamento (sobrepostos contam UMA vez);
 *  3. PAUSED — em pausa, por motivo (a pausa programada só conta quando entra em vigor: o evento dela leva esse instante);
 *  4. AVAILABLE — disponível aguardando acionamento (inclui a espera entre atendimentos).
 *
 * Tempo ONLINE (base dos percentuais) = disponível + em atendimento + em pausa; Indisponível fica fora. Base zero = "Sem tempo online
 * no período" (percentuais nulos, nunca 0%).
 */
export type JourneyState = "AVAILABLE" | "IN_ATTENDANCE" | "PAUSED" | "UNAVAILABLE"

export type StatusMark = { at: number; status: PresenceStatus; pauseReason: PauseReason | null }
export type ConnectionMark = { at: number; connected: boolean }
export type AttendanceSpanMs = { start: number; end: number | null }
export type JourneyDay = { day: string; start: number; end: number }

export type JourneyInput = {
  /** Dias do período no fuso da organização, em ordem, já cortados pelo filtro e pelo instante atual. */
  days: readonly JourneyDay[]
  initialStatus: Omit<StatusMark, "at">
  statusMarks: readonly StatusMark[]
  initialConnected: boolean
  connectionMarks: readonly ConnectionMark[]
  attendances: readonly AttendanceSpanMs[]
}

export type JourneyDurations = {
  availableMs: number
  attendanceMs: number
  pausedMs: Record<PauseReason, number>
  /** Indisponível (= offline): fora do tempo online. */
  unavailableMs: number
}
export type JourneyDayResult = JourneyDurations & { day: string }

const emptyPauses = (): Record<PauseReason, number> => Object.fromEntries(PAUSE_REASONS_V1.map((reason) => [reason, 0])) as Record<PauseReason, number>
export const emptyDurations = (): JourneyDurations => ({ availableMs: 0, attendanceMs: 0, pausedMs: emptyPauses(), unavailableMs: 0 })

/** Último marco com `at <= instant` (marcos em ordem). */
function lastAt<T extends { at: number }>(marks: readonly T[], instant: number): T | null {
  let found: T | null = null
  for (const mark of marks) {
    if (mark.at > instant) break
    found = mark
  }
  return found
}

export function stateAt(input: JourneyInput, instant: number): { state: JourneyState; pauseReason: PauseReason | null } {
  const connected = lastAt(input.connectionMarks, instant)?.connected ?? input.initialConnected
  const status = lastAt(input.statusMarks, instant) ?? input.initialStatus
  if (!connected || status.status === "OFFLINE") return { state: "UNAVAILABLE", pauseReason: null }
  if (input.attendances.some((span) => span.start <= instant && (span.end === null || span.end > instant))) return { state: "IN_ATTENDANCE", pauseReason: null }
  if (status.status === "PAUSED") return { state: "PAUSED", pauseReason: status.pauseReason }
  return { state: "AVAILABLE", pauseReason: null }
}

/** Durações por dia: varre os trechos entre todos os instantes em que algo muda e soma cada trecho no estado vigente no seu início. */
export function journeyByDay(input: JourneyInput): JourneyDayResult[] {
  const changes = [
    ...input.statusMarks.map((mark) => mark.at),
    ...input.connectionMarks.map((mark) => mark.at),
    ...input.attendances.flatMap((span) => (span.end === null ? [span.start] : [span.start, span.end])),
  ]
  return input.days.map((day) => {
    const result: JourneyDayResult = { day: day.day, ...emptyDurations() }
    const cuts = [...new Set([day.start, day.end, ...changes.filter((at) => at > day.start && at < day.end)])].sort((a, b) => a - b)
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index]!
      const length = cuts[index + 1]! - from
      if (length <= 0) continue
      const { state, pauseReason } = stateAt(input, from)
      if (state === "AVAILABLE") result.availableMs += length
      else if (state === "IN_ATTENDANCE") result.attendanceMs += length
      else if (state === "PAUSED") result.pausedMs[pauseReason ?? "PERSONAL"] += length
      else result.unavailableMs += length
    }
    return result
  })
}

export const pausedTotal = (durations: Pick<JourneyDurations, "pausedMs">) => Object.values(durations.pausedMs).reduce((sum, value) => sum + value, 0)
/** Tempo online: disponível + em atendimento + em pausa (Indisponível = offline fica fora). */
export const onlineBase = (durations: JourneyDurations) => durations.availableMs + durations.attendanceMs + pausedTotal(durations)

export function sumDurations(list: readonly JourneyDurations[]): JourneyDurations {
  const total = emptyDurations()
  for (const item of list) {
    total.availableMs += item.availableMs
    total.attendanceMs += item.attendanceMs
    total.unavailableMs += item.unavailableMs
    for (const reason of PAUSE_REASONS_V1) total.pausedMs[reason] += item.pausedMs[reason]
  }
  return total
}

/** Percentuais sobre a base (soma das durações ÷ soma da base no período, sem arredondar). Base zero = null em todos. */
export type JourneyShares = {
  available: number | null
  attendance: number | null
  pausedTotal: number | null
  paused: Record<PauseReason, number | null>
  productive: number | null
}
export function journeyShares(durations: JourneyDurations): JourneyShares {
  const base = onlineBase(durations)
  const pct = (part: number) => (base > 0 ? (part / base) * 100 : null)
  return {
    available: pct(durations.availableMs),
    attendance: pct(durations.attendanceMs),
    pausedTotal: pct(pausedTotal(durations)),
    paused: Object.fromEntries(PAUSE_REASONS_V1.map((reason) => [reason, pct(durations.pausedMs[reason])])) as Record<PauseReason, number | null>,
    productive: pct(durations.availableMs + durations.attendanceMs),
  }
}

/** Resumo do período: totais, percentuais e, com vários dias, a média diária entre os dias COM tempo online. */
export function journeySummary(days: readonly JourneyDayResult[]) {
  const total = sumDurations(days)
  const online = days.filter((day) => onlineBase(day) > 0)
  return {
    total,
    baseMs: onlineBase(total),
    shares: journeyShares(total),
    daysWithOnline: online.length,
    dailyAverage: online.length === 0 ? null : { availableMs: total.availableMs / online.length, attendanceMs: total.attendanceMs / online.length },
  }
}
