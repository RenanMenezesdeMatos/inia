/**
 * REGRAS ANALÍTICAS DA LIDERANÇA — o significado de "pior", "fora", "ofensor", "decil", "concentrado" e "comparável" em
 * UM lugar, puro e testado. Ferramentas do chat, a rota determinística e o cartão "Onde atuar hoje" chamam estas funções;
 * nenhuma tela ou prompt redefine os termos. Cada saída leva o texto do método (`ANALYTIC_METHODS`) para a resposta mostrar
 * a base de cálculo.
 *
 * O que NÃO está aqui de propósito (já tem dono e nunca é recalculado):
 *  - dentro/abaixo da referência: `isWithinReference` (performance-analytics/application/member-performance.ts);
 *  - quartil OFICIAL: vem da fonte (`employee_indicator_performance.quartile`);
 *  - consolidação em VALOR do indicador: camada operacional (Σ numerador ÷ Σ denominador, `combineWindowComponents`).
 */

/** Decil exige ao menos 10 pessoas ranqueadas — abaixo disso não existe "pior 10%" (nunca um D10 inventado). */
export const MINIMUM_DECILE_POPULATION = 10
/** Cobertura (pessoas com dado ÷ pessoas da estrutura) abaixo disso = dados incompletos para a competência. */
export const LOW_COVERAGE_THRESHOLD = 0.7
/** Unidade entra na leitura de concentração com ao menos 3 pessoas com referência avaliável. */
export const MINIMUM_CONCENTRATION_UNIT_POPULATION = 3
/** Unidade comparável com outras: ao menos 5 pessoas com referência avaliável. */
export const MINIMUM_COMPARABLE_POPULATION = 5
/** Unidade "de um Grupo" quando ao menos 80% das pessoas dela estão no mesmo Grupo (operação). */
export const DOMINANT_GROUP_SHARE = 0.8
/** Concentrado: o menor conjunto de unidades com ≥ 50% das pessoas fora… */
export const CONCENTRATION_SHARE_OF_DEVIATIONS = 0.5
/** …tem no máximo 1/3 das unidades… */
export const CONCENTRATION_MAX_UNIT_SHARE = 1 / 3
/** …e taxa de pessoas fora ≥ 1,5× a das demais unidades. */
export const CONCENTRATION_RATE_RATIO = 1.5
/** Disseminado: ≥ 2/3 das unidades com taxa de fora ≥ metade da taxa geral. */
export const DISSEMINATION_UNIT_SHARE = 2 / 3
export const DISSEMINATION_RATE_FACTOR = 0.5

export const ANALYTIC_METHODS = {
  reference:
    "Dentro/fora da meta: atingimento oficial ≥ 100% = dentro; sem atingimento, valor comparado à meta vigente pela direção do indicador. Pessoas sem dado ficam fora do denominador e são informadas à parte — sem dado nunca é desempenho ruim.",
  denominator: "% do time = pessoas fora (ou dentro) ÷ operadores ativos da estrutura com referência avaliável no indicador e na competência.",
  ranking: "Ranking pelo atingimento oficial (já ajustado à direção do indicador: maior ou menor é melhor). Empates dividem a mesma posição (1, 2, 2, 4); o nome só ordena a exibição.",
  officialQuartile: "Quartil oficial da fonte (Q1 = melhor 25%), com a população de referência definida pela fonte — a INIA não recalcula.",
  decile: `Decil calculado pela INIA dentro da estrutura analisada: D1 = melhores 10%, decil = arredondar para cima (10 × posição ÷ pessoas ranqueadas), empates no mesmo decil; exige ao menos ${MINIMUM_DECILE_POPULATION} pessoas ranqueadas.`,
  averageAchievement: "Atingimento médio = média simples dos atingimentos oficiais individuais (normalizados pela meta de cada pessoa). É uma leitura de apoio — não é o resultado da estrutura no indicador.",
  offender:
    "Ofensor tem dois sentidos, sempre separados: pior resultado (menor atingimento) e volume de desvios (participação da unidade no total de pessoas fora). Contribuição em valor para o resultado consolidado ainda não é calculada.",
  concentration: `Concentrado: o menor conjunto de unidades que soma ao menos 50% das pessoas fora tem no máximo 1/3 das unidades e taxa de fora ao menos 1,5× a das demais. Disseminado: ao menos 2/3 das unidades com taxa de fora ≥ metade da taxa geral. Considera unidades com ao menos ${MINIMUM_CONCENTRATION_UNIT_POPULATION} pessoas avaliáveis.`,
  comparability: `Unidades são comparadas entre si quando estão no mesmo Grupo (≥ 80% das pessoas), têm ao menos ${MINIMUM_COMPARABLE_POPULATION} pessoas com referência e cobertura ≥ 70%. Metas diferentes entre Subgrupos já estão normalizadas pelo atingimento.`,
  currentStructure: "A estrutura é a vigente hoje (quem está na equipe agora), aplicada também às competências anteriores.",
} as const

export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

