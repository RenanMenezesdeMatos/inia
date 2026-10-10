import { detectTemporalLanguage } from "../../investigation/domain/temporal-semantics.js"
import { allowedCanonicalNumbers, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"

/**
 * V1.5.12 — INDICATOR CLAIM BOUNDARIES (determinísticas, sem LLM). O texto sobre um indicador só pode afirmar o que o
 * contexto CANÔNICO sustenta:
 *
 *   CANONICAL_METRIC_ONLY / NO_METRIC_RECALC  → todo número do texto é o valor oficial, a meta oficial a distância até a
 *                                               meta calculada pelo SISTEMA (V1.5.12a) ou parte da data do período (com o
 *                                               arredondamento do próprio formato) — nada de conversão ("420 s" →
 *                                               "7 minutos"), diferença diferente da canônica, percentual ou média;
 *   TARGET_COMPARISON_REQUIRES_CANONICAL_DATA → "atingiu/dentro da meta" × "não atingiu/fora da meta" e "acima/abaixo da
 *                                               meta" precisam bater com a comparação oficial (valor × meta × direção);
 *   TREND_REQUIRES_CANONICAL_EVIDENCE         → evolução/tendência ("melhorou", "vem caindo", "em relação ao mês anterior")
 *                                               exige histórico canônico — que a V1 NÃO carrega: sempre violação;
 *   PERIOD_CLAIM_REQUIRES_MATCHING_PERIOD     → mês citado precisa estar dentro do período da medição.
 * Usadas em DOIS lugares: sobre a interpretação da origem (conflito → a interpretação não vai ao redator e o item vai a QA)
 * e sobre o texto do redator (violação → fallback determinístico do item).
 */
export type IndicatorClaimViolation = "UNSUPPORTED_NUMBER" | "TARGET_COMPARISON_MISMATCH" | "TREND_WITHOUT_CANONICAL_HISTORY" | "PERIOD_MISMATCH"

const NUMBER = /\d+(?:[.,]\d+)*/g

/** Leituras possíveis de um número escrito (pt-BR "1.234,5" / "85,5"; ou "85.5"). */
export function numberReadings(raw: string): number[] {
  const readings = new Set<number>()
  if (raw.includes(",") && raw.includes(".")) readings.add(Number(raw.replace(/\./g, "").replace(",", ".")))
  else if (raw.includes(",")) readings.add(Number(raw.replace(",", ".")))
  else if (raw.includes(".")) {
    readings.add(Number(raw))
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) readings.add(Number(raw.replace(/\./g, "")))
  } else readings.add(Number(raw))
  return [...readings].filter((value) => Number.isFinite(value))
}

const roundTo = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals
/** O número escrito é um dos permitidos, aceitando SÓ o arredondamento de exibição (0–2 casas) — nunca outra conta. */
function isAllowedNumber(written: number, allowed: readonly number[]): boolean {
  return allowed.some((value) => Math.abs(written - value) < 1e-9 || [0, 1, 2].some((decimals) => Math.abs(written - roundTo(value, decimals)) < 1e-9))
}

/**
 * `extraAllowed` (V1.6.1): números dos textos VERIFICADOS do próprio item (frases do diagnóstico, regra literal da base, título do
 * documento) — como valor numérico ou como o token EXATO escrito na fonte (ex.: "1.6.1" num título).
 */
export function unsupportedNumbers(textValue: string, context: IndicatorCanonicalContext, extraAllowed: readonly (number | string)[] = []): string[] {
  const allowed = [...allowedCanonicalNumbers(context), ...extraAllowed.filter((value): value is number => typeof value === "number")]
  const tokens = new Set(extraAllowed.filter((value): value is string => typeof value === "string"))
  return (textValue.match(NUMBER) ?? []).filter((raw) => !tokens.has(raw) && !numberReadings(raw).some((reading) => isAllowedNumber(reading, allowed)))
}

