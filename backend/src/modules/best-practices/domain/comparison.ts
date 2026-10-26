import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"

/**
 * GRUPOS DA COMPARAÇÃO — quem tem os melhores resultados × grupo de referência, sempre pelo QUARTIL OFICIAL do indicador (nunca
 * recalculado; a direção de melhoria já está embutida no quartil do fechamento). Com várias competências, vale a MAIORIA ESTRITA
 * das competências em que a pessoa tem quartil; empate não classifica. Sem quartil oficial = fora da comparação (dado ausente nunca
 * é desempenho ruim, nem bom).
 *
 *   TOP_QUARTILE_VS_REST   — melhores = Q1 na maioria; referência = fora do Q1 na maioria (Q2–Q4).
 *   TOP_VS_BOTTOM_QUARTILE — melhores = Q1 na maioria; referência = Q4 na maioria (contraste maior, grupos menores).
 */
export type ComparisonMode = "TOP_QUARTILE_VS_REST" | "TOP_VS_BOTTOM_QUARTILE"
export const COMPARISON_MODES: readonly ComparisonMode[] = ["TOP_QUARTILE_VS_REST", "TOP_VS_BOTTOM_QUARTILE"]
export type GroupKind = "TOP" | "REFERENCE"

export type OperatorQuartile = { operatorRef: string; referencePeriod: string; quartile: Quartile | null }
export type ClassificationReason = "TOP_MAJORITY" | "REFERENCE_MAJORITY" | "NO_OFFICIAL_QUARTILE" | "TIE" | "MIDDLE_QUARTILES"
export type OperatorClassification = { operatorRef: string; group: GroupKind | null; reason: ClassificationReason; quartiles: { referencePeriod: string; quartile: Quartile }[] }

export const COMPARISON_LABELS: Record<ComparisonMode, { top: string; reference: string; method: string }> = {
  TOP_QUARTILE_VS_REST: {
    top: "Melhores resultados (1º quartil oficial)",
    reference: "Referência (demais quartis)",
    method: "Melhores resultados = 1º quartil oficial do indicador na maioria das competências analisadas; referência = demais operadores da mesma população (Grupo ou Subgrupo) com quartil oficial fora do 1º na maioria. Empate e quem não tem quartil oficial ficam fora.",
  },
  TOP_VS_BOTTOM_QUARTILE: {
    top: "Melhores resultados (1º quartil oficial)",
    reference: "Referência (4º quartil oficial)",
    method: "Melhores resultados = 1º quartil oficial do indicador na maioria das competências analisadas; referência = 4º quartil oficial na maioria. Quem fica no meio, empata ou não tem quartil oficial fica fora.",
  },
}

/** Pelo sinal da chamada (`BEST_PRACTICE_ANALYSIS_V3`): os grupos são de chamadas, pelo critério cadastrado no sinal. */
export function signalComparisonLabels(labels: { good: string; bad: string }): { top: string; reference: string; method: string } {
  return {
    top: `Chamadas com resultado bom (${labels.good})`,
    reference: `Chamadas com resultado ruim (${labels.bad})`,
    method: `Cada chamada entra pelo valor do sinal nela: boa = ${labels.good}; ruim = ${labels.bad}. Chamada sem o sinal ou com valor no meio fica fora (dado ausente não é resultado). O mesmo operador pode ter chamadas nos dois grupos; dentro de cada grupo, cada operador conta igual.`,
  }
}

export function classifyOperators(operatorRefs: readonly string[], rows: readonly OperatorQuartile[], mode: ComparisonMode): Map<string, OperatorClassification> {
  const byOperator = new Map<string, { referencePeriod: string; quartile: Quartile }[]>()
  for (const row of rows) {
    if (!row.quartile) continue
    const list = byOperator.get(row.operatorRef) ?? []
    if (!list.some((item) => item.referencePeriod === row.referencePeriod)) list.push({ referencePeriod: row.referencePeriod, quartile: row.quartile })
    byOperator.set(row.operatorRef, list)
  }
  const result = new Map<string, OperatorClassification>()
  for (const operatorRef of operatorRefs) {
    const quartiles = (byOperator.get(operatorRef) ?? []).sort((a, b) => a.referencePeriod.localeCompare(b.referencePeriod))
    const total = quartiles.length
    if (total === 0) {
      result.set(operatorRef, { operatorRef, group: null, reason: "NO_OFFICIAL_QUARTILE", quartiles })
      continue
    }
    const top = quartiles.filter((item) => item.quartile === "Q1").length
    const bottom = quartiles.filter((item) => item.quartile === "Q4").length
    const majority = (count: number) => count * 2 > total
    if (majority(top)) result.set(operatorRef, { operatorRef, group: "TOP", reason: "TOP_MAJORITY", quartiles })
    else if (mode === "TOP_QUARTILE_VS_REST" ? majority(total - top) : majority(bottom)) result.set(operatorRef, { operatorRef, group: "REFERENCE", reason: "REFERENCE_MAJORITY", quartiles })
    else result.set(operatorRef, { operatorRef, group: null, reason: mode === "TOP_VS_BOTTOM_QUARTILE" && top * 2 < total ? "MIDDLE_QUARTILES" : "TIE", quartiles })
  }
  return result
}
