import { describe, expect, it } from "vitest"
import { businessDaysInWindow, closedCalendarMonths, describePeriod, describeTimeWindow, lastClosedPeriod, localDateOf, resolvePreviousTimeWindow, resolveTimeWindow } from "./time-window.js"

const NOW = new Date("2026-09-15T14:30:00-03:00")
const FORTALEZA = "America/Fortaleza"

describe("janela temporal única — calendário local por timezone IANA", () => {
  it("Últimos 7 dias = 09/09 00:00 local → agora (hoje parcial incluído); anterior = 02/09 → 09/09", () => {
    const window = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, FORTALEZA)
    expect(window.start.toISOString()).toBe("2026-09-09T03:00:00.000Z")
    expect(window.end.toISOString()).toBe(NOW.toISOString())
    const previous = resolvePreviousTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, FORTALEZA)
    expect(previous.start.toISOString()).toBe("2026-09-02T03:00:00.000Z")
    expect(previous.end.toISOString()).toBe("2026-09-09T03:00:00.000Z")
    expect(describeTimeWindow(window, FORTALEZA)).toBe("09/09/2026 → 15/09/2026")
  })

  it("Hoje = início do dia local até agora; Ontem = dia local completo anterior", () => {
    const today = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "CURRENT" }, NOW, FORTALEZA)
    expect(today.start.toISOString()).toBe("2026-09-15T03:00:00.000Z")
    const yesterday = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "PREVIOUS" }, NOW, FORTALEZA)
    expect(yesterday.start.toISOString()).toBe("2026-09-14T03:00:00.000Z")
    expect(yesterday.end.toISOString()).toBe("2026-09-15T03:00:00.000Z")
    expect(describePeriod({ kind: "CALENDAR", unit: "DAY", phase: "CURRENT" })).toBe("Hoje")
    expect(describePeriod({ kind: "CALENDAR", unit: "WEEK" })).toBe("Semana anterior")
  })

  it("semana anterior = segunda a domingo civis; mês corrente parcial; janela anterior do mês corrente = mês passado inteiro", () => {
    const week = resolveTimeWindow({ kind: "CALENDAR", unit: "WEEK", phase: "PREVIOUS" }, NOW, FORTALEZA)
    expect(week.start.toISOString()).toBe("2026-09-07T03:00:00.000Z")
    expect(week.end.toISOString()).toBe("2026-09-14T03:00:00.000Z")
    const month = resolveTimeWindow({ kind: "CALENDAR", unit: "MONTH", phase: "CURRENT" }, NOW, FORTALEZA)
    expect(month.start.toISOString()).toBe("2026-09-01T03:00:00.000Z")
    expect(month.end).toEqual(NOW)
    const previousMonth = resolvePreviousTimeWindow({ kind: "CALENDAR", unit: "MONTH", phase: "CURRENT" }, NOW, FORTALEZA)
    expect(previousMonth.start.toISOString()).toBe("2026-08-01T03:00:00.000Z")
    expect(previousMonth.end.toISOString()).toBe("2026-09-01T03:00:00.000Z")
  })

  it("bimestre = jan–fev, mar–abr, mai–jun, jul–ago, set–out, nov–dez: em 15/09 o corrente é 01/09 → agora e o anterior é jul–ago inteiro; trimestre corrente = jul–set", () => {
    const current = resolveTimeWindow({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "CURRENT" }, NOW, FORTALEZA)
    expect(current.start.toISOString()).toBe("2026-09-01T03:00:00.000Z")
    expect(current.end).toEqual(NOW)
    const previous = resolvePreviousTimeWindow({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "CURRENT" }, NOW, FORTALEZA)
    expect(describeTimeWindow(previous, FORTALEZA)).toBe("01/07/2026 → 31/08/2026")
    const closed = resolveTimeWindow({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "PREVIOUS" }, NOW, FORTALEZA)
    expect(describeTimeWindow(closed, FORTALEZA)).toBe("01/07/2026 → 31/08/2026")
    expect(describeTimeWindow(resolvePreviousTimeWindow({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "PREVIOUS" }, NOW, FORTALEZA), FORTALEZA)).toBe("01/05/2026 → 30/06/2026")
    // Virada de ano: em 20/01 o bimestre anterior é nov–dez do ano passado.
    expect(describeTimeWindow(resolveTimeWindow({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "PREVIOUS" }, new Date("2027-01-20T12:00:00-03:00"), FORTALEZA), FORTALEZA)).toBe("01/11/2026 → 31/12/2026")
    expect(describeTimeWindow(resolveTimeWindow({ kind: "CALENDAR", unit: "QUARTER", phase: "CURRENT" }, NOW, FORTALEZA), FORTALEZA)).toBe("01/07/2026 → 15/09/2026")
    expect(describePeriod({ kind: "CALENDAR", unit: "TWO_MONTHS", phase: "CURRENT" })).toBe("Bimestre corrente")
    expect(describePeriod({ kind: "CALENDAR", unit: "TWO_MONTHS" })).toBe("Bimestre anterior")
  })

  it("dias úteis na janela (base da cobertura): 7 dias corridos de 09/09 a 15/09 = 5 úteis", () => {
    expect(businessDaysInWindow(resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, FORTALEZA), FORTALEZA)).toBe(5)
  })

  it("meses fechados: o mês corrente NUNCA entra — em 15/09 os últimos 3 são ago/jul/jun e o último fechado é 2026-08", () => {
    const months = closedCalendarMonths(NOW, 3, FORTALEZA)
    expect(months.map((month) => month.start.toISOString())).toEqual(["2026-08-01T03:00:00.000Z", "2026-07-01T03:00:00.000Z", "2026-06-01T03:00:00.000Z"])
    expect(months[0]!.end.toISOString()).toBe("2026-09-01T03:00:00.000Z")
    expect(lastClosedPeriod(NOW, FORTALEZA)).toBe("2026-08")
    expect(lastClosedPeriod(new Date("2026-10-01T00:00:00-03:00"), FORTALEZA)).toBe("2026-09")
    expect(lastClosedPeriod(new Date("2026-09-30T23:59:59-03:00"), FORTALEZA)).toBe("2026-08")
  })
})

