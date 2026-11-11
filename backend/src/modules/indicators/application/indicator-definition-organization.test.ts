import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { runEmployeeRanking } from "../../workflows/application/select-employees-executor.js"
import { loadIndicatorOperationalDefinition } from "./operational-measurement-resolver.js"

/**
 * Regressão (isolamento entre organizações): o código do indicador só é único por (organização, código).
 * Duas organizações com o MESMO código e definições opostas — a A, mais antiga, com direção HIGHER e
 * estratégia SUM; a B com LOWER e WEIGHTED_AVERAGE. A busca pelo código sozinho (`order by created_at
 * limit 1`) devolvia a linha da A para a B: quartil, ranking e Condition da B calculados com a definição
 * da A. O fake responde a consulta sem organização com a linha mais antiga, como o banco fazia.
 */
const NOW = new Date("2026-09-16T14:30:00-03:00")
const TZ = "America/Fortaleza"
const ORG_A = "org-a"
const ORG_B = "org-b"
const CODE = "TMA"
const DEFINITIONS = [
  { organization_id: ORG_A, created_at: "2026-01-01", id: "def-a", code: CODE, unit: "SECONDS", desired_direction: "HIGHER", operational_aggregation: "SUM", daily_supported: true, unjustified_absence_policy: "ZERO_CONTRIBUTION" },
  { organization_id: ORG_B, created_at: "2026-06-01", id: "def-b", code: CODE, unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true, unjustified_absence_policy: "NO_SAMPLE" },
]
// TMA em segundos: LOWER é melhor — na B, "h" (1000 s) é o Q4; com a direção da A seria o "a".
const TMA: Record<string, number> = { a: 300, b: 400, c: 500, d: 600, e: 700, f: 800, g: 900, h: 1000 }
const POPULATION_IDS = Object.keys(TMA)

type Logged = { sql: string; params: unknown[] }

function fakeDb(log: Logged[] = []): Database {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params })
      if (/from indicator_definitions where code = \$1/.test(sql)) {
        const code = params[0]
        const scoped = /organization_id = \$2/.test(sql) ? DEFINITIONS.filter((row) => row.code === code && row.organization_id === params[1]) : DEFINITIONS.filter((row) => row.code === code).sort((x, y) => x.created_at.localeCompare(y.created_at))
        const rows = scoped.slice(0, 1)
        return { rows, rowCount: rows.length }
      }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params[0] as string[]).map((id) => ({ id, organization_id: ORG_B, hired_at: null, operational_capital_code: null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
      if (sql.includes("from indicator_measurements")) {
        const ids = params[1] as string[]
        const row = (id: string) => {
          const tma = TMA[id]
          if (tma === undefined) return null
          return { avg_value: String(tma), min_value: String(tma), max_value: String(tma), sum_value: String(tma * 5), sample_count: "5", numerator_sum: String(tma * 5), denominator_sum: "5", rows_with_components: "5", days_with_data: "5" }
        }
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (row(id) ? [{ subject_id: id, ...row(id) }] : [])), rowCount: 0 }
        return { rows: [row(ids[0]!) ?? { avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

/** Toda leitura de definição pelo código precisa estar presa à organização informada. */
function expectDefinitionLookupsBoundTo(log: Logged[], organizationId: string) {
  const lookups = log.filter((entry) => /from indicator_definitions where code = \$1/.test(entry.sql))
  expect(lookups.length).toBeGreaterThan(0)
  for (const lookup of lookups) {
    const bound = /organization_id = \$(\d+)/.exec(lookup.sql)
    expect(bound, lookup.sql).not.toBeNull()
    expect(lookup.params[Number(bound![1]) - 1]).toBe(organizationId)
  }
}

const QUARTILE_QUERY = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE" as const, source: "OPERATIONAL_QUARTILE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 } }
const IS_Q4 = { historicalQuery: QUARTILE_QUERY, comparator: "EQUALS" as const, thresholdText: "Q4" }

describe("definição operacional do indicador · sempre da organização da execução", () => {
  it("loadIndicatorOperationalDefinition devolve a linha da organização pedida, nunca a mais antiga com o mesmo código", async () => {
    const db = fakeDb()
    expect(await loadIndicatorOperationalDefinition(db, ORG_B, CODE)).toMatchObject({ id: "def-b", direction: "LOWER", kind: "WEIGHTED_AVERAGE", unjustifiedAbsencePolicy: "NO_SAMPLE" })
    expect(await loadIndicatorOperationalDefinition(db, ORG_A, CODE)).toMatchObject({ id: "def-a", direction: "HIGHER", kind: "SUM", unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" })
    // Organização sem o indicador: SEM linha (padrão documentado no chamador), nunca a de outra empresa.
    expect(await loadIndicatorOperationalDefinition(db, "org-c", CODE)).toBeNull()
  })

  it("Condition Quartil operacional da B usa a direção da B (LOWER): o Q4 é o pior TMA, não o melhor", async () => {
    const log: Logged[] = []
    const db = fakeDb(log)
    const options = { organizationId: ORG_B, timeZone: TZ }
    const worst = await evaluateDataCondition(db, IS_Q4, { operatorId: "h", subjectIds: ["h"], populationIds: POPULATION_IDS }, NOW, { ...options, quartileCache: new Map() })
    const best = await evaluateDataCondition(db, IS_Q4, { operatorId: "a", subjectIds: ["a"], populationIds: POPULATION_IDS }, NOW, { ...options, quartileCache: new Map() })
    expect(worst!.evaluation).toMatchObject({ direction: "LOWER", value: "Q4" })
    expect(worst!.branch).toBe("true")
    expect(best!.branch).toBe("false")
    expectDefinitionLookupsBoundTo(log, ORG_B)
  })

  it("Condition de Valor (MEASUREMENT) e de meses fechados leem a definição só na organização da execução", async () => {
    const log: Logged[] = []
    const db = fakeDb(log)
    await evaluateDataCondition(db, { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 } }, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "h", subjectIds: ["h"] }, NOW, { organizationId: ORG_B, timeZone: TZ })
    await evaluateDataCondition(db, { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 2 } }, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "h", subjectIds: ["h"] }, NOW, { organizationId: ORG_B, timeZone: TZ })
    expectDefinitionLookupsBoundTo(log, ORG_B)
    // Meses fechados: a medição é casada pelo id da definição DA B (subconsulta presa à organização).
    const closedMonths = log.find((entry) => entry.sql.includes("from expected e"))!
    expect(closedMonths.sql).toMatch(/select id from indicator_definitions where code = \$1 and organization_id = \$12/)
    expect(closedMonths.params[11]).toBe(ORG_B)
  })

  it("Ranking operacional (Valor e Evolução) da B lê a definição só na B", async () => {
    const log: Logged[] = []
    const db = fakeDb(log)
    const ranking = { source: "MEASUREMENT" as const, indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 } }
    await runEmployeeRanking(db, ORG_B, { ...ranking, selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", rankingBasis: "VALUE" }, POPULATION_IDS, NOW, { timeZone: TZ })
    await runEmployeeRanking(db, ORG_B, { ...ranking, selection: "DECLINED", count: 2, rankingBasis: "CHANGE" }, POPULATION_IDS, NOW, { timeZone: TZ })
    expectDefinitionLookupsBoundTo(log, ORG_B)
  })
})
