import { describe, expect, it } from "vitest"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { closedReferencePeriods } from "./demo-constants.js"
import { effectiveWeight, valueBounds } from "./indicator-catalog.js"
import { achievementFromValue, quartileByRank, valueFromAchievement, type IndicatorPerformanceRow } from "./performance-generator.js"
import { firstPerformancePeriod, type DemoPerson } from "./structure-generator.js"

const definitions = stubIndicatorDefinitions()
const mass = buildDemoMass(definitions, 20260915, "2026-09-15")
const PERIODS = mass.closedPeriods
const LAST_PERIOD = PERIODS[PERIODS.length - 1]!
const { structure, performance } = mass
const operators = structure.people.filter((person) => person.role === "OPERATOR")
const rowsByPerson = new Map<string, IndicatorPerformanceRow[]>()
for (const row of performance.indicatorRows) {
  const list = rowsByPerson.get(row.personId) ?? []
  list.push(row)
  rowsByPerson.set(row.personId, list)
}
const rowsOf = (person: DemoPerson) => rowsByPerson.get(person.id) ?? []
const prvOf = (person: DemoPerson) => performance.prvRows.filter((row) => row.personId === person.id).sort((a, b) => a.referencePeriod.localeCompare(b.referencePeriod))
const operator = (ordinal: number) => structure.byKey.get(`operator:${String(ordinal).padStart(4, "0")}`)!
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