// ---------------------------------------------------------------------------------------------
// Ranking e decis
// ---------------------------------------------------------------------------------------------

export type RankCandidate = { id: string; name: string; score: number }
export type RankedEntry = RankCandidate & { position: number }

/** Ranking de competição pelo score (maior = melhor): empatados dividem a posição (1, 2, 2, 4). */
export function competitionRanking(candidates: readonly RankCandidate[]): RankedEntry[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id))
  let position = 0
  return sorted.map((candidate, index) => {
    if (index === 0 || sorted[index - 1]!.score !== candidate.score) position = index + 1
    return { ...candidate, position }
  })
}

export const DECILES = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"] as const
export type Decile = (typeof DECILES)[number]

export function decileForPosition(position: number, total: number): Decile {
  const index = Math.min(10, Math.max(1, Math.ceil((10 * position) / total)))
  return DECILES[index - 1]!
}

export type DecileResult = {
  reason: "OK" | "INSUFFICIENT_POPULATION"
  rankedCount: number
  counts: Record<Decile, number>
  byId: Map<string, Decile>
}

export function assignDeciles(ranked: readonly RankedEntry[]): DecileResult {
  const counts = Object.fromEntries(DECILES.map((decile) => [decile, 0])) as Record<Decile, number>
  const byId = new Map<string, Decile>()
  if (ranked.length < MINIMUM_DECILE_POPULATION) return { reason: "INSUFFICIENT_POPULATION", rankedCount: ranked.length, counts, byId }
  for (const entry of ranked) {
    const decile = decileForPosition(entry.position, ranked.length)
    counts[decile] += 1
    byId.set(entry.id, decile)
  }
  return { reason: "OK", rankedCount: ranked.length, counts, byId }
}

// ---------------------------------------------------------------------------------------------
// Concentração × disseminação
// ---------------------------------------------------------------------------------------------

export type DeviationUnit = { key: string; label: string; withReference: number; below: number }
export type ConcentrationPattern = "CONCENTRATED" | "DISSEMINATED" | "MIXED" | "NONE" | "UNDETERMINED"
export type ConcentrationResult = {
  pattern: ConcentrationPattern
  /** Unidades que somam ao menos metade das pessoas fora (as de maior volume primeiro). */
  focusKeys: string[]
  overallRatePercent: number | null
  explanation: string
}

const rateOf = (units: readonly DeviationUnit[]) => {
  const withReference = units.reduce((sum, unit) => sum + unit.withReference, 0)
  return withReference === 0 ? 0 : units.reduce((sum, unit) => sum + unit.below, 0) / withReference
}
const formatRate = (rate: number) => `${(Math.round(rate * 1000) / 10).toLocaleString("pt-BR")}%`

export function evaluateConcentration(units: readonly DeviationUnit[]): ConcentrationResult {
  const eligible = units.filter((unit) => unit.withReference >= MINIMUM_CONCENTRATION_UNIT_POPULATION)
  if (eligible.length < 3) {
    return { pattern: "UNDETERMINED", focusKeys: [], overallRatePercent: null, explanation: `Não dá para dizer se está concentrado ou disseminado: há ${eligible.length} ${eligible.length === 1 ? "unidade" : "unidades"} com pelo menos ${MINIMUM_CONCENTRATION_UNIT_POPULATION} pessoas avaliáveis (mínimo 3).` }
  }
  const totalBelow = eligible.reduce((sum, unit) => sum + unit.below, 0)
  const overallRate = rateOf(eligible)
  if (totalBelow === 0) return { pattern: "NONE", focusKeys: [], overallRatePercent: 0, explanation: "Nenhuma pessoa fora da referência nas unidades avaliáveis." }

  const byVolume = [...eligible].sort((a, b) => b.below - a.below || b.below / b.withReference - a.below / a.withReference || a.label.localeCompare(b.label, "pt-BR"))
  const focus: DeviationUnit[] = []
  let accumulated = 0
  for (const unit of byVolume) {
    if (accumulated >= totalBelow * CONCENTRATION_SHARE_OF_DEVIATIONS) break
    focus.push(unit)
    accumulated += unit.below
  }
  const rest = eligible.filter((unit) => !focus.includes(unit))
  const focusRate = rateOf(focus)
  const restRate = rateOf(rest)
  const focusLabels = focus.map((unit) => unit.label).join(", ")
  const share = formatRate(accumulated / totalBelow)
  const concentrated = focus.length <= eligible.length * CONCENTRATION_MAX_UNIT_SHARE && (restRate === 0 ? focusRate > 0 : focusRate >= restRate * CONCENTRATION_RATE_RATIO)
  if (concentrated) {
    return { pattern: "CONCENTRATED", focusKeys: focus.map((unit) => unit.key), overallRatePercent: percentOf(totalBelow, eligible.reduce((s, u) => s + u.withReference, 0)), explanation: `Concentrado: ${focusLabels} ${focus.length === 1 ? "reúne" : "reúnem"} ${share} das pessoas fora (${focus.length} de ${eligible.length} unidades), com taxa de fora de ${formatRate(focusRate)} contra ${formatRate(restRate)} nas demais.` }
  }
  const widespread = eligible.filter((unit) => unit.below / unit.withReference >= overallRate * DISSEMINATION_RATE_FACTOR).length
  const overallRatePercent = percentOf(totalBelow, eligible.reduce((s, u) => s + u.withReference, 0))
  if (widespread >= eligible.length * DISSEMINATION_UNIT_SHARE) {
    return { pattern: "DISSEMINATED", focusKeys: focus.map((unit) => unit.key), overallRatePercent, explanation: `Disseminado: ${widespread} de ${eligible.length} unidades têm taxa de fora de pelo menos metade da taxa geral (${formatRate(overallRate)}).` }
  }
  return { pattern: "MIXED", focusKeys: focus.map((unit) => unit.key), overallRatePercent, explanation: `Misto: ${focusLabels} ${focus.length === 1 ? "reúne" : "reúnem"} ${share} das pessoas fora, mas o desvio também aparece em outras unidades (taxa geral ${formatRate(overallRate)}).` }
}

