import type { CriterionStatus, VerifiedGuidance, VerifiedQuote } from "./call-analysis.js"
import type { ContractSteps, DiagnosticSignals, EffectiveCapabilities, ENGINE_INVESTIGATION_TOOLS_VERSION, INVESTIGATION_CLOSURE_VERSION, OpenQuestion, QuestionDisposition, QuestionStatus, ToolAvailability, ToolLedgerEntry } from "./investigation-toolbox.js"
import type { InvestigationSlice, SliceFilter, SliceOrigin } from "./investigation-slices.js"
import { INDICATOR_INVESTIGATION_LOGIC_VERSION } from "./versions.js"
import { argumentRequirementOf, type ArgumentRequirement } from "./feedback-brief.js"

/**
 * INVESTIGAÇÃO DE INDICADOR (domínio puro, determinístico — o modelo só entra na leitura das chamadas).
 *
 * O indicador oficial é FATO (valor, meta, direção, unidade nunca são reinterpretados). Queda é motivo para investigar, nunca
 * prova de erro. A investigação desce do agregado para o cenário:
 *   1. ONDE mudou — por assunto, com a métrica de chamada que acompanha a unidade (duração registrada para segundos, taxa do
 *      sinal para taxas, volume para contagens), período atual × anterior, separando efeito de COMPOSIÇÃO (mudou o mix de
 *      assuntos) de mudança DENTRO do cenário; por dia só com medição diária. Uma melhora geral não esconde o assunto que piorou.
 *   2. O QUE se observa nas chamadas do recorte — memória já analisada + novas análises (limitadas), com denominador por
 *      critério e inconclusivos à parte; amostra dirigida é rotulada como tal (nunca extrapolada para a equipe).
 *   3. O QUE a base orienta — os critérios são linhas da base; a prática recomendada nunca contraria o procedimento.
 *   4. O QUE o grupo de referência COMPARÁVEL faz — melhores no MESMO assunto e período (ou, sem métrica por assunto, a
 *      classificação geral, dita como tal); só agregados, com mínimos de privacidade.
 *   5. QUAL mudança concreta — só quando há padrão sustentado; senão a conclusão diz o que ficou sem suporte.
 * Associação não é causa: um desvio encontrado não "explica" sozinho a variação do indicador (limite sempre registrado).
 */
export type Direction = "HIGHER" | "LOWER" | "TARGET"
export type Movement = "IMPROVED" | "WORSENED" | "UNCHANGED"
export type ChangeDirection = "WORSE" | "BETTER" | "STABLE" | "UNKNOWN"
export type ProxyKind = "DURATION_SECONDS" | "SIGNAL_RATE" | "VOLUME"

export type OfficialFacts = {
  indicatorId: string
  code: string
  name: string
  unit: string
  direction: Direction
  sourceKind: "MEASUREMENT" | "OFFICIAL_CLOSING"
  sourceRef: string
  value: number
  target: number | null
  withinTarget: boolean | null
  gapToTarget: number | null
  periodStart: string
  /** Inclusivo (data local). */
  periodEnd: string
  periodLabel: string
  referencePeriod: string | null
  previous: { value: number; periodLabel: string; withinTarget: boolean | null } | null
  movement: Movement | null
  quartile: string | null
  previousQuartile: string | null
}

export type SegmentSample = { n: number; value: number }
export type SegmentComparison = {
  key: string
  label: string
  current: SegmentSample | null
  previous: SegmentSample | null
  shareCurrent: number
  sharePrevious: number
  withinContribution: number | null
  mixContribution: number | null
  change: number | null
  relativeChange: number | null
  changeDirection: ChangeDirection
  sufficient: boolean
}
export type FocusSegment = { key: string; label: string; reason: "DETERIORATED" | "HIDDEN_DETERIORATION" | "IMPROVED" }
export type Localization = {
  proxy: { kind: ProxyKind | null; label: string; description: string }
  windows: { current: { start: string; end: string; label: string }; previous: { start: string; end: string; label: string } }
  overall: { current: SegmentSample | null; previous: SegmentSample | null; change: number | null; direction: ChangeDirection }
  officialAgreement: "AGREES" | "DISAGREES" | "UNKNOWN"
  decomposition: { mixEffect: number; withinEffect: number; dominant: "MIX" | "WITHIN" | "BALANCED" } | null
  segments: SegmentComparison[]
  daily: { available: boolean; points: { date: string; value: number }[]; outliers: { date: string; value: number; robustZ: number }[]; weekdays: { weekday: number; label: string; mean: number; n: number }[]; /** Mediana dos dias do período (a base com que o dia fora do padrão é comparado). */ median?: number }
  focus: FocusSegment[]
  limitations: string[]
}

const STABLE_THRESHOLD = 0.05
const MATERIAL_SEGMENT_CHANGE = 0.1

export function changeDirectionOf(previous: number | null, current: number | null, direction: Direction): ChangeDirection {
  if (previous === null || current === null || direction === "TARGET") return "UNKNOWN"
  const base = Math.abs(previous) > 0 ? Math.abs(previous) : 1
  const relative = (current - previous) / base
  if (Math.abs(relative) < STABLE_THRESHOLD) return "STABLE"
  const increased = current > previous
  return (direction === "LOWER" ? increased : !increased) ? "WORSE" : "BETTER"
}

export type SegmentInput = { key: string; label: string; current: SegmentSample | null; previous: SegmentSample | null }
/** Volume mínimo de chamadas em CADA período para comparar o agregado. */
export const minimumOverallOf = (minimumPerSegment: number) => Math.max(minimumPerSegment * 3, 10)

/**
 * Comparação por segmento + decomposição (aproximada) da variação da métrica agregada em COMPOSIÇÃO e DENTRO do segmento:
 *   mix_i    = (w1_i − w0_i) · (m0_i − M0)     (o peso do assunto mudou; só conta se o assunto difere da média)
 *   within_i = w1_i · (m1_i − m0_i)            (o assunto mudou por dentro)
 * Assunto sem período anterior entra só como composição. Volume (contagem) não tem decomposição.
 */
