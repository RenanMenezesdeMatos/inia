import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"

/**
 * EVOLUÇÃO MEDIDA (`INTERVENTION_EVOLUTION_V1`) — o indicador do colaborador ANTES × DEPOIS de um marco (o último feedback
 * publicado sobre o indicador). É leitura da medição operacional diária, calculada pela INIA: não substitui a leitura que o
 * líder registra ao concluir e não usa nenhum limiar escondido — os dois valores, a variação e a amostra vão por extenso, e
 * "melhorou/piorou" só diz para que lado o valor andou segundo a direção do indicador. Quanto é "evolução suficiente" é
 * decisão de quem lê (e, no futuro, um parâmetro explícito da política) — nunca uma regra silenciosa aqui.
 *
 * Dado ausente nunca é desempenho ruim: sem medição diária, com marco recente demais ou com poucos dias medidos em um dos
 * lados, o resultado diz o que falta e não classifica.
 */
export const EVOLUTION_CONTRACT = "INTERVENTION_EVOLUTION_V1"

/** Menos dias que isso desde o marco: cedo demais para comparar. */
export const EVOLUTION_MIN_DAYS_SINCE = 7
/** As duas janelas têm o mesmo tamanho (os dias desde o marco), limitado a este teto. */
export const EVOLUTION_MAX_WINDOW_DAYS = 60
/** Dias com medição exigidos em CADA lado para comparar. */
export const EVOLUTION_MIN_DAYS_WITH_DATA = 3

export type EvolutionStatus = "IMPROVED" | "WORSENED" | "UNCHANGED" | "CHANGED" | "TOO_RECENT" | "INSUFFICIENT_DATA" | "NOT_AVAILABLE"
/** O marco da comparação: o último feedback sobre o indicador, ou o início de um acompanhamento (checkpoints e fechamento). */
export type EvolutionReference = { kind: "FEEDBACK" | "INTERVENTION"; ref: string; label: string; at: string }
export type EvolutionWindow = { start: string; end: string; value: number | null; daysWithData: number; expectedDays: number | null }

export type Evolution = {
  contract: typeof EVOLUTION_CONTRACT
  indicatorCode: string
  indicatorName: string
  unit: string
  direction: "HIGHER" | "LOWER" | "TARGET"
  reference: EvolutionReference
  status: EvolutionStatus
  windowDays: number | null
  before: EvolutionWindow | null
  after: EvolutionWindow | null
  change: { absolute: number; percent: number | null } | null
  /** Frase pronta, factual, com os números usados. */
  statement: string
}

const DAY_MS = 86_400_000
const noon = (day: string) => new Date(`${day}T12:00:00Z`).getTime()
/** Soma dias a uma data civil (AAAA-MM-DD), sem fuso. */
export const addCivilDays = (day: string, days: number) => new Date(noon(day) + days * DAY_MS).toISOString().slice(0, 10)

/**
 * As duas janelas, em DIAS CIVIS da organização (a medição é diária): o dia do marco fica FORA das duas — o feedback chega no
 * meio dele, então esse dia não é "antes" nem "depois". Mesmo tamanho dos dois lados: os dias desde o marco, limitados ao teto.
 *   antes  = [marco − N dias, marco)            depois = [fim − N + 1 dia, fim]   (fim = dia da avaliação, parcial)
 * `windowDays` nulo = cedo demais para comparar.
 */
export function evolutionPlan(referenceDay: string, asOfDay: string): { daysSince: number; windowDays: number | null; before: { startDay: string; endDayExclusive: string } | null; after: { startDay: string; endDay: string } | null } {
  const daysSince = Math.round((noon(asOfDay) - noon(referenceDay)) / DAY_MS)
  if (daysSince < EVOLUTION_MIN_DAYS_SINCE) return { daysSince, windowDays: null, before: null, after: null }
  const windowDays = Math.min(daysSince, EVOLUTION_MAX_WINDOW_DAYS)
  return { daysSince, windowDays, before: { startDay: addCivilDays(referenceDay, -windowDays), endDayExclusive: referenceDay }, after: { startDay: addCivilDays(asOfDay, -windowDays + 1), endDay: asOfDay } }
}

