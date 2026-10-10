import { describe, expect, it } from "vitest"
import { periodWindow, positiveNumber, selectPerPerson, selectSample, type Candidate } from "./bootstrap-core.js"
import { createPaidBudget } from "./evaluation/paid-budget.js"

const candidates = (): Candidate[] => Array.from({ length: 120 }, (_, index) => ({ id: `call-${index}`, personId: `p${index % 30}`, subject: "contestacao", startedAt: "2026-08-01", transcriptHash: "hash", transcriptChars: 2000, performance: index % 30 === 29 ? null : 200 + (index % 30) * 10, subteamId: null }))
describe("diagnostic bootstrap selection and financial boundary", () => {
  it("caps unique calls, keeps target and comparison, and does not select unknown performance as reference", () => {
    const sample = selectSample(candidates(), 40, "p0", "LOWER")
    expect(sample).toHaveLength(40)
    expect(new Set(sample.map((r) => r.id)).size).toBe(40)
    expect(sample.filter((r) => r.cohort === "TARGET")).toHaveLength(4)
    expect(sample.some((r) => r.cohort === "COMPARISON")).toBe(true)
    expect(sample.filter((r) => r.cohort === "REFERENCE_CANDIDATE").every((r) => r.performance !== null && r.personId !== "p0")).toBe(true)
    expect(new Set(sample.filter((r) => r.cohort === "REFERENCE_CANDIDATE").map((r) => r.personId)).size).toBeGreaterThan(3)
  })
  it("is deterministic despite database order and follows indicator direction", () => {
    expect(selectSample(candidates(), 40, "p0", "LOWER")).toEqual(selectSample(candidates().reverse(), 40, "p0", "LOWER"))
    expect(selectSample(candidates(), 40, null, "HIGHER").filter((r) => r.cohort === "REFERENCE_CANDIDATE").every((r) => r.performance! >= 410)).toBe(true)
  })
  it("does not invent samples when the source is small", () => {
    expect(selectSample(candidates().slice(0, 3), 40, "p0", "LOWER")).toHaveLength(3)
    expect(periodWindow("2026-12")).toEqual({ from: "2026-12-01", until: "2027-01-01" })
    expect(() => periodWindow("2026-13")).toThrow()
    for (const value of ["-1", "0", "NaN", "Infinity", "1.2"]) expect(() => positiveNumber(value, "limit", true)).toThrow()
  })
  it("per-person sample gives everyone the same depth before anyone gets more, deterministically", () => {
    const sample = selectPerPerson(candidates(), 3, 1000, "p0", "LOWER")
    const perPerson = new Map<string, number>()
    for (const row of sample) perPerson.set(row.personId, (perPerson.get(row.personId) ?? 0) + 1)
    expect(sample).toHaveLength(90)
    expect(new Set(sample.map((r) => r.id)).size).toBe(90)
    expect([...perPerson.values()].every((n) => n === 3)).toBe(true)
    expect(sample.filter((r) => r.personId === "p0").every((r) => r.cohort === "TARGET")).toBe(true)
    expect(selectPerPerson(candidates(), 3, 1000, "p0", "LOWER")).toEqual(selectPerPerson(candidates().reverse(), 3, 1000, "p0", "LOWER"))
    // limit cuts whole rounds first: 40 = everyone once + 10 people twice.
    const cut = selectPerPerson(candidates(), 3, 40, null, "LOWER")
    expect(new Set(cut.slice(0, 30).map((r) => r.personId)).size).toBe(30)
    expect(cut).toHaveLength(40)
    // a person with fewer calls than asked contributes only what exists
    expect(selectPerPerson(candidates().slice(0, 32), 5, 1000, null, "LOWER").filter((r) => r.personId === "p1")).toHaveLength(2)
  })
  it("reserves before HTTP; refuses overspend without sending; unknown usage retains reservation", async () => {
    let sends = 0
    const budget = createPaidBudget({ maxRequests: 3, maxUsd: 0.001, pricePerMillion: { input: 1, output: 1 }, hostPattern: /^https:\/\/test\.invalid/ }, async () => { sends++; expect(budget.ledger[0]!.spentUsd).toBeGreaterThan(0); return new Response("{}") })
    const init = { body: JSON.stringify({ generationConfig: { maxOutputTokens: 600 } }) }
    await budget.fetch("https://test.invalid", init)
    await expect(budget.fetch("https://test.invalid", init)).rejects.toThrow("Orçamento")
    expect(sends).toBe(1)
    expect(budget.totals().unknownUsage).toBe(1)
    expect(budget.totals().spentUsd).toBeLessThanOrEqual(0.001)
  })
})
