import { describe, expect, it } from "vitest"
import {
  effectiveFrequency,
  isDateDue,
  localDateParts,
  nextOccurrences,
  zonedTimeToIso,
  type ScheduleRecurrenceConfig,
} from "./schedule-recurrence.js"

function config(overrides: Partial<ScheduleRecurrenceConfig> = {}): ScheduleRecurrenceConfig {
  return { times: ["09:00"], intervalDays: 1, anchorDate: null, ...overrides }
}

describe("effectiveFrequency — ausente no trigger_config = comportamento legado", () => {
  it("intervalDays === 1 sem frequency vira DAILY", () => {
    expect(effectiveFrequency({ intervalDays: 1 })).toEqual({ type: "DAILY" })
  })

  it("intervalDays > 1 sem frequency vira EVERY_N_DAYS", () => {
    expect(effectiveFrequency({ intervalDays: 7 })).toEqual({ type: "EVERY_N_DAYS" })
  })

  it("frequency explícita sempre vence, mesmo com intervalDays > 1", () => {
    expect(effectiveFrequency({ intervalDays: 7, frequency: { type: "DAILY" } })).toEqual({ type: "DAILY" })
  })
})

describe("isDateDue — DAILY", () => {
  it("bate em qualquer data", () => {
    const cfg = config({ frequency: { type: "DAILY" } })
    expect(isDateDue(cfg, "2026-01-01")).toBe(true)
    expect(isDateDue(cfg, "2026-12-31")).toBe(true)
  })
})

describe("isDateDue — EVERY_N_DAYS (legado e explícito)", () => {
  it("com âncora, bate exatamente a cada N dias a partir dela", () => {
    const cfg = config({ intervalDays: 3, anchorDate: "2026-09-01", frequency: { type: "EVERY_N_DAYS" } })
    expect(isDateDue(cfg, "2026-09-01")).toBe(true) // diff 0
    expect(isDateDue(cfg, "2026-09-02")).toBe(false) // diff 1
    expect(isDateDue(cfg, "2026-09-04")).toBe(true) // diff 3
    expect(isDateDue(cfg, "2026-09-07")).toBe(true) // diff 6
  })

  it("nunca bate antes da âncora", () => {
    const cfg = config({ intervalDays: 2, anchorDate: "2026-09-10", frequency: { type: "EVERY_N_DAYS" } })
    expect(isDateDue(cfg, "2026-09-05")).toBe(false)
  })

  it("shape legado (frequency ausente, intervalDays > 1) se comporta igual à forma explícita", () => {
    const cfg = config({ intervalDays: 3, anchorDate: "2026-09-01" })
    expect(isDateDue(cfg, "2026-09-04")).toBe(true)
    expect(isDateDue(cfg, "2026-09-05")).toBe(false)
  })

  it("sem âncora nenhuma, nunca bloqueia silenciosamente — dispara todo dia", () => {
    const cfg = config({ intervalDays: 5, anchorDate: null, frequency: { type: "EVERY_N_DAYS" } })
    expect(isDateDue(cfg, "2026-09-01")).toBe(true)
    expect(isDateDue(cfg, "2026-09-02")).toBe(true)
  })
})

describe("isDateDue — WEEKLY", () => {
  it("bate só nos dias da semana escolhidos (Seg, Qua e Sex)", () => {
    const cfg = config({ frequency: { type: "WEEKLY", weekdays: ["MON", "WED", "FRI"] } })
    // 2026-09-14 é uma segunda-feira.
    expect(isDateDue(cfg, "2026-09-14")).toBe(true) // segunda
    expect(isDateDue(cfg, "2026-09-15")).toBe(false) // terça
    expect(isDateDue(cfg, "2026-09-16")).toBe(true) // quarta
    expect(isDateDue(cfg, "2026-09-17")).toBe(false) // quinta
    expect(isDateDue(cfg, "2026-09-18")).toBe(true) // sexta
    expect(isDateDue(cfg, "2026-09-19")).toBe(false) // sábado
    expect(isDateDue(cfg, "2026-09-20")).toBe(false) // domingo
  })
})

