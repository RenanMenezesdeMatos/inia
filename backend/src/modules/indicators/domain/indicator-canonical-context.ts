import { evaluateAttainment } from "./evaluate-attainment.js"
import { formatIndicatorValue } from "./indicator-definition.js"

/**
 * CONTEXTO CANÔNICO DO INDICADOR (V1.5.12; fonte única desde a V1.5.12a): os números vêm do SISTEMA, nunca do LLM.
 *
 * Só o que existe de fato no domínio para UMA medição de indicador de UMA pessoa: valor da medição, período, meta vigente
 * da pessoa (pessoa > Subgrupo > Grupo), a comparação valor × meta × direção pela regra ÚNICA do domínio
 * (`evaluateAttainment`) e a DISTÂNCIA até a meta derivada dessa mesma comparação. Sem histórico, sem quartil, sem PRV,
 * sem peso, sem cobertura: esses não fazem parte desta medição e NÃO são inventados. Nada aqui é recalculado a partir de
 * texto de modelo.
 *
 * É a MESMA projeção consumida pelo contexto que "Chamar agente" entrega ao Agent (gatilho por Indicador) e pelo
 * adaptador do feedback confiável — o Agent e a validação nunca enxergam números diferentes.
 */
export const INDICATOR_CANONICAL_CONTEXT_CONTRACT = "INDICATOR_CANONICAL_CONTEXT_V1" as const

export type IndicatorDirection = "HIGHER" | "LOWER" | "TARGET"
/** OFFICIAL_CLOSURE (Indicator Diagnosis V1): a meta OFICIAL do fechamento do PRV (employee_indicator_performance), lida pronta. */
export type TargetSource = "PERSON" | "SUBTEAM" | "TEAM" | "OFFICIAL_CLOSURE"

export type IndicatorCanonicalContext = {
  contract: typeof INDICATOR_CANONICAL_CONTEXT_CONTRACT
  indicator: { id: string; code: string; name: string; unit: string; direction: IndicatorDirection }
  /** periodStart/periodEnd = datas LOCAIS da organização; periodEndAt = instante original do fim da medição (ISO). */
  measurement: { id: string; subjectId: string; value: number; periodStart: string; periodEnd: string; periodEndAt?: string; granularity: string | null }
  target: { value: number; source: TargetSource; goalId: string } | null
  /** `evaluateAttainment(valor, meta, direção)` — null sem meta. */
  withinTarget: boolean | null
  /** Posição NUMÉRICA do valor em relação à meta (independe de direção) — null sem meta. */
  position: "ABOVE" | "BELOW" | "EQUAL" | null
  /** Distância até a meta quando FORA dela (|valor − meta|), calculada pelo sistema; null dentro da meta ou sem meta. */
  gapToTarget: number | null
  /** `employee_indicator_performance` = fechamento oficial do PRV (valor, meta e dentro/fora da referência vindos da fonte oficial). */
  provenance: { source: "indicator_measurements+goals" | "employee_indicator_performance"; loadedAt: string }
}

/** Precisão fixa para a distância (evita 0,30000000000000004 em valores decimais). */
const roundGap = (value: number) => Math.round(value * 1e6) / 1e6

export function canonicalComparison(value: number, target: number | null, direction: IndicatorDirection): Pick<IndicatorCanonicalContext, "withinTarget" | "position" | "gapToTarget"> {
  if (target === null) return { withinTarget: null, position: null, gapToTarget: null }
  const withinTarget = evaluateAttainment(value, target, direction)
  return {
    withinTarget,
    position: value > target ? "ABOVE" : value < target ? "BELOW" : "EQUAL",
    gapToTarget: withinTarget === false ? roundGap(Math.abs(value - target)) : null,
  }
}

/**
 * Frase da distância até a meta — derivada SÓ da comparação canônica (a mesma regra de "dentro/fora da meta").
 * Substitui os antigos `computeGapText` paralelos (Chamar agente e contexto do chat), que podiam divergir da regra oficial.
 */
export function describeTargetGap(value: number, target: number | null, direction: IndicatorDirection | string, unit: string): string {
  const normalized: IndicatorDirection = direction === "LOWER" ? "LOWER" : direction === "TARGET" ? "TARGET" : "HIGHER"
  const comparison = canonicalComparison(value, target, normalized)
  if (comparison.withinTarget === null) return ""
  if (comparison.withinTarget || comparison.gapToTarget === null) return "Está dentro da meta."
  const gap = formatIndicatorValue(comparison.gapToTarget, unit)
  if (normalized === "LOWER") return `Precisa reduzir ${gap} para atingir a meta.`
  if (normalized === "HIGHER") return `Faltam ${gap} para atingir a meta.`
  return `Diferença de ${gap} em relação à meta.`
}

const DIRECTION_LABELS: Record<IndicatorDirection, string> = { HIGHER: "quanto maior, melhor", LOWER: "quanto menor, melhor", TARGET: "o objetivo é atingir a meta" }

/** "01/09/2026 a 30/09/2026" (ou uma data só). Nunca identificador. */
export function periodLabelOf(periodStart: string, periodEnd: string): string {
  const format = (iso: string) => {
    const [year, month, day] = iso.slice(0, 10).split("-")
    return year && month && day ? `${day}/${month}/${year}` : iso
  }
  const start = format(periodStart)
  const end = format(periodEnd)
  return start === end ? start : `${start} a ${end}`
}

/** Fatos canônicos EXIBÍVEIS (o que o colaborador e o redator podem ler) — todos do sistema. */
export function canonicalFactsOf(context: IndicatorCanonicalContext): { valueText: string; targetText: string | null; periodLabel: string; directionLabel: string; comparisonLabel: string | null } {
  const { unit } = context.indicator
  return {
    valueText: formatIndicatorValue(context.measurement.value, unit),
    targetText: context.target ? formatIndicatorValue(context.target.value, unit) : null,
    periodLabel: periodLabelOf(context.measurement.periodStart, context.measurement.periodEnd),
    directionLabel: DIRECTION_LABELS[context.indicator.direction],
    comparisonLabel: context.withinTarget === null ? null : context.withinTarget ? "dentro da meta" : "fora da meta",
  }
}

/** Contexto que "Chamar agente" entrega ao Agent numa medição de indicador — renderizado da MESMA projeção. */
export function renderIndicatorContextForAgent(context: IndicatorCanonicalContext): string {
  const facts = canonicalFactsOf(context)
  return [
    `Indicador: ${context.indicator.name} (${context.indicator.code})`,
    `Período: ${facts.periodLabel}`,
    `Valor medido: ${facts.valueText}`,
    `Meta vigente: ${facts.targetText ?? "não cadastrada para o período"}`,
    describeTargetGap(context.measurement.value, context.target?.value ?? null, context.indicator.direction, context.indicator.unit),
  ]
    .filter(Boolean)
    .join("\n")
}

/** Números que o texto PODE conter (e só estes): valor, meta, distância até a meta e os componentes das datas do período. */
export function allowedCanonicalNumbers(context: IndicatorCanonicalContext): number[] {
  const numbers = [context.measurement.value, ...(context.target ? [context.target.value] : []), ...(context.gapToTarget !== null && context.gapToTarget !== undefined ? [context.gapToTarget] : [])]
  const dateParts = [context.measurement.periodStart, context.measurement.periodEnd].flatMap((iso) => iso.slice(0, 10).split("-").map(Number))
  return [...numbers, ...dateParts].filter((value) => Number.isFinite(value))
}
