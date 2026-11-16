import { describe, expect, it } from "vitest"
import type { AnjoSituation } from "./presence.js"
import { transferDecision } from "./transfer.js"

const anjo = (overrides: Partial<AnjoSituation> = {}): AnjoSituation => ({ coversScope: true, active: true, status: "AVAILABLE", connected: true, activeAttendances: 0, capacity: 2, isOperator: false, scheduledChange: false, ...overrides })
const toB = { kind: "ANJO" as const, anjoPersonId: "b" }

describe("transferência pela coordenação", () => {
  it("só com o pedido em atendimento", () => {
    expect(transferDecision({ requestStatus: "WAITING", currentAnjoPersonId: null, target: { kind: "QUEUE" }, targetSituation: null })).toEqual({ ok: false, code: "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS" })
    expect(transferDecision({ requestStatus: "CLOSED", currentAnjoPersonId: "a", target: toB, targetSituation: anjo() })).toEqual({ ok: false, code: "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS" })
  })

  it("devolver à fila sempre pode; para o mesmo Anjo, não", () => {
    expect(transferDecision({ requestStatus: "IN_PROGRESS", currentAnjoPersonId: "a", target: { kind: "QUEUE" }, targetSituation: null })).toEqual({ ok: true })
    expect(transferDecision({ requestStatus: "IN_PROGRESS", currentAnjoPersonId: "a", target: { kind: "ANJO", anjoPersonId: "a" }, targetSituation: anjo() })).toEqual({ ok: false, code: "HUMAN_SUPPORT_TRANSFER_SAME_ANJO" })
  })

  it("destino só quem pode receber agora: disponível, conectado, sem programação, com vaga e do escopo", () => {
    const decide = (situation: AnjoSituation | null) => transferDecision({ requestStatus: "IN_PROGRESS", currentAnjoPersonId: "a", target: toB, targetSituation: situation })
    expect(decide(anjo())).toEqual({ ok: true })
    expect(decide(null)).toMatchObject({ ok: false, notEligible: "NOT_AN_ANJO" })
    expect(decide(anjo({ status: "PAUSED" }))).toMatchObject({ ok: false, notEligible: "PAUSED" })
    expect(decide(anjo({ connected: false }))).toMatchObject({ ok: false, notEligible: "NOT_CONNECTED" })
    expect(decide(anjo({ scheduledChange: true }))).toMatchObject({ ok: false, notEligible: "SCHEDULED_CHANGE" })
    expect(decide(anjo({ activeAttendances: 2 }))).toMatchObject({ ok: false, notEligible: "NO_CAPACITY" })
    expect(decide(anjo({ coversScope: false }))).toMatchObject({ ok: false, notEligible: "SCOPE_NOT_COVERED" })
  })
})
