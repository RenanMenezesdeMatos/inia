import { HUMAN_SUPPORT_LIMITS } from "./catalogs.js"

/**
 * FILA: ESPERA ESTIMADA E PRAZO (design_draft.md seção 9; D12). Funções puras, sem cache: quem chama lê os pedidos dos últimos 14
 * dias da organização e passa aqui.
 *
 * População de referência: pedidos criados nos últimos 14 dias com o mesmo Subgrupo congelado, já atribuídos ou terminados, SEM os
 * cancelados por escopo desligado; com menos de 10 atribuídos, o mesmo com o Grupo; depois a organização; senão, sem histórico.
 * Espera de um atribuído = do pedido à primeira atribuição; de um que terminou sem atribuição = o tempo que ficou na fila.
 */
export type QueueSample = {
  teamId: string | null
  subteamId: string | null
  /** Foi atribuído a um Anjo alguma vez. */
  assigned: boolean
  /** Segundos do pedido à primeira atribuição (atribuído) ou até terminar sem atribuição. */
  waitSeconds: number
}
export type PopulationBasis = "SUBGROUP" | "GROUP" | "ORGANIZATION"
export type Population = { basis: PopulationBasis; samples: QueueSample[] }

export type WaitEstimate = { kind: "ABOUT" | "MORE_THAN"; minutes: number; basis: PopulationBasis } | { kind: "NO_HISTORY" }
export type QueueDeadline = { minutes: number; basis: PopulationBasis | "DEFAULT" }

const assignedCount = (samples: readonly QueueSample[]) => samples.filter((sample) => sample.assigned).length

export function referencePopulation(samples: readonly QueueSample[], place: { teamId: string | null; subteamId: string | null }, minAssigned: number = HUMAN_SUPPORT_LIMITS.queueHistoryMinAssigned): Population | null {
  const levels: { basis: PopulationBasis; pick: (sample: QueueSample) => boolean }[] = []
  if (place.subteamId) levels.push({ basis: "SUBGROUP", pick: (sample) => sample.subteamId === place.subteamId })
  if (place.teamId) levels.push({ basis: "GROUP", pick: (sample) => sample.teamId === place.teamId })
  levels.push({ basis: "ORGANIZATION", pick: () => true })
  for (const level of levels) {
    const picked = samples.filter(level.pick)
    if (assignedCount(picked) >= minAssigned) return { basis: level.basis, samples: picked }
  }
  return null
}

const minutesUp = (seconds: number) => Math.max(1, Math.ceil(seconds / 60))

/**
 * Espera estimada: o menor tempo t entre as esperas dos atribuídos em que os atribuídos com espera ≤ t chegam à metade da população
 * (arredondada para cima) → "cerca de t min" (para cima, mínimo 1). Se os atribuídos nunca chegam à metade: "mais de X min", X = a
 * maior espera observada na população. Sem população: sem histórico. Nunca zero, nunca tempo inventado.
 */
export function estimateWait(population: Population | null): WaitEstimate {
  if (!population || population.samples.length === 0) return { kind: "NO_HISTORY" }
  const half = Math.ceil(population.samples.length / 2)
  const assigned = population.samples.filter((sample) => sample.assigned).map((sample) => sample.waitSeconds).sort((a, b) => a - b)
  if (assigned.length >= half) return { kind: "ABOUT", minutes: minutesUp(assigned[half - 1]!), basis: population.basis }
  const longest = Math.max(...population.samples.map((sample) => sample.waitSeconds))
  return { kind: "MORE_THAN", minutes: minutesUp(longest), basis: population.basis }
}

/** Percentil por posição (nearest-rank) de uma lista ordenada. */
export function nearestRank(sorted: readonly number[], percentile: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))]!
}

/**
 * Prazo da fila: percentil 90 das esperas dos atribuídos da população, para cima em minutos, entre 10 e 25 min (acima de 25 a
 * sessão do operador expiraria antes); sem histórico, 20 min. Calculado quando o pedido entra (ou volta) na fila; não muda depois.
 */
export function queueDeadline(population: Population | null): QueueDeadline {
  const { queueDeadlineDefaultMinutes, queueDeadlineMinMinutes, queueDeadlineMaxMinutes } = HUMAN_SUPPORT_LIMITS
  if (!population) return { minutes: queueDeadlineDefaultMinutes, basis: "DEFAULT" }
  const p90 = nearestRank(population.samples.filter((sample) => sample.assigned).map((sample) => sample.waitSeconds).sort((a, b) => a - b), 90)
  if (p90 === null) return { minutes: queueDeadlineDefaultMinutes, basis: "DEFAULT" }
  return { minutes: Math.min(queueDeadlineMaxMinutes, Math.max(queueDeadlineMinMinutes, Math.ceil(p90 / 60))), basis: population.basis }
}
