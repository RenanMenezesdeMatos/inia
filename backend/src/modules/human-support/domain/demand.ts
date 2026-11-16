import { operationIndicators, type OperationIndicators, type RequestRecord } from "./attendance-indicators.js"
import { nearestRank } from "./queue-history.js"

/**
 * ACIONAMENTOS DO PERÍODO (aba Indicadores do Painel dos Anjos; pedido do responsável em 2026-11-11). Visão da DEMANDA, sem pessoa
 * do Anjo: quando os operadores acionam (curva por hora local), quanto esperam (da entrada original na fila ao acolhimento — a
 * atribuição é direta), quem mais aciona (operador, Grupo e Subgrupo congelados no pedido) e os números da fila (sem Anjo logado,
 * abandono antes do acolhimento, expirados). A jornada e os números de cada Anjo ficam em "Jornada e atendimentos".
 *
 * Produtivo × não produtivo = a PERTINÊNCIA marcada pelo Anjo (migration 191): produtivo = algum atendimento do pedido marcado
 * Pertinente; não produtivo = marcado Não pertinente (e nenhum Pertinente); o resto (sem atendimento, sem classificação ou Não
 * avaliado) = não avaliado. A divisão é sempre do período inteiro; escolher uma parte filtra o restante da visão.
 */
export const PRODUCTIVITY = ["PRODUCTIVE", "NOT_PRODUCTIVE", "NOT_EVALUATED"] as const
export type Productivity = (typeof PRODUCTIVITY)[number]

export type DemandRecord = RequestRecord & {
  operatorPersonId: string
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  /** Hora local (0–23) e dia civil local da entrada na fila. */
  hour: number
  day: string
  /** Segundos da entrada original ao PRIMEIRO acolhimento (null = não acolhido). */
  waitSeconds: number | null
  productivity: Productivity
}

export type Ranked = { key: string; label: string; count: number; share: number }
export type Demand = {
  productivity: Record<Productivity, number>
  filter: Productivity | null
  total: number
  byHour: number[]
  wait: { averageSeconds: number | null; p50Seconds: number | null; p90Seconds: number | null; count: number; byDay: { day: string; averageSeconds: number | null; count: number }[] }
  top: { operators: Ranked[]; groups: Ranked[]; subgroups: Ranked[] }
  operation: OperationIndicators
}

const TOP = 5

function rank(records: readonly DemandRecord[], keyOf: (record: DemandRecord) => string | null, labelOf: (record: DemandRecord) => string): Ranked[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const record of records) {
    const key = keyOf(record)
    if (!key) continue
    const current = counts.get(key) ?? { label: labelOf(record), count: 0 }
    current.count += 1
    counts.set(key, current)
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: value.label, count: value.count, share: records.length > 0 ? value.count / records.length : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, TOP)
}

export function demandOf(all: readonly DemandRecord[], days: readonly string[], filter: Productivity | null, operatorName: (personId: string) => string): Demand {
  const productivity = { PRODUCTIVE: 0, NOT_PRODUCTIVE: 0, NOT_EVALUATED: 0 } as Record<Productivity, number>
  for (const record of all) productivity[record.productivity] += 1
  const records = filter ? all.filter((record) => record.productivity === filter) : all
  const byHour = Array.from({ length: 24 }, () => 0)
  for (const record of records) byHour[record.hour] = (byHour[record.hour] ?? 0) + 1
  const waits = records.flatMap((record) => (record.waitSeconds === null ? [] : [record.waitSeconds])).sort((a, b) => a - b)
  const byDay = days.map((day) => {
    const own = records.flatMap((record) => (record.day === day && record.waitSeconds !== null ? [record.waitSeconds] : []))
    return { day, averageSeconds: own.length === 0 ? null : own.reduce((sum, value) => sum + value, 0) / own.length, count: own.length }
  })
  return {
    productivity,
    filter,
    total: records.length,
    byHour,
    wait: {
      averageSeconds: waits.length === 0 ? null : waits.reduce((sum, value) => sum + value, 0) / waits.length,
      p50Seconds: nearestRank(waits, 50),
      p90Seconds: nearestRank(waits, 90),
      count: waits.length,
      byDay,
    },
    top: {
      operators: rank(records, (record) => record.operatorPersonId, (record) => operatorName(record.operatorPersonId)),
      groups: rank(records, (record) => record.teamId, (record) => record.teamName ?? "Grupo"),
      subgroups: rank(records, (record) => record.subteamId, (record) => record.subteamName ?? "Subgrupo"),
    },
    operation: operationIndicators(records),
  }
}