export function compareSegments(inputs: readonly SegmentInput[], direction: Direction, proxy: ProxyKind, minimumPerSegment: number): { segments: SegmentComparison[]; overall: Localization["overall"]; decomposition: Localization["decomposition"] } {
  const totalCurrent = inputs.reduce((sum, entry) => sum + (entry.current?.n ?? 0), 0)
  const totalPrevious = inputs.reduce((sum, entry) => sum + (entry.previous?.n ?? 0), 0)
  const weighted = (side: "current" | "previous", total: number) => (total > 0 ? inputs.reduce((sum, entry) => sum + (entry[side] ? entry[side]!.n * entry[side]!.value : 0), 0) / total : null)
  const overallCurrent = proxy === "VOLUME" ? totalCurrent : weighted("current", totalCurrent)
  const overallPrevious = proxy === "VOLUME" ? totalPrevious : weighted("previous", totalPrevious)
  let mixEffect = 0
  let withinEffect = 0
  const segments = inputs.map((entry): SegmentComparison => {
    const shareCurrent = totalCurrent > 0 ? (entry.current?.n ?? 0) / totalCurrent : 0
    const sharePrevious = totalPrevious > 0 ? (entry.previous?.n ?? 0) / totalPrevious : 0
    const currentValue = proxy === "VOLUME" ? entry.current?.n ?? 0 : entry.current?.value ?? null
    const previousValue = proxy === "VOLUME" ? entry.previous?.n ?? 0 : entry.previous?.value ?? null
    const change = currentValue !== null && previousValue !== null ? currentValue - previousValue : null
    const relativeChange = change !== null && previousValue !== null && previousValue !== 0 ? change / Math.abs(previousValue) : null
    let within: number | null = null
    let mix: number | null = null
    if (proxy !== "VOLUME" && overallPrevious !== null) {
      if (entry.current && entry.previous) {
        within = shareCurrent * (entry.current.value - entry.previous.value)
        mix = (shareCurrent - sharePrevious) * (entry.previous.value - overallPrevious)
      } else if (entry.current) {
        mix = shareCurrent * (entry.current.value - overallPrevious)
      } else if (entry.previous) {
        mix = -sharePrevious * (entry.previous.value - overallPrevious)
      }
      withinEffect += within ?? 0
      mixEffect += mix ?? 0
    }
    const sufficient = (entry.current?.n ?? 0) >= minimumPerSegment && (entry.previous?.n ?? 0) >= minimumPerSegment
    return { key: entry.key, label: entry.label, current: entry.current, previous: entry.previous, shareCurrent, sharePrevious, withinContribution: within, mixContribution: mix, change, relativeChange, changeDirection: sufficient ? changeDirectionOf(previousValue, currentValue, direction) : "UNKNOWN", sufficient }
  })
  const overallChange = overallCurrent !== null && overallPrevious !== null ? overallCurrent - overallPrevious : null
  // Comparar o agregado exige volume nos DOIS períodos; sem ele não há decomposição (nunca uma "variação" de 1 chamada).
  const comparable = totalCurrent >= minimumOverallOf(minimumPerSegment) && totalPrevious >= minimumOverallOf(minimumPerSegment)
  const decomposition = proxy === "VOLUME" || overallChange === null || !comparable
    ? null
    : { mixEffect, withinEffect, dominant: (Math.abs(mixEffect) > 2 * Math.abs(withinEffect) ? "MIX" : Math.abs(withinEffect) > 2 * Math.abs(mixEffect) ? "WITHIN" : "BALANCED") as "MIX" | "WITHIN" | "BALANCED" }
  return {
    segments: segments.sort((a, b) => Math.abs(b.withinContribution ?? b.change ?? 0) - Math.abs(a.withinContribution ?? a.change ?? 0)),
    overall: { current: overallCurrent === null ? null : { n: totalCurrent, value: overallCurrent }, previous: overallPrevious === null ? null : { n: totalPrevious, value: overallPrevious }, change: overallChange, direction: comparable ? changeDirectionOf(overallPrevious, overallCurrent, direction) : "UNKNOWN" },
    decomposition,
  }
}

/**
 * Onde olhar: até DOIS assuntos. Pior material primeiro (mesmo quando o geral melhorou — piora escondida); com resultado bom e
 * nenhum assunto piorando, o que mais melhorou (reconhecimento). Só assuntos com dados suficientes nos dois períodos.
 */
export function selectFocusSegments(segments: readonly SegmentComparison[], official: Pick<OfficialFacts, "withinTarget" | "movement">, overallDirection: ChangeDirection): FocusSegment[] {
  // Base ZERO (`ZERO_BASELINE_MATERIALITY_V1`, 06/10/2026): a variação relativa não existe quando o período anterior é 0 — uma taxa de
  // chamadas sinalizadas que sai de 0% (ex.: nenhuma nota ≤ 2 em agosto, 4 de 6 em setembro) é a mudança mais forte possível, não "sem
  // mudança material". Com volume suficiente nos dois períodos, qualquer variação a partir de zero é material.
  const material = (segment: SegmentComparison) => segment.sufficient && (segment.relativeChange !== null ? Math.abs(segment.relativeChange) >= MATERIAL_SEGMENT_CHANGE : segment.change !== null && segment.change !== 0)
  const adverse = segments.filter((segment) => material(segment) && segment.changeDirection === "WORSE")
  const favorable = segments.filter((segment) => material(segment) && segment.changeDirection === "BETTER")
  const overallGood = official.movement === "IMPROVED" || overallDirection === "BETTER" || official.withinTarget === true
  const focus: FocusSegment[] = adverse.slice(0, 2).map((segment) => ({ key: segment.key, label: segment.label, reason: overallGood ? "HIDDEN_DETERIORATION" : "DETERIORATED" }))
  if (focus.length === 0 && overallGood && favorable[0]) focus.push({ key: favorable[0].key, label: favorable[0].label, reason: "IMPROVED" })
  return focus
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"]
/** Dias fora do padrão da própria pessoa (mediana + MAD) e perfil por dia da semana — só com medição DIÁRIA. */
export function dailyProfileOf(points: readonly { date: string; value: number }[], direction: Direction): Localization["daily"] {
  if (points.length < 5) return { available: points.length > 0, points: [...points], outliers: [], weekdays: [] }
  const values = points.map((point) => point.value).sort((a, b) => a - b)
  const median = values[Math.floor(values.length / 2)]!
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
  const mad = deviations[Math.floor(deviations.length / 2)]! * 1.4826 || Math.max(Math.abs(median) * 0.02, 1e-9)
  const outliers = points
    .map((point) => ({ ...point, robustZ: (point.value - median) / mad }))
    .filter((point) => Math.abs(point.robustZ) >= 2.5 && (direction === "LOWER" ? point.robustZ > 0 : direction === "HIGHER" ? point.robustZ < 0 : true))
    .sort((a, b) => Math.abs(b.robustZ) - Math.abs(a.robustZ))
    .slice(0, 3)
  const byWeekday = new Map<number, number[]>()
  for (const point of points) {
    const weekday = new Date(`${point.date}T12:00:00Z`).getUTCDay()
    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), point.value])
  }
  const weekdays = [...byWeekday.entries()].filter(([, list]) => list.length >= 2).map(([weekday, list]) => ({ weekday, label: WEEKDAYS[weekday]!, mean: list.reduce((sum, value) => sum + value, 0) / list.length, n: list.length })).sort((a, b) => a.weekday - b.weekday)
  return { available: true, points: [...points], outliers, weekdays, median }
}

