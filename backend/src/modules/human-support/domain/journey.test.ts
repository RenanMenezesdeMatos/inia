import { describe, expect, it } from "vitest"
import { journeyByDay, journeySummary, onlineBase, type JourneyInput, type StatusMark } from "./journey.js"

const H = 3_600_000
const M = 60_000
const T0 = Date.UTC(2026, 10, 10, 11, 0) // 08:00 em São Paulo
const day = (key: string, start: number, end: number) => ({ day: key, start, end })
const available = (at: number): StatusMark => ({ at, status: "AVAILABLE", pauseReason: null })
const unavailable = (at: number): StatusMark => ({ at, status: "OFFLINE", pauseReason: null })
const base = (patch: Partial<JourneyInput>): JourneyInput => ({
  days: [day("2026-11-10", T0, T0 + 8 * H)],
  initialStatus: { status: "AVAILABLE", pauseReason: null },
  statusMarks: [],
  initialConnected: true,
  connectionMarks: [],
  attendances: [],
  ...patch,
})

describe("jornada do Anjo", () => {
  it("8 h online: 37,5% disponível, 37,5% em atendimento, 25% em pausa (18,75% almoço, 6,25% pessoal), 75% de dia produtivo", () => {
    // 3 h disponível (1 h + 2 h), 3 h atendendo, 1 h 30 almoço e 30 min pessoal.
    const input = base({
      attendances: [{ start: T0 + 1 * H, end: T0 + 4 * H }],
      statusMarks: [
        { at: T0 + 4 * H, status: "PAUSED", pauseReason: "LUNCH" },
        available(T0 + 5.5 * H),
        { at: T0 + 7.5 * H, status: "PAUSED", pauseReason: "PERSONAL" },
      ],
    })
    const [result] = journeyByDay(input)
    expect(result).toMatchObject({ availableMs: 3 * H, attendanceMs: 3 * H, unavailableMs: 0 })
    expect(result!.pausedMs).toMatchObject({ LUNCH: 1.5 * H, PERSONAL: 30 * M, MEETING: 0, PROCESS_ACTIVITY: 0 })
    const summary = journeySummary([result!])
    expect(summary.baseMs).toBe(8 * H)
    expect(summary.shares).toMatchObject({ available: 37.5, attendance: 37.5, pausedTotal: 25, productive: 75 })
    expect(summary.shares.paused).toMatchObject({ LUNCH: 18.75, PERSONAL: 6.25 })
  })

  it("Indisponível é o mesmo estado que offline: fica FORA do tempo online, seja declarado ou sem conexão", () => {
    // 8 h: 3 h disponível, 3 h atendendo, 1 h 30 almoço, 15 min pessoal, 15 min Indisponível (declarado) → online = 7 h 45.
    const input = base({
      attendances: [{ start: T0 + 1 * H, end: T0 + 4 * H }],
      statusMarks: [
        { at: T0 + 4 * H, status: "PAUSED", pauseReason: "LUNCH" },
        available(T0 + 5.5 * H),
        { at: T0 + 7.5 * H, status: "PAUSED", pauseReason: "PERSONAL" },
        unavailable(T0 + 7.75 * H),
      ],
    })
    const [result] = journeyByDay(input)
    expect(result).toMatchObject({ availableMs: 3 * H, attendanceMs: 3 * H, unavailableMs: 15 * M })
    const summary = journeySummary([result!])
    expect(summary.baseMs).toBe(7.75 * H)
    expect(summary.shares.available).toBeCloseTo((3 / 7.75) * 100)
    expect(summary.shares.productive).toBeCloseTo((6 / 7.75) * 100)
    expect("unavailable" in summary.shares).toBe(false)
  })

  it("atendimentos simultâneos contam uma vez; a pausa programada só conta quando entra em vigor", () => {
    const [result] = journeyByDay(base({
      days: [day("d", T0, T0 + 3 * H)],
      attendances: [{ start: T0 + 1 * H, end: T0 + 2 * H }, { start: T0 + 1.5 * H, end: T0 + 2.5 * H }],
      statusMarks: [{ at: T0 + 2.5 * H, status: "PAUSED", pauseReason: "MEETING" }],
    }))
    expect(result).toMatchObject({ availableMs: 1 * H, attendanceMs: 1.5 * H })
    expect(result!.pausedMs.MEETING).toBe(30 * M)
  })

  it("corta na meia-noite e nos limites do filtro", () => {
    const midnight = T0 + 4 * H
    const input = base({
      days: [day("2026-11-10", T0 + 1 * H, midnight), day("2026-11-11", midnight, midnight + 2 * H)],
      attendances: [{ start: midnight - 30 * M, end: midnight + 45 * M }],
    })
    const [first, second] = journeyByDay(input)
    expect(first).toMatchObject({ availableMs: 2.5 * H, attendanceMs: 30 * M })
    expect(second).toMatchObject({ availableMs: 1.25 * H, attendanceMs: 45 * M })
    expect(onlineBase(first!) + onlineBase(second!)).toBe(5 * H)
  })

  it("sem conexão é Indisponível, mesmo em atendimento; volta a contar na reconexão", () => {
    const [result] = journeyByDay(base({
      days: [day("d", T0, T0 + 2 * H)],
      attendances: [{ start: T0, end: T0 + 1 * H }],
      connectionMarks: [{ at: T0 + 30 * M, connected: false }, { at: T0 + 40 * M, connected: true }],
    }))
    expect(result).toMatchObject({ attendanceMs: 50 * M, unavailableMs: 10 * M, availableMs: 1 * H })
  })

  it("sem tempo online: base zero, percentuais nulos (nunca 0%) e nenhum dia na média", () => {
    const [result] = journeyByDay(base({ initialConnected: false }))
    const summary = journeySummary([result!])
    expect(summary.baseMs).toBe(0)
    expect(summary.shares.available).toBeNull()
    expect(summary.daysWithOnline).toBe(0)
    expect(summary.dailyAverage).toBeNull()
  })

  it("vários dias: percentual = soma das durações ÷ soma das bases; média diária só entre os dias com tempo online", () => {
    const input = base({
      days: [day("a", T0, T0 + 4 * H), day("b", T0 + 24 * H, T0 + 26 * H), day("c", T0 + 48 * H, T0 + 50 * H)],
      attendances: [{ start: T0, end: T0 + 1 * H }],
      connectionMarks: [{ at: T0 + 47 * H, connected: false }],
    })
    const summary = journeySummary(journeyByDay(input))
    expect(summary.baseMs).toBe(6 * H)
    expect(summary.shares.available).toBeCloseTo((5 / 6) * 100)
    expect(summary.daysWithOnline).toBe(2)
    expect(summary.dailyAverage).toEqual({ availableMs: 2.5 * H, attendanceMs: 0.5 * H })
  })
})