const MET = [
  /(?<!n[ãa]o\s)(?<!\p{L})(?:atingiu|alcan[çc]ou|bateu|cumpriu|superou)\s+(?:a\s+)?meta/iu,
  /(?<!\p{L})dentro\s+d[ao]\s+meta/iu,
  /(?<!\p{L})meta\s+(?:foi\s+)?(?:atingida|alcan[çc]ada|batida|cumprida|superada)/iu,
]
const MISSED = [
  /(?<!\p{L})n[ãa]o\s+(?:atingiu|alcan[çc]ou|bateu|cumpriu|superou)\s+(?:a\s+)?meta/iu,
  /(?<!\p{L})fora\s+d[ao]\s+meta/iu,
  /(?<!\p{L})meta\s+n[ãa]o\s+(?:foi\s+)?(?:atingida|alcan[çc]ada|batida|cumprida)/iu,
]
const ABOVE = [/(?<!\p{L})acima\s+d[ao]\s+meta/iu, /(?<!\p{L})superior\s+[àa]\s+meta/iu, /(?<!\p{L})maior\s+(?:do\s+)?que\s+a\s+meta/iu]
const BELOW = [/(?<!\p{L})abaixo\s+d[ao]\s+meta/iu, /(?<!\p{L})inferior\s+[àa]\s+meta/iu, /(?<!\p{L})menor\s+(?:do\s+)?que\s+a\s+meta/iu]

export type IndicatorClaimSlot = "observed" | "whyItMatters" | "whatYouCanDo" | "analysis"

/**
 * Onde o texto AFIRMA o estado do indicador. `observed` (o resultado do período) e a interpretação da origem (`analysis`)
 * descrevem o resultado real: toda menção à meta é afirmação e fica ESTRITA. `whyItMatters`/`whatYouCanDo` falam de
 * relevância e do próximo ciclo: "manter/atingir/ficar dentro da meta" ali é OBJETIVO, não estado — só conta como afirmação
 * a menção de posição ligada a um verbo de ESTADO no indicativo ("ficou/está/esteve… dentro da meta") ou o verbo de
 * resultado no pretérito ("atingiu/bateu a meta", "a meta foi atingida"). V1.5.12a (smoke: "Manter este indicador dentro da
 * meta pode ajudar…" não é afirmação de que o indicador ESTÁ dentro da meta).
 */
const STATE_ASSERTING_SLOTS: readonly IndicatorClaimSlot[] = ["observed", "analysis"]
/** Verbo de ESTADO finito no indicativo, logo antes da posição ("seu TMA ficou dentro da meta"). Subjuntivo/infinitivo não. */
const FINITE_STATE_VERB = /(?<!\p{L})(?:est[áa]|esteve|estava|ficou|ficaram|permaneceu|permanece|continua|continuou|segue|seguiu|foi|foram|é|s[ãa]o)(?!\p{L})/iu
const CLAUSE_BREAK = /[.;:!?,]|\s(?:e|mas|para|pois|porque|que)\s/giu
/** Janela da oração que antecede a menção (a partir da última pausa/conectivo), no máximo 5 palavras. */
function precedingClause(text: string, index: number): string {
  const before = text.slice(0, index)
  let start = 0
  for (const match of before.matchAll(CLAUSE_BREAK)) start = (match.index ?? 0) + match[0].length
  return before.slice(start).trim().split(/\s+/).slice(-5).join(" ")
}
type Mention = { phrase: string; asserted: boolean }
/** Cada padrão: a frase encontrada e se ela AFIRMA estado no slot. Verbo de resultado finito = sempre afirmação. */
function mentions(textValue: string, patterns: RegExp[], kind: "RESULT_VERB" | "POSITION", slot: IndicatorClaimSlot): Mention[] {
  return patterns.flatMap((pattern) => {
    const match = pattern.exec(textValue)
    if (!match) return []
    if (STATE_ASSERTING_SLOTS.includes(slot)) return [{ phrase: match[0], asserted: true }]
    if (kind === "RESULT_VERB") return [{ phrase: match[0], asserted: /(?<!\p{L})(?:atingiu|alcan[çc]ou|bateu|cumpriu|superou|foi)(?!\p{L})/iu.test(match[0]) }]
    return [{ phrase: match[0], asserted: FINITE_STATE_VERB.test(precedingClause(textValue, match.index)) }]
  })
}

