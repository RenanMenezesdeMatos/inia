import { describe, expect, it } from "vitest"
import { elapsedScheduledPercent, isAssumedWorkday, resolveRelativeInstant, resolveShiftWindow, type EmployeeShift } from "./shift-schedule.js"
import type { RelativeSchedule } from "../domain/trigger-config-schema.js"

const TZ = "America/Fortaleza" // UTC-3, sem horário de verão

describe("resolveShiftWindow — início/fim previstos, nunca comparando só relógios (Parte 17)", () => {
  it("jornada normal (não atravessa meia-noite)", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 } // 8h
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    expect(window.start.toISOString()).toBe("2026-09-14T11:00:00.000Z") // 08:00 -03:00
    expect(window.end.toISOString()).toBe("2026-09-14T19:00:00.000Z") // 16:00 -03:00
  })

  it("jornada que atravessa a meia-noite (entrada 22:00, 8h) termina no dia seguinte", () => {
    const shift: EmployeeShift = { startTime: "22:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    expect(window.start.toISOString()).toBe("2026-09-15T01:00:00.000Z") // 22:00 -03:00 (14/09)
    expect(window.end.toISOString()).toBe("2026-09-15T09:00:00.000Z") // 06:00 -03:00 (15/09)
  })

  it("aceita start_time no formato HH:mm:ss (coluna `time` do Postgres)", () => {
    const shift: EmployeeShift = { startTime: "08:00:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    expect(window.start.toISOString()).toBe("2026-09-14T11:00:00.000Z")
  })
})

describe("resolveRelativeInstant — START (X minutos após o início)", () => {
  const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 } // 08:00 -> 16:00

  it("15 minutos após o início", () => {
    const relative: RelativeSchedule = { anchor: "START", offsetMinutes: 15 }
    const instant = resolveRelativeInstant(shift, relative, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T11:15:00.000Z") // 08:15 -03:00
  })

  it("operadores com entradas diferentes disparam em horários diferentes pra mesma regra", () => {
    const relative: RelativeSchedule = { anchor: "START", offsetMinutes: 15 }
    const joao = resolveRelativeInstant({ startTime: "08:00", workMinutes: 480 }, relative, "2026-09-14", TZ)
    const maria = resolveRelativeInstant({ startTime: "09:00", workMinutes: 480 }, relative, "2026-09-14", TZ)
    expect(joao?.toISOString()).toBe("2026-09-14T11:15:00.000Z")
    expect(maria?.toISOString()).toBe("2026-09-14T12:15:00.000Z")
  })

  it("offset incompatível com a duração da jornada (nunca dispara fora do expediente — Parte 30)", () => {
    const shortShift: EmployeeShift = { startTime: "08:00", workMinutes: 240 } // 4h: 08:00 -> 12:00
    const relative: RelativeSchedule = { anchor: "START", offsetMinutes: 300 } // 5h após o início
    expect(resolveRelativeInstant(shortShift, relative, "2026-09-14", TZ)).toBeNull()
  })
})

describe("resolveRelativeInstant — PERCENTAGE (percentual da jornada prevista)", () => {
  it("50% (entrada 08:00, 8h) -> 12:00", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 50 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T15:00:00.000Z") // 12:00 -03:00
  })

  it("50% (entrada 07:30, 6h) -> 10:30", () => {
    const shift: EmployeeShift = { startTime: "07:30", workMinutes: 360 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 50 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T13:30:00.000Z") // 10:30 -03:00
  })

  it("0% == início do expediente", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 0 }, "2026-09-14", TZ)
    expect(instant?.getTime()).toBe(window.start.getTime())
  })

  it("100% == fim do expediente (08:00 + 8h = 16:00)", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 100 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T19:00:00.000Z") // 16:00 -03:00
  })

  it("100% (entrada 13:00, 6h) == 19:00", () => {
    const shift: EmployeeShift = { startTime: "13:00", workMinutes: 360 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 100 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T22:00:00.000Z") // 19:00 -03:00
  })

  it("75% (entrada 08:00, 8h) -> 14:00", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 75 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T17:00:00.000Z") // 14:00 -03:00
  })
})

describe("resolveRelativeInstant — END (X minutos antes do fim)", () => {
  it("30 minutos antes do fim (08:00 + 8h = 16:00 -> 15:30)", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const instant = resolveRelativeInstant(shift, { anchor: "END", offsetMinutes: 30 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-14T18:30:00.000Z") // 15:30 -03:00
  })

  it("offset maior que a duração da jornada nunca cai antes do início (Parte 30)", () => {
    const shortShift: EmployeeShift = { startTime: "08:00", workMinutes: 240 } // 4h
    expect(resolveRelativeInstant(shortShift, { anchor: "END", offsetMinutes: 300 }, "2026-09-14", TZ)).toBeNull()
  })
})

describe("resolveRelativeInstant — jornada atravessando meia-noite (Parte 17)", () => {
  it("50% de um turno 22:00 + 8h cai às 02:00 do dia seguinte", () => {
    const shift: EmployeeShift = { startTime: "22:00", workMinutes: 480 }
    const instant = resolveRelativeInstant(shift, { anchor: "PERCENTAGE", percentage: 50 }, "2026-09-14", TZ)
    expect(instant?.toISOString()).toBe("2026-09-15T05:00:00.000Z") // 02:00 -03:00 (15/09)
  })
})

describe("elapsedScheduledPercent — percentual do expediente PREVISTO decorrido (nunca 'tempo logado' — Parte 3)", () => {
  it("no início do expediente é 0%", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    expect(elapsedScheduledPercent(window, window.start)).toBe(0)
  })

  it("no fim do expediente é 100%", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    expect(elapsedScheduledPercent(window, window.end)).toBe(100)
  })

  it("na metade do expediente é 50%", () => {
    const shift: EmployeeShift = { startTime: "08:00", workMinutes: 480 }
    const window = resolveShiftWindow(shift, "2026-09-14", TZ)
    const midpoint = new Date((window.start.getTime() + window.end.getTime()) / 2)
    expect(elapsedScheduledPercent(window, midpoint)).toBe(50)
  })
})

describe("isAssumedWorkday — Segunda a Sexta (limitação documentada, Parte 16)", () => {
  it("dias de semana são dias de trabalho", () => {
    expect(isAssumedWorkday("2026-09-14")).toBe(true) // segunda
    expect(isAssumedWorkday("2026-09-18")).toBe(true) // sexta
  })

  it("fim de semana não é dia de trabalho", () => {
    expect(isAssumedWorkday("2026-09-19")).toBe(false) // sábado
    expect(isAssumedWorkday("2026-09-20")).toBe(false) // domingo
  })
})
