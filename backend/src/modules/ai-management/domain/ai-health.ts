/**
 * SAÚDE DA CONEXÃO (§54, §55) — derivada, sem polling: último teste explícito + telemetria REAL
 * das últimas 24h (eventos de uso). Nada de ping periódico caro.
 *
 *  - OFFLINE:  último teste falhou e nenhum sucesso depois dele; ou ≥ 3 tentativas nas 24h, todas com erro.
 *  - DEGRADED: erro em ≥ 20% das tentativas das 24h (mínimo 5), ou rate limit na última hora, ou teste RATE_LIMITED.
 *  - HEALTHY:  teste CONNECTED ou sucesso recente, sem os sinais acima.
 *  - UNKNOWN:  sem teste e sem uso nas 24h.
 */
export type ConnectionHealthStatus = "HEALTHY" | "DEGRADED" | "OFFLINE" | "UNKNOWN"

export type HealthSignals = {
  lastTest: { status: string; checkedAt: Date } | null
  attempts24h: number
  errors24h: number
  rateLimitsLastHour: number
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
}

export const DEGRADED_ERROR_RATE = 0.2
export const DEGRADED_MIN_ATTEMPTS = 5

export function connectionHealth(signals: HealthSignals): ConnectionHealthStatus {
  const testFailed = signals.lastTest !== null && signals.lastTest.status !== "CONNECTED"
  const successAfterTest = signals.lastTest !== null && signals.lastSuccessAt !== null && signals.lastSuccessAt > signals.lastTest.checkedAt
  if (testFailed && signals.lastTest!.status !== "RATE_LIMITED" && !successAfterTest) return "OFFLINE"
  if (signals.attempts24h >= 3 && signals.errors24h === signals.attempts24h) return "OFFLINE"
  if (signals.rateLimitsLastHour > 0 || signals.lastTest?.status === "RATE_LIMITED") return "DEGRADED"
  if (signals.attempts24h >= DEGRADED_MIN_ATTEMPTS && signals.errors24h / signals.attempts24h >= DEGRADED_ERROR_RATE) return "DEGRADED"
  if (signals.lastTest?.status === "CONNECTED" || signals.lastSuccessAt !== null) return "HEALTHY"
  return "UNKNOWN"
}