// ---------------------------------------------------------------------------------------------
// Evidência nas chamadas (memória)
// ---------------------------------------------------------------------------------------------
export type MemoryRow = {
  interactionId: string
  personId: string
  criterionKey: string
  /**
   * `PRACTICE_ANCHOR_V1`: identidade da LINHA-ÂNCORA da obrigação (a primeira linha da regra na ordem do documento, pela identidade
   * de linha da base). Cada análise junta as linhas de uma obrigação do seu jeito ("validar o titular" + CPF; + nome completo…) e a
   * identidade da obrigação muda junto — a mesma prática ficava espalhada e nenhuma chegava ao mínimo (carga de 40 chamadas: 0
   * práticas). A âncora é a mesma entre análises e é identidade da BASE, nunca semelhança de texto. Ausente = `criterionKey`.
   * `PRACTICE_IDENTITY_V1`: quando a linha-âncora já foi organizada, a chave é a da PRÁTICA (KP-…) — a mesma conduta em outra linha,
   * seção, documento ou argumentário cai na mesma chave.
   */
  practiceKey?: string
  /** Título da prática (rótulo escrito pelo modelo ao organizar a base — nunca evidência; a regra literal continua em `text`). */
  practiceTitle?: string
  documentId: string
  documentTitle: string
  heading: string | null
  text: string
  status: CriterionStatus
  localDate: string
  evidence: VerifiedQuote[]
  rationale: string | null
  guidance: VerifiedGuidance | null
  materiality: "HIGH" | "MEDIUM" | "LOW" | null
  /** A chamada foi avaliada pela regra ATUAL (não havia versão vigente na data): leitura para orientar daqui para frente, nunca culpa histórica. */
  reevaluation?: boolean
  /** Critério vindo de ARGUMENTÁRIO (documentId = id do argumentário; nunca vira material da base). */
  sourceKind?: "ARGUMENT_SCRIPT"
  /** `PRODUCT_IN_FEEDBACK_V1`: o produto ESTABELECIDO da solicitação a que esta avaliação se refere (nome do cadastro); ausente = não estabelecido. */
  product?: string
  /** Os produtos a que a regra avaliada vale ("Vale para"); ausente = regra geral. */
  ruleScope?: string[]
  /** Item de argumentário avaliado (script, versão, campo, deve/pode) — a fala sugerida é a DESSA versão. */
  argument?: MemoryArgument
  /** Quando a chamada aconteceu (ISO) — para ler o argumentário em vigor nela. */
  occurredAt?: string
}
export type MemoryArgument = { scriptId: string; version: number | null; field: string | null; modality: string | null }
export type CriterionPattern = {
  criterionKey: string
  sourceKind?: "ARGUMENT_SCRIPT"
  documentId: string
  documentTitle: string
  heading: string | null
  text: string
  /** Chamadas em que a etapa se aplicava e foi observável (cumpriu, não cumpriu, parcial) — o denominador. */
  eligible: number
  met: number
  notMet: number
  partial: number
  inconclusive: number
  notApplicable: number
  classification: "DEVELOPMENT_PATTERN" | "STRENGTH_PATTERN" | "ISOLATED_DEVIATION" | "NONE"
  /** A regra usada nessas avaliações ainda está na base publicada HOJE? (a orientação segue a regra atual; avaliação histórica
   * continua valendo como leitura da época, mas não vira orientação se a regra mudou). */
  currentRule?: "IN_FORCE" | "CHANGED" | "UNKNOWN"
  /** Avaliações feitas pela regra ATUAL publicada depois das chamadas (reavaliação): orientam daqui para frente, não explicam o resultado da época. */
  reevaluated?: number
  /** `PATTERN_EXAMPLE_CONTEXT_V1` (22/10/2026): cada exemplo leva os produtos da chamada e a REGRA avaliada nela — num padrão que junta
   * chamadas de produtos diferentes, a fala de uma chamada nunca pode ser lida contra a regra de outra (no TMA da Larissa, a fala do
   * prazo da Banda Larga, certa, saiu no texto como erro do IP Dedicado). Investigações gravadas antes não têm os campos. */
  examples: { interactionId: string; localDate: string; quote: VerifiedQuote | null; rationale: string | null; guidance: VerifiedGuidance | null; /** V19: o produto da SOLICITAÇÃO (não todos os da chamada). */ product?: string; rule?: PracticeRule; argument?: MemoryArgument; occurredAt?: string }[]
  /** `PRODUCT_IN_FEEDBACK_V1`: os produtos estabelecidos nas chamadas avaliadas desta prática (comparação com os colegas por produto). */
  products?: string[]
  /** `PRACTICE_IDENTITY_V1`: título da prática (rótulo — a regra literal continua em `text`/`memberRules`). */
  practiceTitle?: string
  /** As regras (literais) da prática que aparecem nestas avaliações — a mesma conduta pode vir de mais de uma linha ou fonte. */
  memberRules?: PracticeRule[]
}
/** `PRODUCT_IN_FEEDBACK_V1`: a regra leva o "Vale para" (`appliesTo`), o "evitar" e o "deve/pode" do argumentário — a mesma marcação da monitoria. */
export type PracticeRule = { documentId: string; documentTitle: string; heading: string | null; text: string; sourceKind?: "ARGUMENT_SCRIPT"; appliesTo?: string[]; avoid?: boolean; requirement?: ArgumentRequirement }
/** A regra avaliada numa linha da memória, com o "Vale para", o "evitar" e o "deve/pode" dela. */
export function practiceRuleOf(row: MemoryRow): PracticeRule {
  const requirement = argumentRequirementOf(row.argument?.field ? { field: row.argument.field, modality: row.argument.modality } : null)
  return {
    documentId: row.documentId, documentTitle: row.documentTitle, heading: row.heading, text: row.text,
    ...(row.sourceKind ? { sourceKind: row.sourceKind } : {}),
    ...((row.ruleScope ?? []).length > 0 ? { appliesTo: row.ruleScope! } : {}),
    ...(row.argument?.field === "AVOID" ? { avoid: true } : {}),
    ...(requirement ? { requirement } : {}),
  }
}
export const PATTERN_MINIMUM_ELIGIBLE = 3
export const PATTERN_EXAMPLE_CONTEXT_VERSION = "PATTERN_EXAMPLE_CONTEXT_V1" as const

export const PRACTICE_ANCHOR_VERSION = "PRACTICE_ANCHOR_V1" as const
/** Chave de agregação de padrões e práticas: a linha-âncora da base (`PRACTICE_ANCHOR_V1`); sem ela, a identidade da obrigação. */
export const practiceKeyOf = (row: Pick<MemoryRow, "practiceKey" | "criterionKey">) => row.practiceKey ?? row.criterionKey

/** Texto mais frequente de um grupo (empate = o primeiro): a mesma prática aparece com recortes diferentes da regra entre análises. */
const modalTextOf = (rows: readonly MemoryRow[]) => {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.text, (counts.get(row.text) ?? 0) + 1)
  const best = [...counts.entries()].reduce((winner, entry) => (entry[1] > winner[1] ? entry : winner))
  return rows.find((row) => row.text === best[0])!
}

