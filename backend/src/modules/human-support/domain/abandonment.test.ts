import { describe, expect, it } from "vitest"
import { abandonmentOf, type AbandonAttendance } from "./abandonment.js"

const attendance = (patch: Partial<AbandonAttendance>): AbandonAttendance => ({ endCause: "ANJO_CLOSED", lostCause: null, anjoResponded: true, lastHumanAuthor: "ANJO", ...patch })

describe("abandonos", () => {
  it("na espera: fechou a INIA e cancelou são abandono; expirado à parte; atendido e na fila não", () => {
    const result = abandonmentOf(
      [
        { status: "ABANDONED", endCause: "OPERATOR_ABANDONED" },
        { status: "CANCELLED", endCause: "OPERATOR_CANCELLED" },
        { status: "EXPIRED", endCause: "QUEUE_EXPIRED" },
        { status: "CLOSED", endCause: "ANJO_CLOSED" },
        { status: "WAITING", endCause: null },
      ],
      [],
    )
    expect(result.waiting).toMatchObject({ requests: 5, closedInia: 1, cancelled: 1, abandoned: 2, expired: 1, rate: { numerator: 2, denominator: 5, value: 0.4 } })
  })

  it("no atendimento: encerramento normal e transferência nunca são abandono; operador × Anjo por causa", () => {
    const result = abandonmentOf([], [
      attendance({}),
      attendance({ endCause: "OPERATOR_CLOSED" }),
      attendance({ endCause: "TRANSFERRED" }),
      attendance({ endCause: "OPERATOR_ABSENT" }),
      attendance({ endCause: "INACTIVITY", lastHumanAuthor: "ANJO" }),
      attendance({ endCause: "INACTIVITY", anjoResponded: false, lastHumanAuthor: "OPERATOR" }),
      attendance({ endCause: "ANJO_LOST", lostCause: "CONNECTION" }),
      attendance({ endCause: "ANJO_LOST", lostCause: "SESSION" }),
      attendance({ endCause: null }),
    ])
    expect(result.attendance).toMatchObject({
      ended: 7,
      byOperator: { leftInia: 1, noReply: 1, total: 2 },
      byAnjo: { connection: 1, session: 1, roleRevoked: 0, unknownDrop: 0, noReply: 1, total: 3 },
      abandoned: 5,
      rate: { numerator: 5, denominator: 7 },
    })
  })

  it("sem dados: taxas 'sem dados', nunca 0%", () => {
    const result = abandonmentOf([], [])
    expect(result.waiting.rate.status).toBe("NO_DATA")
    expect(result.attendance.rate.status).toBe("NO_DATA")
  })
})
