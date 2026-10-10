import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { buildAnalyticsContext } from "../../performance-analytics/application/build-analytics-context.js"
import { InMemoryAnalyticsRepository, indicatorRow, prvRow, ORG } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { findLatestIndicatorPerformance, aggregateAchievementHistory } from "../application/resolve-employee-performance.js"
import { clampToClosedReferencePeriod, isClosedReferencePeriod, lastClosedReferencePeriod, onlyClosedReferencePeriods } from "./official-closure-policy.js"

const MID_SEPTEMBER = new Date("2026-09-16T14:00:00-03:00")
const OCTOBER_FIRST = new Date("2026-10-01T00:30:00-03:00")

describe("Guard central do fechamento oficial — o mês corrente nunca é fechamento", () => {
  it("regra temporal, por fuso: em 16/09 o último fechamento é 08/2026; em 01/10 00:30 (Fortaleza) já é 09/2026", () => {
    expect(lastClosedReferencePeriod(MID_SEPTEMBER, "America/Fortaleza")).toBe("2026-08")
    expect(isClosedReferencePeriod("2026-09", MID_SEPTEMBER, "America/Fortaleza")).toBe(false)
    expect(isClosedReferencePeriod("2026-08", MID_SEPTEMBER, "America/Fortaleza")).toBe(true)
    expect(lastClosedReferencePeriod(OCTOBER_FIRST, "America/Fortaleza")).toBe("2026-09")
    // 01/10 00:30 em Fortaleza ainda é 30/09 22:30 em… não: é 03:30 UTC de 01/10 — em UTC também virou outubro.
    // Já em America/Sao_Paulo (mesmo offset sem DST) o resultado é o mesmo; o fuso decide, nunca o offset fixo.
    expect(lastClosedReferencePeriod(new Date("2026-10-01T02:30:00Z"), "America/Sao_Paulo")).toBe("2026-08") // 30/09 23:30 em SP
    expect(lastClosedReferencePeriod(new Date("2026-10-01T02:30:00Z"), "UTC")).toBe("2026-09")
    expect(clampToClosedReferencePeriod("2026-09", MID_SEPTEMBER, "America/Fortaleza")).toBe("2026-08")
    expect(onlyClosedReferencePeriods(["2026-09", "2026-08", "2026-07"], MID_SEPTEMBER, "America/Fortaleza")).toEqual(["2026-08", "2026-07"])
  })

  it("leitores oficiais (SQL): uma linha de 09/2026 EXISTE no banco, referência 16/09 → o 'mais recente' é 08/2026; em 01/10 passa a ser 09/2026 (independe da source)", async () => {
    // Fake que responde ao SQL real do resolvedor: devolve as linhas com reference_period <= $3.
    const rows = [
      { referencePeriod: "2026-09", source: "MANUAL_SEED", quartile: "Q4", achievementPercent: "50" },
      { referencePeriod: "2026-08", source: "DEMO_SEED", quartile: "Q1", achievementPercent: "110" },
    ]
    const db = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("from employee_indicator_performance eip") && sql.includes("reference_period <= $3")) {
          const cutoff = params[2] as string
          const visible = rows.filter((row) => row.referencePeriod <= cutoff).sort((a, b) => b.referencePeriod.localeCompare(a.referencePeriod))
          return { rows: visible.slice(0, 1).map((row) => ({ id: "x", personId: "p", indicatorDefinitionId: "i", indicatorCode: "TMA", subteamId: null, referencePeriod: row.referencePeriod, value: "1", targetValue: null, achievementPercent: row.achievementPercent, weightPercent: null, quartile: row.quartile, source: row.source })), rowCount: 1 }
        }
        throw new Error(`SQL inesperado: ${sql.slice(0, 80)}`)
      }),
    } as unknown as Database
    const midSeptember = await findLatestIndicatorPerformance(db, "p", "TMA", MID_SEPTEMBER, "America/Fortaleza")
    expect(midSeptember?.referencePeriod).toBe("2026-08")
    expect(midSeptember?.quartile).toBe("Q1")
    const october = await findLatestIndicatorPerformance(db, "p", "TMA", OCTOBER_FIRST, "America/Fortaleza")
    expect(october?.referencePeriod).toBe("2026-09")
  })

  it("Condition oficial (Quartil do indicador): linha manual de 09/2026 não vira 'Q4 no fechamento mais recente' em 16/09", async () => {
    const db = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.startsWith("select timezone from operations")) return { rows: [], rowCount: 0 }
        if (sql.includes("from employee_indicator_performance eip")) {
          const cutoff = params[2] as string
          const all = [
            { referencePeriod: "2026-09", quartile: "Q4" },
            { referencePeriod: "2026-08", quartile: "Q1" },
          ].filter((row) => row.referencePeriod <= cutoff)
          return { rows: all.slice(0, 1).map((row) => ({ id: "x", personId: "p", indicatorDefinitionId: "i", indicatorCode: "TMA", subteamId: null, referencePeriod: row.referencePeriod, value: "1", targetValue: null, achievementPercent: "90", weightPercent: null, quartile: row.quartile, source: "MANUAL_SEED" })), rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const config = { performanceQuery: { kind: "EMPLOYEE_PERFORMANCE" as const, metric: "INDICATOR_QUARTILE" as const, indicatorCode: "TMA" }, comparator: "EQUALS" as const, thresholdText: "Q4" }
    const midSeptember = await evaluateDataCondition(db, config, { operatorId: "p", subjectIds: ["p"] }, MID_SEPTEMBER, { timeZone: "America/Fortaleza" })
    expect(midSeptember?.branch).toBe("false")
    expect(midSeptember?.evaluation.referencePeriod).toBe("2026-08")
    const october = await evaluateDataCondition(db, config, { operatorId: "p", subjectIds: ["p"] }, OCTOBER_FIRST, { timeZone: "America/Fortaleza" })
    expect(october?.branch).toBe("true")
    expect(october?.evaluation.referencePeriod).toBe("2026-09")
  })

  it("histórico oficial por janela (últimos 30 dias tocando o mês corrente) nunca lê o mês corrente", async () => {
    const db = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        // params: [personIds, startPeriod, lastIncludedPeriod, code]
        expect(params[2]).toBe("2026-08")
        return { rows: [{ avg_value: "100", min_value: "100", max_value: "100", sample_count: "1" }], rowCount: 1 }
      }),
    } as unknown as Database
    const agg = await aggregateAchievementHistory(db, "employee_indicator_performance", ["p"], "TMA", new Date("2026-08-17T03:00:00Z"), new Date("2026-09-16T17:00:00Z"), MID_SEPTEMBER, "America/Fortaleza")
    expect(agg.count).toBe(1)
  })

  it("seletor de competência (Analytics): 09/2026 com dado oficial fica FORA da lista em 16/09 e entra em 01/10", async () => {
    const repository = new InMemoryAnalyticsRepository({
      people: [{ id: "op", name: "Op", role: "OPERATOR", reportsToId: null, teamId: null, teamName: null, subteamId: null, subteamName: null, avatarUrl: null, jobTitle: null, operationalCapitalCode: null, active: true }],
      indicatorRows: [indicatorRow({ personId: "op", indicatorCode: "TMA", referencePeriod: "2026-09", value: 1 }), indicatorRow({ personId: "op", indicatorCode: "TMA", referencePeriod: "2026-08", value: 1 })],
      prvRows: [prvRow("op", "2026-09", 100, "Q1")],
    })
    const scope = { organizationId: ORG, viewer: { id: "op", name: "Op" }, role: "OPERATOR", members: [] } as unknown as ViewerScope
    const midSeptember = await buildAnalyticsContext(repository, scope, { kind: "EMPLOYEE", employeeId: "op" }, lastClosedReferencePeriod(MID_SEPTEMBER, "America/Fortaleza"))
    expect(midSeptember.availablePeriods.map((entry) => entry.period)).toEqual(["2026-08"])
    expect(midSeptember.currentPeriod).toBe("2026-08")
    const october = await buildAnalyticsContext(repository, scope, { kind: "EMPLOYEE", employeeId: "op" }, lastClosedReferencePeriod(OCTOBER_FIRST, "America/Fortaleza"))
    expect(october.availablePeriods.map((entry) => entry.period)).toEqual(["2026-09", "2026-08"])
    expect(october.currentPeriod).toBe("2026-09")
  })
})