describe("isDateDue — MONTHLY (dia do mês)", () => {
  it("bate só no dia configurado", () => {
    const cfg = config({ frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } })
    expect(isDateDue(cfg, "2026-09-05")).toBe(true)
    expect(isDateDue(cfg, "2026-09-06")).toBe(false)
    expect(isDateDue(cfg, "2026-10-05")).toBe(true)
  })

  it("dia 31 nunca bate em abril (30 dias) — pula a ocorrência daquele mês, nunca cai pro dia 30", () => {
    const cfg = config({ frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 31 } })
    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-04-${String(day).padStart(2, "0")}`
      expect(isDateDue(cfg, dateStr)).toBe(false)
    }
    expect(isDateDue(cfg, "2026-05-31")).toBe(true) // maio tem 31 dias
  })

  it("dia 29 pula fevereiro não-bissexto (2026) mas bate no bissexto (2024)", () => {
    const cfg = config({ frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 29 } })
    for (let day = 1; day <= 28; day++) {
      const dateStr = `2026-02-${String(day).padStart(2, "0")}`
      expect(isDateDue(cfg, dateStr)).toBe(false)
    }
    expect(isDateDue(cfg, "2024-02-29")).toBe(true)
  })
})

describe("isDateDue — MONTHLY (último dia do mês)", () => {
  it("bate no último dia de meses de tamanhos diferentes", () => {
    const cfg = config({ frequency: { type: "MONTHLY", mode: "LAST_DAY" } })
    expect(isDateDue(cfg, "2026-01-31")).toBe(true) // 31 dias
    expect(isDateDue(cfg, "2026-01-30")).toBe(false)
    expect(isDateDue(cfg, "2026-04-30")).toBe(true) // 30 dias
    expect(isDateDue(cfg, "2026-02-28")).toBe(true) // fev não-bissexto
    expect(isDateDue(cfg, "2024-02-29")).toBe(true) // fev bissexto
    expect(isDateDue(cfg, "2024-02-28")).toBe(false)
  })
})

describe("localDateParts / zonedTimeToIso — timezone real (sem depender de UTC)", () => {
  it("America/Fortaleza (UTC-3, sem horário de verão) converte corretamente nos dois sentidos", () => {
    const iso = zonedTimeToIso("2026-09-14", "09:00", "America/Fortaleza")
    expect(iso).toBe("2026-09-14T12:00:00.000Z")

    const parts = localDateParts(new Date("2026-09-14T12:00:00.000Z"), "America/Fortaleza")
    expect(parts).toEqual({ date: "2026-09-14", time: "09:00" })
  })

  it("uma timezone diferente (America/Los_Angeles, UTC-7/-8) produz um offset distinto", () => {
    const iso = zonedTimeToIso("2026-01-15", "09:00", "America/Los_Angeles")
    expect(iso).toBe("2026-01-15T17:00:00.000Z") // PST = UTC-8 em janeiro
  })
})

describe("nextOccurrences — mesma lógica de isDateDue, usada tanto pelo preview quanto pelo checador real", () => {
  it("DAILY com múltiplos horários gera ocorrências ordenadas por horário dentro do mesmo dia", () => {
    const cfg = config({ times: ["15:00", "09:00"], frequency: { type: "DAILY" } })
    const from = new Date("2026-09-14T08:00:00.000Z") // 05:00 em America/Fortaleza
    const occurrences = nextOccurrences(cfg, { timezone: "America/Fortaleza", from, count: 4 })
    expect(occurrences.map((o) => `${o.date} ${o.time}`)).toEqual(["2026-09-14 09:00", "2026-09-14 15:00", "2026-09-15 09:00", "2026-09-15 15:00"])
  })

  it("nunca inclui um horário que já passou hoje", () => {
    const cfg = config({ times: ["09:00"], frequency: { type: "DAILY" } })
    // 2026-09-14 12:30 em America/Fortaleza (UTC-3) — 09:00 já passou.
    const from = new Date("2026-09-14T15:30:00.000Z")
    const occurrences = nextOccurrences(cfg, { timezone: "America/Fortaleza", from, count: 1 })
    expect(occurrences[0]?.date).toBe("2026-09-15")
  })

  it("MONTHLY cruza a virada de mês corretamente", () => {
    const cfg = config({ times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } })
    const from = new Date("2026-09-10T12:00:00.000Z") // já passou do dia 5 de setembro
    const occurrences = nextOccurrences(cfg, { timezone: "America/Fortaleza", from, count: 2 })
    expect(occurrences.map((o) => o.date)).toEqual(["2026-10-05", "2026-11-05"])
  })

  it("WEEKLY com dois dias da semana intercala corretamente", () => {
    const cfg = config({ times: ["08:30"], frequency: { type: "WEEKLY", weekdays: ["MON", "THU"] } })
    const from = new Date("2026-09-14T06:00:00.000Z") // segunda de manhã, antes das 08:30 locais
    const occurrences = nextOccurrences(cfg, { timezone: "America/Fortaleza", from, count: 3 })
    expect(occurrences.map((o) => o.date)).toEqual(["2026-09-14", "2026-09-17", "2026-09-21"])
  })
})
