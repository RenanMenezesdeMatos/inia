import { describe, expect, it } from "vitest"
import { detectAnomalies } from "./anomaly-detection.js"

const series = (values: number[]) => values.map((value, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, value }))

describe("detect_anomalies — mediana + MAD, explicável e determinístico", () => {
  it("série estável: nenhum ponto fora, padrão STABLE", () => {
    const report = detectAnomalies(series([400, 402, 398, 401, 399, 403, 400]), "LOWER")
    expect(report.pattern).toBe("STABLE")
    expect(report.anomalies).toEqual([])
    expect(report.baseline).toBe(400)
  })

  it("um pico isolado é ANOMALY e, para indicador LOWER, é WORSE", () => {
    const report = detectAnomalies(series([400, 402, 398, 401, 700, 403, 400, 399]), "LOWER")
    expect(report.pattern).toBe("ISOLATED_SPIKES")
    expect(report.anomalies).toHaveLength(1)
    expect(report.anomalies[0]).toMatchObject({ date: "2026-09-05", value: 700, classification: "ANOMALY", performance: "WORSE" })
  })

  it("para indicador HIGHER, um vale é WORSE e um pico é BETTER", () => {
    const report = detectAnomalies(series([90, 91, 89, 90, 40, 92, 90, 99]), "HIGHER")
    const byDate = Object.fromEntries(report.anomalies.map((point) => [point.date, point.performance]))
    expect(byDate["2026-09-05"]).toBe("WORSE")
    expect(byDate["2026-09-08"]).toBe("BETTER")
  })

  it("≥ 30% dos pontos fora = RECURRENT, não pico isolado", () => {
    const report = detectAnomalies(series([400, 900, 401, 950, 399, 980, 402, 400, 1000, 401]), "LOWER")
    expect(report.pattern).toBe("RECURRENT")
    expect(report.anomalies.length).toBeGreaterThanOrEqual(3)
  })

  it("série vazia = NO_DATA; método documentado no resultado", () => {
    const report = detectAnomalies([], "LOWER")
    expect(report.pattern).toBe("NO_DATA")
    expect(report.method).toContain("Mediana")
  })
})
