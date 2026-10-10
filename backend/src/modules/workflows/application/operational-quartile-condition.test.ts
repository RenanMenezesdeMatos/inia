import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { evaluateDataCondition, type EvaluationOptions } from "./condition-evaluator.js"
import { runEmployeeRanking, runEmployeeSelection } from "./select-employees-executor.js"
import { validateDataConditionConfig } from "./validate-workflow-for-publish.js"

const NOW = new Date("2026-09-16T14:30:00-03:00")
const TZ = "America/Fortaleza"

/**
 * Fake: TMA (segundos, LOWER) dos últimos 7 dias por colaborador (5 dias úteis, 1 contato/dia) +
 * o quartil OFICIAL do último fechamento (employee_indicator_performance) — duas camadas, duas
 * tabelas, nunca misturadas.
 */
function fakeDb(tmaByOperator: Record<string, number | null>, officialQuartile: Record<string, string> = {}, direction = "LOWER"): Database {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("select timezone from operations")) return { rows: [{ timezone: TZ }], rowCount: 1 }
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: direction, operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true }], rowCount: 1 }
      if (sql.includes("desired_direction from indicator_definitions")) return { rows: [{ desired_direction: direction }], rowCount: 1 }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params?.[0] as string[]).map((id) => ({ id, organization_id: "org", hired_at: null, operational_capital_code: null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
      if (sql.includes("from employee_indicator_performance eip")) {
        const id = params?.[0] as string
        const quartile = officialQuartile[id]
        if (!quartile) return { rows: [], rowCount: 0 }
        return { rows: [{ id: `perf-${id}`, personId: id, indicatorDefinitionId: "i", indicatorCode: "TMA", subteamId: null, referencePeriod: "2026-08", value: "700", targetValue: "400", achievementPercent: "57.1", weightPercent: "25", quartile, source: "DEMO_SEED" }], rowCount: 1 }
      }
      if (sql.includes("from indicator_measurements")) {
        const ids = params?.[1] as string[]
        const row = (id: string) => {
          const tma = tmaByOperator[id]
          if (tma === null || tma === undefined) return null
          return { avg_value: String(tma), min_value: String(tma), max_value: String(tma), sample_count: "5", numerator_sum: String(tma * 5), denominator_sum: "5", rows_with_components: "5", days_with_data: "5" }
        }
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (row(id) ? [{ subject_id: id, ...row(id) }] : [])), rowCount: 0 }
        return { rows: [row(ids[0]!) ?? { avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const QUARTILE_QUERY = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, source: "OPERATIONAL_QUARTILE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 } }
const IS_Q4 = { historicalQuery: QUARTILE_QUERY, comparator: "EQUALS" as const, thresholdText: "Q4" }
// 8 operadores: TMA de 300 s (melhor) a 1000 s (pior) — LOWER é melhor, então "h" é Q4 e "a" é Q1.
const POPULATION = { a: 300, b: 400, c: 500, d: 600, e: 700, f: 800, g: 900, h: 1000 }
const POPULATION_IDS = Object.keys(POPULATION)

describe("Condition · Quartil operacional (source OPERATIONAL_QUARTILE)", () => {
  it("classifica o colaborador na população do Workflow com a direção oficial: pior TMA = Q4, melhor = Q1", async () => {
    const db = fakeDb(POPULATION)
    const worst = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(worst?.branch).toBe("true")
    expect(worst?.evaluation).toMatchObject({ kind: "operational_quartile", value: "Q4", position: 8, rankedCount: 8, operationalValue: 1000, direction: "LOWER", method: "Média ponderada pelo volume", population: { evaluatedCount: 8, rankedCount: 8, noDataCount: 0, belowCoverageCount: 0 } })
    expect(String(worst?.evaluation.windowLabel)).toContain("10/09/2026")
    const best = await evaluateDataCondition(db, IS_Q4, { operatorId: "a", subjectIds: ["a"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(best?.branch).toBe("false")
    expect(best?.evaluation.value).toBe("Q1")
    const notQ4 = await evaluateDataCondition(db, { ...IS_Q4, comparator: "NOT_EQUALS" }, { operatorId: "a", subjectIds: ["a"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(notQ4?.branch).toBe("true")
  })

  it("HIGHER inverte: com direção HIGHER o maior valor é Q1 — mesma regra do Ranking", async () => {
    const db = fakeDb(POPULATION, {}, "HIGHER")
    const top = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(top?.evaluation.value).toBe("Q1")
    expect(top?.branch).toBe("false")
  })

  it("população menor que 4 com dados → SEM DADOS (INSUFFICIENT_RECURRENCE), nunca Q4", async () => {
    const db = fakeDb({ a: 300, b: 900, c: 1000 })
    const result = await evaluateDataCondition(db, IS_Q4, { operatorId: "c", subjectIds: ["c"], populationIds: ["a", "b", "c"] }, NOW, { timeZone: TZ })
    expect(result?.branch).toBe("no_data")
    expect(result?.evaluation.value).toBeNull()
    expect(String(result?.evaluation.reasonText)).toContain("mínimo 4")
  })

  it("colaborador sem medição na janela → SEM DADOS (NO_VALUE); os outros continuam classificados sem ele", async () => {
    const db = fakeDb({ ...POPULATION, h: null })
    const missing = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(missing?.branch).toBe("no_data")
    expect(missing?.evaluation.reason).toBe("NO_VALUE")
    expect(missing?.evaluation.population).toMatchObject({ evaluatedCount: 8, rankedCount: 7, noDataCount: 1 })
    const nowWorst = await evaluateDataCondition(db, IS_Q4, { operatorId: "g", subjectIds: ["g"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(nowWorst?.evaluation.value).toBe("Q4")
  })

  it("indicador TARGET (sem direção) → SEM DADOS, nunca inventa quartil", async () => {
    const db = fakeDb(POPULATION, {}, "TARGET")
    const result = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(result?.branch).toBe("no_data")
    expect(String(result?.evaluation.reasonText)).toContain("HIGHER/LOWER")
  })

  it("EXEMPLO CRÍTICO: Q4 OFICIAL no último fechamento (performance) E Q4 OPERACIONAL de TMA nos últimos 7 dias → as duas Conditions TRUE, cada uma da sua camada", async () => {
    const db = fakeDb(POPULATION, { h: "Q4", a: "Q1" })
    const official = await evaluateDataCondition(db, { performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" }, comparator: "EQUALS", thresholdText: "Q4" }, { operatorId: "h", subjectIds: ["h"] }, NOW, { timeZone: TZ })
    expect(official?.branch).toBe("true")
    expect(official?.evaluation).toMatchObject({ kind: "performance", referencePeriod: "2026-08", value: "Q4" }) // lido da fonte oficial, nunca calculado
    const operational = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(operational?.branch).toBe("true")
    expect(operational?.evaluation).toMatchObject({ kind: "operational_quartile", value: "Q4", source: "OPERATIONAL_QUARTILE" })
    // "a" é Q1 nas duas camadas: oficial TRUE só se fosse Q1; operacional Q4 é FALSE.
    const officialA = await evaluateDataCondition(db, { performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" }, comparator: "EQUALS", thresholdText: "Q4" }, { operatorId: "a", subjectIds: ["a"] }, NOW, { timeZone: TZ })
    expect(officialA?.branch).toBe("false")
    const operationalA = await evaluateDataCondition(db, IS_Q4, { operatorId: "a", subjectIds: ["a"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(operationalA?.branch).toBe("false")
  })

  it("Condition e Ranking dão o MESMO quartil pra cada colaborador (uma implementação só)", async () => {
    const db = fakeDb(POPULATION)
    const ranking = { source: "MEASUREMENT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 }, selection: "OPERATIONAL_QUARTILE" as const, operationalQuartile: "Q4" as const, rankingBasis: "VALUE" as const }
    const ranked = await runEmployeeRanking(db, "org", ranking, POPULATION_IDS, NOW, { timeZone: TZ })
    const viaCondition: string[] = []
    for (const id of POPULATION_IDS) {
      const result = await evaluateDataCondition(db, IS_Q4, { operatorId: id, subjectIds: [id], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
      if (result?.branch === "true") viaCondition.push(id)
    }
    expect(viaCondition.sort()).toEqual([...ranked.memberIds].sort())
    expect(viaCondition).toEqual(["g", "h"])
  })

  it("critério de Selecionar colaboradores: N candidatos, UMA resolução em lote (cache por execução, nunca N+1)", async () => {
    const db = fakeDb(POPULATION)
    const options: EvaluationOptions = { timeZone: TZ }
    const selection = await runEmployeeSelection(db, IS_Q4, POPULATION_IDS, NOW, options)
    expect(selection.memberIds).toEqual(["g", "h"])
    expect(selection.notMatchedCount).toBe(6)
    const measurementQueries = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(([sql]) => String(sql).includes("from indicator_measurements"))
    expect(measurementQueries).toHaveLength(1)
  })

  it("cobertura mínima também vale aqui: quem está abaixo fica fora da classificação como SEM DADOS", async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const base = fakeDb(POPULATION)
        if (sql.includes("group by m.subject_id")) {
          const rows = (await base.query(sql, params)).rows as { subject_id: string; days_with_data: string }[]
          return { rows: rows.map((row) => (row.subject_id === "h" ? { ...row, days_with_data: "1", sample_count: "1" } : row)), rowCount: 0 }
        }
        return base.query(sql, params)
      }),
    } as unknown as Database
    const result = await evaluateDataCondition(db, { ...IS_Q4, historicalQuery: { ...QUARTILE_QUERY, minimumCoverage: 0.6 } }, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { timeZone: TZ })
    expect(result?.branch).toBe("no_data")
    expect(result?.evaluation.reason).toBe("BELOW_MINIMUM_COVERAGE")
    expect(result?.evaluation.population).toMatchObject({ rankedCount: 7, belowCoverageCount: 1 })
  })

  it("publish: exige indicador, janela operacional (nunca fechamentos), agregação de valor, comparador É/NÃO É e Q1..Q4", () => {
    const ok = () => validateDataConditionConfig("X", IS_Q4, "ERR")
    expect(ok).not.toThrow()
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, historicalQuery: { ...QUARTILE_QUERY, period: { kind: "CLOSURES", unit: "MONTH", count: 1 } } }, "ERR")).toThrow(/fechamentos/)
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, historicalQuery: { ...QUARTILE_QUERY, aggregation: "COUNT" } }, "ERR")).toThrow(/Quantidade de ocorrências/)
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, thresholdText: "Q5" }, "ERR")).toThrow()
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, comparator: "GT" }, "ERR")).toThrow(/operador incompatível/)
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, comparator: "CONTAINS" }, "ERR")).toThrow(/É igual a/)
    expect(() => validateDataConditionConfig("X", { ...IS_Q4, historicalQuery: { ...QUARTILE_QUERY, compareTo: { kind: "GOAL" } } }, "ERR")).toThrow(/Comparar com/)
  })
})
