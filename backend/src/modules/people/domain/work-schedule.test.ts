import { describe, expect, it } from "vitest"
import { isLegacyBusinessDay, nextScheduledDayOff, normalizeScheduleType, resolveScheduledDay, weekdayOf } from "./work-schedule.js"

describe("escala de trabalho — domínio", () => {
  it("regime: só 5x2/6x1 (e os códigos internos) são reconhecidos", () => {
    expect(normalizeScheduleType("5x2")).toBe("FIVE_BY_TWO")
    expect(normalizeScheduleType("6X1")).toBe("SIX_BY_ONE")
    expect(normalizeScheduleType(" 6 x 1 ")).toBe("SIX_BY_ONE")
    expect(normalizeScheduleType("SIX_BY_ONE")).toBe("SIX_BY_ONE")
    for (const raw of ["4x3", "12x36", "", null, "escala"]) expect(normalizeScheduleType(raw)).toBeNull()
  })

  it("calendário explícito vence tudo: trabalha/folga como a fonte disse — inclusive domingo trabalhado e quarta de folga; feriado não vence escala explícita", () => {
    expect(resolveScheduledDay({ date: "2026-09-13", explicit: { date: "2026-09-13", scheduledToWork: true, shiftStart: null, shiftEnd: null }, scheduleType: "SIX_BY_ONE", holiday: true })).toEqual({ scheduledToWork: true, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null })
    expect(resolveScheduledDay({ date: "2026-09-09", explicit: { date: "2026-09-09", scheduledToWork: false, shiftStart: null, shiftEnd: null }, scheduleType: null, holiday: false })).toEqual({ scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null })
  })

  it("6x1 conhecido sem folga informada = DESCONHECIDO (nunca seg–sex inventado)", () => {
    expect(resolveScheduledDay({ date: "2026-09-09", explicit: undefined, scheduleType: "SIX_BY_ONE", holiday: false })).toEqual({ scheduledToWork: false, basis: "UNKNOWN_SCHEDULE", holiday: false, exception: null })
  })

  it("sem escala configurada: fallback legado seg–sex; feriado aplicável só vira folga com política EXCLUDE (só aqui)", () => {
    expect(resolveScheduledDay({ date: "2026-09-09", explicit: undefined, scheduleType: null, holiday: false })).toEqual({ scheduledToWork: true, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null })
    expect(resolveScheduledDay({ date: "2026-09-12", explicit: undefined, scheduleType: null, holiday: false })).toEqual({ scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null })
    expect(resolveScheduledDay({ date: "2026-09-07", explicit: undefined, scheduleType: "FIVE_BY_TWO", holiday: true })).toEqual({ scheduledToWork: true, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null }) // IGNORE (default)
    expect(resolveScheduledDay({ date: "2026-09-07", explicit: undefined, scheduleType: "FIVE_BY_TWO", holiday: true, holidayPolicy: "EXCLUDE_APPLICABLE_HOLIDAYS" })).toEqual({ scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: true, exception: null })
    // Feriado num sábado do fallback: continua fim de semana (não vira "excluído por feriado").
    expect(resolveScheduledDay({ date: "2026-09-12", explicit: undefined, scheduleType: null, holiday: true, holidayPolicy: "EXCLUDE_APPLICABLE_HOLIDAYS" })).toEqual({ scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null })
    expect(weekdayOf("2026-09-13")).toBe(0)
    expect(isLegacyBusinessDay("2026-09-11")).toBe(true)
  })

  it("exceção individual NON_WORKING vence a escala explícita 'trabalha' e o fallback; efeito, não código, decide", () => {
    const dayOff = { date: "2026-09-09", code: "DAY_OFF" as const, effect: "NON_WORKING" as const, rawReason: "DAY OFF" }
    expect(resolveScheduledDay({ date: "2026-09-09", explicit: { date: "2026-09-09", scheduledToWork: true, shiftStart: "08:00", shiftEnd: "14:20" }, scheduleType: "SIX_BY_ONE", holiday: false, exception: dayOff })).toEqual({ scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: dayOff })
    expect(resolveScheduledDay({ date: "2026-09-09", explicit: undefined, scheduleType: null, holiday: false, exception: { ...dayOff, code: "BANCO_HORAS" } })).toMatchObject({ scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", exception: { code: "BANCO_HORAS" } })
    // Feriado + trabalha explícito + day off → não trabalha (exceção), sem "feriado" na conta.
    expect(resolveScheduledDay({ date: "2026-09-07", explicit: { date: "2026-09-07", scheduledToWork: true, shiftStart: null, shiftEnd: null }, scheduleType: null, holiday: true, holidayPolicy: "EXCLUDE_APPLICABLE_HOLIDAYS", exception: dayOff })).toMatchObject({ scheduledToWork: false, holiday: false, exception: { code: "DAY_OFF" } })
  })

  it("próxima folga só a partir de calendário explícito", () => {
    const days = [
      { date: "2026-09-16", scheduledToWork: true, shiftStart: null, shiftEnd: null },
      { date: "2026-09-18", scheduledToWork: false, shiftStart: null, shiftEnd: null },
      { date: "2026-09-25", scheduledToWork: false, shiftStart: null, shiftEnd: null },
    ]
    expect(nextScheduledDayOff(days, "2026-09-16")?.date).toBe("2026-09-18")
    expect(nextScheduledDayOff(days, "2026-09-19")?.date).toBe("2026-09-25")
    expect(nextScheduledDayOff([], "2026-09-16")).toBeNull()
  })
})
