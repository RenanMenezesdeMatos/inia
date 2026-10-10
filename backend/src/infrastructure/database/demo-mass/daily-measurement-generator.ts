import { absenceStartFor, closedReferencePeriods, DEMO_TZ_OFFSET, type DemoReferencePeriod } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { CANONICAL_OPERATORS } from "./demo-identities.js"
import { DEMO_VOLUME_INDICATOR, valueBounds, valueDecimals, type GroupSpec } from "./indicator-catalog.js"
import { shiftFor } from "./interaction-generator.js"
import { targetFor, valueFromAchievement, type IndicatorDefinition, type IndicatorPerformanceRow, type PerformanceDataset } from "./performance-generator.js"
import type { Persona } from "./personas.js"
import { clamp, roundTo, type Random } from "./random.js"
import { demoNonProductiveDates } from "./demo-employment-status.js"
import { DEMO_SCHEDULE_PAST_DAYS, demoScheduledWorkDates } from "./demo-work-schedules.js"
import { placementAt, type DemoPerson, type DemoStructure } from "./structure-generator.js"

/**
 * CAMADA 1 — medições operacionais DIÁRIAS (indicator_measurements, granularity DAILY) para os
 * últimos 180 dias corridos até a data de referência. Não é ruído independente: cada dia é
 * ancorado no FECHAMENTO OFICIAL mensal já gerado (camada 2) do mesmo operador × indicador —
 * o nível diário médio do mês reproduz o atingimento oficial daquele mês, com a "textura" da
 * persona por cima (dias ruins ocasionais, regimes semanais, tendência suave). Assim o agregado
 * operacional do mês fica fortemente correlacionado ao oficial (desvio controlado), sem nunca
 * recalcular/alterar o oficial.
 *
 * Determinismo por DATA: o valor de um (operador, indicador, dia) depende só da chave — rodar
 * amanhã acrescenta um dia e mantém todos os outros idênticos.
 *
 * Componentes por semântica (migration 052): WEIGHTED_AVERAGE guarda numerador = total e
 * denominador = volume; RATE guarda ocorrências/elegíveis; LATEST guarda só o snapshot.
 * Dias sem amostra (sem avaliação de qualidade, sem resposta de URA) NÃO geram linha — SEM
 * DADOS de verdade, nunca zero. Só dias úteis (a operação demo não trabalha sáb/dom).
 */
export const DAILY_HISTORY_DAYS = 180

