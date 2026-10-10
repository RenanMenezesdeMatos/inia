/**
 * QUARTIL OPERACIONAL — calculado pela INIA sobre valores operacionais de UMA população, UM
 * indicador, UMA janela e UMA agregação. Conceito explicitamente distinto do quartil OFICIAL
 * (`employee_*_performance.quartile`, persistido pela fonte corporativa, nunca recalculado).
 *
 * Regras (únicas no sistema — Ranking, QA Lab e futuros usos chamam esta função):
 *  - ordenação pela direção oficial: HIGHER → maior é melhor; LOWER → menor é melhor;
 *    TARGET → sem classificação (bloqueado até existir regra oficial clara);
 *  - Q1 = melhor 25% … Q4 = pior 25%, pela posição: quartil = ceil(4 × posição ÷ n);
 *  - empate = MESMA posição pra todos os empatados (ranking de competição: 1, 2, 2, 4) — dois
 *    colaboradores com o mesmo valor nunca caem em quartis diferentes; `employeeId` só ordena a
 *    lista de forma estável, nunca separa quartil;
 *  - população mínima: 4 colaboradores COM valor. Abaixo disso não existe "pior 25%" — ninguém
 *    é classificado (`quartile: null`, motivo INSUFFICIENT_POPULATION), nunca um Q4 inventado.
 * Quem não tem valor (SEM DADOS) fica fora da população ranqueada — nunca vira Q4 por omissão.
 */
export type OperationalQuartile = "Q1" | "Q2" | "Q3" | "Q4"
export const OPERATIONAL_QUARTILES: OperationalQuartile[] = ["Q1", "Q2", "Q3", "Q4"]
export const MINIMUM_QUARTILE_POPULATION = 4

export type QuartileCandidate = { employeeId: string; value: number }
export type QuartileAssignment = QuartileCandidate & { position: number; quartile: OperationalQuartile | null }
export type QuartileResult = {
  rankedCount: number
  assignments: QuartileAssignment[]
  reason: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED"
}

export function quartileForPosition(position: number, total: number): OperationalQuartile {
  const index = Math.min(4, Math.max(1, Math.ceil((4 * position) / total)))
  return OPERATIONAL_QUARTILES[index - 1]!
}

export function assignOperationalQuartiles(candidates: QuartileCandidate[], direction: "HIGHER" | "LOWER" | "TARGET"): QuartileResult {
  const rankedCount = candidates.length
  if (direction === "TARGET") {
    return { rankedCount, reason: "DIRECTION_UNSUPPORTED", assignments: candidates.map((candidate) => ({ ...candidate, position: 0, quartile: null })) }
  }
  const sorted = [...candidates].sort((a, b) => (direction === "HIGHER" ? b.value - a.value : a.value - b.value) || a.employeeId.localeCompare(b.employeeId))
  const insufficient = rankedCount < MINIMUM_QUARTILE_POPULATION
  const assignments: QuartileAssignment[] = []
  let position = 0
  sorted.forEach((candidate, index) => {
    const previous = sorted[index - 1]
    if (!previous || previous.value !== candidate.value) position = index + 1
    assignments.push({ ...candidate, position, quartile: insufficient ? null : quartileForPosition(position, rankedCount) })
  })
  return { rankedCount, reason: insufficient ? "INSUFFICIENT_POPULATION" : "OK", assignments }
}