// ---------------------------------------------------------------------------------------------
// Comparabilidade
// ---------------------------------------------------------------------------------------------

export type ComparabilityInput = {
  key: string
  memberCount: number
  membersWithData: number
  withReference: number
  /** Grupo (operação) de cada membro — null para quem não tem Grupo. */
  memberTeams: { teamId: string | null; teamName: string | null }[]
}

export type ComparabilityResult = {
  comparable: boolean
  reasons: string[]
  dominantTeam: { teamId: string; teamName: string | null; share: number } | null
  coverage: number | null
}

export function dominantTeamOf(memberTeams: ComparabilityInput["memberTeams"]): ComparabilityResult["dominantTeam"] {
  if (memberTeams.length === 0) return null
  const counts = new Map<string, { teamName: string | null; count: number }>()
  for (const member of memberTeams) {
    if (!member.teamId) continue
    const entry = counts.get(member.teamId) ?? { teamName: member.teamName, count: 0 }
    entry.count += 1
    counts.set(member.teamId, entry)
  }
  const top = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || (a[1].teamName ?? "").localeCompare(b[1].teamName ?? "", "pt-BR"))[0]
  return top ? { teamId: top[0], teamName: top[1].teamName, share: top[1].count / memberTeams.length } : null
}

export function evaluateComparability(unit: ComparabilityInput): ComparabilityResult {
  const reasons: string[] = []
  const coverage = unit.memberCount > 0 ? unit.membersWithData / unit.memberCount : null
  const dominantTeam = dominantTeamOf(unit.memberTeams)
  if (unit.withReference < MINIMUM_COMPARABLE_POPULATION) reasons.push(`população pequena (${unit.withReference} ${unit.withReference === 1 ? "pessoa avaliável" : "pessoas avaliáveis"}; mínimo ${MINIMUM_COMPARABLE_POPULATION})`)
  if (coverage !== null && coverage < LOW_COVERAGE_THRESHOLD) reasons.push(`cobertura de ${formatRate(coverage)} (mínimo 70%)`)
  if (!dominantTeam || dominantTeam.share < DOMINANT_GROUP_SHARE) reasons.push("mistura operações (pessoas de Grupos diferentes)")
  return { comparable: reasons.length === 0, reasons, dominantTeam, coverage }
}

/**
 * Agrupa as unidades COMPARÁVEIS pelo Grupo dominante: só unidades do mesmo grupo de comparação devem ser postas lado a lado.
 * Mais de um grupo = a resposta precisa dizer que Grupos diferentes não se comparam diretamente.
 */
export function comparisonGroups(units: readonly { key: string; comparable: boolean; groupKey: string | null; groupLabel: string | null }[]): { groupKey: string; groupLabel: string | null; keys: string[] }[] {
  const groups = new Map<string, { groupKey: string; groupLabel: string | null; keys: string[] }>()
  for (const unit of units) {
    if (!unit.comparable || !unit.groupKey) continue
    const group = groups.get(unit.groupKey) ?? { groupKey: unit.groupKey, groupLabel: unit.groupLabel, keys: [] }
    group.keys.push(unit.key)
    groups.set(unit.groupKey, group)
  }
  return [...groups.values()].sort((a, b) => b.keys.length - a.keys.length || (a.groupLabel ?? "").localeCompare(b.groupLabel ?? "", "pt-BR"))
}

// ---------------------------------------------------------------------------------------------
// Texto livre do usuário → comparação tolerante (acentos, caixa)
// ---------------------------------------------------------------------------------------------

export function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
}

/** Todas as palavras da consulta aparecem (como início de palavra) no nome do candidato. */
export function matchesAllTokens(candidate: string, query: string): boolean {
  const words = normalizeForMatch(candidate).split(" ")
  const tokens = normalizeForMatch(query).split(" ").filter((token) => token.length > 0)
  return tokens.length > 0 && tokens.every((token) => words.some((word) => word.startsWith(token)))
}
