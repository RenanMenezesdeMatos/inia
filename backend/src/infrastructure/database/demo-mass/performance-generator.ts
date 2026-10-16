import { closureComponents } from "./closure-components.js"
import { type DemoReferencePeriod } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { CANONICAL_OPERATORS } from "./demo-identities.js"
import { effectiveTarget, effectiveWeight, QUALITY_CODE, valueBounds, valueDecimals, type GroupSpec, type IndicatorGoal } from "./indicator-catalog.js"
import type { Persona } from "./personas.js"
import { clamp, roundTo, type Random } from "./random.js"
import { firstPerformancePeriod, placementAt, subteamKey, type DemoPerson, type DemoStructure } from "./structure-generator.js"

/** Definição real lida de `indicator_definitions` — direção, semântica de agregação operacional e
 * suporte a medição diária vêm do banco (migration 052), nunca do nome. */
export type IndicatorDefinition = {
  id: string
  code: string
  unit: string
  direction: "HIGHER" | "LOWER" | "TARGET"
  kind: "WEIGHTED_AVERAGE" | "RATE" | "AVERAGE" | "SUM" | "LATEST"
  dailySupported: boolean
}

export type GoalRow = {
  id: string
  indicatorDefinitionId: string
  subjectType: "TEAM" | "SUBTEAM"
  subjectId: string
  targetValue: number
  validFrom: string
  validUntil: string | null
}

export type IndicatorPerformanceRow = {
  id: string
  personId: string
  indicatorDefinitionId: string
  indicatorCode: string
  subteamId: string | null
  referencePeriod: DemoReferencePeriod
  value: number
  targetValue: number
  achievementPercent: number
  weightPercent: number
  quartile: Quartile
  /** Componentes do valor oficial (contrato @2): só para Taxa/Média ponderada — ver closure-components.ts. */
  numerator: number | null
  denominator: number | null
}

export type PrvPerformanceRow = {
  id: string
  personId: string
  subteamId: string | null
  referencePeriod: DemoReferencePeriod
  achievementPercent: number
  quartile: Quartile
}

export type Quartile = "Q1" | "Q2" | "Q3" | "Q4"

/** Camada 2 — fechamentos OFICIAIS (metas, indicador × competência, PRV). As medições
 * operacionais diárias (camada 1) ficam em daily-measurement-generator.ts, ancoradas nestes. */
export type PerformanceDataset = {
  goals: GoalRow[]
  indicatorRows: IndicatorPerformanceRow[]
  prvRows: PrvPerformanceRow[]
}

/** Teto por componente no PRV — programas reais limitam o quanto um indicador "carrega" os outros. */
export const PRV_COMPONENT_CAP = 120

/**
 * Nível de atingimento (%) que a persona "pede" pra um indicador numa competência. Índice do mês
 * 0..5 (abril..setembro). `bias` é um viés fixo por pessoa×indicador (sorteado uma vez) que dá
 * identidade à persona MÉDIA/PRV PARCIAL sem virar ruído mês a mês.
 */
export function personaAchievement(
  persona: Persona,
  monthIndex: number,
  role: "QUALITY" | "EFFICIENCY" | "OTHER",
  indicatorIndex: number,
  bias: number,
  volatilePhase: 0 | 1,
  random: Random,
): number {
  const noise = (stdDev: number) => random.gaussian(0, stdDev)
  switch (persona) {
    case "ALTA_PERFORMANCE":
      return 107 + noise(2.5)
    case "MEDIA":
    case "DADOS_INCOMPLETOS":
      return 100 + bias + noise(4)
    case "CRITICO":
      return Math.min(95, 84 + noise(3.5))
    case "EM_EVOLUCAO":
      return 84 + monthIndex * 5.2 + noise(2.5)
    case "EM_QUEDA":
      return 110 - monthIndex * 5.2 + noise(2.5)
    case "EFICIENTE_BAIXA_QUALIDADE":
      return role === "EFFICIENCY" ? 112 + noise(2.5) : role === "QUALITY" ? 85 + noise(2.5) : 100 + bias / 2 + noise(3)
    case "QUALIDADE_BOA_TMA_RUIM":
      return role === "QUALITY" ? 110 + noise(2) : role === "EFFICIENCY" ? 84 + noise(2.5) : 100 + bias / 2 + noise(3)
    case "PRV_PARCIAL":
      return (indicatorIndex % 2 === 0 ? 108 : 88) + noise(3)
    case "VOLATIL":
      return ((monthIndex + volatilePhase) % 2 === 0 ? 112 : 86) + noise(3)
  }
}

