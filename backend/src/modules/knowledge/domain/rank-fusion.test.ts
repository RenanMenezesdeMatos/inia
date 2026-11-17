import { describe, expect, it } from "vitest"
import { reciprocalRankFusion } from "./rank-fusion.js"

const keys = (...values: string[]) => values.map((key) => ({ key }))

describe("reciprocalRankFusion", () => {
  it("quem aparece nas duas listas passa à frente de quem lidera só uma", () => {
    const fused = reciprocalRankFusion({ text: keys("a", "b"), vector: keys("c", "b") })
    expect(fused[0]!.key).toBe("b")
    expect(fused[0]!.ranks).toEqual({ text: 2, vector: 2 })
  })

  it("usa a fórmula 1 / (k + posição)", () => {
    const [only] = reciprocalRankFusion({ text: keys("a") }, { k: 60 })
    expect(only!.score).toBeCloseTo(1 / 61, 10)
  })

  it("repetição na mesma lista conta só a melhor posição", () => {
    const [only] = reciprocalRankFusion({ text: keys("a", "a") })
    expect(only!.score).toBeCloseTo(1 / 61, 10)
    expect(only!.ranks.text).toBe(1)
  })

  it("o empate é resolvido sempre da mesma forma", () => {
    const fused = reciprocalRankFusion({ text: keys("b"), vector: keys("a") })
    expect(fused.map((item) => item.key)).toEqual(["a", "b"])
  })

  it("respeita o peso de cada lista", () => {
    const fused = reciprocalRankFusion({ text: keys("a"), vector: keys("b") }, { weights: { text: 1, vector: 2 } })
    expect(fused[0]!.key).toBe("b")
  })

  it("listas vazias não produzem resultado", () => {
    expect(reciprocalRankFusion({ text: [], vector: [] })).toEqual([])
  })
})