/** Regras distintas (literais) de um grupo, das mais avaliadas para as menos — até três. */
const memberRulesOf = (rows: readonly MemoryRow[]): PracticeRule[] => {
  const counts = new Map<string, { rule: PracticeRule; count: number }>()
  for (const row of rows) {
    const key = `${row.documentId}|${row.heading ?? ""}|${row.text}|${(row.ruleScope ?? []).join(",")}`
    const entry = counts.get(key) ?? { rule: practiceRuleOf(row), count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3).map((entry) => entry.rule)
}
const practiceTitleOfRows = (rows: readonly MemoryRow[]) => rows.find((row) => row.practiceTitle)?.practiceTitle
/** Produtos estabelecidos nas avaliações de uma prática, sem repetir (as que não têm produto não entram). */
const productsOfRows = (rows: readonly MemoryRow[]) => [...new Set(rows.flatMap((row) => (row.product ? [row.product] : [])))]
/**
 * `CURRENT_PRACTICE_TITLE_V1` (06/10/2026): o nome da prática é RÓTULO, não evidência — vale o atual do catálogo. A investigação
 * guardada carrega o nome da época e é reaproveitada; sem isto, um nome corrigido depois (ou generalizado quando outra regra entrou na
 * prática) nunca chegava ao retorno. Contagens, regras e evidência ficam como foram apurados.
 */
export function withCurrentPracticeTitles(investigation: IndicatorInvestigation, titles: ReadonlyMap<string, string>): IndicatorInvestigation {
  if (titles.size === 0) return investigation
  const retitle = <T extends { criterionKey: string; practiceTitle?: string }>(entry: T): T => {
    const title = titles.get(entry.criterionKey)
    return title && entry.practiceTitle && title !== entry.practiceTitle ? { ...entry, practiceTitle: title } : entry
  }
  return {
    ...investigation,
    evidence: investigation.evidence.map((entry) => ({ ...entry, patterns: entry.patterns.map(retitle) })),
    ...(investigation.reference ? { reference: { ...investigation.reference, practices: investigation.reference.practices.map(retitle) } } : {}),
  }
}


const STATUS_WEIGHT: Record<string, number> = { NOT_MET: 4, PARTIAL: 3, MET: 2 }
/**
 * Uma leitura por CHAMADA em cada prática: com a âncora, duas obrigações da mesma análise podem cair na mesma prática, e as contagens
 * são "em X de Y chamadas". Fica a leitura mais grave (não cumprida > parcial > cumprida > inconclusiva) — nunca a mais favorável.
 */
export function onePerInteraction(rows: readonly MemoryRow[]): MemoryRow[] {
  const byInteraction = new Map<string, MemoryRow>()
  for (const row of rows) {
    const current = byInteraction.get(row.interactionId)
    if (!current || (STATUS_WEIGHT[row.status] ?? 0) > (STATUS_WEIGHT[current.status] ?? 0)) byInteraction.set(row.interactionId, row)
  }
  return [...byInteraction.values()]
}

export function criterionPatternsOf(rows: readonly MemoryRow[]): CriterionPattern[] {
  const byKey = new Map<string, MemoryRow[]>()
  for (const row of rows) byKey.set(practiceKeyOf(row), [...(byKey.get(practiceKeyOf(row)) ?? []), row])
  return [...byKey.values()].map((all): CriterionPattern => {
    const group = onePerInteraction(all)
    const count = (statuses: readonly CriterionStatus[]) => group.filter((row) => statuses.includes(row.status)).length
    const met = count(["MET"])
    const notMet = count(["NOT_MET"])
    const partial = count(["PARTIAL"])
    const eligible = met + notMet + partial
    const deviations = notMet + partial
    const classification: CriterionPattern["classification"] =
      eligible >= PATTERN_MINIMUM_ELIGIBLE && deviations >= 2 && deviations / eligible >= 0.5 ? "DEVELOPMENT_PATTERN"
      : eligible >= PATTERN_MINIMUM_ELIGIBLE && met / eligible >= 0.8 ? "STRENGTH_PATTERN"
      : deviations > 0 ? "ISOLATED_DEVIATION"
      : "NONE"
    const exampleRows = group.filter((row) => (classification === "STRENGTH_PATTERN" ? row.status === "MET" : row.status === "NOT_MET" || row.status === "PARTIAL"))
    const first = modalTextOf(group.filter((row) => STATUS_WEIGHT[row.status]).length > 0 ? group.filter((row) => STATUS_WEIGHT[row.status]) : group)
    return {
      criterionKey: practiceKeyOf(first),
      ...(first.sourceKind ? { sourceKind: first.sourceKind } : {}),
      documentId: first.documentId,
      documentTitle: first.documentTitle,
      heading: first.heading,
      text: first.text,
      eligible,
      met,
      notMet,
      partial,
      inconclusive: count(["NOT_OBSERVABLE", "NOT_ASSESSED"]),
      notApplicable: count(["NOT_APPLICABLE"]),
      classification,
      reevaluated: group.filter((row) => row.reevaluation && (row.status === "MET" || row.status === "NOT_MET" || row.status === "PARTIAL")).length,
      ...(practiceTitleOfRows(all) ? { practiceTitle: practiceTitleOfRows(all)! } : {}),
      ...(memberRulesOf(group).length > 1 ? { memberRules: memberRulesOf(group) } : {}),
      ...(productsOfRows(group).length > 0 ? { products: productsOfRows(group) } : {}),
      examples: exampleRows.slice(0, 3).map((row) => ({ interactionId: row.interactionId, localDate: row.localDate, quote: row.evidence.find((quote) => /OPERADOR|ATENDENTE|AGENTE/i.test(quote.speaker ?? "")) ?? row.evidence[0] ?? null, rationale: row.rationale, guidance: row.guidance, ...(row.product ? { product: row.product } : {}), rule: practiceRuleOf(row), ...(row.argument ? { argument: row.argument } : {}), ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}) })),
    }
  }).sort((a, b) => (b.notMet + b.partial) / Math.max(b.eligible, 1) - (a.notMet + a.partial) / Math.max(a.eligible, 1) || b.eligible - a.eligible)
}

/**
 * `PATTERN_CONFIRMATION_V1` (rodada real V14): no assunto que PIOROU, uma etapa que falhou em toda (ou na maior parte da) amostra mas
 * com chamadas aplicáveis abaixo do mínimo de padrão é uma pergunta em aberto — "isso se repete?" —, nunca "desvio isolado". Na V14 o
 * planejador analisou 3 de 11 contestações e "prazo" falhou em 2 de 2 aplicáveis: virou "nenhum desvio recorrente". Esses candidatos
 * pedem MAIS chamadas do mesmo assunto (dentro do orçamento da estratégia) antes de concluir; a decisão de padrão continua a mesma.
 */
export const PATTERN_CONFIRMATION_VERSION = "PATTERN_CONFIRMATION_V1" as const
export function patternConfirmationCandidatesOf(patterns: readonly CriterionPattern[]): CriterionPattern[] {
  return patterns.filter((pattern) => {
    const deviations = pattern.notMet + pattern.partial
    return pattern.classification !== "DEVELOPMENT_PATTERN" && deviations >= 1 && pattern.eligible < PATTERN_MINIMUM_ELIGIBLE && deviations / Math.max(pattern.eligible, 1) >= 0.5
  })
}

/** Quantas chamadas (e de quantas pessoas) do grupo de referência têm leitura determinada desta prática — uma por chamada. */
export function practiceCoverageOf(rows: readonly MemoryRow[], practiceKey: string): { eligible: number; contributors: number } {
  const own = onePerInteraction(rows.filter((row) => practiceKeyOf(row) === practiceKey)).filter((row) => row.status === "MET" || row.status === "NOT_MET" || row.status === "PARTIAL")
  return { eligible: own.length, contributors: new Set(own.map((row) => row.personId)).size }
}

/** PERIOD_SAMPLE (`PERIOD_SAMPLE_V1`) = amostra determinística das chamadas do período quando a mudança não pôde ser localizada por
 * volume (ver `periodSampleOf`). */
export type SampleBasis = "LONGEST_DURATION" | "SIGNALED" | "TEMPORAL" | "EXISTING_MEMORY" | "PERIOD_SAMPLE"
/** UNLOCATED = não foi possível localizar onde o resultado mudou (volume insuficiente para comparar): descreve o que se sabe das
 * chamadas do período — a memória que já existia e, com a análise de chamadas autorizada pela estratégia, a amostra do período
 * (`PERIOD_SAMPLE_V1`). É OBSERVAÇÃO do período: nada aqui é tratado como causa da variação do indicador. */