/** Valor bruto coerente com meta + direção oficial: HIGHER → meta×a; LOWER → meta/a. */
export function valueFromAchievement(achievement: number, target: number, direction: IndicatorDefinition["direction"]): number {
  if (direction === "TARGET") throw new Error("A massa demo não usa indicadores com direção TARGET — desenhe o modelo antes de gerar.")
  const ratio = Math.max(0.5, achievement / 100)
  return direction === "HIGHER" ? target * ratio : target / ratio
}

/** Atingimento oficial (%) a partir do valor persistido — a MESMA semântica dos fechamentos existentes (seed 001). */
export function achievementFromValue(value: number, target: number, direction: IndicatorDefinition["direction"]): number {
  if (direction === "TARGET") throw new Error("Direção TARGET não suportada pela massa demo.")
  const withinTarget = direction === "LOWER" ? value <= target : value >= target
  const rounded = direction === "HIGHER" ? roundTo((value / target) * 100, 1) : roundTo(value <= 0 ? 0 : (target / value) * 100, 1)
  // O arredondamento a 1 casa nunca pode contradizer "dentro/fora da meta" (regra única do analytics: ≥ 100 = dentro).
  if (withinTarget && rounded < 100) return 100
  if (!withinTarget && rounded >= 100) return 99.9
  return rounded
}

/** Q1 = melhor 25% … Q4 = pior 25%, ranqueado pelo atingimento (desc) dentro do cohort. */
export function quartileByRank(position: number, total: number): Quartile {
  const fraction = (position + 1) / total
  if (fraction <= 0.25) return "Q1"
  if (fraction <= 0.5) return "Q2"
  if (fraction <= 0.75) return "Q3"
  return "Q4"
}

