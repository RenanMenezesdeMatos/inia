import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { EmployeeRankingConfig, EmployeeSelectionCriterion } from "../domain/graph-schema.js"
import { CANDIDATE_EVALUATION_CONCURRENCY, runEmployeeRanking, runEmployeeSelection } from "./select-employees-executor.js"

/**
 * Seleção e Ranking avaliam candidato a candidato com no máximo CANDIDATE_EVALUATION_CONCURRENCY avaliações em andamento — nunca
 * milhares de consultas de uma vez num pool de 20 conexões. Avaliador fake (a engine da Condition tem os próprios testes): conta
 * as avaliações abertas ao mesmo tempo e termina cada uma num tempo diferente, para provar também que a ordem não muda.
 */
const tracker = { running: 0, peak: 0 }
const settle = (index: number) => new Promise((resolve) => setTimeout(resolve, index % 3))

vi.mock("./condition-evaluator.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./condition-evaluator.js")>()
  return {
    ...original,
    evaluateDataCondition: vi.fn(async (_db: unknown, _criterion: unknown, subject: { operatorId: string }) => {
      tracker.running += 1
      tracker.peak = Math.max(tracker.peak, tracker.running)
      const index = Number(subject.operatorId.slice(3))
      await settle(index)
      tracker.running -= 1
      return { branch: index % 3 === 0 ? "true" : index % 3 === 1 ? "false" : "no_data" }
    }),
    resolveHistoricalResult: vi.fn(async (_db: unknown, subjectIds: string[]) => {
      tracker.running += 1
      tracker.peak = Math.max(tracker.peak, tracker.running)
      const index = Number(subjectIds[0]!.slice(3))
      await settle(index)
      tracker.running -= 1
      return { kind: "aggregate", value: index % 5 === 0 ? null : index }
    }),
  }
})

const candidates = Array.from({ length: 300 }, (_, index) => `op-${index}`)
const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database

describe("Selecionar colaboradores — avaliação por candidato com concorrência limitada", () => {
  it("critério de seleção: nunca mais que o limite em andamento; mesma coleção, na ordem dos candidatos", async () => {
    tracker.peak = 0
    const criterion: EmployeeSelectionCriterion = { comparator: "GTE", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } } }
    const result = await runEmployeeSelection(db, criterion, candidates, new Date("2026-10-01T12:00:00Z"))
    expect(tracker.peak).toBe(CANDIDATE_EVALUATION_CONCURRENCY)
    expect(result.memberIds).toEqual(candidates.filter((_, index) => index % 3 === 0))
    expect(result.notMatchedCount).toBe(100)
    expect(result.noDataCount).toBe(100)
  })

  it("Ranking por fonte oficial (fechamentos, um a um): nunca mais que o limite em andamento; mesmo ranking", async () => {
    tracker.peak = 0
    const ranking: EmployeeRankingConfig = { indicatorCode: "QUALIDADE", source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CLOSURES", count: 3 }, selection: "HIGHEST", count: 3 } as EmployeeRankingConfig
    const result = await runEmployeeRanking(db, "org-1", ranking, candidates, new Date("2026-10-01T12:00:00Z"))
    expect(tracker.peak).toBe(CANDIDATE_EVALUATION_CONCURRENCY)
    expect(result.memberIds).toEqual(["op-299", "op-298", "op-297"])
    expect(result.rankedCount).toBe(240)
    expect(result.noDataCount).toBe(60)
  })
})
