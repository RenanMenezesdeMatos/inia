/**
 * INDICATOR DIAGNOSIS V2 — POPULAÇÃO SINALIZADA (domínio puro, ZERO modelo). Para um indicador de taxa cujo evento é marcado em
 * cada interação por um sinal JÁ CALCULADO pela fonte (a flag declarada na estratégia — ex.: `rechamada`), descreve com números
 * do sistema ONDE o sinal aparece nas interações ATENDIDAS pelo colaborador — nunca POR QUE apareceu:
 *
 *   "5 das 8 interações marcadas foram de Contestação" é FATO de composição;
 *   "as rechamadas aconteceram porque…" NÃO é (o sinal não carrega causa, e sem vínculo explícito com o atendimento anterior não
 *   se sabe nem qual atendimento originou o retorno).
 *
 * A INIA não define janela, não vincula atendimentos por semelhança de assunto e não recalcula o indicador oficial: só conta as
 * interações que a fonte marcou. Regras `SIGNAL_POPULATION_V1` (descritivas, sem estatística causal):
 *   distribuição   só com ≥ 5 interações sinalizadas no período (abaixo disso não se fala de distribuição);
 *   concentração   o motivo com mais interações sinalizadas, desde que ≥ 3 delas, ≥ 50 % do sinal E taxa de sinal no motivo ≥ 1,5×
 *                  a taxa nos demais motivos (senão é só volume: o motivo é grande, não "concentra" o sinal);
 *   evolução       os dois períodos com ≥ 20 interações e ≥ 3 sinalizadas; mudança de composição = o motivo com maior aumento de
 *                  participação no sinal, ≥ 20 p.p. e ≥ 3 sinalizadas no período atual.
 */
export const SIGNAL_POPULATION_VERSION = "SIGNAL_POPULATION_V1" as const
export const SIGNAL_MIN_FOR_DISTRIBUTION = 5
export const SIGNAL_CONCENTRATION_MIN_EVENTS = 3
export const SIGNAL_CONCENTRATION_MIN_SHARE = 0.5
export const SIGNAL_CONCENTRATION_MIN_LIFT = 1.5
export const SIGNAL_EVOLUTION_MIN_INTERACTIONS = 20
export const SIGNAL_EVOLUTION_MIN_EVENTS = 3
export const SIGNAL_SHIFT_MIN_PP = 20

export type SignalRow = { key: string; label: string; interactions: number; signaled: number }

export type SignalReason = { key: string; label: string; interactions: number; signaled: number; signalRatePercent: number | null; shareOfSignalPercent: number | null }

export type SignalDistribution = {
  version: typeof SIGNAL_POPULATION_VERSION
  signalLabel: string
  status: "CONCENTRATED" | "SPREAD" | "INSUFFICIENT_DATA" | "NO_SIGNAL"
  interactions: number
  signaled: number
  signalRatePercent: number | null
  reasons: SignalReason[]
  concentration: { key: string; label: string; interactions: number; signaled: number; shareOfSignalPercent: number; signalRatePercent: number; othersSignalRatePercent: number } | null
}

export type SignalEvolution = {
  version: typeof SIGNAL_POPULATION_VERSION
  status: "AVAILABLE" | "INSUFFICIENT_DATA"
  previous: { interactions: number; signaled: number; signalRatePercent: number | null }
  current: { interactions: number; signaled: number; signalRatePercent: number | null }
  rows: { key: string; label: string; previousSignaled: number; currentSignaled: number; previousSharePercent: number | null; currentSharePercent: number | null; changePp: number | null }[]
  shifted: { key: string; label: string; previousSharePercent: number; currentSharePercent: number; changePp: number; currentSignaled: number } | null
}

const round1 = (value: number) => Math.round(value * 10) / 10
const percent = (part: number, total: number) => (total > 0 ? round1((part / total) * 100) : null)

/** Rótulo humano do sinal a partir do nome da flag (`rechamada` → "rechamada"; `nota_baixa` → "nota baixa"). */
export const signalLabelOf = (flagName: string) => flagName.replace(/[_-]+/g, " ").trim().toLocaleLowerCase("pt-BR")

