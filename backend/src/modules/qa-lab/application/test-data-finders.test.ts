import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { findInteractions, findMeasurements } from "./test-data-finders.js"

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

const FLAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const OP = (n: number) => `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${n}`

function db(handler: (sql: string, params: unknown[]) => { rows: unknown[] } | undefined): Database {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const result = handler(sql.replace(/\s+/g, " "), params)
      return { rows: result?.rows ?? [], rowCount: result?.rows.length ?? 0 }
    },
  } as unknown as Database
}

describe("QA Lab — seletor de massa de teste (determinístico, sem IA)", () => {
  it("findInteractions filtra pelo comparador da Condition em memória e permite 'quem NÃO atende'", async () => {
    const rows = [
      { id: "i1", external_id: "A", reason: "r", started_at: "2026-09-10", operator_id: OP(1), operator_name: "João", team_name: "FATURAS", flag_name: "nota_ura", value_boolean: null, value_numeric: "1", has_transcript: true },
      { id: "i2", external_id: "B", reason: "r", started_at: "2026-09-09", operator_id: OP(2), operator_name: "Maria", team_name: "FATURAS", flag_name: "nota_ura", value_boolean: null, value_numeric: "5", has_transcript: true },
    ]
    const database = db((sql) => (sql.includes("from interaction_flags f") ? { rows } : undefined))
    const matching = await findInteractions(database, QA_ORGANIZATION, { channelFlagId: FLAG_ID, comparator: "LT", thresholdNumeric: 2, limit: 30 })
    expect(matching.map((row) => row.id)).toEqual(["i1"])
    expect(matching[0]).toMatchObject({ value: 1, operatorName: "João", matches: true })
    const notMatching = await findInteractions(database, QA_ORGANIZATION, { channelFlagId: FLAG_ID, comparator: "LT", thresholdNumeric: 2, negate: true, limit: 30 })
    expect(notMatching.map((row) => row.id)).toEqual(["i2"])
    const all = await findInteractions(database, QA_ORGANIZATION, { channelFlagId: FLAG_ID, limit: 30 })
    expect(all).toHaveLength(2)
  })

  it("findMeasurements devolve valor + meta vigente e filtra por comparador", async () => {
    const rows = [
      { id: "m1", subject_id: OP(1), operator_name: "João", team_name: "FATURAS", value: "72", period_start: "2026-09-01", period_end: "2026-09-30", unit: "%", target: "80" },
      { id: "m2", subject_id: OP(2), operator_name: "Maria", team_name: "FATURAS", value: "85", period_start: "2026-09-01", period_end: "2026-09-30", unit: "%", target: "80" },
    ]
    const database = db((sql) => (sql.includes("from indicator_measurements m") ? { rows } : undefined))
    const below = await findMeasurements(database, QA_ORGANIZATION, { indicatorCode: "QUALIDADE", comparator: "LT", thresholdNumeric: 80, limit: 30 })
    expect(below).toEqual([expect.objectContaining({ id: "m1", value: 72, targetValue: 80, matches: true })])
  })
})