/** ATYPICAL_DAY / CONCENTRATION = recorte encontrado durante a investigação (dia fora do padrão, parte das chamadas pior que o conjunto). */
export type EvidenceFocus = FocusSegment["reason"] | "UNLOCATED" | "ATYPICAL_DAY" | "CONCENTRATION"
export const isAdverseFocus = (reason: EvidenceFocus) => reason === "DETERIORATED" || reason === "HIDDEN_DETERIORATION" || reason === "ATYPICAL_DAY" || reason === "CONCENTRATION"
export type SegmentEvidence = {
  /** V4: o recorte (R-n) desta evidência — filtros, como entra numa frase, de onde veio e o que ficou com revisão pendente. */
  sliceRef?: string
  filters?: SliceFilter[]
  scope?: string
  origin?: SliceOrigin
  pendingReview?: number
  segmentKey: string
  segmentLabel: string
  focusReason: EvidenceFocus
  universe: number
  analyzedCalls: number
  reusedCalls: number
  newlyAnalyzed: number
  sampleBasis: SampleBasis
  sampleNote: string
  patterns: CriterionPattern[]
  pathIncorrect: number
  pathAssessed: number
  /** V6 (`ABSENCE_OF_PATTERN_V1`) — qualidade das análises da amostra: completas × parciais (nem todas as etapas avaliadas) e quantas
   * chamadas têm alguma conclusão confirmada. Ausência de padrão só é dita com esse denominador, nunca como "sem desvios". */
  quality?: { usable: number; partial: number; confirmedCalls: number }
  /** `PERIOD_SAMPLE_V1` — evidência do PERÍODO (todos os assuntos): por assunto, chamadas com transcrição × com análise. */
  periodSubjects?: { key: string; label: string; universe: number; analyzed: number }[]
}

// ---------------------------------------------------------------------------------------------
// Amostra do período (`PERIOD_SAMPLE_V1`)
// ---------------------------------------------------------------------------------------------
export const PERIOD_SAMPLE_VERSION = "PERIOD_SAMPLE_V1" as const
export type LocalizationVolumeGap = "PERIOD_VOLUME" | "SUBJECT_VOLUME"

/**
 * A localização por assunto deixou de acontecer por VOLUME? `PERIOD_VOLUME` = algum dos períodos abaixo do mínimo de chamadas para
 * comparar o agregado (`minimumOverallOf`); `SUBJECT_VOLUME` = o agregado é comparável, mas nenhum assunto tem o mínimo nos dois
 * períodos. null = houve recorte localizado, não havia chamadas por assunto, ou a falta de localização não foi por volume (ex.:
 * indicador com alvo, que não se ordena). Só faz sentido com a métrica de chamada e a segmentação no contrato (quem chama confere).
 */
export function localizationVolumeGapOf(input: { segments: readonly SegmentComparison[]; overall: Localization["overall"]; focus: readonly FocusSegment[]; minimumPerSegment: number }): LocalizationVolumeGap | null {
  if (input.segments.length === 0 || input.focus.length > 0) return null
  const minimum = minimumOverallOf(input.minimumPerSegment)
  if ((input.overall.current?.n ?? 0) < minimum || (input.overall.previous?.n ?? 0) < minimum) return "PERIOD_VOLUME"
  return input.segments.some((segment) => segment.sufficient) ? null : "SUBJECT_VOLUME"
}

/** Um assunto do período e as chamadas COM TRANSCRIÇÃO dele, na ordem do sistema (espalhadas no período). */
/** `signaled` (só em indicador por sinal) = chamadas do assunto com o sinal: o assunto com mais delas abre a amostra. */
export type PeriodSampleSubject = { key: string; label: string; calls: readonly { id: string }[]; signaled?: number }
export type PeriodSamplePlan = {
  /** Chamadas com transcrição no período (todos os assuntos). */
  universe: number
  /** Tamanho que a amostra deve ter (limitado ao universo). */
  target: number
  /** Chamadas do período que a memória já analisou (contam na amostra, sem custo). */
  already: number
  /** Chamadas a analisar agora, na ordem da amostra — nunca mais que o espaço (`room`) do orçamento. */
  pick: { id: string; subjectKey: string }[]
  topSubject: { key: string; label: string } | null
  subjects: { key: string; label: string; calls: number; analyzed: number; picked: number }[]
}

/**
 * AMOSTRA DO PERÍODO (`PERIOD_SAMPLE_V1`), determinística: primeiro o assunto com mais chamadas com transcrição (as mesmas situações
 * se repetem — é onde uma prática pode virar padrão), depois os demais em rodízio, do maior volume para o menor (empate pela chave);
 * dentro de cada assunto, a ordem do sistema. As chamadas que a memória já analisou contam na amostra; só as que faltam até o alvo
 * são pedidas, e nunca mais que o espaço do orçamento de análises.
 */
export function periodSampleOf(input: { subjects: readonly PeriodSampleSubject[]; analyzed: ReadonlySet<string>; target: number; room: number }): PeriodSamplePlan {
  const subjects = input.subjects.filter((subject) => subject.calls.length > 0).sort((a, b) => (b.signaled ?? 0) - (a.signaled ?? 0) || b.calls.length - a.calls.length || a.key.localeCompare(b.key))
  const order: { id: string; subjectKey: string }[] = []
  const seen = new Set<string>()
  const push = (id: string, subjectKey: string) => {
    if (seen.has(id)) return
    seen.add(id)
    order.push({ id, subjectKey })
  }
  const [top, ...rest] = subjects
  if (top) for (const call of top.calls) push(call.id, top.key)
  const deepest = Math.max(0, ...rest.map((subject) => subject.calls.length))
  for (let index = 0; index < deepest; index++) {
    for (const subject of rest) {
      const call = subject.calls[index]
      if (call) push(call.id, subject.key)
    }
  }
  const target = Math.min(Math.max(0, input.target), order.length)
  const already = order.filter((entry) => input.analyzed.has(entry.id)).length
  const need = Math.max(0, Math.min(target - already, input.room))
  const pick = order.filter((entry) => !input.analyzed.has(entry.id)).slice(0, need)
  return {
    universe: order.length,
    target,
    already,
    pick,
    topSubject: top ? { key: top.key, label: top.label } : null,
    subjects: subjects.map((subject) => ({ key: subject.key, label: subject.label, calls: subject.calls.length, analyzed: subject.calls.filter((call) => input.analyzed.has(call.id)).length, picked: pick.filter((entry) => entry.subjectKey === subject.key).length })),
  }
}

/** Registro do passo `PERIOD_SAMPLE_V1` (só quando a localização por assunto não aconteceu por volume): o que foi amostrado — ou por
 * que não. `NOT_ALLOWED` = a estratégia, o Workflow ou o especialista não autorizam analisar chamadas (nada é consultado). */
