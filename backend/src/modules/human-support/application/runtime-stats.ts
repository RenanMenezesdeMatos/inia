/**
 * Números do processo para `GET /internal/metrics` (seção `humanSupport`, design_draft.md seção 11): chamadas longas abertas e como
 * foram respondidas, distribuição (rodadas, falhas por pedido), atraso entre um prazo vencer e a transição, falhas do registro LGPD.
 * Só contagens — nunca ids de pessoas nem conteúdo.
 */
export type HumanSupportRuntimeStats = {
  dispatchRuns: number
  dispatchSkipped: number
  dispatchFailures: number
  assignmentFailures: number
  assignments: number
  personalDataLogFailures: number
  deadlineLagLastMs: number | null
  deadlineLagMaxMs: number
}

export const humanSupportStats: HumanSupportRuntimeStats = {
  dispatchRuns: 0,
  dispatchSkipped: 0,
  dispatchFailures: 0,
  assignmentFailures: 0,
  assignments: 0,
  personalDataLogFailures: 0,
  deadlineLagLastMs: null,
  deadlineLagMaxMs: 0,
}

export function recordDeadlineLag(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return
  humanSupportStats.deadlineLagLastMs = Math.round(ms)
  humanSupportStats.deadlineLagMaxMs = Math.max(humanSupportStats.deadlineLagMaxMs, Math.round(ms))
}
