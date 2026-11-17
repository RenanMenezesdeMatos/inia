import { describe, expect, it } from "vitest"
import { anjoLost, canWriteMessage, cancelDecision, closeDecision, operatorAbandoned, operatorDidNotReturn, queueExpired, responseTimesProblem, silentSide } from "./request-lifecycle.js"

const now = new Date("2026-11-09T12:00:00Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

describe("ciclo de vida do pedido", () => {
  it("cancelar na fila ou aguardando o retorno do operador", () => {
    expect(cancelDecision("WAITING")).toEqual({ ok: true, status: "CANCELLED", cause: "OPERATOR_CANCELLED" })
    expect(cancelDecision("AWAITING_OPERATOR")).toEqual({ ok: true, status: "CANCELLED", cause: "OPERATOR_CANCELLED" })
    for (const status of ["IN_PROGRESS", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"] as const) expect(cancelDecision(status)).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
  })

  it("operador encerra o atendimento (também antes da primeira resposta); na fila, encerrar vira cancelar; terminado, 409", () => {
    expect(closeDecision({ status: "IN_PROGRESS", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CLOSE", cause: "OPERATOR_CLOSED" })
    expect(closeDecision({ status: "WAITING", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CANCEL", cause: "OPERATOR_CANCELLED" })
    expect(closeDecision({ status: "AWAITING_OPERATOR", actor: "OPERATOR", operatorSeenAt: now, now })).toEqual({ ok: true, kind: "CANCEL", cause: "OPERATOR_CANCELLED" })
    expect(closeDecision({ status: "AWAITING_OPERATOR", actor: "ANJO", isActiveAnjo: false, operatorSeenAt: now, now })).toEqual({ ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" })
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
    expect(canWriteMessage({ status: "AWAITING_OPERATOR", author: "OPERATOR", isActiveAnjo: false })).toEqual({ ok: true })
    expect(canWriteMessage({ status: "AWAITING_OPERATOR", author: "ANJO", isActiveAnjo: false })).toEqual({ ok: false, code: "NOT_FOUND" })
  })

  it("tempos de resposta: a vez é de quem não escreveu por último; cada lado com o seu tempo; o 2º tempo do operador encerra", () => {
    const times = { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 10 }
    // Última mensagem do Anjo → vez do operador (15 min).
    expect(silentSide({ lastHumanAuthor: "ANJO", lastHumanMessageAt: minutesAgo(14.9), now, times })).toBeNull()
    expect(silentSide({ lastHumanAuthor: "ANJO", lastHumanMessageAt: minutesAgo(15.1), now, times })).toBe("OPERATOR_SILENT")
    // Última do operador, ou ninguém escreveu ainda → vez do Anjo (10 min).
    expect(silentSide({ lastHumanAuthor: "OPERATOR", lastHumanMessageAt: minutesAgo(9.9), now, times })).toBeNull()
    expect(silentSide({ lastHumanAuthor: "OPERATOR", lastHumanMessageAt: minutesAgo(10.1), now, times })).toBe("ANJO_SILENT")
    expect(silentSide({ lastHumanAuthor: null, lastHumanMessageAt: minutesAgo(10.1), now, times })).toBe("ANJO_SILENT")
    expect([operatorDidNotReturn(minutesAgo(20.1), now, times), operatorDidNotReturn(minutesAgo(19.9), now, times)]).toEqual([true, false])
    expect(responseTimesProblem(times)).toBeNull()
    expect(responseTimesProblem({ ...times, operatorCloseMinutes: 15 })).toBe("O encerramento precisa ser depois da volta à fila do operador.")
    expect(responseTimesProblem({ ...times, anjoRequeueMinutes: 0 })).toBe("Os tempos de volta à fila vão de 1 a 120 minutos.")
    expect(responseTimesProblem({ ...times, operatorRequeueMinutes: 1.5 })).toBe("Use minutos inteiros.")
  })

  it("prazos: fila vencida, operador 2 min sem chamar, Anjo 3 min além do prazo da conexão", () => {
    expect([queueExpired(now, now), queueExpired(new Date(now.getTime() + 1), now)]).toEqual([true, false])
    expect([operatorAbandoned(minutesAgo(2.1), now), operatorAbandoned(minutesAgo(1.9), now)]).toEqual([true, false])
    expect([anjoLost(minutesAgo(3.1), now), anjoLost(minutesAgo(2.9), now), anjoLost(null, now)]).toEqual([true, false, true])
  })
})