/** Afirmações sobre a meta incompatíveis com a comparação oficial. Sem meta canônica, QUALQUER afirmação sobre meta viola. */
export function targetComparisonConflicts(textValue: string, context: IndicatorCanonicalContext, slot: IndicatorClaimSlot = "observed"): string[] {
  const asserted = (found: Mention[]) => found.filter((mention) => mention.asserted).map((mention) => mention.phrase)
  const met = asserted([...mentions(textValue, [MET[0]!, MET[2]!], "RESULT_VERB", slot), ...mentions(textValue, [MET[1]!], "POSITION", slot)])
  const missed = asserted([...mentions(textValue, [MISSED[0]!, MISSED[2]!], "RESULT_VERB", slot), ...mentions(textValue, [MISSED[1]!], "POSITION", slot)])
  const above = asserted(mentions(textValue, ABOVE, "POSITION", slot))
  const below = asserted(mentions(textValue, BELOW, "POSITION", slot))
  const conflicts: string[] = []
  if (context.withinTarget === null) return [...met, ...missed, ...above, ...below]
  if (context.withinTarget === true) conflicts.push(...missed)
  if (context.withinTarget === false) conflicts.push(...met)
  if (context.position !== "ABOVE") conflicts.push(...above)
  if (context.position !== "BELOW") conflicts.push(...below)
  return conflicts
}

/** Evolução no tempo: verbos de mudança no passado, tendência, comparação com período anterior (sempre) e gerúndios de mudança (só em afirmação, nunca em sugestão). */
const TREND_ALWAYS = /(?<!\p{L})(?:melhorou|piorou|evoluiu|regrediu|caiu|subiu|aumentou|diminuiu|reduziu|oscilou|tend[êe]ncia|em\s+rela[çc][ãa]o\s+(?:ao|à)\s+(?:m[êe]s|per[íi]odo|ciclo|semana)\s+anterior|comparad[oa]\s+(?:ao|com\s+o|com\s+a)\s+(?:m[êe]s|per[íi]odo|ciclo|semana)\s+anterior|no\s+(?:m[êe]s|per[íi]odo)\s+passado)(?!\p{L})/iu
const TREND_ASSERTION = /(?<!\p{L})(?:melhorando|piorando|caindo|subindo|aumentando|diminuindo|evoluindo|vem\s+\p{L}+ndo)(?!\p{L})/iu
export function trendLanguage(textValue: string, slot: IndicatorClaimSlot): string[] {
  const hits = [TREND_ALWAYS.exec(textValue)?.[0] ?? null, slot === "whatYouCanDo" ? null : TREND_ASSERTION.exec(textValue)?.[0] ?? null].filter((match): match is string => match !== null)
  return [...hits, ...detectTemporalLanguage(textValue)]
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const monthsOf = (periodStart: string, periodEnd: string): Set<number> => {
  const start = new Date(`${periodStart.slice(0, 10)}T12:00:00Z`)
  const end = new Date(`${periodEnd.slice(0, 10)}T12:00:00Z`)
  const months = new Set<number>()
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  while (cursor <= end && months.size < 24) {
    months.add(cursor.getUTCMonth())
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}
/** Mês citado fora do período da medição. */
export function periodConflicts(textValue: string, context: IndicatorCanonicalContext): string[] {
  const allowed = monthsOf(context.measurement.periodStart, context.measurement.periodEnd)
  const lower = textValue.toLowerCase()
  return MONTHS.filter((month, index) => new RegExp(`(?<!\\p{L})${month}(?!\\p{L})`, "u").test(lower) && !allowed.has(index))
}

/** Todas as fronteiras sobre UM texto (a interpretação da origem ou um slot do redator). */
export function indicatorClaimViolations(textValue: string, context: IndicatorCanonicalContext, slot: IndicatorClaimSlot, extraAllowed: readonly (number | string)[] = []): IndicatorClaimViolation[] {
  const violations = new Set<IndicatorClaimViolation>()
  if (unsupportedNumbers(textValue, context, extraAllowed).length > 0) violations.add("UNSUPPORTED_NUMBER")
  if (targetComparisonConflicts(textValue, context, slot).length > 0) violations.add("TARGET_COMPARISON_MISMATCH")
  if (trendLanguage(textValue, slot).length > 0) violations.add("TREND_WITHOUT_CANONICAL_HISTORY")
  if (periodConflicts(textValue, context).length > 0) violations.add("PERIOD_MISMATCH")
  return [...violations]
}
