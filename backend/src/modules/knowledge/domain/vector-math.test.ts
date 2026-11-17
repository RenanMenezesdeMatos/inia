import { describe, expect, it } from "vitest"
import { decodeVector, dot, encodeVector, nearest, normalized } from "./vector-math.js"

describe("vetores sem extensão no banco", () => {
  it("normaliza (cosseno = produto escalar) e recusa vetor nulo ou com valor não finito", () => {
    expect([...normalized(new Float32Array([3, 4]))!]).toEqual([0.6000000238418579, 0.800000011920929])
    expect(normalized(new Float32Array([0, 0]))).toBeNull()
    expect(normalized(new Float32Array([1, Number.NaN]))).toBeNull()
  })

  it("bytea float32 little-endian ida e volta", () => {
    const vector = new Float32Array([0.25, -1.5, 3])
    const bytes = encodeVector(vector)
    expect(bytes.length).toBe(12)
    expect([...decodeVector(bytes)]).toEqual([0.25, -1.5, 3])
  })

  it("dimensões diferentes nunca viram nota (modelo trocado); mais parecidos primeiro, empate pela ordem", () => {
    expect(dot(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBeNull()
    const items = [{ item: "a", vector: new Float32Array([0, 1]) }, { item: "b", vector: new Float32Array([1, 0]) }, { item: "c", vector: new Float32Array([1, 0]) }, { item: "x", vector: new Float32Array([1]) }]
    expect(nearest(new Float32Array([1, 0]), items, 3).map((hit) => hit.item)).toEqual(["b", "c", "a"])
  })
})
