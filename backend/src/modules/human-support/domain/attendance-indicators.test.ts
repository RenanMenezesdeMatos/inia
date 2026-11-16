import { describe, expect, it } from "vitest"
import { attendanceIndicators, operationIndicators, type AttendanceRecord } from "./attendance-indicators.js"

const T = Date.UTC(2026, 10, 11, 13, 0)
const S = 1000
const record = (patch: Partial<AttendanceRecord>): AttendanceRecord => ({
  anjoPersonId: "B",
  requestId: "r1",
  startedAt: T + 35 * S,
  endedAt: T + 35 * S + 240 * S,
  endCause: "ANJO_CLOSED",
  lostCause: null,
  firstAnjoMessageAt: T + 40 * S,
  lastHumanAuthor: "ANJO",
  classification: { reason: "NO_PROCESS", pertinence: "PERTINENT" },
  firstOfRequest: true,
  requestCreatedAt: T,
  ...patch,
})

describe("indicadores de atendimento", () => {
  it("atendimento direto: espera do operador da entrada original ao acolhimento; tempo de atendimento do acolhimento ao fim", () => {
    const result = attendanceIndicators([record({})])
    expect(result.acolhimentos).toBe(1)
    expect(result.operatorWait).toEqual({ averageSeconds: 35, count: 1 })
    expect(result.handling).toMatchObject({ averageSeconds: 240, count: 1, normal: { averageSeconds: 240, count: 1 }, other: { averageSeconds: null, count: 0 } })
    expect(result.firstResponse).toEqual({ averageSeconds: 5, count: 1 })
  })

  it("sem atendimento: médias nulas (sem dados), nunca zero", () => {
    const result = attendanceIndicators([])
    expect(result.operatorWait).toEqual({ averageSeconds: null, count: 0 })
    expect(result.handling.averageSeconds).toBeNull()
    expect(result.pertinence.rate.status).toBe("NO_DATA")
    expect(result.noReply.rate).toMatchObject({ numerator: 0, denominator: 0, value: null, status: "NO_DATA" })
  })

  it("segundo atendimento do pedido (depois de interrupção ou transferência) não conta de novo na espera do operador", () => {
    const result = attendanceIndicators([record({ firstOfRequest: false, startedAt: T + 600 * S, endedAt: T + 700 * S })])
    expect(result.operatorWait.count).toBe(0)
    expect(result.handling.count).toBe(1)
  })

  it("motivos com 'Sem classificação'; pertinência só sobre os avaliados; interrompidos e transferidos fora", () => {
    const result = attendanceIndicators([
      record({}),
      record({ classification: { reason: "NO_PROCESS", pertinence: "NOT_PERTINENT" } }),
      record({ classification: { reason: "FOUND_IN_PROCESS", pertinence: null } }),
      record({ classification: null }),
      record({ endCause: "ANJO_LOST", lostCause: "SESSION", classification: null }),
      record({ endCause: "TRANSFERRED", classification: null }),
    ])
    expect(result.reasons.total).toBe(4)
    expect(result.reasons.items.map((item) => [item.key, item.count])).toEqual([["NO_PROCESS", 2], ["FOUND_IN_PROCESS", 1], ["NO_CLASSIFICATION", 1]])
    expect(result.reasons.items.find((item) => item.key === "NO_CLASSIFICATION")?.label).toBe("Sem classificação")
    expect(result.pertinence).toMatchObject({ pertinent: 1, notPertinent: 1, notEvaluated: 2 })
    expect(result.pertinence.rate).toMatchObject({ numerator: 1, denominator: 2 })
    expect(result.interruptedBySystem).toEqual({ connection: 0, session: 1, roleRevoked: 0, unknown: 0 })
    expect(result.handling.otherByCause).toEqual({ ANJO_LOST: 1, TRANSFERRED: 1 })
  })

  it("falta de retorno: numerador e denominador (sem os transferidos) e de quem faltou o retorno; abandono depois do acolhimento", () => {
    const result = attendanceIndicators([
      record({ endCause: "INACTIVITY", firstAnjoMessageAt: null, lastHumanAuthor: "OPERATOR" }),
      record({ endCause: "INACTIVITY", lastHumanAuthor: "OPERATOR" }),
      record({ endCause: "INACTIVITY", lastHumanAuthor: "ANJO" }),
      record({ endCause: "OPERATOR_ABSENT" }),
      record({}),
      record({ endCause: "TRANSFERRED" }),
    ])
    expect(result.noReply.rate).toMatchObject({ numerator: 3, denominator: 5 })
    expect(result.noReply).toMatchObject({ anjoSide: 2, operatorSide: 1 })
    expect(result.abandonedAfterAcolhimento).toBe(1)
  })
})

describe("estrelas", () => {
  it("média só com 5 notas ou mais; abaixo, nula com a quantidade", () => {
    expect(attendanceIndicators([4, 5, null].map((stars) => record({ stars }))).stars).toEqual({ average: null, count: 2 })
    expect(attendanceIndicators([5, 4, 4, 3, 5].map((stars) => record({ stars }))).stars).toEqual({ average: 4.2, count: 5 })
  })
})

describe("indicadores da operação", () => {
  it("sem Anjo logado conta uma vez por pedido encerrado na fila sem acolhimento; abandono antes do acolhimento; na fila não entra", () => {
    const result = operationIndicators([
      { status: "EXPIRED", endCause: "QUEUE_EXPIRED", hadAttendance: false, anjosInServiceAtEnd: 0 },
      { status: "ABANDONED", endCause: "OPERATOR_ABANDONED", hadAttendance: false, anjosInServiceAtEnd: 2 },
      { status: "CANCELLED", endCause: "OPERATOR_CANCELLED", hadAttendance: false, anjosInServiceAtEnd: 0 },
      { status: "EXPIRED", endCause: "QUEUE_EXPIRED", hadAttendance: false, anjosInServiceAtEnd: null },
      { status: "WAITING", endCause: null, hadAttendance: false, anjosInServiceAtEnd: null },
      { status: "CLOSED", endCause: "ANJO_CLOSED", hadAttendance: true, anjosInServiceAtEnd: null },
      { status: "ABANDONED", endCause: "OPERATOR_ABANDONED", hadAttendance: true, anjosInServiceAtEnd: 1 },
    ])
    expect(result).toMatchObject({ requests: 7, acolhidos: 2, waiting: 1, endedWithoutAcolhimento: 4, expired: 2, endedInQueueAfterAcolhimento: 1 })
    expect(result.noAnjoLogged).toEqual({ count: 2, withAnjos: 1, unrecorded: 1 })
    expect(result.abandonedBeforeAcolhimento).toEqual({ abandoned: 1, cancelled: 1 })
  })
})