export function signalDistributionOf(rows: readonly SignalRow[], flagName: string): SignalDistribution {
  const interactions = rows.reduce((sum, row) => sum + row.interactions, 0)
  const signaled = rows.reduce((sum, row) => sum + row.signaled, 0)
  const reasons: SignalReason[] = rows
    .map((row) => ({ key: row.key, label: row.label, interactions: row.interactions, signaled: row.signaled, signalRatePercent: percent(row.signaled, row.interactions), shareOfSignalPercent: percent(row.signaled, signaled) }))
    .sort((a, b) => b.signaled - a.signaled || b.interactions - a.interactions || a.label.localeCompare(b.label))
  const base = { version: SIGNAL_POPULATION_VERSION, signalLabel: signalLabelOf(flagName), interactions, signaled, signalRatePercent: percent(signaled, interactions), reasons }
  if (signaled === 0) return { ...base, status: "NO_SIGNAL", concentration: null }
  if (signaled < SIGNAL_MIN_FOR_DISTRIBUTION) return { ...base, status: "INSUFFICIENT_DATA", concentration: null }
  const top = reasons[0]!
  const othersInteractions = interactions - top.interactions
  const othersSignaled = signaled - top.signaled
  const topRate = top.interactions > 0 ? top.signaled / top.interactions : 0
  const othersRate = othersInteractions > 0 ? othersSignaled / othersInteractions : null
  const concentrated =
    top.signaled >= SIGNAL_CONCENTRATION_MIN_EVENTS &&
    top.signaled / signaled >= SIGNAL_CONCENTRATION_MIN_SHARE &&
    othersRate !== null &&
    (othersRate === 0 ? topRate > 0 : topRate >= othersRate * SIGNAL_CONCENTRATION_MIN_LIFT)
  if (!concentrated) return { ...base, status: "SPREAD", concentration: null }
  return {
    ...base,
    status: "CONCENTRATED",
    concentration: { key: top.key, label: top.label, interactions: top.interactions, signaled: top.signaled, shareOfSignalPercent: percent(top.signaled, signaled)!, signalRatePercent: percent(top.signaled, top.interactions)!, othersSignalRatePercent: percent(othersSignaled, othersInteractions)! },
  }
}

export function signalEvolutionOf(current: readonly SignalRow[], previous: readonly SignalRow[]): SignalEvolution {
  const total = (rows: readonly SignalRow[]) => ({ interactions: rows.reduce((sum, row) => sum + row.interactions, 0), signaled: rows.reduce((sum, row) => sum + row.signaled, 0) })
  const now = total(current)
  const before = total(previous)
  const keys = [...new Set([...current.map((row) => row.key), ...previous.map((row) => row.key)])]
  const rows = keys
    .map((key) => {
      const currentRow = current.find((row) => row.key === key)
      const previousRow = previous.find((row) => row.key === key)
      const currentShare = percent(currentRow?.signaled ?? 0, now.signaled)
      const previousShare = percent(previousRow?.signaled ?? 0, before.signaled)
      return { key, label: currentRow?.label ?? previousRow?.label ?? key, previousSignaled: previousRow?.signaled ?? 0, currentSignaled: currentRow?.signaled ?? 0, previousSharePercent: previousShare, currentSharePercent: currentShare, changePp: currentShare !== null && previousShare !== null ? round1(currentShare - previousShare) : null }
    })
    .filter((row) => row.previousSignaled > 0 || row.currentSignaled > 0)
    .sort((a, b) => b.currentSignaled - a.currentSignaled || b.previousSignaled - a.previousSignaled || a.label.localeCompare(b.label))
  const base = { version: SIGNAL_POPULATION_VERSION, previous: { ...before, signalRatePercent: percent(before.signaled, before.interactions) }, current: { ...now, signalRatePercent: percent(now.signaled, now.interactions) }, rows }
  const enough = now.interactions >= SIGNAL_EVOLUTION_MIN_INTERACTIONS && before.interactions >= SIGNAL_EVOLUTION_MIN_INTERACTIONS && now.signaled >= SIGNAL_EVOLUTION_MIN_EVENTS && before.signaled >= SIGNAL_EVOLUTION_MIN_EVENTS
  if (!enough) return { ...base, status: "INSUFFICIENT_DATA", shifted: null }
  const candidate = rows
    .filter((row) => row.changePp !== null && row.changePp >= SIGNAL_SHIFT_MIN_PP && row.currentSignaled >= SIGNAL_CONCENTRATION_MIN_EVENTS)
    .sort((a, b) => (b.changePp ?? 0) - (a.changePp ?? 0) || a.label.localeCompare(b.label))[0]
  return { ...base, status: "AVAILABLE", shifted: candidate ? { key: candidate.key, label: candidate.label, previousSharePercent: candidate.previousSharePercent!, currentSharePercent: candidate.currentSharePercent!, changePp: candidate.changePp!, currentSignaled: candidate.currentSignaled } : null }
}
