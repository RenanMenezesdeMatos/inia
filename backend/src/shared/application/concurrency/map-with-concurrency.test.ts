import { describe, expect, it } from "vitest"
import { mapWithConcurrency } from "./map-with-concurrency.js"

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe("mapWithConcurrency", () => {
  it("devolve os resultados na ordem dos itens, como Promise.all", async () => {
    const delays = [5, 1, 3, 0, 2]
    const result = await mapWithConcurrency(delays, 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return `${index}:${delay}`
    })
    expect(result).toEqual(["0:5", "1:1", "2:3", "3:0", "4:2"])
  })

  it("nunca passa do limite de chamadas em andamento", async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async () => {
      running += 1
      peak = Math.max(peak, running)
      await tick()
      running -= 1
    })
    expect(peak).toBe(4)
  })

  it("lista vazia não chama a função", async () => {
    let calls = 0
    expect(await mapWithConcurrency([], 3, async () => { calls += 1 })).toEqual([])
    expect(calls).toBe(0)
  })

  it("a primeira falha rejeita e nenhum item novo começa depois dela", async () => {
    const started: number[] = []
    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item)
      await tick()
      if (item === 1) throw new Error("falhou 1")
      return item
    })
    await expect(run).rejects.toThrow("falhou 1")
    await tick()
    await tick()
    expect(started.length).toBeLessThan(6)
  })

  it("recusa limite inválido", async () => {
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(RangeError)
    await expect(mapWithConcurrency([1], 1.5, async (item) => item)).rejects.toThrow(RangeError)
  })
})