function periodBounds(period: string): { validFrom: string; dayBefore: string } {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const previous = new Date(Date.UTC(year, month - 1, 0))
  const dayBefore = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`
  return { validFrom: `${period}-01`, dayBefore }
}

export function generateGoals(structure: DemoStructure, definitions: Map<string, IndicatorDefinition>, periods: DemoReferencePeriod[]): GoalRow[] {
  const rows: GoalRow[] = []
  const firstPeriod = periods[0]!
  for (const team of structure.teams) {
    for (const indicator of team.spec.indicators) {
      const definition = definitions.get(indicator.code)!
      if (indicator.targetFrom) {
        rows.push({
          id: demoId(`goal:${team.key}:${indicator.code}:${firstPeriod}`), indicatorDefinitionId: definition.id, subjectType: "TEAM", subjectId: team.id,
          targetValue: indicator.target, validFrom: periodBounds(firstPeriod).validFrom, validUntil: periodBounds(indicator.targetFrom.period).dayBefore,
        })
        rows.push({
          id: demoId(`goal:${team.key}:${indicator.code}:${indicator.targetFrom.period}`), indicatorDefinitionId: definition.id, subjectType: "TEAM", subjectId: team.id,
          targetValue: indicator.targetFrom.target, validFrom: periodBounds(indicator.targetFrom.period).validFrom, validUntil: null,
        })
      } else {
        rows.push({
          id: demoId(`goal:${team.key}:${indicator.code}:${firstPeriod}`), indicatorDefinitionId: definition.id, subjectType: "TEAM", subjectId: team.id,
          targetValue: indicator.target, validFrom: periodBounds(firstPeriod).validFrom, validUntil: null,
        })
      }
    }
    for (const override of team.spec.subgroupGoals ?? []) {
      const subteam = structure.subteamByKey.get(subteamKey(team.key, override.subgroup))!
      rows.push({
        id: demoId(`goal:${subteam.key}:${override.code}:${firstPeriod}`), indicatorDefinitionId: definitions.get(override.code)!.id, subjectType: "SUBTEAM", subjectId: subteam.id,
        targetValue: override.target, validFrom: periodBounds(firstPeriod).validFrom, validUntil: null,
      })
    }
  }
  return rows
}

/** Meta que vale pra ESTA pessoa nesta competência: Subgrupo dela (se houver override) senão Grupo. */
export function targetFor(spec: GroupSpec, indicator: IndicatorGoal, person: DemoPerson, period: DemoReferencePeriod): number {
  const subgroup = person.subteamKey?.split("/")[1]
  const override = spec.subgroupGoals?.find((goal) => goal.code === indicator.code && goal.subgroup === subgroup)
  return override ? override.target : effectiveTarget(indicator, period)
}

function indicatorRole(spec: GroupSpec, code: string): "QUALITY" | "EFFICIENCY" | "OTHER" {
  if (code === QUALITY_CODE) return "QUALITY"
  if (code === spec.efficiencyCode) return "EFFICIENCY"
  return "OTHER"
}

/** Lacunas propositais (competência × indicador) por operador — nunca um operador totalmente vazio. */
function missingCells(person: DemoPerson, spec: GroupSpec, random: Random, periods: DemoReferencePeriod[]): Set<string> {
  const missing = new Set<string>()
  const canonical = CANONICAL_OPERATORS.find((candidate) => candidate.operatorOrdinal === person.ordinal)
  for (const period of canonical?.missingUraPeriods ?? []) missing.add(`${period}:NOTA_URA`)
  if (person.persona === "DADOS_INCOMPLETOS") {
    const gaps = random.int(1, 2)
    for (let index = 0; index < gaps; index += 1) missing.add(`${random.pick(periods)}:${random.pick(spec.indicators).code}`)
  } else if (!canonical && spec.indicators.some((indicator) => indicator.code === "NOTA_URA")) {
    // Pesquisa da URA sem respostas suficientes no mês: lacuna pequena e realista (~1,5% das células).
    for (const period of periods) if (random.chance(0.015)) missing.add(`${period}:NOTA_URA`)
  }
  return missing
}

/**
 * Fechamentos OFICIAIS (camada 2) — só para as competências FECHADAS recebidas em `periods`
 * (derivadas da data de referência; o mês corrente nunca entra — ver closedReferencePeriods).
 */
export function generatePerformance(structure: DemoStructure, definitions: Map<string, IndicatorDefinition>, random: Random, periods: DemoReferencePeriod[]): PerformanceDataset {
  if (periods.length === 0) throw new Error("A massa demo precisa de pelo menos uma competência fechada.")
  const goals = generateGoals(structure, definitions, periods)
  const indicatorRows: IndicatorPerformanceRow[] = []
  const prvRows: PrvPerformanceRow[] = []

  const operators = structure.people.filter((person) => person.role === "OPERATOR")
  for (const person of operators) {
    const personRandom = random.fork(`performance:${person.key}`)
    // SNAPSHOT ≠ ESTRUTURA ATUAL: a posição que vale é a VIGENTE em cada competência (placementAt).
    // Viés/lacunas/fase consomem o gerador pseudoaleatório UMA vez, pelo catálogo da 1ª competência —
    // assim os fechamentos de quem foi transferido depois continuam byte a byte os mesmos.
    const baseSpec = structure.teamByKey.get(placementAt(person, periods[0]!).teamKey!)!.spec
    const persona = person.persona!
    const biasByCode = new Map(baseSpec.indicators.map((indicator) => [indicator.code, personRandom.float(-6, 6)]))
    const volatilePhase: 0 | 1 = personRandom.chance(0.5) ? 0 : 1
    const missing = missingCells(person, baseSpec, personRandom.fork("gaps"), periods)
    const firstPeriod = person.lateHire ? firstPerformancePeriod(person) : periods[0]!

    periods.forEach((period, monthIndex) => {
      if (period < firstPeriod) return
      // Afastado no último mês fechado: sem fechamento oficial dele (e sem diário/chamadas a partir do dia 15).
      if (person.absentLastPeriod && period === periods[periods.length - 1]) return
      const placement = placementAt(person, period)
      const spec = structure.teamByKey.get(placement.teamKey!)!.spec
      const placed: DemoPerson = { ...person, teamKey: placement.teamKey, subteamKey: placement.subteamKey }
      const subteamId = placement.subteamKey ? structure.subteamByKey.get(placement.subteamKey)!.id : null
      let weightedSum = 0
      let weightTotal = 0
      spec.indicators.forEach((indicator, indicatorIndex) => {
        if (missing.has(`${period}:${indicator.code}`)) return
        const definition = definitions.get(indicator.code)!
        const target = targetFor(spec, indicator, placed, period)
        // Indicador que só existe no catálogo do Grupo novo (depois de uma transferência): viés neutro, determinístico.
        const requested = spec.performanceBias + personaAchievement(persona, monthIndex, indicatorRole(spec, indicator.code), indicatorIndex, biasByCode.get(indicator.code) ?? 0, volatilePhase, personRandom)
        const limits = valueBounds(indicator.code, definition.unit)
        const rawValue = clamp(valueFromAchievement(requested, target, definition.direction), limits.min, limits.max ?? Number.POSITIVE_INFINITY)
        const value = roundTo(rawValue, valueDecimals(definition.unit))
        const achievement = achievementFromValue(value, target, definition.direction)
        const weight = effectiveWeight(indicator, period)
        const id = demoId(`perf:${person.key}:${indicator.code}:${period}`)
        // Numerador/denominador derivados do valor já decidido, pela chave da linha (nunca pelo gerador da pessoa).
        const components = closureComponents({ rowKey: id, code: indicator.code, kind: definition.kind, value })
        indicatorRows.push({
          id, personId: person.id, indicatorDefinitionId: definition.id, indicatorCode: indicator.code,
          subteamId, referencePeriod: period, value, targetValue: target, achievementPercent: achievement, weightPercent: weight, quartile: "Q4",
          numerator: components?.numerator ?? null, denominator: components?.denominator ?? null,
        })
        weightedSum += weight * Math.min(achievement, PRV_COMPONENT_CAP)
        weightTotal += weight
      })
      if (weightTotal > 0) {
        prvRows.push({ id: demoId(`prv:${person.key}:${period}`), personId: person.id, subteamId, referencePeriod: period, achievementPercent: roundTo(weightedSum / weightTotal, 1), quartile: "Q4" })
      }
    })
  }

  assignQuartiles(structure, indicatorRows, prvRows)
  return { goals, indicatorRows, prvRows }
}

/**
 * Quartil oficial por cohort = Grupo × competência (× indicador), ranqueado pelo atingimento. A
 * coorte é o Grupo VIGENTE NA COMPETÊNCIA (placementAt), nunca o Grupo atual: transferir alguém em
 * setembro não muda o ranking de agosto de ninguém.
 */
function assignQuartiles(structure: DemoStructure, indicatorRows: IndicatorPerformanceRow[], prvRows: PrvPerformanceRow[]): void {
  const personById = new Map(structure.people.map((person) => [person.id, person]))
  const cohorts = new Map<string, { achievementPercent: number; quartile: Quartile }[]>()
  const cohortKey = (personId: string, extra: string) => `${placementAt(personById.get(personId)!, extra.slice(0, 7)).teamKey}:${extra}`
  const append = (key: string, row: { achievementPercent: number; quartile: Quartile }) => {
    const rows = cohorts.get(key)
    if (rows) rows.push(row)
    else cohorts.set(key, [row])
  }
  for (const row of indicatorRows) append(cohortKey(row.personId, `${row.referencePeriod}:${row.indicatorCode}`), row)
  for (const row of prvRows) append(cohortKey(row.personId, `${row.referencePeriod}:PRV`), row)
  for (const rows of cohorts.values()) {
    const sorted = [...rows].sort((a, b) => b.achievementPercent - a.achievementPercent)
    sorted.forEach((row, position) => {
      row.quartile = quartileByRank(position, sorted.length)
    })
  }
}
