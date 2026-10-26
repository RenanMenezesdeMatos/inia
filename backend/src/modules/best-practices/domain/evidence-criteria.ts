import type { GroupKind } from "./comparison.js"

/**
 * CRITÉRIOS DE EVIDÊNCIA (`BEST_PRACTICE_EVIDENCE_V1`) — o código decide, com números das codificações, se um comportamento é uma
 * ASSOCIAÇÃO sustentada num contexto. O modelo nunca dá número nem força. Tudo é por OPERADOR primeiro (taxa de cada operador nas
 * próprias chamadas em que a situação existiu; a frequência do grupo é a média dessas taxas), para que quem tem muitas chamadas não
 * pese mais que os outros.
 *
 *  - "com a situação" = codificado PRESENT ou ABSENT (NOT_APPLICABLE e UNCLEAR saem do denominador: não houve espera não é "não
 *    explicou a espera"; texto ambíguo não é ausência);
 *  - adota = o comportamento aparece em ≥ 50% das chamadas do operador com a situação;
 *  - consistência = parcela dos operadores com melhores resultados cuja taxa supera a média do grupo de referência;
 *  - concentração = um operador sozinho com mais da metade das ocorrências do grupo de melhores resultados.
 *
 * Desfechos: INSUFFICIENT_DATA (poucos operadores/chamadas com a situação), ISOLATED (uma chamada ou um operador), CONCENTRATED,
 * COMMON_TO_BOTH (≥ 80% nos dois grupos — tende a ser etapa padrão, não diferencial), MORE_FREQUENT_IN_REFERENCE, NO_DIFFERENCE,
 * WEAK_ASSOCIATION (diferença pequena ou poucos adotam) e SUPPORTED (força MODERATE ou STRONG). Só SUPPORTED vira padrão.
 */
export type CodingStatus = "PRESENT" | "ABSENT" | "NOT_APPLICABLE" | "UNCLEAR"
export type EvidenceStrength = "STRONG" | "MODERATE" | "WEAK" | "INSUFFICIENT"
export type CandidateOutcome = "SUPPORTED" | "WEAK_ASSOCIATION" | "NO_DIFFERENCE" | "MORE_FREQUENT_IN_REFERENCE" | "COMMON_TO_BOTH" | "ISOLATED" | "CONCENTRATED" | "INSUFFICIENT_DATA"

export type CodedCall = { callRef: string; operatorRef: string; group: GroupKind; status: CodingStatus }

export const EVIDENCE_THRESHOLDS = {
  minOperatorsApplicable: 3,
  minCallsApplicable: 6,
  adopterShare: 0.5,
  maxOperatorShareOfPresent: 0.5,
  commonShare: 0.8,
  noDifferencePp: 10,
  moderate: { minAdopters: 3, minDifferencePp: 20, minConsistency: 2 / 3, minPresentCalls: 4 },
  strong: { minOperatorsApplicable: 5, minCallsApplicable: 15, minAdopters: 4, minDifferencePp: 30 },
} as const

export type GroupStats = {
  operatorsSampled: number
  operatorsApplicable: number
  callsSampled: number
  callsApplicable: number
  callsPresent: number
  callsNotApplicable: number
  callsUnclear: number
  /** Média das taxas por operador (0–100), só operadores com a situação. */
  operatorRatePercent: number | null
  /** Ocorrências ÷ chamadas com a situação (0–100) — referência auxiliar, nunca o critério. */
  callRatePercent: number | null
  adopters: number
  operatorsWithPresence: number
  /** Maior parcela das ocorrências do grupo nas mãos de um operador (0–100). */
  topOperatorSharePercent: number | null
}
export type CriterionCheck = { key: string; label: string; met: boolean; value: string; level: "SUPPORT" | "STRONG" }
export type ContextAssessment = {
  outcome: CandidateOutcome
  strength: EvidenceStrength
  top: GroupStats
  reference: GroupStats
  differencePp: number | null
  consistencyPercent: number | null
  criteria: CriterionCheck[]
  explanation: string
}

const round1 = (value: number) => Math.round(value * 10) / 10