export type PeriodSampleRecord = {
  version: typeof PERIOD_SAMPLE_VERSION
  gap: LocalizationVolumeGap
  status: "SAMPLED" | "MEMORY_SUFFICIENT" | "NOT_ALLOWED" | "BELOW_MINIMUM" | "NO_ROOM" | "TOOL_BUDGET" | "MODEL_BUDGET"
  reason: string | null
  /** null = não contado (análise de chamadas não autorizada). */
  universe: number | null
  minimumAnalyzed: number
  target: number
  already: number
  requested: number
  /** Análises de chamada da pessoa feitas pela amostra nesta execução (inclui falha e revisão pendente, como o orçamento conta). */
  analyzedNow: number
  topSubject: string | null
  subjects: PeriodSamplePlan["subjects"]
}

// ---------------------------------------------------------------------------------------------
// Grupo de referência comparável
// ---------------------------------------------------------------------------------------------
export type ReferencePractice = {
  criterionKey: string
  /** `PRODUCT_IN_FEEDBACK_V1`: os produtos a que a regra dos colegas vale ("Vale para"); ausente = regra geral. */
  appliesTo?: string[]
  /** `PRACTICE_IDENTITY_V1`: título da prática (rótulo). */
  practiceTitle?: string
  text: string
  heading: string | null
  documentTitle: string
  reference: { eligible: number; met: number; contributors: number }
  /** `null` = a pessoa não tem avaliação dessa etapa no recorte (só o grupo de referência). */
  person: { eligible: number; met: number; notMet: number } | null
  /**
   * REFERENCE_FOLLOWS_PERSON_MISSES / BOTH_FOLLOW = o grupo cumpre (≥ 80%) e a pessoa não cumpre / também cumpre;
   * REFERENCE_ALSO_MISSES = a pessoa não cumpre e o grupo de melhor resultado também quase nunca cumpre (≤ 20%) — fato que impede
   * tratar a etapa como lacuna individual; REFERENCE_ONLY = o grupo cumpre e a pessoa não tem avaliação dessa etapa (boa prática
   * observada nos colegas, nunca falha dela); INSUFFICIENT = nada disso.
   */
  contrast: "REFERENCE_FOLLOWS_PERSON_MISSES" | "BOTH_FOLLOW" | "REFERENCE_ALSO_MISSES" | "REFERENCE_ONLY" | "INSUFFICIENT"
}
export type ReferenceGroup = {
  basis: "SUBJECT_METRIC" | "OVERALL_INDICATOR" | "UNAVAILABLE"
  segmentKey: string | null
  segmentLabel: string | null
  population: number
  members: number
  practices: ReferencePractice[]
  limitations: string[]
  /**
   * `REFERENCE_DURATION_V1` (só indicador de DURAÇÃO): duração registrada média das chamadas do assunto no período — a da pessoa × a do
   * grupo de referência (média ponderada pelas chamadas; só com pelo menos 3 colegas com chamadas no assunto). Descritivo: mostra ONDE
   * está a diferença de tempo, nunca a causa.
   */
  durationComparison?: { personAverage: number; personCalls: number; referenceAverage: number; referenceCalls: number; contributors: number } | null
}
export const REFERENCE_MINIMUM_POPULATION = 4
export const REFERENCE_MINIMUM_CONTRIBUTORS = 3
export const REFERENCE_MINIMUM_ASSESSMENTS = 5

/** Comparação de duração registrada no assunto (`REFERENCE_DURATION_V1`): agregada, sem nomes; menos de 3 colegas com chamadas = nada. */
export function durationComparisonOf(person: { avgDuration: number | null; n: number } | null, members: readonly { avgDuration: number | null; n: number }[]): ReferenceGroup["durationComparison"] {
  if (!person || person.avgDuration === null || person.n === 0) return null
  const contributing = members.filter((member) => member.avgDuration !== null && member.n > 0)
  if (contributing.length < REFERENCE_MINIMUM_CONTRIBUTORS) return null
  const calls = contributing.reduce((sum, member) => sum + member.n, 0)
  const average = contributing.reduce((sum, member) => sum + member.avgDuration! * member.n, 0) / calls
  return { personAverage: Math.round(person.avgDuration), personCalls: person.n, referenceAverage: Math.round(average), referenceCalls: calls, contributors: contributing.length }
}

/** Grupo de melhor desempenho entre pares ranqueáveis (quartil superior pela direção; alvo não é ranqueável). */
/** `minimumMembers`: o grupo nunca é menor que o número de colegas que a estratégia exige para comparar (senão nunca compararia). */
export function topReferenceMembers(candidates: readonly { personId: string; value: number; n: number }[], direction: Direction, minimumN: number, minimumMembers = REFERENCE_MINIMUM_CONTRIBUTORS): { members: string[]; population: number } {
  if (direction === "TARGET") return { members: [], population: 0 }
  const eligible = candidates.filter((candidate) => candidate.n >= minimumN)
  if (eligible.length < REFERENCE_MINIMUM_POPULATION) return { members: [], population: eligible.length }
  const sorted = [...eligible].sort((a, b) => (direction === "LOWER" ? a.value - b.value : b.value - a.value))
  return { members: sorted.slice(0, Math.max(Math.ceil(sorted.length / 4), REFERENCE_MINIMUM_CONTRIBUTORS, minimumMembers)).map((candidate) => candidate.personId), population: eligible.length }
}

/** Prática do grupo de referência × a pessoa, por critério — só agregados, com mínimos (a recorrência da equipe não prova o erro da pessoa). */
/**
 * Prática do grupo de referência × a pessoa, por prática (`PRACTICE_ANCHOR_V1`) — só agregados, com mínimos (a recorrência da equipe
 * não prova o erro da pessoa). Os mínimos são os do produto ou os da estratégia, o que for MAIOR (a estratégia só endurece).
 */
export function referencePracticesOf(referenceRows: readonly MemoryRow[], personPatterns: readonly CriterionPattern[], minimums?: { assessments?: number; contributors?: number }): ReferencePractice[] {
  const minimumAssessments = Math.max(REFERENCE_MINIMUM_ASSESSMENTS, minimums?.assessments ?? 0)
  const minimumContributors = Math.max(REFERENCE_MINIMUM_CONTRIBUTORS, minimums?.contributors ?? 0)
  const byKey = new Map<string, MemoryRow[]>()
  for (const row of referenceRows) byKey.set(practiceKeyOf(row), [...(byKey.get(practiceKeyOf(row)) ?? []), row])
  return [...byKey.entries()].flatMap(([criterionKey, every]) => {
    // `PRODUCT_IN_FEEDBACK_V1`: regra de um produto só compara quando a pessoa tem chamadas desse produto nesta prática; regra geral, sempre.
    const personProducts = new Set(personPatterns.find((entry) => entry.criterionKey === criterionKey)?.products ?? [])
    const all = every.filter((row) => (row.ruleScope ?? []).length === 0 || (row.product !== undefined && personProducts.has(row.product)))
    if (all.length === 0) return []
    const rows = onePerInteraction(all)
    const eligibleRows = rows.filter((row) => row.status === "MET" || row.status === "NOT_MET" || row.status === "PARTIAL")
    const contributors = new Set(eligibleRows.map((row) => row.personId)).size
    const met = eligibleRows.filter((row) => row.status === "MET").length
    if (eligibleRows.length < minimumAssessments || contributors < minimumContributors) return []
    const pattern = personPatterns.find((entry) => entry.criterionKey === criterionKey && entry.eligible > 0)
    const share = met / eligibleRows.length
    const referenceFollows = share >= 0.8
    const personMisses = pattern ? (pattern.notMet + pattern.partial) / pattern.eligible >= 0.5 : false
    const contrast: ReferencePractice["contrast"] = !pattern
      ? referenceFollows ? "REFERENCE_ONLY" : "INSUFFICIENT"
      : referenceFollows && personMisses ? "REFERENCE_FOLLOWS_PERSON_MISSES"
      : referenceFollows && pattern.met / pattern.eligible >= 0.8 ? "BOTH_FOLLOW"
      : personMisses && share <= 0.2 ? "REFERENCE_ALSO_MISSES"
      : "INSUFFICIENT"
    if (contrast === "INSUFFICIENT") return []
    const representative = modalTextOf(eligibleRows.length > 0 ? eligibleRows : rows)
    return [{ criterionKey, ...((representative.ruleScope ?? []).length > 0 ? { appliesTo: representative.ruleScope! } : {}), ...(practiceTitleOfRows(all) ? { practiceTitle: practiceTitleOfRows(all)! } : {}), text: representative.text, heading: representative.heading, documentTitle: representative.documentTitle, reference: { eligible: eligibleRows.length, met, contributors }, person: pattern ? { eligible: pattern.eligible, met: pattern.met, notMet: pattern.notMet + pattern.partial } : null, contrast }]
  })
}

