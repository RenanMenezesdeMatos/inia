import { describe, expect, it } from "vitest"
import { bucketKeyOf, directRouteLabel, foldByBucket, isSpecialistTool, periodBuckets, rankRoutes, rate, weightedAverage } from "./success-metrics.js"

describe("taxa com base", () => {
  it("denominador zero = sem base (nunca 0%)", () => {
    expect(rate(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null, status: "NO_DATA" })
  })
  it("denominador abaixo de 5 = amostra pequena, taxa oculta mas numerador e denominador presentes", () => {
    expect(rate(3, 4)).toEqual({ numerator: 3, denominator: 4, value: null, status: "SMALL_SAMPLE" })
  })
  it("com base suficiente devolve a razão exata", () => {
    expect(rate(164, 200)).toMatchObject({ value: 0.82, status: "OK" })
    expect(rate(0, 5)).toMatchObject({ value: 0, status: "OK" })
  })
})

describe("média ponderada pelas observações", () => {
  it("é a soma das observações ÷ a quantidade, nunca a média das médias dos dias", () => {
    // Dia 1: 1 resposta de 100 s; dia 2: 9 respostas somando 90 s (média 10 s). Média de médias = 55 s; a certa = 19 s.
    const average = weightedAverage([
      { sum: 100, count: 1 },
      { sum: 90, count: 9 },
    ])
    expect(average).toEqual({ sum: 190, count: 10, value: 19, status: "OK" })
  })
  it("sem observação = sem base; ausência não vira zero", () => {
    expect(weightedAverage([])).toMatchObject({ value: null, status: "NO_DATA", count: 0 })
    expect(weightedAverage([{ sum: 0, count: 0 }])).toMatchObject({ value: null, status: "NO_DATA" })
  })
  it("menos de 5 observações = amostra pequena", () => {
    expect(weightedAverage([{ sum: 40, count: 4 }])).toMatchObject({ value: null, status: "SMALL_SAMPLE", count: 4, sum: 40 })
  })
})

describe("intervalos da evolução", () => {
  it("até 31 dias, um ponto por dia", () => {
    const { granularity, buckets } = periodBuckets("2026-11-01", "2026-11-03")
    expect(granularity).toBe("DAY")
    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"])
  })
  it("acima de 31 dias, semanas de segunda a domingo, com as pontas parciais marcadas", () => {
    // 2026-10-01 é quinta; 2026-11-10 é terça.
    const { granularity, buckets } = periodBuckets("2026-10-01", "2026-11-10")
    expect(granularity).toBe("WEEK")
    expect(buckets[0]).toEqual({ key: "2026-10-01", from: "2026-10-01", to: "2026-10-04", days: 4, partial: true })
    expect(buckets[1]).toEqual({ key: "2026-10-05", from: "2026-10-05", to: "2026-10-11", days: 7, partial: false })
    expect(buckets.at(-1)).toEqual({ key: "2026-11-09", from: "2026-11-09", to: "2026-11-10", days: 2, partial: true })
    expect(buckets.reduce((sum, bucket) => sum + bucket.days, 0)).toBe(41)
  })
  it("cada dia cai no intervalo certo e a soma dos intervalos é a soma dos dias", () => {
    expect(bucketKeyOf("2026-10-02", "2026-10-01", "WEEK")).toBe("2026-10-01")
    expect(bucketKeyOf("2026-10-07", "2026-10-01", "WEEK")).toBe("2026-10-05")
    const rows = [
      { day: "2026-10-02", n: 2 },
      { day: "2026-10-05", n: 3 },
      { day: "2026-10-11", n: 4 },
      { day: "2026-11-10", n: 1 },
    ]
    const folded = foldByBucket(rows, { from: "2026-10-01", to: "2026-11-10" }, () => ({ n: 0 }), (totals, row) => {
      totals.n += row.n
    })
    expect(folded.map((entry) => entry.totals.n)).toEqual([2, 7, 0, 0, 0, 0, 1])
  })
})

describe("motivos de procura pela rota", () => {
  it("especialista vem da participação gravada; o nome técnico agent_<hex> nunca vira rota", () => {
    expect(isSpecialistTool("agent_408046f113184c458824c9a9883568f1")).toBe(true)
    expect(isSpecialistTool("my_results")).toBe(false)
    expect(directRouteLabel("my_results")).toBe("Consulta aos próprios resultados")
    expect(directRouteLabel("ferramenta_nova")).toBe("Ferramenta ferramenta_nova")
  })
  it("participação = respostas com a rota ÷ respostas do período; rotas além do limite viram 'outras'", () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({ kind: "DIRECT" as const, key: `tool:${index}`, label: `Rota ${index}`, detail: null, answers: 10 - index }))
    const ranked = rankRoutes(rows, 20, 3)
    expect(ranked.items.map((item) => [item.label, item.share])).toEqual([
      ["Rota 0", 0.5],
      ["Rota 1", 0.45],
      ["Rota 2", 0.4],
    ])
    // A soma das participações passa de 100%: uma resposta pode ter várias rotas.
    expect(ranked.items.reduce((sum, item) => sum + (item.share ?? 0), 0)).toBeGreaterThan(1)
    expect(ranked.others).toEqual({ routes: 1, answers: 7 })
    expect(rankRoutes(rows, 4).items[0]!.share).toBeNull()
  })
})