function statsOf(codings: readonly CodedCall[], group: GroupKind): { stats: GroupStats; rates: number[] } {
  const own = codings.filter((coding) => coding.group === group)
  const operators = new Map<string, { applicable: number; present: number }>()
  for (const coding of own) {
    const entry = operators.get(coding.operatorRef) ?? { applicable: 0, present: 0 }
    if (coding.status === "PRESENT" || coding.status === "ABSENT") entry.applicable += 1
    if (coding.status === "PRESENT") entry.present += 1
    operators.set(coding.operatorRef, entry)
  }
  const applicable = [...operators.values()].filter((entry) => entry.applicable > 0)
  const rates = applicable.map((entry) => entry.present / entry.applicable)
  const present = own.filter((coding) => coding.status === "PRESENT").length
  const callsApplicable = own.filter((coding) => coding.status === "PRESENT" || coding.status === "ABSENT").length
  const maxPresent = Math.max(0, ...[...operators.values()].map((entry) => entry.present))
  const stats: GroupStats = {
    operatorsSampled: operators.size,
    operatorsApplicable: applicable.length,
    callsSampled: own.length,
    callsApplicable,
    callsPresent: present,
    callsNotApplicable: own.filter((coding) => coding.status === "NOT_APPLICABLE").length,
    callsUnclear: own.filter((coding) => coding.status === "UNCLEAR").length,
    operatorRatePercent: rates.length > 0 ? round1((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 100) : null,
    callRatePercent: callsApplicable > 0 ? round1((present / callsApplicable) * 100) : null,
    adopters: applicable.filter((entry) => entry.present / entry.applicable >= EVIDENCE_THRESHOLDS.adopterShare).length,
    operatorsWithPresence: applicable.filter((entry) => entry.present > 0).length,
    topOperatorSharePercent: present > 0 ? round1((maxPresent / present) * 100) : null,
  }
  return { stats, rates }
}

const pct = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`)
const pp = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`)

