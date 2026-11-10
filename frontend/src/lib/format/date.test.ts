import { describe, expect, it } from "vitest"

import { describeElapsed, formatCivilDate, formatDateTime, formatElapsed, formatShortDateTime } from "./date"

describe("formatCivilDate", () => {
  it("vira dd/mm/aaaa sem passar por Date (o dia nunca desloca pelo fuso)", () => {
    expect(formatCivilDate("2026-01-01")).toBe("01/01/2026")
    expect(formatCivilDate("2026-12-31T23:59:59Z")).toBe("31/12/2026")
  })
})

describe("formatDateTime", () => {
  it("instante ISO → dd/mm/aaaa, hh:mm", () => {
    expect(formatDateTime("2026-10-07T14:03:00Z")).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/)
  })
})

describe("formatShortDateTime", () => {
  const instant = "2026-10-07T14:03:00Z"

  it("padrão: dd/mm às hh:mm no fuso pedido", () => {
    expect(formatShortDateTime(instant, { timeZone: "America/Sao_Paulo" })).toBe("07/10 às 11:03")
  })

  it("com ano e dia da semana", () => {
    expect(formatShortDateTime(instant, { timeZone: "UTC", withYear: true })).toBe("07/10/2026 às 14:03")
    expect(formatShortDateTime(instant, { timeZone: "UTC", withWeekday: true })).toBe("qua 07/10 às 14:03")
  })

  it("valor inválido vira texto vazio", () => {
    expect(formatShortDateTime("não é data")).toBe("")
  })
})

describe("formatElapsed e describeElapsed", () => {
  it("cronômetro mm:ss e h:mm:ss, nunca negativo", () => {
    expect(formatElapsed(0)).toBe("00:00")
    expect(formatElapsed(65_400)).toBe("01:05")
    expect(formatElapsed(3_725_000)).toBe("1:02:05")
    expect(formatElapsed(-5_000)).toBe("00:00")
    expect(describeElapsed(40_000)).toBe("40 s")
    expect(describeElapsed(724_000)).toBe("12 min 4 s")
    expect(describeElapsed(3_900_000)).toBe("1 h 5 min")
  })
})