describe("performance demo — coerência com meta e direção", () => {
  it("valor × meta × direção sempre batem com o atingimento persistido", () => {
    for (const row of performance.indicatorRows) {
      const definition = [...definitions.values()].find((candidate) => candidate.id === row.indicatorDefinitionId)!
      expect(row.achievementPercent).toBe(achievementFromValue(row.value, row.targetValue, definition.direction))
      const withinTarget = definition.direction === "LOWER" ? row.value <= row.targetValue : row.value >= row.targetValue
      expect(row.achievementPercent >= 100).toBe(withinTarget)
      const bounds = valueBounds(row.indicatorCode, definition.unit)
      expect(row.value).toBeGreaterThanOrEqual(bounds.min)
      if (bounds.max !== null) expect(row.value).toBeLessThanOrEqual(bounds.max)
    }
  })

  it("funções de conversão são inversas (LOWER: meta/valor)", () => {
    expect(valueFromAchievement(120, 600, "LOWER")).toBe(500)
    expect(achievementFromValue(500, 600, "LOWER")).toBe(120)
    expect(achievementFromValue(96, 90, "HIGHER")).toBe(106.7)
    expect(quartileByRank(0, 100)).toBe("Q1")
    expect(quartileByRank(99, 100)).toBe("Q4")
  })

  it("todo operador tem fechamento em toda competência (exceto antes da admissão ou afastado no último mês) e nunca fica vazio", () => {
    for (const person of operators) {
      const periods = new Set(rowsOf(person).map((row) => row.referencePeriod))
      const expected = PERIODS.filter((period) => period >= (person.lateHire ? firstPerformancePeriod(person) : PERIODS[0]!)).filter((period) => !(person.absentLastPeriod && period === LAST_PERIOD))
      expect([...periods].sort()).toEqual(expected)
      expect(rowsOf(person).length).toBeGreaterThan(0)
    }
  })

  it("PRV existe pra cada competência com fechamento, é plausível e tem peso oficial em toda linha", () => {
    for (const person of operators) {
      const prv = prvOf(person)
      expect(prv.map((row) => row.referencePeriod)).toEqual([...new Set(rowsOf(person).map((row) => row.referencePeriod))].sort())
      for (const row of prv) {
        const components = rowsOf(person).filter((candidate) => candidate.referencePeriod === row.referencePeriod)
        const max = Math.max(...components.map((component) => Math.min(component.achievementPercent, 120)))
        const min = Math.min(...components.map((component) => Math.min(component.achievementPercent, 120)))
        expect(row.achievementPercent).toBeGreaterThanOrEqual(min - 0.1)
        expect(row.achievementPercent).toBeLessThanOrEqual(max + 0.1)
      }
    }
    const team = structure.teamByKey.get("b2c-retencao")!
    const weightsBefore = team.spec.indicators.map((indicator) => effectiveWeight(indicator, "2026-06")).reduce((sum, weight) => sum + weight, 0)
    const weightsAfter = team.spec.indicators.map((indicator) => effectiveWeight(indicator, "2026-07")).reduce((sum, weight) => sum + weight, 0)
    expect(weightsBefore).toBe(100)
    expect(weightsAfter).toBe(100)
    for (const candidate of structure.teams) expect(candidate.spec.indicators.reduce((sum, indicator) => sum + indicator.weight, 0)).toBe(100)
  })

  it("personas contam histórias: alta bate quase tudo, queda piora, evolução melhora, crítica falha", () => {
    const share = (person: DemoPerson, predicate: (row: IndicatorPerformanceRow) => boolean) => rowsOf(person).filter(predicate).length / rowsOf(person).length
    for (const person of operators.filter((candidate) => candidate.persona === "ALTA_PERFORMANCE")) expect(share(person, (row) => row.achievementPercent >= 100)).toBeGreaterThanOrEqual(0.85)
    for (const person of operators.filter((candidate) => candidate.persona === "CRITICO")) expect(share(person, (row) => row.achievementPercent < 100)).toBeGreaterThanOrEqual(0.9)
    for (const person of operators.filter((candidate) => candidate.persona === "EM_QUEDA" && !candidate.lateHire)) {
      const prv = prvOf(person)
      expect(prv[0]!.achievementPercent).toBeGreaterThan(prv[prv.length - 1]!.achievementPercent + 10)
    }
    for (const person of operators.filter((candidate) => candidate.persona === "EM_EVOLUCAO" && !candidate.lateHire)) {
      const prv = prvOf(person)
      expect(prv[prv.length - 1]!.achievementPercent).toBeGreaterThan(prv[0]!.achievementPercent + 10)
    }
    for (const person of operators.filter((candidate) => candidate.persona === "VOLATIL" && !candidate.lateHire)) {
      const prv = prvOf(person).map((row) => row.achievementPercent)
      const swings = prv.slice(1).map((value, index) => Math.abs(value - prv[index]!))
      expect(average(swings)).toBeGreaterThan(15)
    }
  })

  it("cenários canônicos: Q1 recorrente, Q4 recorrente, TMA alto com qualidade boa, sem Nota URA em jul/ago", () => {
    expect(prvOf(operator(1)).map((row) => row.quartile)).toEqual(Array(6).fill("Q1"))
    expect(prvOf(operator(2)).map((row) => row.quartile)).toEqual(Array(6).fill("Q4"))
    expect(prvOf(operator(2)).map((row) => row.quartile).slice(-3)).toEqual(["Q4", "Q4", "Q4"])
    const camila = rowsOf(operator(5))
    expect(camila.filter((row) => row.indicatorCode === "TMA").every((row) => row.achievementPercent < 100)).toBe(true)
    expect(camila.filter((row) => row.indicatorCode === "MONITORIA_QUALIDADE").every((row) => row.achievementPercent >= 100)).toBe(true)
    const diego = rowsOf(operator(6)).filter((row) => row.indicatorCode === "NOTA_URA").map((row) => row.referencePeriod).sort()
    expect(diego).toEqual(PERIODS.filter((period) => period !== "2026-07" && period !== "2026-08"))
    const renata = rowsOf(operator(10))
    expect(renata.length).toBeLessThan(6 * structure.teamByKey.get(operator(10).teamKey!)!.spec.indicators.length)
  })

  it("quartis Q1..Q4 existem em todo grupo e competência, tanto por indicador quanto no PRV", () => {
    const teamOf = new Map(structure.people.map((person) => [person.id, person.teamKey]))
    const cohorts = new Map<string, Set<string>>()
    for (const row of performance.prvRows) {
      const key = `${teamOf.get(row.personId)}:${row.referencePeriod}`
      cohorts.set(key, (cohorts.get(key) ?? new Set()).add(row.quartile))
    }
    expect(cohorts.size).toBe(structure.teams.length * PERIODS.length)
    for (const quartiles of cohorts.values()) expect([...quartiles].sort()).toEqual(["Q1", "Q2", "Q3", "Q4"])
  })

  it("há Q4 recorrente (3 últimos meses) e Q1 recorrente em vários operadores, e evoluções/quedas em todo subgrupo", () => {
    const streak = (quartile: string) => operators.filter((person) => prvOf(person).slice(-3).map((row) => row.quartile).join() === [quartile, quartile, quartile].join())
    expect(streak("Q4").length).toBeGreaterThan(50)
    expect(streak("Q1").length).toBeGreaterThan(50)
    for (const subteam of structure.subteams) {
      const members = operators.filter((person) => person.subteamKey === subteam.key && !person.lateHire && !person.absentLastPeriod)
      const deltas = members.map((person) => {
        const prv = prvOf(person)
        return prv[prv.length - 1]!.achievementPercent - prv[prv.length - 2]!.achievementPercent
      })
      expect(deltas.some((delta) => delta > 3)).toBe(true)
      expect(deltas.some((delta) => delta < -3)).toBe(true)
    }
  })

  it("metas: uma por grupo×indicador, com histórico (valid_until) onde a meta mudou e overrides por subgrupo", () => {
    const tma = performance.goals.filter((goal) => goal.subjectType === "TEAM" && goal.subjectId === structure.teamByKey.get("b2c-atendimento-geral")!.id && goal.indicatorDefinitionId === definitions.get("TMA")!.id)
    expect(tma.map((goal) => [goal.targetValue, goal.validFrom, goal.validUntil])).toEqual([[420, `${PERIODS[0]}-01`, "2026-06-30"], [400, "2026-07-01", null]])
    expect(performance.goals.filter((goal) => goal.subjectType === "SUBTEAM")).toHaveLength(2)
    const chatRows = performance.indicatorRows.filter((row) => row.indicatorCode === "TMA" && row.subteamId === structure.subteamByKey.get("b2c-atendimento-geral/Chat")!.id)
    expect(chatRows.every((row) => row.targetValue === 300)).toBe(true)
    const voiceAugust = performance.indicatorRows.find((row) => row.indicatorCode === "TMA" && row.referencePeriod === "2026-08" && row.subteamId === structure.subteamByKey.get("b2c-atendimento-geral/Voz")!.id)!
    expect(voiceAugust.targetValue).toBe(400)
  })

})