export function assessCandidateInContext(codings: readonly CodedCall[], thresholds = EVIDENCE_THRESHOLDS): ContextAssessment {
  const { stats: top, rates: topRates } = statsOf(codings, "TOP")
  const { stats: reference } = statsOf(codings, "REFERENCE")
  const differencePp = top.operatorRatePercent !== null && reference.operatorRatePercent !== null ? round1(top.operatorRatePercent - reference.operatorRatePercent) : null
  const consistencyPercent = reference.operatorRatePercent !== null && topRates.length > 0 ? round1((topRates.filter((rate) => rate * 100 > reference.operatorRatePercent!).length / topRates.length) * 100) : null
  const enoughOperators = top.operatorsApplicable >= thresholds.minOperatorsApplicable && reference.operatorsApplicable >= thresholds.minOperatorsApplicable
  const enoughCalls = top.callsApplicable >= thresholds.minCallsApplicable && reference.callsApplicable >= thresholds.minCallsApplicable
  const notIsolated = top.callsPresent >= 2 && top.operatorsWithPresence >= 2
  const notConcentrated = top.topOperatorSharePercent === null || top.topOperatorSharePercent <= thresholds.maxOperatorShareOfPresent * 100
  const moderate = thresholds.moderate
  const strong = thresholds.strong
  const criteria: CriterionCheck[] = [
    { key: "OPERATORS", level: "SUPPORT", label: `≥ ${thresholds.minOperatorsApplicable} operadores com a situação em cada grupo`, met: enoughOperators, value: `${top.operatorsApplicable} × ${reference.operatorsApplicable}` },
    { key: "CALLS", level: "SUPPORT", label: `≥ ${thresholds.minCallsApplicable} chamadas com a situação em cada grupo`, met: enoughCalls, value: `${top.callsApplicable} × ${reference.callsApplicable}` },
    { key: "RECURRENCE", level: "SUPPORT", label: "Aparece em mais de uma chamada e mais de um operador do grupo de melhores resultados", met: notIsolated, value: `${top.callsPresent} chamada(s), ${top.operatorsWithPresence} operador(es)` },
    { key: "CONCENTRATION", level: "SUPPORT", label: "Nenhum operador concentra mais da metade das ocorrências", met: notConcentrated, value: top.topOperatorSharePercent === null ? "—" : `maior parcela: ${pct(top.topOperatorSharePercent)}` },
    { key: "ADOPTERS", level: "SUPPORT", label: `≥ ${moderate.minAdopters} operadores com melhores resultados adotam (em ≥ 50% das próprias chamadas)`, met: top.adopters >= moderate.minAdopters, value: `${top.adopters} de ${top.operatorsApplicable}` },
    { key: "DIFFERENCE", level: "SUPPORT", label: `Diferença ≥ ${moderate.minDifferencePp} p.p. (média por operador)`, met: differencePp !== null && differencePp >= moderate.minDifferencePp, value: `${pct(top.operatorRatePercent)} × ${pct(reference.operatorRatePercent)} (${pp(differencePp)})` },
    { key: "CONSISTENCY", level: "SUPPORT", label: "≥ 2/3 dos operadores com melhores resultados acima da média da referência", met: consistencyPercent !== null && consistencyPercent >= moderate.minConsistency * 100 - 0.05, value: pct(consistencyPercent) },
    { key: "STRONG_VOLUME", level: "STRONG", label: `Força alta: ≥ ${strong.minOperatorsApplicable} operadores e ≥ ${strong.minCallsApplicable} chamadas com a situação em cada grupo`, met: top.operatorsApplicable >= strong.minOperatorsApplicable && reference.operatorsApplicable >= strong.minOperatorsApplicable && top.callsApplicable >= strong.minCallsApplicable && reference.callsApplicable >= strong.minCallsApplicable, value: `${top.operatorsApplicable}/${top.callsApplicable} × ${reference.operatorsApplicable}/${reference.callsApplicable}` },
    { key: "STRONG_EFFECT", level: "STRONG", label: `Força alta: ≥ ${strong.minAdopters} adotam e diferença ≥ ${strong.minDifferencePp} p.p.`, met: top.adopters >= strong.minAdopters && differencePp !== null && differencePp >= strong.minDifferencePp, value: `${top.adopters} · ${pp(differencePp)}` },
  ]
  const result = (outcome: CandidateOutcome, strength: EvidenceStrength, explanation: string): ContextAssessment => ({ outcome, strength, top, reference, differencePp, consistencyPercent, criteria, explanation })

  if (!enoughOperators || !enoughCalls) return result("INSUFFICIENT_DATA", "INSUFFICIENT", `Dados insuficientes: ${top.operatorsApplicable} × ${reference.operatorsApplicable} operadores e ${top.callsApplicable} × ${reference.callsApplicable} chamadas em que a situação existiu (mínimo ${thresholds.minOperatorsApplicable} operadores e ${thresholds.minCallsApplicable} chamadas por grupo).`)
  if (top.callsPresent === 0 && reference.callsPresent === 0) return result("NO_DIFFERENCE", "INSUFFICIENT", "O comportamento não apareceu em nenhuma chamada analisada dos dois grupos.")
  if (top.callsPresent === 0) return result("NO_DIFFERENCE", "INSUFFICIENT", `Não apareceu nas chamadas do grupo de melhores resultados (${reference.callsPresent} ocorrência(s) na referência).`)
  if (!notIsolated) return result("ISOLATED", "INSUFFICIENT", `Ocorrência isolada no grupo de melhores resultados (${top.callsPresent} chamada(s), ${top.operatorsWithPresence} operador(es)) — uma frase ou uma chamada nunca vira padrão.`)
  if (!notConcentrated) return result("CONCENTRATED", "INSUFFICIENT", `Um único operador concentra ${pct(top.topOperatorSharePercent)} das ocorrências do grupo de melhores resultados.`)
  if ((top.operatorRatePercent ?? 0) >= thresholds.commonShare * 100 && (reference.operatorRatePercent ?? 0) >= thresholds.commonShare * 100) return result("COMMON_TO_BOTH", "INSUFFICIENT", `Frequente nos dois grupos (${pct(top.operatorRatePercent)} × ${pct(reference.operatorRatePercent)}) — tende a ser etapa comum, não diferencial.`)
  if (differencePp !== null && differencePp <= -thresholds.noDifferencePp) return result("MORE_FREQUENT_IN_REFERENCE", "INSUFFICIENT", `Mais frequente no grupo de referência (${pct(top.operatorRatePercent)} × ${pct(reference.operatorRatePercent)}).`)
  if (differencePp === null || differencePp < thresholds.noDifferencePp) return result("NO_DIFFERENCE", "INSUFFICIENT", `Sem diferença relevante entre os grupos (${pct(top.operatorRatePercent)} × ${pct(reference.operatorRatePercent)}).`)
  const supported = criteria.filter((criterion) => criterion.level === "SUPPORT").every((criterion) => criterion.met) && top.callsPresent >= moderate.minPresentCalls
  if (supported) {
    const isStrong = criteria.filter((criterion) => criterion.level === "STRONG").every((criterion) => criterion.met)
    return result("SUPPORTED", isStrong ? "STRONG" : "MODERATE", `Associação ${isStrong ? "forte" : "moderada"}: ${pct(top.operatorRatePercent)} das chamadas com a situação no grupo de melhores resultados × ${pct(reference.operatorRatePercent)} na referência (média por operador; ${top.adopters} de ${top.operatorsApplicable} operadores adotam).`)
  }
  return result("WEAK_ASSOCIATION", "WEAK", `Associação fraca: ${pct(top.operatorRatePercent)} × ${pct(reference.operatorRatePercent)}, sem cumprir todos os critérios de sustentação (${criteria.filter((criterion) => criterion.level === "SUPPORT" && !criterion.met).map((criterion) => criterion.label.toLowerCase()).join("; ") || "poucas ocorrências"}).`)
}

