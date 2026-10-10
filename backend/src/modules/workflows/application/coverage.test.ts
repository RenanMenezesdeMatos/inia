import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveEligibleDaysBySubject, resolveOperationalWindowBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { coverageSatisfied, evaluateDataCondition } from "./condition-evaluator.js"
import { runEmployeeRanking } from "./select-employees-executor.js"
import { resolveTimeWindow } from "./time-window.js"

const NOW = new Date("2026-09-15T14:30:00-03:00")
const TZ = "America/Fortaleza"
const WINDOW = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, TZ) // 09/09 → 15/09: 5 dias úteis

/** Fake: dias com medição por colaborador (todos com TMA 500 s, 1 contato/dia) + hired_at opcional. */
function fakeDb(daysByOperator: Record<string, number>, hiredAt: Record<string, string> = {}): Database {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("select timezone from operations")) return { rows: [{ timezone: TZ }], rowCount: 1 }
      // Catálogo com cobertura mínima PADRÃO de 60% — o runtime do Workflow nunca a lê como fallback silencioso.
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true, minimum_coverage: "0.600" }], rowCount: 1 }
      if (sql.trim().startsWith("select person_id, status, effective_from")) return { rows: [], rowCount: 0 }
      if (sql.includes("desired_direction from indicator_definitions")) return { rows: [{ desired_direction: "LOWER" }], rowCount: 1 }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params?.[0] as string[]).map((id) => ({ id, organization_id: "org", hired_at: hiredAt[id] ?? null, operational_capital_code: null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
      if (sql.includes("from indicator_measurements")) {
        const ids = params?.[1] as string[]
        const row = (id: string) => {
          const days = daysByOperator[id] ?? 0
          return days === 0 ? null : { avg_value: "500", min_value: "500", max_value: "500", sample_count: String(days), numerator_sum: String(500 * days), denominator_sum: String(days), rows_with_components: String(days), days_with_data: String(days) }
        }
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (row(id) ? [{ subject_id: id, ...row(id) }] : [])), rowCount: 0 }
        return { rows: [row(ids[0]!) ?? { avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const QUERY = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, source: "MEASUREMENT" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 } }

describe("cobertura mínima operacional — dias com medição ÷ dias elegíveis", () => {
  it("cobertura = dias com dado ÷ dias úteis elegíveis: 5/5, 3/5, 1/5 e 0/5 (fim de semana nunca conta como 'faltou dado')", async () => {
    const db = fakeDb({ full: 5, three: 3, one: 1, none: 0 })
    const results = await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["full", "three", "one", "none"], window: WINDOW, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: TZ })
    expect(results.get("full")!.coverage).toBe(1)
    expect(results.get("full")!.expectedDays).toBe(5)
    expect(results.get("three")!.coverage).toBe(0.6)
    expect(results.get("one")!.coverage).toBe(0.2)
    expect(results.has("none")).toBe(false) // sem linha = SEM DADOS, nunca cobertura 0 com valor 0
  })

  it("ausência justificada: admitido no meio da janela tem menos dias elegíveis — 3 dias com dado em 3 elegíveis = cobertura 100%", async () => {
    const db = fakeDb({ newcomer: 3 }, { newcomer: "2026-09-11" })
    const eligible = await resolveEligibleDaysBySubject(db, ["newcomer"], WINDOW, TZ)
    expect(eligible.get("newcomer")?.eligibleDays).toBe(3) // 11/09 (sex), 14/09 e 15/09
    expect(eligible.get("newcomer")?.excludedBeforeHire).toBe(2)
    const results = await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["newcomer"], window: WINDOW, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: TZ })
    expect(results.get("newcomer")!.coverage).toBe(1)
  })

  it("coverageSatisfied: sem mínimo configurado nunca bloqueia; cobertura incalculável não bloqueia; abaixo do mínimo bloqueia", () => {
    expect(coverageSatisfied(0.2, undefined)).toBeNull()
    expect(coverageSatisfied(null, 0.6)).toBe(true)
    expect(coverageSatisfied(0.6, 0.6)).toBe(true)
    expect(coverageSatisfied(0.2, 0.6)).toBe(false)
  })

  it("Condition: 5 de 5 dias atende; 3/5 e 1/5 viram SEM DADOS (BELOW_MINIMUM_COVERAGE) com mínimo 70%; 0/5 é NO_VALUE", async () => {
    const expectations: [string, string][] = [["full", "true"], ["three", "no_data"], ["one", "no_data"], ["none", "no_data"]]
    const db = fakeDb({ full: 5, three: 3, one: 1, none: 0 })
    for (const [id, branch] of expectations) {
      const result = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, minimumCoverage: 0.7 }, comparator: "GT", thresholdNumeric: 400 }, { operatorId: id, subjectIds: [id] }, NOW, { timeZone: TZ })
      expect(result?.branch, id).toBe(branch)
      if (id === "three") {
        expect(result?.evaluation.reason).toBe("BELOW_MINIMUM_COVERAGE")
        expect(String(result?.evaluation.reasonText)).toContain("3 de 5 dias elegíveis")
        expect(result?.evaluation.value).toBe(500) // o valor existe no trace, mas nunca decide
      }
      if (id === "none") expect(result?.evaluation.reason).toBe("NO_VALUE")
    }
    const withoutRule = await evaluateDataCondition(db, { historicalQuery: QUERY, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "one", subjectIds: ["one"] }, NOW, { timeZone: TZ })
    expect(withoutRule?.branch).toBe("true") // sem mínimo configurado, 1 dia continua sendo dado válido
  })

  it("Ranking/quartil: quem está abaixo da cobertura mínima fica FORA como SEM DADOS — nunca vira Q4", async () => {
    const db = fakeDb({ a: 5, b: 5, c: 5, d: 5, low: 1 })
    const ranking = { source: "MEASUREMENT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 }, selection: "OPERATIONAL_QUARTILE" as const, operationalQuartile: "Q4" as const, rankingBasis: "VALUE" as const, minimumCoverage: 0.6 }
    const result = await runEmployeeRanking(db, "org", ranking, ["a", "b", "c", "d", "low"], NOW, { timeZone: TZ })
    expect(result.rankedCount).toBe(4)
    expect(result.noDataCount).toBe(1)
    expect(result.memberIds).not.toContain("low")
    expect(result.partitions[0]!.calculation?.minimumCoverage).toBe(0.6)
    const lenient = await runEmployeeRanking(db, "org", { ...ranking, minimumCoverage: undefined }, ["a", "b", "c", "d", "low"], NOW, { timeZone: TZ })
    expect(lenient.rankedCount).toBe(5)
  })

  it("Workflow sobrescreve o padrão do catálogo: catálogo 60%, Workflow 80% → 3/5 (60%) é SEM DADOS; sem valor no Workflow, o runtime NÃO aplica o catálogo por conta própria", async () => {
    const db = fakeDb({ three: 3 })
    const overridden = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, minimumCoverage: 0.8 }, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "three", subjectIds: ["three"] }, NOW, { timeZone: TZ })
    expect(overridden?.branch).toBe("no_data")
    expect(overridden?.evaluation.reason).toBe("BELOW_MINIMUM_COVERAGE")
    expect((overridden?.evaluation.evidence as { minimumCoverage: number }).minimumCoverage).toBe(0.8)
    const explicitCatalogValue = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, minimumCoverage: 0.6 }, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "three", subjectIds: ["three"] }, NOW, { timeZone: TZ })
    expect(explicitCatalogValue?.branch).toBe("true") // 60% >= 60%
    const unset = await evaluateDataCondition(db, { historicalQuery: QUERY, comparator: "GT", thresholdNumeric: 400 }, { operatorId: "three", subjectIds: ["three"] }, NOW, { timeZone: TZ })
    expect(unset?.branch).toBe("true")
    expect((unset?.evaluation.evidence as { minimumCoverage: number | null }).minimumCoverage).toBeNull() // a versão publicada manda; o padrão do catálogo é pré-preenchido pelo editor, nunca aplicado em runtime
  })
})
