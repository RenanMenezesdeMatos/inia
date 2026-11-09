import { describe, expect, it } from "vitest"
import cases from "../testing/cadence-cases.json" with { type: "json" }
import { cadenceLabel, cadenceSchema, cadenceWriteProblem, computeFeedFreshness, expectedIntervalMinutes, nextSyncAt, syncAtSourceResume, upcomingSyncs, type Cadence } from "./freshness.js"

const TZ = "America/Fortaleza" // UTC-3 o ano todo.
const weekdays = (days: string[], times: string[]) => cadenceSchema.parse({ kind: "CALENDAR", times, frequency: { type: "WEEKLY", weekdays: days } })
const WORK_WEEK = ["MON", "TUE", "WED", "THU", "FRI"]

/** Hora local de Fortaleza → instante: 2026-11-06 é sexta. */
const local = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`)

/** Anda o relógio como o agendador faz: dispara em cada `next_sync_at` e calcula a próxima a partir dele. */
function firings(cadence: Cadence, from: Date, until: Date, timeZone = TZ): string[] {
  const fired: string[] = []
  let next = nextSyncAt(cadence, from, timeZone)
  while (next && next.getTime() <= until.getTime()) {
    fired.push(next.toISOString())
    next = nextSyncAt(cadence, next, timeZone)
  }
  return fired
}

describe("periodicidade: frase legível", () => {
  it.each(cases.labels)("$label", ({ cadence, label }) => {
    expect(cadenceLabel(cadenceSchema.parse(cadence))).toBe(label)
  })

  it("nunca expõe cron nem estrutura técnica", () => {
    for (const { label } of cases.labels) expect(label).not.toMatch(/[*{}[\]]|CALENDAR|WEEKLY|cron/i)
  })
})

describe("periodicidade: validação", () => {
  it.each(cases.invalid)("recusa: $message", ({ cadence, message }) => {
    const parsed = cadenceSchema.safeParse(cadence)
    const problem = parsed.success ? cadenceWriteProblem(parsed.data) : parsed.error.issues[0]?.message
    expect(problem).toBe(message)
  })

  it("normaliza a ordem de horários e dias para a frase e a comparação não dependerem de quem enviou", () => {
    expect(cadenceSchema.parse({ kind: "CALENDAR", times: ["18:00", "06:00"], frequency: { type: "WEEKLY", weekdays: ["FRI", "MON"] } })).toEqual({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "FRI"] } })
  })

  it("mínimo de 15 minutos: vale para valor novo; o já gravado continua salvando", () => {
    expect(cadenceWriteProblem({ kind: "INTERVAL", minutes: 15 })).toBeNull()
    expect(cadenceWriteProblem({ kind: "INTERVAL", minutes: 5 })).toMatch(/mínimo/)
    expect(cadenceWriteProblem({ kind: "INTERVAL", minutes: 5 }, { kind: "INTERVAL", minutes: 5 })).toBeNull()
    expect(cadenceWriteProblem({ kind: "INTERVAL", minutes: 10 }, { kind: "INTERVAL", minutes: 5 })).toMatch(/mínimo/)
    expect(cadenceSchema.safeParse({ kind: "INTERVAL", minutes: 4 }).success).toBe(false)
    expect(cadenceSchema.safeParse({ kind: "INTERVAL", minutes: 24 * 60 + 1 }).success).toBe(false)
  })

  it("15 minutos entre horários é o limite aceito, inclusive na virada do dia", () => {
    expect(cadenceSchema.safeParse({ kind: "CALENDAR", times: ["06:00", "06:15"], frequency: { type: "DAILY" } }).success).toBe(true)
    expect(cadenceSchema.safeParse({ kind: "CALENDAR", times: ["23:50", "00:05"], frequency: { type: "DAILY" } }).success).toBe(true)
  })
})

describe("periodicidade: formas já gravadas continuam iguais", () => {
  it("MANUAL, INTERVAL e DAILY passam pelo esquema sem mudar e calculam como antes", () => {
    for (const cadence of [{ kind: "MANUAL" }, { kind: "INTERVAL", minutes: 15 }, { kind: "INTERVAL", minutes: 5 }, { kind: "DAILY", time: "06:00" }]) expect(cadenceSchema.parse(cadence)).toEqual(cadence)
    const now = new Date("2026-09-16T15:00:00Z") // 12:00 em Fortaleza
    expect(nextSyncAt({ kind: "MANUAL" }, now, TZ)).toBeNull()
    expect(nextSyncAt({ kind: "INTERVAL", minutes: 360 }, now, TZ)?.toISOString()).toBe("2026-09-16T21:00:00.000Z")
    expect(nextSyncAt({ kind: "DAILY", time: "13:00" }, now, TZ)?.toISOString()).toBe("2026-09-16T16:00:00.000Z")
    expect(nextSyncAt({ kind: "DAILY", time: "12:00" }, now, TZ)?.toISOString()).toBe("2026-09-17T15:00:00.000Z")
    expect(expectedIntervalMinutes({ kind: "DAILY", time: "06:00" })).toBe(24 * 60)
    expect(expectedIntervalMinutes({ kind: "INTERVAL", minutes: 60 })).toBe(60)
    expect(expectedIntervalMinutes({ kind: "MANUAL" })).toBeNull()
  })

  it("intervalo fixo continua com 2× o intervalo; manual nunca atrasa; a coluna gravada segue valendo", () => {
    const now = new Date("2026-09-16T15:00:00Z")
    const feed = (lastSuccessAt: string | null, cadence: Cadence, expected: number | null = null) => computeFeedFreshness({ lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt) : null, cadence, expectedIntervalMinutes: expected }, now, TZ)
    expect(feed("2026-09-16T13:30:00Z", { kind: "INTERVAL", minutes: 60 })).toBe("FRESH")
    expect(feed("2026-09-16T12:30:00Z", { kind: "INTERVAL", minutes: 60 })).toBe("STALE")
    expect(feed("2026-09-16T12:30:00Z", { kind: "INTERVAL", minutes: 60 }, 120)).toBe("FRESH")
    expect(feed("2020-01-01T00:00:00Z", { kind: "MANUAL" })).toBe("FRESH")
    expect(feed(null, { kind: "DAILY", time: "06:00" })).toBe("NEVER")
    expect(feed(null, weekdays(WORK_WEEK, ["06:00"]))).toBe("NEVER")
  })
})

describe("agenda: quando dispara (relógio fixo, fuso da operação)", () => {
  it("seg a sex às 06:00 e 18:00: duas semanas sem nenhum disparo no fim de semana", () => {
    const fired = firings(weekdays(WORK_WEEK, ["06:00", "18:00"]), local("2026-11-06", "12:00"), local("2026-11-16", "23:59"))
    expect(fired).toEqual([
      local("2026-11-06", "18:00"), // sexta à tarde
      local("2026-11-09", "06:00"), local("2026-11-09", "18:00"),
      local("2026-11-10", "06:00"), local("2026-11-10", "18:00"),
      local("2026-11-11", "06:00"), local("2026-11-11", "18:00"),
      local("2026-11-12", "06:00"), local("2026-11-12", "18:00"),
      local("2026-11-13", "06:00"), local("2026-11-13", "18:00"),
      local("2026-11-16", "06:00"), local("2026-11-16", "18:00"),
    ].map((instant) => instant.toISOString()))
  })

  it("o dia da semana é o do fuso da operação, nunca o de UTC", () => {
    // Sexta 22:00 em Fortaleza já é sábado em UTC; sexta ainda tem horário às 23:00.
    expect(nextSyncAt(weekdays(["FRI"], ["23:00"]), local("2026-11-06", "22:00"), TZ)?.toISOString()).toBe(local("2026-11-06", "23:00").toISOString())
    // Domingo 22:00 em Fortaleza já é segunda em UTC: a segunda local ainda não começou, e dispara às 00:30 dela.
    expect(nextSyncAt(weekdays(["MON"], ["00:30"]), local("2026-11-08", "22:00"), TZ)?.toISOString()).toBe(local("2026-11-09", "00:30").toISOString())
    // Fuso a leste de UTC: segunda 05:00 em Tóquio ainda é domingo em UTC.
    expect(nextSyncAt(weekdays(["SUN"], ["06:00"]), new Date("2026-11-08T20:00:00Z"), "Asia/Tokyo")?.toISOString()).toBe(new Date("2026-11-14T21:00:00Z").toISOString())
  })

  it("virada de dia: depois do último horário de hoje, vale o primeiro de amanhã", () => {
    const cadence = cadenceSchema.parse({ kind: "CALENDAR", times: ["00:10", "23:50"], frequency: { type: "DAILY" } })
    expect(nextSyncAt(cadence, local("2026-11-06", "23:50"), TZ)?.toISOString()).toBe(local("2026-11-07", "00:10").toISOString())
    expect(nextSyncAt(cadence, local("2026-11-07", "00:09"), TZ)?.toISOString()).toBe(local("2026-11-07", "00:10").toISOString())
    expect(nextSyncAt(cadence, local("2026-11-07", "00:10"), TZ)?.toISOString()).toBe(local("2026-11-07", "23:50").toISOString())
  })

  it("a cada 3 dias conta da data de início: não escorrega, e uma data futura espera por ela", () => {
    const cadence = cadenceSchema.parse({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "EVERY_N_DAYS", days: 3, startDate: "2026-11-02" } })
    expect(firings(cadence, local("2026-11-02", "00:00"), local("2026-11-12", "00:00"))).toEqual([local("2026-11-02", "06:00"), local("2026-11-05", "06:00"), local("2026-11-08", "06:00"), local("2026-11-11", "06:00")].map((instant) => instant.toISOString()))
    // Uma carga manual no meio do ciclo não muda o dia seguinte da agenda.
    expect(nextSyncAt(cadence, local("2026-11-06", "15:00"), TZ)?.toISOString()).toBe(local("2026-11-08", "06:00").toISOString())
    const future = cadenceSchema.parse({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "EVERY_N_DAYS", days: 90, startDate: "2030-01-15" } })
    expect(nextSyncAt(future, local("2026-11-06", "15:00"), TZ)?.toISOString()).toBe(local("2030-01-15", "06:00").toISOString())
  })

  it("dia do mês: mês sem o dia é pulado (nunca escorrega); último dia acompanha o mês", () => {
    const day31 = cadenceSchema.parse({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 31 } })
    expect(firings(day31, local("2027-01-01", "00:00"), local("2027-05-31", "23:00"))).toEqual([local("2027-01-31", "06:00"), local("2027-03-31", "06:00"), local("2027-05-31", "06:00")].map((instant) => instant.toISOString()))
    const last = cadenceSchema.parse({ kind: "CALENDAR", times: ["23:00"], frequency: { type: "MONTHLY", mode: "LAST_DAY" } })
    expect(firings(last, local("2028-01-31", "23:00"), local("2028-04-30", "23:00"))).toEqual([local("2028-02-29", "23:00"), local("2028-03-31", "23:00"), local("2028-04-30", "23:00")].map((instant) => instant.toISOString()))
  })

  it("horário de verão: a hora de parede se mantém dos dois lados da mudança e o cálculo sempre anda", () => {
    const cadence = cadenceSchema.parse({ kind: "CALENDAR", times: ["01:30"], frequency: { type: "DAILY" } })
    const zone = "America/New_York" // Muda em 08/03/2026 (02:00 → 03:00) e 01/11/2026 (02:00 → 01:00).
    expect(nextSyncAt(cadence, new Date("2026-03-07T12:00:00Z"), zone)?.toISOString()).toBe("2026-03-08T06:30:00.000Z") // 01:30 EST, antes da mudança
    expect(nextSyncAt(cadence, new Date("2026-03-08T12:00:00Z"), zone)?.toISOString()).toBe("2026-03-09T05:30:00.000Z") // 01:30 EDT
    const gap = cadenceSchema.parse({ kind: "CALENDAR", times: ["02:30"], frequency: { type: "DAILY" } }) // 02:30 não existe em 08/03.
    const fired = firings(gap, new Date("2026-03-07T12:00:00Z"), new Date("2026-03-10T12:00:00Z"), zone)
    expect(fired).toHaveLength(3)
    expect(new Set(fired).size).toBe(3)
  })

  it("próximas execuções para a tela vêm da mesma função", () => {
    const cadence = weekdays(WORK_WEEK, ["06:00"])
    expect(upcomingSyncs(cadence, local("2026-11-06", "12:00"), TZ, 2).map((run) => run.toISOString())).toEqual([local("2026-11-09", "06:00").toISOString(), local("2026-11-10", "06:00").toISOString()])
    expect(upcomingSyncs({ kind: "MANUAL" }, local("2026-11-06", "12:00"), TZ, 3)).toEqual([])
  })

  it("retomar uma fonte: horário escolhido espera o próximo; intervalo roda em seguida; manual não agenda", () => {
    const now = local("2026-11-06", "14:00")
    expect(syncAtSourceResume({ kind: "DAILY", time: "06:00" }, now, TZ)?.toISOString()).toBe(local("2026-11-07", "06:00").toISOString())
    expect(syncAtSourceResume(weekdays(WORK_WEEK, ["06:00"]), now, TZ)?.toISOString()).toBe(local("2026-11-09", "06:00").toISOString())
    expect(syncAtSourceResume({ kind: "INTERVAL", minutes: 60 }, now, TZ)).toEqual(now)
    expect(syncAtSourceResume({ kind: "MANUAL" }, now, TZ)).toBeNull()
  })
})

describe("agenda: atraso pela agenda real", () => {
  const state = (cadence: Cadence, lastSuccessAt: Date, now: Date, timeZone = TZ) => computeFeedFreshness({ lastSuccessAt, cadence, expectedIntervalMinutes: expectedIntervalMinutes(cadence) }, now, timeZone)

  it("seg a sex: sucesso na sexta segue em dia no fim de semana inteiro", () => {
    const cadence = weekdays(WORK_WEEK, ["06:00"])
    const friday = local("2026-11-06", "06:05")
    expect(state(cadence, friday, local("2026-11-07", "12:00"))).toBe("FRESH") // sábado
    expect(state(cadence, friday, local("2026-11-08", "23:59"))).toBe("FRESH") // domingo
    expect(state(cadence, friday, local("2026-11-09", "12:00"))).toBe("FRESH") // segunda: um ciclo perdido é tolerado
    expect(state(cadence, friday, local("2026-11-10", "06:30"))).toBe("FRESH") // terça: a carga do horário ainda pode estar rodando
    expect(state(cadence, friday, local("2026-11-10", "07:01"))).toBe("STALE") // terça: segundo horário perdido
  })

  it("o intervalo fixo marcaria o fim de semana como atraso: é isso que a agenda evita", () => {
    const friday = local("2026-11-06", "06:05")
    const monday = local("2026-11-09", "05:00")
    expect(state({ kind: "DAILY", time: "06:00" }, friday, monday)).toBe("STALE")
    expect(state(weekdays(WORK_WEEK, ["06:00"]), friday, monday)).toBe("FRESH")
  })

  it("diário continua tolerando um ciclo e atrasa no segundo", () => {
    const cadence: Cadence = { kind: "DAILY", time: "06:00" }
    const monday = local("2026-11-02", "06:05")
    expect(state(cadence, monday, local("2026-11-03", "23:00"))).toBe("FRESH")
    expect(state(cadence, monday, local("2026-11-04", "06:30"))).toBe("FRESH")
    expect(state(cadence, monday, local("2026-11-04", "07:01"))).toBe("STALE")
  })

  it("dois horários por dia atrasam em horas, não em dias", () => {
    const cadence = weekdays(WORK_WEEK, ["06:00", "18:00"])
    const success = local("2026-11-02", "06:05")
    expect(state(cadence, success, local("2026-11-03", "06:30"))).toBe("FRESH")
    expect(state(cadence, success, local("2026-11-03", "07:01"))).toBe("STALE")
  })

  it("mensal não atrasa no dia seguinte", () => {
    const cadence = cadenceSchema.parse({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } })
    const success = local("2026-11-05", "06:05")
    expect(state(cadence, success, local("2026-12-31", "12:00"))).toBe("FRESH")
    expect(state(cadence, success, local("2027-01-05", "07:01"))).toBe("STALE")
  })
})
