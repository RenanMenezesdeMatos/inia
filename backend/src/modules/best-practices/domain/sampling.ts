import { createHash } from "node:crypto"
import type { GroupKind, OperatorClassification } from "./comparison.js"

/**
 * CONTEXTOS e AMOSTRA (domínio puro, determinístico). A comparação só acontece DENTRO de um contexto (motivo, ou motivo › submotivo)
 * — chamadas de contextos diferentes nunca entram no mesmo número. Em cada contexto:
 *  - operador AVALIÁVEL = tem ao menos `minCallsPerOperator` chamadas com transcrição ali; com menos, entra como "poucas avaliações"
 *    (contado, nunca analisado — evita que uma ou duas chamadas decidam por alguém);
 *  - contexto ELEGÍVEL = ao menos `minOperatorsPerGroup` avaliáveis em CADA grupo;
 *  - amostra = até `maxCallsPerOperator` chamadas por operador (o teto impede que quem atende muito domine a análise), escolhidas
 *    por ordem reproduzível (hash da semente + chamada), nunca "as melhores".
 * A semente é a da requisição (indicador, competências, Grupo, nível): a mesma análise pedida de novo escolhe as mesmas chamadas.
 * O grupo vem do OPERADOR (quartil oficial do indicador) ou, pelo sinal (`BEST_PRACTICE_ANALYSIS_V3`), da própria CHAMADA (boa ×
 * ruim): o mesmo operador pode ter chamadas nos dois grupos, e os mínimos valem por grupo (operadores avaliáveis em cada um).
 */
export type ContextLevel = "REASON" | "SUB_REASON"

export type CallMeta = {
  ref: string
  operatorRef: string
  reason: string
  subReason: string | null
  channel: string | null
  occurredAt: Date
  durationSeconds: number | null
  hasTranscript: boolean
}
export type SampledCall = CallMeta & { group: GroupKind; cellKey: string }

export type SamplingParameters = {
  minCallsPerOperator: number
  minOperatorsPerGroup: number
  maxCallsPerOperator: number
  maxCells: number
  maxCallsPerAnalysis: number
  discoveryMaxCalls: number
  discoveryCallsPerTopOperator: number
}

export const DEFAULT_SAMPLING: SamplingParameters = {
  minCallsPerOperator: 2,
  minOperatorsPerGroup: 3,
  maxCallsPerOperator: 4,
  maxCells: 6,
  maxCallsPerAnalysis: 160,
  discoveryMaxCalls: 16,
  discoveryCallsPerTopOperator: 2,
}
/** Pisos do produto: a análise pode exigir MAIS, nunca menos (um operador ou uma chamada nunca bastam). */
export const SAMPLING_FLOORS = { minCallsPerOperator: 2, minOperatorsPerGroup: 3 } as const

export type GroupCellStats = { operators: number; evaluable: number; fewCalls: number; calls: number; transcribed: number; sampled: number; medianDurationSeconds: number | null }
export type CellStatus = "ELIGIBLE" | "INSUFFICIENT_DATA" | "NOT_ANALYZED_LIMIT"
export type CellPlan = {
  cellKey: string
  reason: string
  subReason: string | null
  status: CellStatus
  /** Por que não foi analisado (texto para a tela e o relatório). */
  note: string | null
  groups: Record<GroupKind, GroupCellStats>
}

export const NO_SUB_REASON = "(sem submotivo)"

export function cellKeyOf(level: ContextLevel, reason: string, subReason: string | null): string {
  return level === "REASON" ? reason.trim() : `${reason.trim()} › ${subReason?.trim() || NO_SUB_REASON}`
}

export function contextLabelOf(cell: { reason: string; subReason: string | null }): string {
  return cell.subReason ? `${cell.reason} › ${cell.subReason}` : cell.reason
}

export function samplingSeedOf(parts: readonly (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("|")).digest("hex").slice(0, 16)
}

const orderKey = (seed: string, ref: string) => createHash("sha256").update(`${seed}:${ref}`).digest("hex")

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

type CellAccumulator = { cellKey: string; reason: string; subReason: string | null; calls: Map<GroupKind, CallMeta[]> }