describe("fechamento oficial = só mês civil COMPLETO (nunca o mês corrente)", () => {
  it("com referência em 16/09/2026 as competências são mar..ago/2026; setembro não existe na camada oficial", () => {
    expect(closedReferencePeriods("2026-09-16")).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"])
    expect(mass.closedPeriods).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"])
    expect(performance.indicatorRows.some((row) => row.referencePeriod === "2026-09")).toBe(false)
    expect(performance.prvRows.some((row) => row.referencePeriod === "2026-09")).toBe(false)
    expect(new Set(performance.indicatorRows.map((row) => row.referencePeriod)).size).toBe(6)
  })

  it("para QUALQUER referência no meio do mês, nenhum fechamento oficial (indicador, PRV, quartil, peso) usa o mês corrente", () => {
    for (const reference of ["2026-09-01", "2026-09-16", "2026-09-30", "2026-12-31", "2027-01-15", "2026-02-28"]) {
      const periods = closedReferencePeriods(reference)
      expect(periods).toHaveLength(6)
      expect(periods.every((period) => period < reference.slice(0, 7))).toBe(true)
      const sample = buildDemoMass(definitions, 20260915, reference)
      const current = reference.slice(0, 7)
      expect(sample.performance.indicatorRows.some((row) => row.referencePeriod >= current)).toBe(false)
      expect(sample.performance.prvRows.some((row) => row.referencePeriod >= current)).toBe(false)
      expect(sample.performance.indicatorRows.every((row) => row.weightPercent > 0 && ["Q1", "Q2", "Q3", "Q4"].includes(row.quartile))).toBe(true)
    }
  })
})
