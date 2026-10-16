import { describe, expect, it } from "vitest"
import { assignDeciles, competitionRanking, comparisonGroups, decileForPosition, evaluateComparability, evaluateConcentration, matchesAllTokens, normalizeForMatch, percentOf, type DeviationUnit } from "./analytic-rules.js"

const candidate = (id: string, score: number) => ({ id, name: `Pessoa ${id}`, score })

describe("ranking de competição", () => {
  it("empatados dividem a posição e a seguinte pula (1, 2, 2, 4)", () => {
    const ranked = competitionRanking([candidate("a", 90), candidate("b", 110), candidate("c", 90), candidate("d", 70)])
    expect(ranked.map((entry) => [entry.id, entry.position])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]])
  })
})

describe("decis", () => {
  it("D1 = melhores 10% e D10 = piores, pela posição", () => {
    expect(decileForPosition(1, 20)).toBe("D1")
    expect(decileForPosition(2, 20)).toBe("D1")
    expect(decileForPosition(3, 20)).toBe("D2")
    expect(decileForPosition(20, 20)).toBe("D10")
  })

  it("abaixo de 10 pessoas ranqueadas ninguém é classificado (nunca um D10 inventado)", () => {
    const result = assignDeciles(competitionRanking(Array.from({ length: 9 }, (_, index) => candidate(String(index), index))))
    expect(result.reason).toBe("INSUFFICIENT_POPULATION")
    expect(result.byId.size).toBe(0)
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true)
  })

  it("empatados caem no mesmo decil e os decis somam a população", () => {
    const scores = [100, 99, 99, 98, 97, 96, 95, 94, 93, 92]
    const result = assignDeciles(competitionRanking(scores.map((score, index) => candidate(String(index), score))))
    expect(result.reason).toBe("OK")
    expect(result.byId.get("1")).toBe(result.byId.get("2"))
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(10)
  })
})

const unit = (key: string, withReference: number, below: number): DeviationUnit => ({ key, label: key, withReference, below })

describe("concentração × disseminação", () => {
  it("concentrado: uma unidade em seis reúne a maioria das pessoas fora, com taxa muito maior", () => {
    const result = evaluateConcentration([unit("A", 20, 12), unit("B", 20, 2), unit("C", 20, 1), unit("D", 20, 1), unit("E", 20, 2), unit("F", 20, 1)])
    expect(result.pattern).toBe("CONCENTRATED")
    expect(result.focusKeys).toEqual(["A"])
  })

  it("disseminado: quase todas as unidades têm desvio parecido", () => {
    const result = evaluateConcentration([unit("A", 20, 5), unit("B", 20, 4), unit("C", 20, 5), unit("D", 20, 6), unit("E", 20, 4)])
    expect(result.pattern).toBe("DISSEMINATED")
  })

  it("sem ninguém fora = NONE; menos de 3 unidades avaliáveis = indeterminado", () => {
    expect(evaluateConcentration([unit("A", 10, 0), unit("B", 10, 0), unit("C", 10, 0)]).pattern).toBe("NONE")
    expect(evaluateConcentration([unit("A", 10, 4), unit("B", 10, 2), unit("C", 2, 2)]).pattern).toBe("UNDETERMINED")
  })
})

describe("comparabilidade", () => {
  const teams = (teamId: string, count: number) => Array.from({ length: count }, () => ({ teamId, teamName: teamId }))

  it("mesmo Grupo, população e cobertura suficientes = comparável", () => {
    const result = evaluateComparability({ key: "u", memberCount: 10, membersWithData: 9, withReference: 9, memberTeams: teams("G1", 10) })
    expect(result).toMatchObject({ comparable: true, reasons: [] })
  })

  it("explica cada motivo de não comparar", () => {
    const result = evaluateComparability({ key: "u", memberCount: 10, membersWithData: 4, withReference: 4, memberTeams: [...teams("G1", 6), ...teams("G2", 4)] })
    expect(result.comparable).toBe(false)
    expect(result.reasons).toHaveLength(3)
  })

  it("agrupa só as comparáveis, pelo Grupo dominante", () => {
    const unitOf = (key: string, count: number, teamId: string) => {
      const comparability = evaluateComparability({ key, memberCount: count, membersWithData: count, withReference: count, memberTeams: teams(teamId, count) })
      return { key, comparable: comparability.comparable, groupKey: comparability.dominantTeam?.teamId ?? null, groupLabel: comparability.dominantTeam?.teamName ?? null }
    }
    const groups = comparisonGroups([unitOf("a", 8, "G1"), unitOf("b", 8, "G2"), unitOf("c", 8, "G1"), unitOf("d", 3, "G1")])
    expect(groups).toEqual([{ groupKey: "G1", groupLabel: "G1", keys: ["a", "c"] }, { groupKey: "G2", groupLabel: "G2", keys: ["b"] }])
  })
})

describe("apoio", () => {
  it("percentual com uma casa e nulo sem denominador", () => {
    expect(percentOf(1, 3)).toBe(33.3)
    expect(percentOf(1, 0)).toBeNull()
  })

  it("comparação tolerante a acentos, caixa e prefixo", () => {
    expect(normalizeForMatch("  João  da Silva ")).toBe("joao da silva")
    expect(matchesAllTokens("João Pedro Albuquerque", "joao albu")).toBe(true)
    expect(matchesAllTokens("João Pedro Albuquerque", "maria")).toBe(false)
  })
})
