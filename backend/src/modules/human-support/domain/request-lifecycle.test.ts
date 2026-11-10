import { describe, expect, it } from "vitest"
import { anjoLost, attendanceInactive, canWriteMessage, cancelDecision, closeDecision, operatorAbandoned, queueExpired } from "./request-lifecycle.js"

const now = new Date("2026-11-09T12:00:00Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

describe("ciclo de vida do pedido", () => {
  it("cancelar só na fila", () => {
    expect(cancelDecision("WAITING")).toEqual({ ok: true, status: "CANCELLED", cause: "OPERATOR_CANCELLED" })
    for (const status of ["IN_PROGRESS", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"] as const) expect(cancelDecision(status)).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
  })

  it("operador encerra o atendimento (também antes da primeira resposta); na fila, encerrar vira cancelar; terminado, 409", () => {
    expect(closeDecision({ status: "IN_PROGRESS", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CLOSE", cause: "OPERATOR_CLOSED" })
    expect(closeDecision({ status: "WAITING", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CANCEL", cause: "OPERATOR_CANCELLED" })
    expect(closeDecision({ status: "CLOSED", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
  })

  it("Anjo encerra só o próprio; operador ausente só depois de 5 min sem chamar", () => {
    expect(closeDecision({ status: "IN_PROGRESS", actor: "ANJO", isActiveAnjo: true, operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CLOSE", cause: "ANJO_CLOSED" })
    expect(closeDecision({ status: "IN_PROGRESS", actor: "ANJO", isActiveAnjo: false, operatorSeenAt: now, now })).toEqual({ ok: false, code: "HUMAN_SUPPORT_NOT_YOUR_ATTENDANCE" })
    expect(closeDecision({ status: "IN_PROGRESS", actor: "ANJO", isActiveAnjo: true, cause: "OPERATOR_ABSENT", operatorSeenAt: minutesAgo(4), now })).toEqual({ ok: false, code: "HUMAN_SUPPORT_OPERATOR_PRESENT" })
    expect(closeDecision({ status: "IN_PROGRESS", actor: "ANJO", isActiveAnjo: true, cause: "OPERATOR_ABSENT", operatorSeenAt: minutesAgo(6), now })).toEqual({ ok: true, kind: "CLOSE", cause: "OPERATOR_ABSENT" })
    expect(closeDecision({ status: "WAITING", actor: "ANJO", isActiveAnjo: true, operatorSeenAt: now, now })).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
  })

  it("mensagens: operador na fila e no atendimento; Anjo só no próprio em andamento; terminado, 409", () => {
    expect(canWriteMessage({ status: "WAITING", author: "OPERATOR", isActiveAnjo: false })).toEqual({ ok: true })
    expect(canWriteMessage({ status: "WAITING", author: "ANJO", isActiveAnjo: false })).toEqual({ ok: false, code: "NOT_FOUND" })
    expect(canWriteMessage({ status: "IN_PROGRESS", author: "ANJO", isActiveAnjo: true })).toEqual({ ok: true })
    expect(canWriteMessage({ status: "IN_PROGRESS", author: "ANJO", isActiveAnjo: false })).toEqual({ ok: false, code: "NOT_FOUND" })
    expect(canWriteMessage({ status: "EXPIRED", author: "OPERATOR", isActiveAnjo: false })).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
  })

  it("prazos: fila vencida, operador 2 min sem chamar, 15 min sem mensagem, Anjo 3 min além do prazo da conexão", () => {
    expect([queueExpired(now, now), queueExpired(new Date(now.getTime() + 1), now)]).toEqual([true, false])
    expect([operatorAbandoned(minutesAgo(2.1), now), operatorAbandoned(minutesAgo(1.9), now)]).toEqual([true, false])
    expect([attendanceInactive(minutesAgo(15.1), now), attendanceInactive(minutesAgo(14.9), now)]).toEqual([true, false])
    expect([anjoLost(minutesAgo(3.1), now), anjoLost(minutesAgo(2.9), now), anjoLost(null, now)]).toEqual([true, false, true])
  })
})