// ---------------------------------------------------------------------------------------------
// Conclusão
// ---------------------------------------------------------------------------------------------
/** CHANGE_LOCATED_NO_CAUSE = recorte que piorou EXAMINADO (chamadas analisadas ou evidência do mesmo recorte) sem desvio recorrente;
 * CHANGE_LOCATED_NOT_EXAMINED (V5) = recorte que piorou cujas chamadas NÃO foram examinadas (o planejador decidiu não aprofundar,
 * nenhuma ferramenta, orçamento) — nunca confundido com "examinado sem causa". */
export type InvestigationConclusion = "PATTERN_SUPPORTED" | "STRENGTH_PATTERN" | "RESULT_RECOGNITION" | "CHANGE_LOCATED_NO_CAUSE" | "CHANGE_LOCATED_NOT_EXAMINED" | "MIX_EFFECT" | "INSUFFICIENT_DATA"
export type InvestigationQuestion = { id: "WHERE" | "CALLS" | "PROCEDURE" | "REFERENCE" | "ACTION"; question: string; answered: boolean; summary: string; status?: QuestionStatus }

/** Registro da investigação com ferramentas: permissões efetivas (e de onde vieram), ferramentas disponíveis, o que o planejador
 * propôs e o que foi aceito, cada consulta com resultado/qualidade/proveniência, motivo da parada e perguntas que ficaram abertas. */
export type InvestigationToolRecord = {
  version: typeof ENGINE_INVESTIGATION_TOOLS_VERSION
  mode: "FIXED" | "AUTONOMOUS"
  capabilities: EffectiveCapabilities
  availability: ToolAvailability[]
  ledger: ToolLedgerEntry[]
  planner: { status: "NOT_USED" | "USED" | "UNAVAILABLE"; rounds: number; proposals: { round: number; calls: { tool: string; question: string; accepted: boolean; reason: string | null }[]; stop: { reason: string; note: string | null } | null; violations: string[] }[] }
  stopReason: string
  openQuestions: OpenQuestion[]
  budget: { maxToolCalls: number; toolCalls: number; maxPlanningRounds: number }
  /** V4: passos do CONTRATO do diagnóstico (não são ferramentas) e se o plano foi do planejador ou do contrato. */
  contract?: ContractSteps
  /** `PATTERN_CONFIRMATION_V1`: chamadas a mais pedidas porque uma etapa falhou na amostra abaixo do mínimo de padrão. */
  patternConfirmation?: { sliceRef: string; candidates: string[]; requested: number }[]
  /** `PERIOD_SAMPLE_V1`: amostra das chamadas do período quando a mudança não pôde ser localizada por volume (ou por que não houve). */
  periodSample?: PeriodSampleRecord
  plan?: "PLANNER" | "CONTRACT"
  planReason?: string
  /** V4: estado das perguntas depois de cada rodada — como cada descoberta mudou a investigação. */
  questionHistory?: { round: number; after: string[]; questions: { id: string; status: QuestionStatus; material: boolean }[] }[]
  /** V5 (`INVESTIGATION_CLOSURE_V1`): o que o planejador decidiu sobre cada pergunta de recorte ao parar (resolvida pela evidência
   * do mesmo recorte × não aprofundar, com a justificativa) e se o código aceitou. */
  closureVersion?: typeof INVESTIGATION_CLOSURE_VERSION
  dispositions?: QuestionDisposition[]
  /** `PLANNER_QUESTIONS_V1` — perguntas que o planejador abriu a partir de descobertas e como terminaram (registro; nunca fato). */
  plannerQuestions?: PlannerQuestionRecord[]
  /** `TOOL_RESULT_VIEW_V2` — versão da visão dos resultados enviada ao planejador. */
  resultView?: string
}
export type PlannerQuestionRecord = { id: string; question: string; why: string; round: number; status: "OPEN" | "RESOLVED" | "DECLINED"; evidence: string[]; decisionWhy: string | null; accepted: boolean | null; reason: string | null }

export type IndicatorInvestigation = {
  logicVersion: typeof INDICATOR_INVESTIGATION_LOGIC_VERSION
  official: OfficialFacts
  localization: Localization
  evidence: SegmentEvidence[]
  reference: ReferenceGroup | null
  questions: InvestigationQuestion[]
  conclusion: InvestigationConclusion
  limitations: string[]
  /** `maxPeerCallAnalyses`/`peerCallAnalyses`: análises de chamadas de colegas para a referência (orçamento próprio, `REFERENCE_GROUP_V3`). */
  budget: { maxCallAnalyses: number; callAnalyses: number; maxPeerCallAnalyses?: number; peerCallAnalyses?: number; peerAnalyzeFailures?: number; reusedCalls: number; stoppedBy: string | null }
  strategy: { versionId: string | null; configured: boolean; mode?: string; prohibitedClaims?: string[]; /** Comportamento sem diagnóstico acionável (estratégia). HOLD_FOR_QA = abstenção no motor (não há fila de QA). */ noDiagnosisBehavior?: string | null }
  teamId: string | null
  subteamId: string | null
  /** V3: investigação com ferramentas (ausente em investigações V2). */
  tools?: InvestigationToolRecord
  /** V3: o que os resultados das ferramentas mudaram no diagnóstico (atribuição, qualidade do dado, fatos comunicáveis, limitações). */
  signals?: DiagnosticSignals
  /** V4: recortes investigados (localização do código + os que os resultados das ferramentas revelaram). */
  slices?: InvestigationSlice[]
  /**
   * V4: COMPLETE = a investigação foi até onde as perguntas e permissões levavam; INTERRUPTED_BY_BUDGET = o orçamento de modelo da
   * execução acabou com perguntas materiais em aberto (fica no histórico, mas não é reutilizada: a próxima execução retoma).
   */
  completeness?: { status: "COMPLETE" | "INTERRUPTED_BY_BUDGET"; pendingReviews: number; note: string | null }
  /** Notas para o COLABORADOR (detalhes da tela): o que não foi examinado, sem o funcionamento técnico da investigação. */
  readerNotes?: string[]
}

