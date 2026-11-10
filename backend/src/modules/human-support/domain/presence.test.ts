import { describe, expect, it } from "vitest"
import { canReceiveAssignment, effectiveCapacity, inService, isConnected, notEligibleReason, presenceChange, type AnjoSituation } from "./presence.js"

const ready = { connected: true, hasEnabledScope: true, activeAttendances: 0 }
const anjo = (overrides: Partial<AnjoSituation> = {}): AnjoSituation => ({ coversScope: true, active: true, status: "AVAILABLE", connected: true, activeAttendances: 0, capacity: 2, isOperator: false, ...overrides })

describe("presença do Anjo", () => {
  it("conexão = prazo no futuro", () => {
    const now = new Date("2026-11-09T12:00:00Z")
    expect(isConnected(new Date("2026-11-09T12:00:01Z"), now)).toBe(true)
    expect(isConnected(now, now)).toBe(false)
    expect(isConnected(null, now)).toBe(false)
  })

  it("ficar disponível exige a área aberta e um escopo ligado", () => {
    const offline = { status: "OFFLINE" as const, pauseReason: null }
    expect(presenceChange(offline, { status: "AVAILABLE" }, { ...ready, connected: false })).toEqual({ ok: false, code: "HUMAN_SUPPORT_NOT_CONNECTED" })
    expect(presenceChange(offline, { status: "AVAILABLE" }, { ...ready, hasEnabledScope: false })).toEqual({ ok: false, code: "HUMAN_SUPPORT_NO_ENABLED_SCOPE" })
    expect(presenceChange(offline, { status: "AVAILABLE" }, ready)).toEqual({ ok: true, changed: true, status: "AVAILABLE", pauseReason: null })
    expect(presenceChange(offline, { status: "PAUSED", pauseReason: "LUNCH" }, ready)).toEqual({ ok: false, code: "HUMAN_SUPPORT_PRESENCE_INVALID" })
  })

  it("pausa com motivo, troca de motivo, voltar; ficar indisponível só sem atendimento; o mesmo estado não muda nada", () => {
    const available = { status: "AVAILABLE" as const, pauseReason: null }
    expect(presenceChange(available, { status: "PAUSED", pauseReason: "LUNCH" }, ready)).toMatchObject({ ok: true, status: "PAUSED", pauseReason: "LUNCH" })
    expect(presenceChange({ status: "PAUSED", pauseReason: "LUNCH" }, { status: "PAUSED", pauseReason: "MEETING" }, ready)).toMatchObject({ ok: true, changed: true, pauseReason: "MEETING" })
    expect(presenceChange({ status: "PAUSED", pauseReason: "LUNCH" }, { status: "AVAILABLE" }, { ...ready, connected: false })).toMatchObject({ ok: true, status: "AVAILABLE" })
    expect(presenceChange(available, { status: "OFFLINE" }, { ...ready, activeAttendances: 1 })).toEqual({ ok: false, code: "HUMAN_SUPPORT_ACTIVE_ATTENDANCES" })
    expect(presenceChange(available, { status: "OFFLINE" }, ready)).toMatchObject({ ok: true, status: "OFFLINE" })
    expect(presenceChange(available, { status: "AVAILABLE" }, ready)).toEqual({ ok: true, changed: false, status: "AVAILABLE", pauseReason: null })
  })

  it("em serviço e pode receber: pausa está em serviço mas não recebe; sem vaga não recebe; o próprio operador nunca", () => {
    expect([inService(anjo()), canReceiveAssignment(anjo())]).toEqual([true, true])
    expect([inService(anjo({ status: "PAUSED" })), canReceiveAssignment(anjo({ status: "PAUSED" }))]).toEqual([true, false])
    expect([inService(anjo({ connected: false })), canReceiveAssignment(anjo({ connected: false }))]).toEqual([false, false])
    expect(canReceiveAssignment(anjo({ activeAttendances: 2 }))).toBe(false)
    expect(inService(anjo({ isOperator: true }))).toBe(false)
    expect(inService(anjo({ coversScope: false }))).toBe(false)
  })

  it("motivo de não poder receber, na ordem; capacidade efetiva", () => {
    expect(notEligibleReason(anjo({ coversScope: false, status: "OFFLINE" }))).toBe("SCOPE_NOT_COVERED")
    expect(notEligibleReason(anjo({ status: "OFFLINE" }))).toBe("OFFLINE")
    expect(notEligibleReason(anjo({ connected: false }))).toBe("NOT_CONNECTED")
    expect(notEligibleReason(anjo({ status: "PAUSED" }))).toBe("PAUSED")
    expect(notEligibleReason(anjo({ activeAttendances: 2 }))).toBe("NO_CAPACITY")
    expect(notEligibleReason(anjo())).toBeNull()
    expect([effectiveCapacity(null, 2), effectiveCapacity(3, 2)]).toEqual([2, 3])
  })
})