const round2 = (value: number) => Math.round(value * 100) / 100
const civil = (day: string) => day.slice(0, 10).split("-").reverse().join("/")
const percentText = (value: number) => `${Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
const sampleText = (window: EvolutionWindow) => `${window.daysWithData} dia(s) com medição${window.expectedDays !== null ? ` de ${window.expectedDays} esperado(s)` : ""}`

export type EvolutionInput = {
  indicatorCode: string
  indicatorName: string
  unit: string
  direction: Evolution["direction"]
  dailySupported: boolean
  reference: EvolutionReference
  /** Dia civil do marco e da avaliação, no fuso da organização (AAAA-MM-DD). */
  referenceDay: string
  asOfDay: string
  /** Presentes só quando a comparação é possível (medição diária e marco com dias suficientes). */
  before?: EvolutionWindow | null
  after?: EvolutionWindow | null
}

/** Classifica e descreve — pura e determinística (mesma entrada → mesmo resultado). */
export function buildEvolution(input: EvolutionInput): Evolution {
  const base = { contract: EVOLUTION_CONTRACT, indicatorCode: input.indicatorCode, indicatorName: input.indicatorName, unit: input.unit, direction: input.direction, reference: input.reference } as const
  const since = `Desde ${input.reference.label} de ${civil(input.referenceDay)}`
  const none = (status: EvolutionStatus, statement: string, windowDays: number | null = null): Evolution => ({ ...base, status, windowDays, before: input.before ?? null, after: input.after ?? null, change: null, statement })
  if (!input.dailySupported) return none("NOT_AVAILABLE", `${input.indicatorName} não tem medição diária: não é possível comparar antes e depois de ${civil(input.referenceDay)}. Use os fechamentos oficiais.`)
  const { daysSince, windowDays } = evolutionPlan(input.referenceDay, input.asOfDay)
  if (windowDays === null) return none("TOO_RECENT", `${since} passaram ${Math.max(daysSince, 0)} dia(s): ainda é cedo para comparar (mínimo de ${EVOLUTION_MIN_DAYS_SINCE} dias).`)
  const { before, after } = input
  const usable = (window: EvolutionWindow | null | undefined): window is EvolutionWindow & { value: number } => Boolean(window && window.value !== null && window.daysWithData >= EVOLUTION_MIN_DAYS_WITH_DATA)
  if (!usable(before) || !usable(after)) {
    const side = (label: string, window: EvolutionWindow | null | undefined) => `${label}: ${window ? sampleText(window) : "sem medição"}`
    return none("INSUFFICIENT_DATA", `${since}, faltam medições para comparar ${input.indicatorName} (mínimo de ${EVOLUTION_MIN_DAYS_WITH_DATA} dias com medição em cada lado). ${side(`${windowDays} dias antes`, before)}; ${side(`${windowDays} dias depois`, after)}. Dado ausente não é desempenho ruim.`, windowDays)
  }
  const absolute = round2(after.value - before.value)
  const percent = before.value === 0 ? null : round2((absolute / Math.abs(before.value)) * 100)
  const status: EvolutionStatus = absolute === 0 ? "UNCHANGED" : input.direction === "TARGET" ? "CHANGED" : (absolute > 0) === (input.direction === "HIGHER") ? "IMPROVED" : "WORSENED"
  const verdict =
    status === "UNCHANGED"
      ? "sem mudança"
      : `${status === "IMPROVED" ? "melhorou" : status === "WORSENED" ? "piorou" : absolute > 0 ? "subiu" : "caiu"} ${percent !== null ? percentText(percent) : formatIndicatorValue(Math.abs(absolute), input.unit)}`
  const statement = `${since}, ${input.indicatorName} foi de ${formatIndicatorValue(before.value, input.unit)} (${windowDays} dias antes, ${sampleText(before)}) para ${formatIndicatorValue(after.value, input.unit)} (${windowDays} dias depois, ${sampleText(after)}): ${verdict}. ${input.reference.kind === "FEEDBACK" ? "O dia do feedback" : "O dia do início"} não entra em nenhum dos lados.`
  return { ...base, status, windowDays, before, after, change: { absolute, percent }, statement }
}

/**
 * EVOLUÇÃO COMO CONDIÇÃO de política ("sem evolução desde o último feedback"). Aqui o limiar é EXPLÍCITO e vem da regra:
 * `minimumImprovementPercent` = quanto o indicador precisa ter andado para o lado certo para contar como evolução (0 = qualquer
 * melhora). Sem comparação possível (cedo demais, poucos dias medidos, sem medição diária, indicador sem lado certo ou valor de
 * partida zero) o resultado é INCONCLUSIVO — nunca "sem evolução".
 */
export type EvolutionJudgement = { conclusive: true; improved: boolean; improvementPercent: number } | { conclusive: false; reasonCode: string }

export function judgeEvolution(evolution: Evolution, minimumImprovementPercent: number): EvolutionJudgement {
  if (evolution.status === "TOO_RECENT" || evolution.status === "INSUFFICIENT_DATA" || evolution.status === "NOT_AVAILABLE") return { conclusive: false, reasonCode: `EVOLUTION_${evolution.status}` }
  if (evolution.direction === "TARGET") return { conclusive: false, reasonCode: "EVOLUTION_NO_DIRECTION" }
  if (!evolution.change || evolution.change.percent === null) return { conclusive: false, reasonCode: "EVOLUTION_NO_BASELINE" }
  // Melhora = variação para o lado certo (menor é melhor: queda é melhora).
  // `+ 0` evita o zero negativo quando não houve mudança.
  const improvementPercent = round2(evolution.direction === "LOWER" ? -evolution.change.percent : evolution.change.percent) + 0
  return { conclusive: true, improvementPercent, improved: improvementPercent > 0 && improvementPercent >= minimumImprovementPercent }
}
