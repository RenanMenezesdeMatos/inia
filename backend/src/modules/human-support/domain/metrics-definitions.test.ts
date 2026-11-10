import { describe, expect, it } from "vitest"
import { presenceHours, ratio, supportMeasures, type SupportCounts } from "./metrics-definitions.js"

const counts = (overrides: Partial<SupportCounts> = {}): SupportCounts => ({
  suggestions: { SIGNAL: 8, DISLIKE: 2 }, requestsByOrigin: { BUTTON: 3, DISLIKE: 2, SIGNAL: 4 }, convertedRequests: 5, noAnjoAttempts: 2,
  endedByOutcome: { "CLOSED:ANJO_CLOSED": 4, "EXPIRED:QUEUE_EXPIRED": 1 }, hadAttendance: 5, openRequests: 1,
  queuePopulation: null, assignmentWaitSeconds: [30, 60, 90, 120, 600], firstResponseSeconds: [10, 20, 30, 40, 50], endedAttendances: 6, endedWithoutResponseByCause: { INACTIVITY: 1 },
  durationSeconds: [100, 200, 300, 400, 500], interruptedAttendances: 1,
  classificationsByReason: { FOUND_IN_PROCESS: 3, OTHER: 2 }, classificationsByOutcome: { RESOLVED: 4, NOT_RESOLVED: 1 }, topTitles: [{ title: "Cancelamento PJ", count: 2 }],
  resolvedCounts: { YES: 3, PARTIAL: 1, NO: 1 }, starsCounts: { "5": 3, "4": 2 }, endedNotInterrupted: 5, ...overrides,
})
const byId = (all: ReturnType<typeof supportMeasures>) => new Map(all.map((measure) => [measure.id, measure]))

describe("medidas M7–M17", () => {
  it("contagens, conversão por coorte, desfechos, percentis, cobertura e média só com 5 notas", () => {
    const measures = byId(supportMeasures(counts()))
    expect([...measures.keys()]).toEqual(["M7", "M8", "M9", "M10", "M11", "M12", "M13", "M14", "M15", "M16", "M17"])
    expect(measures.get("M7")!.main.value).toBe(10)
    expect(measures.get("M8")!.main.value).toBe(9)
    expect(measures.get("M8")!.conversion).toEqual({ numerator: 5, denominator: 10, value: 0.5, status: "OK" })
    expect(measures.get("M9")!.main.value).toBe(2)
    expect(measures.get("M10")!.breakdown![0]).toMatchObject({ key: "CLOSED:ANJO_CLOSED", count: 4, value: 0.8 })
    expect(measures.get("M10")!.extra).toEqual([{ key: "HAD_ATTENDANCE", label: "Tiveram atendimento", count: 5 }, { key: "OPEN", label: "Ainda abertos", count: 1 }])
    expect(measures.get("M11")!.percentiles).toEqual({ p50: null, p90: 600, estimate: { kind: "NO_HISTORY" } })
    expect(measures.get("M12")!.percentiles).toMatchObject({ p50: 30, p90: 50 })
    expect(measures.get("M12")!.noResponse).toEqual({ numerator: 1, denominator: 6, value: 1 / 6, status: "OK" })
    expect(measures.get("M14")!.coverage).toEqual({ numerator: 5, denominator: 6, value: 5 / 6, status: "OK" })
    expect(measures.get("M16")!.coverage).toEqual({ numerator: 5, denominator: 5, value: 1, status: "OK" })
    expect(measures.get("M17")!.main).toEqual({ numerator: 23, denominator: 5, value: 4.6, status: "OK" })
  })

  it("poucas notas: média oculta; sem nada: sem dados, nunca zero por cento", () => {
    const measures = byId(supportMeasures(counts({ starsCounts: { "5": 2 }, suggestions: { SIGNAL: 0, DISLIKE: 0 }, convertedRequests: 0 })))
    expect(measures.get("M17")!.main).toMatchObject({ value: null, status: "SMALL_SAMPLE" })
    expect(measures.get("M8")!.conversion).toEqual({ numerator: 0, denominator: 0, value: null, status: "NO_DATA" })
    expect(ratio(0, 0).status).toBe("NO_DATA")
  })
})

describe("M18 — horas de presença", () => {
  it("disponível e em pausa só conectado; sem conexão = declarado mas sem a área aberta", () => {
    const at = (hour: number) => new Date(Date.UTC(2026, 10, 9, hour))
    const hours = presenceHours({ status: "OFFLINE", pauseReason: null, connected: false }, [
      { occurredAt: at(8), toStatus: "AVAILABLE", pauseReason: null, cause: "ANJO" },
      { occurredAt: at(10), toStatus: "PAUSED", pauseReason: "LUNCH", cause: "ANJO" },
      { occurredAt: at(11), toStatus: "AVAILABLE", pauseReason: null, cause: "ANJO" },
      { occurredAt: at(12), toStatus: "AVAILABLE", pauseReason: null, cause: "CONNECTION_LOST" },
      { occurredAt: at(13), toStatus: "AVAILABLE", pauseReason: null, cause: "CONNECTION_RESTORED" },
      { occurredAt: at(14), toStatus: "OFFLINE", pauseReason: null, cause: "ANJO" },
    ], at(0), at(18))
    expect(hours).toEqual({ available: 4, disconnected: 1, paused: { LUNCH: 1, PERSONAL: 0, PROCESS_ACTIVITY: 0, MEETING: 0 } })
  })
})
