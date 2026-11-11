import { describe, expect, it } from "vitest"
import { canReceiveAssignment, effectiveCapacity, inService, isConnected, notEligibleReason, presenceChange, scheduledFromRow, scheduledToApply, type AnjoSituation, type PresenceCurrent } from "./presence.js"

const ready = { connected: true, hasEnabledScope: true, activeAttendances: 0 }
const busy = { ...ready, activeAttendances: 2 }
const anjo = (overrides: Partial<AnjoSituation> = {}): AnjoSituation => ({ coversScope: true, active: true, status: "AVAILABLE", connected: true, activeAttendances: 0, capacity: 2, isOperator: false, scheduledChange: false, ...overrides })
const offline: PresenceCurrent = { status: "OFFLINE", pauseReason: null, scheduled: null }
const available: PresenceCurrent = { status: "AVAILABLE", pauseReason: null, scheduled: null }
const lunch: PresenceCurrent = { status: "PAUSED", pauseReason: "LUNCH", scheduled: null }

describe("presença do Anjo", () => {
  it("conexão = prazo no futuro", () => {
    const now = new Date("2026-11-09T12:00:00Z")
    expect(isConnected(new Date("2026-11-09T12:00:01Z"), now)).toBe(true)
    expect(isConnected(now, now)).toBe(false)
    expect(isConnected(null, now)).toBe(false)
  })

  it("ficar disponível exige a área aberta e um escopo ligado", () => {
    expect(presenceChange(offline, { status: "AVAILABLE" }, { ...ready, connected: false })).toEqual({ ok: false, code: "HUMAN_SUPPORT_NOT_CONNECTED" })
    expect(presenceChange(offline, { status: "AVAILABLE" }, { ...ready, hasEnabledScope: false })).toEqual({ ok: false, code: "HUMAN_SUPPORT_NO_ENABLED_SCOPE" })
    expect(presenceChange(offline, { status: "AVAILABLE" }, ready)).toEqual({ ok: true, kind: "APPLY", status: "AVAILABLE", pauseReason: null })
    expect(presenceChange(offline, { status: "PAUSED", pauseReason: "LUNCH" }, ready)).toEqual({ ok: false, code: "HUMAN_SUPPORT_PRESENCE_INVALID" })
  })

  it("sem atendimento: pausa e indisponibilidade entram na hora; o mesmo estado não muda nada", () => {
    expect(presenceChange(available, { status: "PAUSED", pauseReason: "LUNCH" }, ready)).toEqual({ ok: true, kind: "APPLY", status: "PAUSED", pauseReason: "LUNCH" })
    expect(presenceChange(available, { status: "OFFLINE" }, ready)).toEqual({ ok: true, kind: "APPLY", status: "OFFLINE", pauseReason: null })
    expect(presenceChange(lunch, { status: "OFFLINE" }, ready)).toEqual({ ok: true, kind: "APPLY", status: "OFFLINE", pauseReason: null })
    expect(presenceChange(available, { status: "AVAILABLE" }, ready)).toEqual({ ok: true, kind: "NONE" })
  })

  it("com atendimento: pausa e indisponibilidade viram programação; o estado atual fica", () => {
    expect(presenceChange(available, { status: "PAUSED", pauseReason: "MEETING" }, busy)).toEqual({ ok: true, kind: "SCHEDULE", scheduled: { status: "PAUSED", pauseReason: "MEETING" } })
    expect(presenceChange(available, { status: "OFFLINE" }, busy)).toEqual({ ok: true, kind: "SCHEDULE", scheduled: { status: "OFFLINE", pauseReason: null } })
    // Em pausa ele já não recebe chamados: trocar o motivo e "Voltar" valem na hora; Indisponível é programado.
    expect(presenceChange(lunch, { status: "PAUSED", pauseReason: "MEETING" }, busy)).toEqual({ ok: true, kind: "APPLY", status: "PAUSED", pauseReason: "MEETING" })
    expect(presenceChange(lunch, { status: "AVAILABLE" }, { ...busy, connected: false })).toEqual({ ok: true, kind: "APPLY", status: "AVAILABLE", pauseReason: null })
    expect(presenceChange(lunch, { status: "OFFLINE" }, busy)).toEqual({ ok: true, kind: "SCHEDULE", scheduled: { status: "OFFLINE", pauseReason: null } })
  })

  it("alterar e cancelar a programação", () => {
    const scheduledPause: PresenceCurrent = { ...available, scheduled: { status: "PAUSED", pauseReason: "LUNCH" } }
    // Alterar: outro motivo ou Indisponível troca a programação.
    expect(presenceChange(scheduledPause, { status: "PAUSED", pauseReason: "PERSONAL" }, busy)).toEqual({ ok: true, kind: "SCHEDULE", scheduled: { status: "PAUSED", pauseReason: "PERSONAL" } })
    expect(presenceChange(scheduledPause, { status: "OFFLINE" }, busy)).toEqual({ ok: true, kind: "SCHEDULE", scheduled: { status: "OFFLINE", pauseReason: null } })
    // Pedir o que já está programado não muda nada; pedir o estado atual desfaz a programação.
    expect(presenceChange(scheduledPause, { status: "PAUSED", pauseReason: "LUNCH" }, busy)).toEqual({ ok: true, kind: "NONE" })
    expect(presenceChange(scheduledPause, { status: "AVAILABLE" }, busy)).toEqual({ ok: true, kind: "CANCEL_SCHEDULE" })
    // Em pausa com Indisponível programado: "Voltar" aplica Disponível na hora (e a programação some com a mudança aplicada).
    expect(presenceChange({ ...lunch, scheduled: { status: "OFFLINE", pauseReason: null } }, { status: "AVAILABLE" }, busy)).toEqual({ ok: true, kind: "APPLY", status: "AVAILABLE", pauseReason: null })
  })

  it("a programação entra só quando não sobra atendimento; leitura das colunas", () => {
    const pause = { status: "PAUSED" as const, pauseReason: "LUNCH" as const }
    expect(scheduledToApply(pause, 1)).toBeNull()
    expect(scheduledToApply(pause, 0)).toEqual(pause)
    expect(scheduledToApply(null, 0)).toBeNull()
    expect(scheduledFromRow({ scheduled_status: "OFFLINE", scheduled_pause_reason: null })).toEqual({ status: "OFFLINE", pauseReason: null })
    expect(scheduledFromRow({ scheduled_status: "PAUSED", scheduled_pause_reason: "MEETING" })).toEqual({ status: "PAUSED", pauseReason: "MEETING" })
    expect(scheduledFromRow({ scheduled_status: null, scheduled_pause_reason: null })).toBeNull()
  })

  it("em serviço e pode receber: pausa está em serviço mas não recebe; programação não recebe; sem vaga não recebe; o próprio operador nunca", () => {
    expect([inService(anjo()), canReceiveAssignment(anjo())]).toEqual([true, true])
    expect([inService(anjo({ status: "PAUSED" })), canReceiveAssignment(anjo({ status: "PAUSED" }))]).toEqual([true, false])
    expect([inService(anjo({ scheduledChange: true })), canReceiveAssignment(anjo({ scheduledChange: true }))]).toEqual([true, false])
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
    expect(notEligibleReason(anjo({ scheduledChange: true, activeAttendances: 2 }))).toBe("SCHEDULED_CHANGE")
    expect(notEligibleReason(anjo({ activeAttendances: 2 }))).toBe("NO_CAPACITY")
    expect(notEligibleReason(anjo())).toBeNull()
    expect([effectiveCapacity(null, 2), effectiveCapacity(3, 2)]).toEqual([2, 3])
  })
})