export function planSample(input: { calls: readonly CallMeta[]; classification?: ReadonlyMap<string, OperatorClassification>; groupOf?: (call: CallMeta) => GroupKind | null; level: ContextLevel; parameters: SamplingParameters; seed: string }): { cells: CellPlan[]; sample: SampledCall[]; discovery: SampledCall[] } {
  const groupOf = input.groupOf ?? ((call: CallMeta) => input.classification?.get(call.operatorRef)?.group ?? null)
  const parameters = { ...input.parameters, minCallsPerOperator: Math.max(input.parameters.minCallsPerOperator, SAMPLING_FLOORS.minCallsPerOperator), minOperatorsPerGroup: Math.max(input.parameters.minOperatorsPerGroup, SAMPLING_FLOORS.minOperatorsPerGroup) }
  const cells = new Map<string, CellAccumulator>()
  for (const call of input.calls) {
    const group = groupOf(call)
    if (!group) continue
    const cellKey = cellKeyOf(input.level, call.reason, call.subReason)
    const cell = cells.get(cellKey) ?? { cellKey, reason: call.reason.trim(), subReason: input.level === "REASON" ? null : call.subReason?.trim() || null, calls: new Map<GroupKind, CallMeta[]>() }
    cell.calls.set(group, [...(cell.calls.get(group) ?? []), call])
    cells.set(cellKey, cell)
  }

  // Por contexto e grupo: chamadas transcritas por operador em ordem reproduzível.
  const perOperator = (calls: readonly CallMeta[]) => {
    const map = new Map<string, CallMeta[]>()
    for (const call of calls.filter((item) => item.hasTranscript)) map.set(call.operatorRef, [...(map.get(call.operatorRef) ?? []), call])
    for (const list of map.values()) list.sort((a, b) => orderKey(input.seed, a.ref).localeCompare(orderKey(input.seed, b.ref)))
    return map
  }
  const plans: (CellPlan & { byOperator: Record<GroupKind, Map<string, CallMeta[]>> })[] = [...cells.values()].map((cell) => {
    const byOperator = { TOP: perOperator(cell.calls.get("TOP") ?? []), REFERENCE: perOperator(cell.calls.get("REFERENCE") ?? []) }
    const groupStats = (group: GroupKind): GroupCellStats => {
      const all = cell.calls.get(group) ?? []
      const operators = new Set(all.map((call) => call.operatorRef))
      const evaluable = [...byOperator[group].values()].filter((list) => list.length >= parameters.minCallsPerOperator).length
      return { operators: operators.size, evaluable, fewCalls: operators.size - evaluable, calls: all.length, transcribed: all.filter((call) => call.hasTranscript).length, sampled: 0, medianDurationSeconds: median(all.flatMap((call) => (call.durationSeconds === null ? [] : [call.durationSeconds]))) }
    }
    const groups = { TOP: groupStats("TOP"), REFERENCE: groupStats("REFERENCE") }
    const missing = (["TOP", "REFERENCE"] as const).filter((group) => groups[group].evaluable < parameters.minOperatorsPerGroup)
    const note = missing.length === 0 ? null : `Dados insuficientes: ${missing.map((group) => `${groups[group].evaluable} operador(es) ${group === "TOP" ? "com melhores resultados" : "de referência"} com ${parameters.minCallsPerOperator}+ chamadas transcritas (mínimo ${parameters.minOperatorsPerGroup})`).join("; ")}.`
    return { cellKey: cell.cellKey, reason: cell.reason, subReason: cell.subReason, status: missing.length === 0 ? "ELIGIBLE" : "INSUFFICIENT_DATA", note, groups, byOperator }
  })
  plans.sort((a, b) => b.groups.TOP.transcribed + b.groups.REFERENCE.transcribed - (a.groups.TOP.transcribed + a.groups.REFERENCE.transcribed) || a.cellKey.localeCompare(b.cellKey, "pt-BR"))
  let eligible = 0
  for (const plan of plans) {
    if (plan.status !== "ELIGIBLE") continue
    eligible += 1
    if (eligible > parameters.maxCells) {
      plan.status = "NOT_ANALYZED_LIMIT"
      plan.note = `Fora da análise pelo limite de ${parameters.maxCells} contextos por análise (contextos com mais chamadas primeiro).`
    }
  }

  // Teto por operador: começa no máximo e desce até o mínimo para caber no teto da análise; não cabendo, sai o contexto menor.
  const take = (plan: (typeof plans)[number], perOperatorCap: number) =>
    (["TOP", "REFERENCE"] as const).flatMap((group) => [...plan.byOperator[group].values()].filter((list) => list.length >= parameters.minCallsPerOperator).flatMap((list) => list.slice(0, perOperatorCap).map((call): SampledCall => ({ ...call, group, cellKey: plan.cellKey }))))
  const active = () => plans.filter((plan) => plan.status === "ELIGIBLE")
  let cap = parameters.maxCallsPerOperator
  let sample = active().flatMap((plan) => take(plan, cap))
  while (sample.length > parameters.maxCallsPerAnalysis && cap > parameters.minCallsPerOperator) {
    cap -= 1
    sample = active().flatMap((plan) => take(plan, cap))
  }
  while (sample.length > parameters.maxCallsPerAnalysis && active().length > 1) {
    const smallest = active().at(-1)!
    smallest.status = "NOT_ANALYZED_LIMIT"
    smallest.note = `Fora da análise pelo limite de ${parameters.maxCallsPerAnalysis} chamadas por análise.`
    sample = active().flatMap((plan) => take(plan, cap))
  }
  for (const plan of plans) for (const group of ["TOP", "REFERENCE"] as const) plan.groups[group].sampled = sample.filter((call) => call.cellKey === plan.cellKey && call.group === group).length

  // Descoberta (contrastiva): até N chamadas por operador com melhores resultados e 1 por operador de referência, por contexto,
  // intercaladas para caber no teto sem privilegiar um contexto.
  const discoveryTop: SampledCall[][] = []
  const discoveryReference: SampledCall[][] = []
  for (const plan of active()) {
    const own = sample.filter((call) => call.cellKey === plan.cellKey)
    const pick = (group: GroupKind, perOperator: number) => {
      const counts = new Map<string, number>()
      return own.filter((call) => {
        if (call.group !== group) return false
        const count = counts.get(call.operatorRef) ?? 0
        if (count >= perOperator) return false
        counts.set(call.operatorRef, count + 1)
        return true
      })
    }
    discoveryTop.push(pick("TOP", parameters.discoveryCallsPerTopOperator))
    discoveryReference.push(pick("REFERENCE", 1))
  }
  const interleave = (lists: SampledCall[][]) => {
    const out: SampledCall[] = []
    for (let index = 0; lists.some((list) => index < list.length); index += 1) for (const list of lists) if (index < list.length) out.push(list[index]!)
    return out
  }
  const topLimit = Math.ceil((parameters.discoveryMaxCalls * 2) / 3)
  const top = interleave(discoveryTop).slice(0, topLimit)
  const reference = interleave(discoveryReference).slice(0, parameters.discoveryMaxCalls - top.length)
  return { cells: plans.map((plan): CellPlan => ({ cellKey: plan.cellKey, reason: plan.reason, subReason: plan.subReason, status: plan.status, note: plan.note, groups: plan.groups })), sample, discovery: [...top, ...reference] }
}