export const MINIMUM_ANALYZED_FOR_PATTERN = 3
export const ATTRIBUTION_LIMIT = "Um desvio de processo observado nas chamadas não prova, sozinho, que ele explica toda a variação do indicador."

export function concludeInvestigation(input: { official: OfficialFacts; localization: Localization; evidence: readonly SegmentEvidence[]; reference: ReferenceGroup | null; signals?: DiagnosticSignals | null; minimumAnalyzed?: number; slices?: readonly InvestigationSlice[]; /** V5: estado final da pergunta das chamadas de cada recorte (R-n → status). */ sliceStatuses?: Readonly<Record<string, QuestionStatus>> }): { conclusion: InvestigationConclusion; questions: InvestigationQuestion[] } {
  const { official, localization, evidence } = input
  const minimumAnalyzed = Math.max(input.minimumAnalyzed ?? MINIMUM_ANALYZED_FOR_PATTERN, MINIMUM_ANALYZED_FOR_PATTERN)
  // Recortes adversos: os assuntos que pioraram E os que os resultados das ferramentas revelaram (dia, horário, concentração).
  const adverseSlices = (input.slices ?? []).filter((slice) => slice.adverse)
  const adverseLocated = localization.focus.some((focus) => focus.reason !== "IMPROVED") || adverseSlices.length > 0
  // Padrão de desvio só SUSTENTA conclusão no recorte que piorou; regra que mudou na base depois das chamadas não vira orientação.
  const adverseEvidence = evidence.filter((entry) => isAdverseFocus(entry.focusReason))
  const developmentPatterns = adverseEvidence.flatMap((entry) => entry.patterns.filter((pattern) => pattern.classification === "DEVELOPMENT_PATTERN" && pattern.currentRule !== "CHANGED"))
  const strengthPatterns = evidence.flatMap((entry) => entry.patterns.filter((pattern) => pattern.classification === "STRENGTH_PATTERN" && pattern.currentRule !== "CHANGED"))
  const analyzed = evidence.reduce((sum, entry) => sum + entry.analyzedCalls, 0)
  // `PERIOD_SAMPLE_V1`: a amostra do período descreve o período — nunca conta como exame de um recorte que piorou (um dia fora do
  // padrão que ninguém examinou continua "não examinado", mesmo com chamadas do período analisadas).
  const analyzedInSlices = evidence.reduce((sum, entry) => sum + (entry.sampleBasis === "PERIOD_SAMPLE" ? 0 : entry.analyzedCalls), 0)
  // Recorte suficientemente olhado: confirmadas ≥ o mínimo (ou o recorte inteiro, se for menor que o mínimo) — ou a pergunta dele
  // respondida pela memória/evidência do MESMO recorte. Comparação do mês com o grupo NUNCA conta como recorte examinado (V5).
  const statuses = input.sliceStatuses ?? {}
  const sliceExamined = adverseEvidence.some((entry) => entry.universe > 0 && entry.analyzedCalls >= Math.min(minimumAnalyzed, entry.universe)) || adverseSlices.some((slice) => statuses[slice.ref] === "ANSWERED")
  // Não examinado por decisão, ferramenta ou orçamento (≠ sem dado): a mudança está localizada, mas nada se sabe das chamadas dela.
  const notExamined = adverseSlices.some((slice) => ["DECLINED", "NO_TOOL", "BUDGET", "OPEN", "PARTIAL"].includes(statuses[slice.ref] ?? ""))
  const resultGood = official.withinTarget === true || official.movement === "IMPROVED"
  let conclusion: InvestigationConclusion
  if (developmentPatterns.length > 0) conclusion = "PATTERN_SUPPORTED"
  else if (!adverseLocated && localization.decomposition?.dominant === "MIX" && localization.overall.direction === "WORSE") conclusion = "MIX_EFFECT"
  else if (adverseLocated) conclusion = input.signals?.dataQuality === "INSUFFICIENT" ? "INSUFFICIENT_DATA" : sliceExamined || analyzedInSlices >= minimumAnalyzed ? "CHANGE_LOCATED_NO_CAUSE" : notExamined ? "CHANGE_LOCATED_NOT_EXAMINED" : "INSUFFICIENT_DATA"
  else if (resultGood && strengthPatterns.length > 0) conclusion = "STRENGTH_PATTERN"
  else if (resultGood) conclusion = "RESULT_RECOGNITION"
  else conclusion = (localization.proxy.kind === null && analyzed === 0) || input.signals?.dataQuality === "INSUFFICIENT" ? "INSUFFICIENT_DATA" : "CHANGE_LOCATED_NO_CAUSE"

  const located = [...localization.focus.map((focus) => `${focus.label} (${focus.reason === "IMPROVED" ? "melhorou" : "piorou"})`), ...adverseSlices.filter((slice) => slice.origin.kind !== "LOCALIZATION").map((slice) => `${slice.label} (${slice.reason === "ATYPICAL_DAY" ? "dia fora do padrão" : "concentração"})`)]
  const whereAnswered = located.length > 0 || localization.decomposition !== null
  const questions: InvestigationQuestion[] = [
    { id: "WHERE", question: "Em quais cenários o resultado piorou ou melhorou?", answered: whereAnswered, summary: whereAnswered ? (located.length > 0 ? located.join("; ") : "sem recorte com mudança material") : localization.limitations[0] ?? "sem dados por assunto" },
    { id: "CALLS", question: "O que se observa nas chamadas desse recorte?", answered: (adverseLocated ? analyzedInSlices : analyzed) >= minimumAnalyzed || sliceExamined, summary: `${analyzed} chamada(s) com conclusões confirmadas nos recortes investigados${evidence.some((entry) => (entry.pendingReview ?? 0) > 0) ? ` (${evidence.reduce((sum, entry) => sum + (entry.pendingReview ?? 0), 0)} com revisão pendente)` : ""}` },
    { id: "PROCEDURE", question: "O que o procedimento orienta nesse cenário?", answered: evidence.some((entry) => entry.patterns.some((pattern) => pattern.eligible > 0)), summary: `${evidence.reduce((sum, entry) => sum + entry.patterns.filter((pattern) => pattern.eligible > 0).length, 0)} critério(s) da base avaliados` },
    { id: "REFERENCE", question: "O que faz o grupo de melhor desempenho comparável?", answered: Boolean(input.reference && input.reference.practices.length > 0), summary: input.reference ? `${input.reference.basis === "SUBJECT_METRIC" ? "melhores no mesmo assunto" : input.reference.basis === "OVERALL_INDICATOR" ? "melhores no indicador geral (não por assunto)" : "sem grupo comparável"}; ${input.reference.practices.length} prática(s) com evidência suficiente` : "não consultado" },
    { id: "ACTION", question: "Qual mudança concreta é indicada?", answered: conclusion === "PATTERN_SUPPORTED" || conclusion === "STRENGTH_PATTERN", summary: conclusion === "PATTERN_SUPPORTED" ? `${developmentPatterns.length} etapa(s) com desvio recorrente sustentado` : conclusion === "STRENGTH_PATTERN" ? "prática consistente a preservar" : "nenhuma mudança sustentada pela evidência" },
  ]
  return { conclusion, questions }
}