describe("timezone organizacional — o mesmo instante cai em dias diferentes conforme o fuso", () => {
  // 02:30 UTC de 16/09 = 23:30 de 15/09 em Fortaleza/São Paulo (-03), mas já é 16/09 em UTC.
  const BOUNDARY = new Date("2026-09-16T02:30:00Z")

  it("23:30 local (-03): 'Hoje' ainda é 15/09 em Fortaleza e São Paulo; em UTC já é 16/09", () => {
    expect(localDateOf(BOUNDARY, FORTALEZA)).toBe("2026-09-15")
    expect(localDateOf(BOUNDARY, "America/Sao_Paulo")).toBe("2026-09-15")
    expect(localDateOf(BOUNDARY, "UTC")).toBe("2026-09-16")
    const todayFortaleza = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "CURRENT" }, BOUNDARY, FORTALEZA)
    expect(todayFortaleza.start.toISOString()).toBe("2026-09-15T03:00:00.000Z")
    const todayUtc = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "CURRENT" }, BOUNDARY, "UTC")
    expect(todayUtc.start.toISOString()).toBe("2026-09-16T00:00:00.000Z")
  })

  it("virada de dia muda 'Últimos 7 dias' e a virada de mês muda o último mês fechado, por fuso", () => {
    const rollingFortaleza = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, BOUNDARY, FORTALEZA)
    expect(rollingFortaleza.start.toISOString()).toBe("2026-09-09T03:00:00.000Z")
    const rollingUtc = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, BOUNDARY, "UTC")
    expect(rollingUtc.start.toISOString()).toBe("2026-09-10T00:00:00.000Z")
    const monthTurn = new Date("2026-10-01T01:00:00Z") // 22:00 de 30/09 em -03
    expect(lastClosedPeriod(monthTurn, FORTALEZA)).toBe("2026-08")
    expect(lastClosedPeriod(monthTurn, "UTC")).toBe("2026-09")
    expect(lastClosedPeriod(monthTurn, "Asia/Tokyo")).toBe("2026-09")
  })

  it("semana civil respeita o dia local: domingo 23:30 em -03 ainda é a semana anterior; em UTC já é segunda", () => {
    const sundayLate = new Date("2026-09-14T02:30:00Z") // domingo 13/09 23:30 em -03; segunda 14/09 em UTC
    const weekFortaleza = resolveTimeWindow({ kind: "CALENDAR", unit: "WEEK", phase: "CURRENT" }, sundayLate, FORTALEZA)
    expect(localDateOf(weekFortaleza.start, FORTALEZA)).toBe("2026-09-07")
    const weekUtc = resolveTimeWindow({ kind: "CALENDAR", unit: "WEEK", phase: "CURRENT" }, sundayLate, "UTC")
    expect(localDateOf(weekUtc.start, "UTC")).toBe("2026-09-14")
  })

  it("São Paulo e Fortaleza coincidem hoje (-03 sem horário de verão); um fuso com offset diferente desloca o início do dia", () => {
    const fortaleza = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "PREVIOUS" }, NOW, FORTALEZA)
    const saoPaulo = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "PREVIOUS" }, NOW, "America/Sao_Paulo")
    expect(saoPaulo).toEqual(fortaleza)
    const lisbon = resolveTimeWindow({ kind: "CALENDAR", unit: "DAY", phase: "PREVIOUS" }, NOW, "Europe/Lisbon")
    expect(lisbon.start.toISOString()).toBe("2026-09-13T23:00:00.000Z") // 14/09 00:00 em Lisboa (UTC+1 em setembro)
  })
})
