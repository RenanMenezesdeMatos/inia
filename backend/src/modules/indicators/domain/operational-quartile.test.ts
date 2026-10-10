import { describe, expect, it } from "vitest"
import { assignOperationalQuartiles, quartileForPosition } from "./operational-quartile.js"

const candidates = (values: number[]) => values.map((value, index) => ({ employeeId: `op-${String(index + 1).padStart(2, "0")}`, value }))
const quartileOf = (result: ReturnType<typeof assignOperationalQuartiles>, employeeId: string) => result.assignments.find((a) => a.employeeId === employeeId)!.quartile

describe("quartil operacional", () => {
  it("HIGHER: maiores valores são Q1, menores Q4", () => {
    const result = assignOperationalQuartiles(candidates([10, 20, 30, 40, 50, 60, 70, 80]), "HIGHER")
    expect(quartileOf(result, "op-08")).toBe("Q1")
    expect(quartileOf(result, "op-07")).toBe("Q1")
    expect(quartileOf(result, "op-01")).toBe("Q4")
    expect(quartileOf(result, "op-02")).toBe("Q4")
  })

  it("LOWER (TMA): menores valores são Q1, maiores Q4", () => {
    const result = assignOperationalQuartiles(candidates([300, 350, 400, 450, 500, 550, 600, 650]), "LOWER")
    expect(quartileOf(result, "op-01")).toBe("Q1")
    expect(quartileOf(result, "op-08")).toBe("Q4")
    expect(quartileOf(result, "op-07")).toBe("Q4")
  })

  it("TARGET não tem regra de classificação — bloqueado, ninguém recebe quartil", () => {
    const result = assignOperationalQuartiles(candidates([1, 2, 3, 4]), "TARGET")
    expect(result.reason).toBe("DIRECTION_UNSUPPORTED")
    expect(result.assignments.every((a) => a.quartile === null)).toBe(true)
  })

  it("empate: mesma posição e mesmo quartil, nunca separados por employeeId", () => {
    const result = assignOperationalQuartiles(candidates([10, 10, 10, 10, 50, 60, 70, 80]), "HIGHER")
    const tied = result.assignments.filter((a) => a.value === 10)
    expect(new Set(tied.map((a) => a.position)).size).toBe(1)
    expect(new Set(tied.map((a) => a.quartile)).size).toBe(1)
    expect(tied[0]!.position).toBe(5)
    const again = assignOperationalQuartiles([...candidates([10, 10, 10, 10, 50, 60, 70, 80])].reverse(), "HIGHER")
    expect(again.assignments.map((a) => a.employeeId)).toEqual(result.assignments.map((a) => a.employeeId))
  })

  it("populações pequenas são determinísticas: 1, 2 e 3 = sem quartil; 4 = um por quartil; 5, 10 e 25 = ceil(4·pos/n)", () => {
    for (const size of [1, 2, 3]) {
      const result = assignOperationalQuartiles(candidates(Array.from({ length: size }, (_, i) => i + 1)), "HIGHER")
      expect(result.reason).toBe("INSUFFICIENT_POPULATION")
      expect(result.assignments.every((a) => a.quartile === null)).toBe(true)
    }
    expect(assignOperationalQuartiles(candidates([4, 3, 2, 1]), "HIGHER").assignments.map((a) => a.quartile)).toEqual(["Q1", "Q2", "Q3", "Q4"])
    const five = assignOperationalQuartiles(candidates([5, 4, 3, 2, 1]), "HIGHER").assignments.map((a) => a.quartile)
    expect(five).toEqual(["Q1", "Q2", "Q3", "Q4", "Q4"])
    const ten = assignOperationalQuartiles(candidates(Array.from({ length: 10 }, (_, i) => 10 - i)), "HIGHER")
    expect(ten.assignments.filter((a) => a.quartile === "Q4")).toHaveLength(3)
    const twentyFive = assignOperationalQuartiles(candidates(Array.from({ length: 25 }, (_, i) => 25 - i)), "HIGHER")
    expect(twentyFive.assignments.filter((a) => a.quartile === "Q4")).toHaveLength(7)
    expect(twentyFive.assignments.filter((a) => a.quartile === "Q1")).toHaveLength(6)
    expect(quartileForPosition(25, 25)).toBe("Q4")
    expect(quartileForPosition(1, 25)).toBe("Q1")
  })
})