const STRENGTH_ORDER: Record<EvidenceStrength, number> = { STRONG: 3, MODERATE: 2, WEAK: 1, INSUFFICIENT: 0 }
export const strongestOf = (strengths: readonly EvidenceStrength[]): EvidenceStrength => strengths.reduce<EvidenceStrength>((best, item) => (STRENGTH_ORDER[item] > STRENGTH_ORDER[best] ? item : best), "INSUFFICIENT")
export const isRecommendableStrength = (strength: EvidenceStrength) => strength === "STRONG" || strength === "MODERATE"

export const OUTCOME_LABELS: Record<CandidateOutcome, string> = {
  SUPPORTED: "Associação sustentada",
  WEAK_ASSOCIATION: "Associação fraca",
  NO_DIFFERENCE: "Sem diferença entre os grupos",
  MORE_FREQUENT_IN_REFERENCE: "Mais frequente na referência",
  COMMON_TO_BOTH: "Comum aos dois grupos",
  ISOLATED: "Ocorrência isolada",
  CONCENTRATED: "Concentrado em um operador",
  INSUFFICIENT_DATA: "Dados insuficientes",
}
export const STRENGTH_LABELS: Record<EvidenceStrength, string> = { STRONG: "Forte", MODERATE: "Moderada", WEAK: "Fraca", INSUFFICIENT: "Insuficiente" }

/** Texto dos critérios para a tela e para a INIA ("Como calculamos"). */
export const EVIDENCE_METHOD = [
  "Comparação dentro do mesmo contexto (motivo/submotivo), população (Grupo ou Subgrupo) e período; contextos diferentes nunca entram no mesmo número.",
  "Cada operador conta igual: a frequência de um grupo é a média das taxas de cada operador nas próprias chamadas em que a situação existiu; no máximo 4 chamadas por operador e contexto entram na amostra.",
  "Chamadas em que a situação não ocorreu (ex.: não houve espera) ou em que o texto não permite decidir ficam fora do denominador.",
  "Associação sustentada (força moderada): ≥ 3 operadores e ≥ 6 chamadas com a situação em cada grupo, ≥ 3 operadores com melhores resultados adotam, diferença ≥ 20 p.p., ≥ 2/3 deles acima da média da referência e nenhum operador com mais da metade das ocorrências. Força forte: ≥ 5 operadores e ≥ 15 chamadas por grupo, ≥ 4 adotam e diferença ≥ 30 p.p.",
  "É associação observada, nunca causa: não mostra que o comportamento produz o resultado do indicador.",
] as const
