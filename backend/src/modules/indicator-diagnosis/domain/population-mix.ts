/**
 * INDICATOR DIAGNOSIS V1 — COMPOSIÇÃO DA POPULAÇÃO / MIX DE MOTIVOS (domínio puro, ZERO modelo). Descreve, com números do
 * sistema, O QUE MUDOU NAS CHAMADAS que compõem o resultado — nunca POR QUE o resultado mudou:
 *
 *   "Contestação passou de 18 % para 34 % dos atendimentos e teve duração média registrada maior que as demais" é FATO;
 *   "o TMA aumentou por causa de Contestação" NÃO é (composição/correlação ≠ causa — isso nunca sai daqui nem do redator).
 *
 * Regra `MIX_SHIFT_V1` (descritiva, sem estatística causal): os dois períodos com ≥ 20 atendimentos; o motivo com maior aumento
 * de participação, desde que ≥ 10 p.p., ≥ 1,5× a participação anterior e ≥ 5 atendimentos no período atual. "Duração maior"
 * só quando a duração média registrada do motivo supera a das demais chamadas em ≥ 10 % (a duração registrada é uma
 * APROXIMAÇÃO — nunca o cálculo oficial do indicador).
 */
export const MIX_SHIFT_VERSION = "MIX_SHIFT_V1" as const
export const MIX_MIN_PERIOD_INTERACTIONS = 20
export const MIX_MIN_SHARE_CHANGE_PP = 10
export const MIX_MIN_RELATIVE_CHANGE = 1.5
export const MIX_MIN_SEGMENT_INTERACTIONS = 5
export const MIX_DURATION_MIN_RATIO = 1.1

export type MixSegmentRow = { key: string; label: string; interactions: number; totalDurationSeconds: number | null }

export type MixSegment = { key: string; label: string; current: { interactions: number; sharePercent: number; averageDurationSeconds: number | null }; previous: { interactions: number; sharePercent: number; averageDurationSeconds: number | null } | null; shareChangePp: number | null }

export type MixShift = {
  version: typeof MIX_SHIFT_VERSION
  status: "SHIFT" | "NO_SHIFT" | "INSUFFICIENT_DATA"
  currentTotal: number
  previousTotal: number
  segments: MixSegment[]
  shifted: { key: string; label: string; previousSharePercent: number; currentSharePercent: number; changePp: number; segmentAverageDurationSeconds: number | null; othersAverageDurationSeconds: number | null; longerDuration: boolean } | null
}

const round1 = (value: number) => Math.round(value * 10) / 10
const average = (total: number | null, count: number) => (total === null || count === 0 ? null : Math.round(total / count))

export function mixShiftOf(current: readonly MixSegmentRow[], previous: readonly MixSegmentRow[]): MixShift {
  const currentTotal = current.reduce((sum, row) => sum + row.interactions, 0)
  const previousTotal = previous.reduce((sum, row) => sum + row.interactions, 0)
  const previousByKey = new Map(previous.map((row) => [row.key, row]))
  const segments: MixSegment[] = current
    .map((row) => {
      const before = previousByKey.get(row.key) ?? null
      const sharePercent = currentTotal > 0 ? round1((row.interactions / currentTotal) * 100) : 0
      const previousShare = before && previousTotal > 0 ? round1((before.interactions / previousTotal) * 100) : previousTotal > 0 ? 0 : null
      return {
        key: row.key,
        label: row.label,
        current: { interactions: row.interactions, sharePercent, averageDurationSeconds: average(row.totalDurationSeconds, row.interactions) },
        previous: previousTotal > 0 ? { interactions: before?.interactions ?? 0, sharePercent: previousShare ?? 0, averageDurationSeconds: before ? average(before.totalDurationSeconds, before.interactions) : null } : null,
        shareChangePp: previousShare === null ? null : round1(sharePercent - previousShare),
      }
    })
    .sort((a, b) => b.current.interactions - a.current.interactions || a.label.localeCompare(b.label))
  const base = { version: MIX_SHIFT_VERSION, currentTotal, previousTotal, segments }
  if (currentTotal < MIX_MIN_PERIOD_INTERACTIONS || previousTotal < MIX_MIN_PERIOD_INTERACTIONS) return { ...base, status: "INSUFFICIENT_DATA", shifted: null }
  const candidates = segments
    .filter((segment) => segment.previous !== null && segment.shareChangePp !== null && segment.shareChangePp >= MIX_MIN_SHARE_CHANGE_PP && segment.current.interactions >= MIX_MIN_SEGMENT_INTERACTIONS && (segment.previous.sharePercent === 0 || segment.current.sharePercent / segment.previous.sharePercent >= MIX_MIN_RELATIVE_CHANGE))
    .sort((a, b) => (b.shareChangePp ?? 0) - (a.shareChangePp ?? 0) || a.label.localeCompare(b.label))
  const top = candidates[0]
  if (!top) return { ...base, status: "NO_SHIFT", shifted: null }
  const topRow = current.find((row) => row.key === top.key)!
  const others = current.filter((row) => row.key !== top.key)
  const othersCount = others.reduce((sum, row) => sum + row.interactions, 0)
  const othersDuration = others.every((row) => row.totalDurationSeconds !== null) ? others.reduce((sum, row) => sum + (row.totalDurationSeconds ?? 0), 0) : null
  const segmentAverage = average(topRow.totalDurationSeconds, topRow.interactions)
  const othersAverage = average(othersDuration, othersCount)
  return {
    ...base,
    status: "SHIFT",
    shifted: {
      key: top.key,
      label: top.label,
      previousSharePercent: top.previous!.sharePercent,
      currentSharePercent: top.current.sharePercent,
      changePp: top.shareChangePp!,
      segmentAverageDurationSeconds: segmentAverage,
      othersAverageDurationSeconds: othersAverage,
      longerDuration: segmentAverage !== null && othersAverage !== null && othersAverage > 0 && segmentAverage >= othersAverage * MIX_DURATION_MIN_RATIO,
    },
  }
}