export type DailyMeasurementRow = {
  id: string
  indicatorDefinitionId: string
  indicatorCode: string
  personId: string
  day: string
  periodStart: string
  periodEnd: string
  value: number
  numerator: number | null
  denominator: number | null
  sampleCount: number | null
}

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS)
}
function isoFromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}
function weekdayOf(day: number): number {
  return new Date(day * DAY_MS).getUTCDay()
}
function isBusinessDay(day: number): boolean {
  const weekday = weekdayOf(day)
  return weekday !== 0 && weekday !== 6
}
function addDays(iso: string, days: number): string {
  return isoFromDayNumber(dayNumber(iso) + days)
}
function periodOf(iso: string): string {
  return iso.slice(0, 7)
}
function daysInMonth(period: string): number {
  const [year, month] = period.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Dias cobertos pela janela do operador: 180 dias até a referência, respeitando admissão e
 * afastamento. Sem escala explícita = dias úteis (fallback legado seg–sex); com calendário demo
 * (demo-work-schedules.ts) = os dias PROGRAMADOS para trabalho (um 6x1 mede no sábado) e, fora do
 * horizonte do calendário, dias úteis.
 */
export function dailyWindowFor(person: DemoPerson, referenceDate: string): string[] {
  const end = dayNumber(person.absentLastPeriod ? absenceStartFor(referenceDate) : referenceDate)
  const start = Math.max(dayNumber(referenceDate) - (DAILY_HISTORY_DAYS - 1), person.lateHire ? dayNumber(addDays(person.hiredAt, 7)) : 0)
  const scheduled = demoScheduledWorkDates(person, referenceDate)
  const nonProductive = demoNonProductiveDates(person, referenceDate)
  const horizonStart = dayNumber(addDays(referenceDate, -DEMO_SCHEDULE_PAST_DAYS))
  const days: string[] = []
  for (let day = start; day <= end; day += 1) {
    const iso = isoFromDayNumber(day)
    const inHorizon = scheduled !== null && day >= horizonStart
    if (nonProductive(iso)) continue
    if (inHorizon ? scheduled.has(iso) : isBusinessDay(day)) days.push(iso)
  }
  return days
}

/** Fechamentos oficiais do operador, indexados por "CODE:AAAA-MM" — a âncora do nível diário. */
export type OfficialIndex = Map<string, Map<string, IndicatorPerformanceRow>>

export function indexOfficialRows(performance: PerformanceDataset): OfficialIndex {
  const index: OfficialIndex = new Map()
  for (const row of performance.indicatorRows) {
    let byKey = index.get(row.personId)
    if (!byKey) {
      byKey = new Map()
      index.set(row.personId, byKey)
    }
    byKey.set(`${row.indicatorCode}:${row.referencePeriod}`, row)
  }
  return index
}

/** Nível (atingimento %) oficial do mês, ou do mês mais próximo com fechamento (antes de abril = abril; depois de setembro = setembro). */
function anchorAchievement(official: Map<string, IndicatorPerformanceRow>, code: string, period: string, periods: DemoReferencePeriod[]): { achievement: number; period: string } | null {
  const exact = official.get(`${code}:${period}`)
  if (exact) return { achievement: exact.achievementPercent, period }
  const first: string = periods[0]!
  const last: string = periods[periods.length - 1]!
  // Antes da 1ª competência = nível da 1ª; depois da última (mês corrente, ainda sem fechamento)
  // = nível da última + tendência — a camada operacional continua, o fechamento não existe.
  const nearest: string | null = period < first ? first : period > last ? last : null
  if (nearest === null) return null // mês dentro da janela oficial SEM fechamento = indicador indisponível no mês (lacuna proposital)
  const row = official.get(`${code}:${nearest}`)
  return row ? { achievement: row.achievementPercent, period: nearest } : null
}

/**
 * Nível diário pedido pela persona: âncora mensal + textura. Evolução/queda interpolam entre o
 * mês atual e o seguinte (tendência suave, não degrau); volátil alterna regimes semanais;
 * alta performance tem dias ruins ocasionais. Ruído sempre de média zero — o mês reproduz a
 * âncora.
 */
export function dailyAchievement(persona: Persona, anchor: number, nextAnchor: number | null, previousAnchor: number | null, day: string, random: Random): number {
  const dayIndex = Number(day.slice(8, 10)) - 1
  const monthFraction = dayIndex / (daysInMonth(periodOf(day)) - 1)
  const noise = (stdDev: number) => random.gaussian(0, stdDev)
  switch (persona) {
    case "ALTA_PERFORMANCE":
      return anchor + noise(3) - (random.chance(1 / 15) ? 12 : 0)
    case "EM_EVOLUCAO":
    case "EM_QUEDA": {
      // Inclinação do mês: rumo ao próximo fechamento; no último mês, continua a inclinação do
      // anterior (a história não "para" em setembro).
      const slope = nextAnchor !== null ? nextAnchor - anchor : previousAnchor !== null ? anchor - previousAnchor : 0
      return anchor + slope * (monthFraction - 0.5) + noise(3)
    }
    case "VOLATIL": {
      const week = Math.floor(dayNumber(day) / 7)
      return anchor + (week % 2 === 0 ? 9 : -9) + noise(4)
    }
    case "CRITICO":
      return anchor + noise(5)
    case "MEDIA":
    case "DADOS_INCOMPLETOS":
      return anchor + noise(6)
    default:
      return anchor + noise(4)
  }
}

type Components = { numerator: number | null; denominator: number | null; sampleCount: number | null; value: number } | null

/** Volume base de contatos do dia — depende da jornada, da persona e do dia; nunca constante. */
function dailyContacts(person: DemoPerson, random: Random): number {
  const shift = shiftFor(person)
  const base = shift.workMinutes >= 480 ? random.int(35, 80) : random.int(22, 45)
  const factor = person.persona === "EFICIENTE_BAIXA_QUALIDADE" ? 1.15 : person.persona === "QUALIDADE_BOA_TMA_RUIM" ? 0.8 : 1
  return Math.max(5, Math.round(base * factor * random.float(0.85, 1.15)))
}

/**
 * Componentes coerentes com a semântica do indicador. `value` é SEMPRE recalculado a partir dos
 * componentes (numerador ÷ denominador), nunca o contrário — o que fica persistido é
 * internamente consistente. Retorna null quando o dia não tem amostra (sem avaliação, sem
 * resposta) — SEM DADOS naquele dia.
 */
function buildComponents(code: string, definition: IndicatorDefinition, requestedValue: number, person: DemoPerson, contacts: number, random: Random, uraBlocked: boolean): Components {
  const decimals = valueDecimals(definition.unit)
  const kind = definition.kind
  if (kind === "LATEST") return { numerator: null, denominator: null, sampleCount: null, value: Math.round(requestedValue) }
  if (kind === "WEIGHTED_AVERAGE") {
    let volume: number
    switch (code) {
      case "TMA":
        volume = contacts
        break
      case "TMT":
      case "TEMPO_DIAGNOSTICO":
        volume = random.int(8, 25)
        break
      case "NOTA_URA":
        volume = uraBlocked ? 0 : random.chance(0.12) ? 0 : random.int(1, Math.max(1, Math.round(contacts * 0.18)))
        break
      case "NPS":
        volume = random.chance(0.3) ? 0 : random.int(1, 5)
        break
      case "MONITORIA_QUALIDADE":
        volume = random.chance(0.55) ? 0 : random.chance(0.66) ? 1 : 2
        break
      case "QUALIDADE_ANALISE":
        volume = random.chance(0.4) ? 0 : random.int(1, 3)
        break
      default:
        volume = contacts
    }
    if (volume === 0) return null
    const numerator = roundTo(requestedValue * volume, decimals === 0 ? 0 : 2)
    return { numerator, denominator: volume, sampleCount: volume, value: roundTo(numerator / volume, decimals === 0 ? 0 : 2) }
  }
  if (kind === "RATE") {
    let denominator: number
    switch (code) {
      case "ADERENCIA":
        denominator = shiftFor(person).workMinutes
        break
      case "TEMPO_DISPONIVEL":
        denominator = Math.round(shiftFor(person).workMinutes * random.float(0.9, 1))
        break
      case "TAXA_RETRABALHO":
      case "SLA_24H":
        denominator = random.int(8, 25)
        break
      case "TAXA_RETENCAO":
      case "RECONTATO_CANCELAMENTO":
        denominator = random.int(5, 20)
        break
      default:
        denominator = contacts
    }
    const numerator = clamp(Math.round((requestedValue / 100) * denominator), 0, denominator)
    return { numerator, denominator, sampleCount: denominator, value: roundTo((numerator / denominator) * 100, 2) }
  }
  // AVERAGE/SUM (nenhum indicador diário da massa usa) — valor puro, sem componentes.
  return { numerator: null, denominator: null, sampleCount: null, value: roundTo(requestedValue, decimals) }
}

export function generateOperatorDailyMeasurements(
  structure: DemoStructure,
  definitions: Map<string, IndicatorDefinition>,
  official: OfficialIndex,
  person: DemoPerson,
  referenceDate: string,
  random: Random,
): DailyMeasurementRow[] {
  const periods = closedReferencePeriods(referenceDate)
  const officialRows = official.get(person.id) ?? new Map<string, IndicatorPerformanceRow>()
  const canonical = CANONICAL_OPERATORS.find((candidate) => candidate.operatorOrdinal === person.ordinal)
  const personRandom = random.fork(`daily:${person.key}`)
  // Férias/afastamento curto: 2 semanas civis sem NENHUMA medição (persona de dados
  // incompletos), ancoradas em data absoluta — determinístico por data, não por posição.
  const vacationStart = person.persona === "DADOS_INCOMPLETOS" ? dayNumber("2026-04-01") + personRandom.fork("vacation").int(0, 150) : -1
  const days = dailyWindowFor(person, referenceDate)
  const rows: DailyMeasurementRow[] = []

  for (const day of days) {
    const dayNo = dayNumber(day)
    if (vacationStart >= 0 && dayNo >= vacationStart && dayNo < vacationStart + 14) continue
    const dayRandom = personRandom.fork(`day:${day}`)
    const contacts = dailyContacts(person, dayRandom)
    const period = periodOf(day)
    // Catálogo e meta do Grupo/Subgrupo VIGENTES no dia (placementAt) — uma transferência não reescreve dias anteriores.
    const placement = placementAt(person, day)
    const spec: GroupSpec = structure.teamByKey.get(placement.teamKey!)!.spec
    const placed: DemoPerson = { ...person, teamKey: placement.teamKey, subteamKey: placement.subteamKey }
    for (const indicator of spec.indicators) {
      const definition = definitions.get(indicator.code)!
      if (!definition.dailySupported) continue
      const anchor = anchorAchievement(officialRows, indicator.code, period, periods)
      if (!anchor) continue
      const next = anchorAchievement(officialRows, indicator.code, shiftPeriod(period, 1), periods)
      const previous = anchorAchievement(officialRows, indicator.code, shiftPeriod(period, -1), periods)
      const indicatorRandom = dayRandom.fork(indicator.code)
      const requestedAchievement = dailyAchievement(
        person.persona!,
        anchor.achievement,
        next && next.period !== anchor.period ? next.achievement : null,
        previous && previous.period !== anchor.period ? previous.achievement : null,
        day,
        indicatorRandom,
      )
      // Meta vigente do próprio mês (inclusive o corrente, sem fechamento) — a meta não depende de fechamento.
      const target = targetFor(spec, indicator, placed, period)
      const bounds = valueBounds(indicator.code, definition.unit)
      const requestedValue = clamp(valueFromAchievement(requestedAchievement, target, definition.direction), bounds.min, bounds.max ?? Number.POSITIVE_INFINITY)
      const uraBlocked = indicator.code === "NOTA_URA" && (canonical?.missingUraPeriods ?? []).includes(period)
      const components = buildComponents(indicator.code, definition, requestedValue, person, contacts, indicatorRandom, uraBlocked)
      if (!components) continue
      rows.push({
        id: demoId(`daily:${person.key}:${indicator.code}:${day}`),
        indicatorDefinitionId: definition.id,
        indicatorCode: indicator.code,
        personId: person.id,
        day,
        periodStart: `${day}T00:00:00${DEMO_TZ_OFFSET}`,
        periodEnd: `${day}T23:59:59${DEMO_TZ_OFFSET}`,
        value: components.value,
        numerator: components.numerator,
        denominator: components.denominator,
        sampleCount: components.sampleCount,
      })
    }
    // VOLUME/PRODUÇÃO do dia (DEMO_VOLUME_INDICATOR, soma de contagens): o mesmo `contacts` que alimenta
    // o denominador do TMA — a produção diária real da pessoa, todos os dias trabalhados, sem fechamento oficial.
    const volume = definitions.get(DEMO_VOLUME_INDICATOR.code)
    if (volume?.dailySupported) {
      rows.push({
        id: demoId(`daily:${person.key}:${DEMO_VOLUME_INDICATOR.code}:${day}`),
        indicatorDefinitionId: volume.id,
        indicatorCode: DEMO_VOLUME_INDICATOR.code,
        personId: person.id,
        day,
        periodStart: `${day}T00:00:00${DEMO_TZ_OFFSET}`,
        periodEnd: `${day}T23:59:59${DEMO_TZ_OFFSET}`,
        value: contacts,
        numerator: contacts,
        denominator: 1,
        sampleCount: contacts,
      })
    }
  }
  return rows
}

/** Estimativa antes de inserir (Parte 95): operadores × dias úteis × indicadores diários médios. */
export function estimateDailyRows(structure: DemoStructure, definitions: Map<string, IndicatorDefinition>, referenceDate: string): { operators: number; businessDays: number; averageDailyIndicators: number; estimatedRows: number } {
  const operators = structure.people.filter((person) => person.role === "OPERATOR")
  const businessDays = dailyWindowFor({ ...operators[0]!, lateHire: false, absentLastPeriod: false }, referenceDate).length
  const volume = definitions.get(DEMO_VOLUME_INDICATOR.code)?.dailySupported ? 1 : 0
  const perOperator = operators.map((person) => structure.teamByKey.get(person.teamKey!)!.spec.indicators.filter((indicator) => definitions.get(indicator.code)?.dailySupported).length + volume)
  const averageDailyIndicators = perOperator.reduce((sum, count) => sum + count, 0) / operators.length
  return { operators: operators.length, businessDays, averageDailyIndicators, estimatedRows: Math.round(operators.length * businessDays * averageDailyIndicators) }
}

/** "Hoje" local (-03) como AAAA-MM-DD — data de referência padrão da massa diária. */
export function localToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

