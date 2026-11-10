import { describe, expect, it } from "vitest"
import { estimateWait, nearestRank, queueDeadline, referencePopulation, type QueueSample } from "./queue-history.js"

const sample = (waitMinutes: number, overrides: Partial<QueueSample> = {}): QueueSample => ({ teamId: "g1", subteamId: "s1", assigned: true, waitSeconds: waitMinutes * 60, ...overrides })
const many = (count: number, waitMinutes: number, overrides: Partial<QueueSample> = {}) => Array.from({ length: count }, () => sample(waitMinutes, overrides))

describe("população de referência", () => {
  it("Subgrupo com 10 atribuídos; senão Grupo; senão organização; senão sem histórico", () => {
    expect(referencePopulation(many(10, 2), { teamId: "g1", subteamId: "s1" })!.basis).toBe("SUBGROUP")
    expect(referencePopulation([...many(9, 2), ...many(5, 3, { subteamId: "s2" })], { teamId: "g1", subteamId: "s1" })!.basis).toBe("GROUP")
    expect(referencePopulation([...many(4, 2), ...many(6, 3, { teamId: "g2", subteamId: "s9" })], { teamId: "g1", subteamId: "s1" })!.basis).toBe("ORGANIZATION")
    expect(referencePopulation(many(9, 2), { teamId: "g1", subteamId: "s1" })).toBeNull()
    // Terminados sem atribuição entram na população, mas não contam para o mínimo.
    expect(referencePopulation([...many(9, 2), ...many(5, 30, { assigned: false })], { teamId: "g1", subteamId: "s1" })).toBeNull()
    // Pessoa sem Subgrupo começa no Grupo.
    expect(referencePopulation(many(10, 2), { teamId: "g1", subteamId: null })!.basis).toBe("GROUP")
  })
})

describe("espera estimada", () => {
  it("cerca de t: o tempo em que metade da população (para cima) já foi atribuída; mínimo 1 min", () => {
    const population = { basis: "SUBGROUP" as const, samples: [sample(1), sample(2), sample(3), sample(8), sample(20, { assigned: false })] }
    expect(estimateWait(population)).toEqual({ kind: "ABOUT", minutes: 3, basis: "SUBGROUP" })
    expect(estimateWait({ basis: "GROUP", samples: [sample(0.1), sample(0.2)] })).toEqual({ kind: "ABOUT", minutes: 1, basis: "GROUP" })
  })

  it("mais de X quando os atribuídos não chegam à metade; sem histórico nunca inventa", () => {
    const population = { basis: "ORGANIZATION" as const, samples: [sample(4), sample(12, { assigned: false }), sample(18, { assigned: false })] }
    expect(estimateWait(population)).toEqual({ kind: "MORE_THAN", minutes: 18, basis: "ORGANIZATION" })
    expect(estimateWait(null)).toEqual({ kind: "NO_HISTORY" })
  })
})

describe("prazo da fila", () => {
  it("p90 dos atribuídos, para cima, entre 10 e 25 min; sem histórico, 20", () => {
    const waits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14].map((minutes) => sample(minutes))
    expect(queueDeadline({ basis: "SUBGROUP", samples: waits })).toEqual({ minutes: 10, basis: "SUBGROUP" })
    expect(queueDeadline({ basis: "GROUP", samples: [...many(9, 12), sample(40)] })).toEqual({ minutes: 12, basis: "GROUP" })
    expect(queueDeadline({ basis: "GROUP", samples: many(10, 40) })).toEqual({ minutes: 25, basis: "GROUP" })
    expect(queueDeadline({ basis: "GROUP", samples: many(10, 0.5) })).toEqual({ minutes: 10, basis: "GROUP" })
    expect(queueDeadline(null)).toEqual({ minutes: 20, basis: "DEFAULT" })
    expect(nearestRank([], 90)).toBeNull()
  })
})
