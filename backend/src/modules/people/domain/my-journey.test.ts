import { describe, expect, it } from "vitest"
import { buildJourneyBlocks, buildJourneyDays, describeJourneyDay, employmentStatusSentenceLabel, resolveJourneyShift, type JourneyDayInput } from "./my-journey.js"
import type { ScheduledDayResolution } from "./work-schedule.js"
import { resolveWorkday } from "./workday-resolution.js"

/**
 * "Minha jornada" lê o MESMO dia resolvido do Calendário da equipe (`resolveWorkday`): o que muda é só o recorte que o operador vê
 * (o plano). Estes casos cobrem os cenários pedidos: dia normal, folga integral, exceção, situação funcional, sem escala publicada,
 * escala sem horário e jornada que cruza a meia-noite.
 */
const work: ScheduledDayResolution = { scheduledToWork: true, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null }
const dayOff: ScheduledDayResolution = { scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null }
const fallback: ScheduledDayResolution = { scheduledToWork: true, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null }
const unknown: ScheduledDayResolution = { scheduledToWork: false, basis: "UNKNOWN_SCHEDULE", holiday: false, exception: null }
const holiday: ScheduledDayResolution = { scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: true, exception: null }
const banco: ScheduledDayResolution = { scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: { date: "2026-11-18", code: "BANCO_HORAS", effect: "NON_WORKING", rawReason: null } }

function input(date: string, planned: ScheduledDayResolution, extra: Partial<JourneyDayInput> & { status?: Parameters<typeof resolveWorkday>[0]["status"]; hired?: boolean; observed?: boolean } = {}): JourneyDayInput {
  const resolved = resolveWorkday({ date, hired: extra.hired ?? true, status: extra.status ?? null, planned, evidence: extra.observed ? { date, interactionCount: 4, indicatorCodes: [] } : null, evidenceEnabled: true, dayClosed: true, availability: "READY", classification: null })
  return { resolved, exceptions: extra.exceptions ?? [], scheduleDay: extra.scheduleDay ?? null, workShift: extra.workShift ?? null, activities: extra.activities ?? [] }
}

describe("Minha jornada — tipo do dia (mesma precedência do domínio)", () => {
  it("dia de trabalho com horário da escala: entrada e saída da escala, sem cruzar a meia-noite", () => {
    const day = describeJourneyDay(input("2026-11-17", work, { scheduleDay: { start: "08:00:00", end: "14:20:00" } }))
    expect(day).toMatchObject({ kind: "WORK", label: "Dia de trabalho", shift: { start: "08:00", end: "14:20", crossesMidnight: false, source: "SCHEDULE_DAY" } })
  })

  it("escala sem horário no dia: usa a jornada vigente (entrada + carga) e marca a origem", () => {
    const day = describeJourneyDay(input("2026-11-17", work, { scheduleDay: { start: null, end: null }, workShift: { startTime: "09:00:00", workMinutes: 380 } }))
    expect(day.shift).toEqual({ start: "09:00", end: "15:20", crossesMidnight: false, source: "WORK_SHIFT" })
  })

  it("escala de trabalho sem horário nem jornada: dia de trabalho sem horário (nada inventado)", () => {
    expect(describeJourneyDay(input("2026-11-17", work))).toMatchObject({ kind: "WORK", shift: null })
  })

  it("folga integral da escala → Folga, sem horário", () => {
    expect(describeJourneyDay(input("2026-11-16", dayOff, { scheduleDay: { start: null, end: null } }))).toMatchObject({ kind: "DAY_OFF", label: "Folga", shift: null })
  })

  it("exceção vigente vence a escala de trabalho → nome oficial da exceção", () => {
    const day = describeJourneyDay(input("2026-11-18", banco, { scheduleDay: { start: "08:00", end: "14:20" }, exceptions: [{ id: "e1", code: "BANCO_HORAS", label: "Banco de horas", originLabel: "Central de Dados" }] }))
    expect(day).toMatchObject({ kind: "EXCEPTION", label: "Banco de horas", shift: null, exceptions: [{ code: "BANCO_HORAS" }] })
  })

  it("situação funcional não produtiva vence exceção e escala (férias)", () => {
    expect(describeJourneyDay(input("2026-11-19", work, { status: "FERIAS", scheduleDay: { start: "08:00", end: "14:20" } }))).toMatchObject({ kind: "EMPLOYMENT_STATUS", label: "Férias", shift: null })
    expect(employmentStatusSentenceLabel("INSS")).toBe("INSS")
    expect(employmentStatusSentenceLabel("ATIVIDADE_OFF")).toBe("Atividade off")
  })

  it("produção observada num dia de folga NÃO muda o plano mostrado ao operador", () => {
    expect(describeJourneyDay(input("2026-11-16", dayOff, { observed: true }))).toMatchObject({ kind: "DAY_OFF" })
  })

  it("só a escala que o cliente enviou: fallback seg–sex e regime sem calendário → Sem escala publicada, sem horário nenhum (nem o da jornada cadastrada)", () => {
    const noSchedule = describeJourneyDay(input("2026-11-17", fallback, { workShift: { startTime: "08:00", workMinutes: 360 } }))
    expect(noSchedule).toEqual({ date: "2026-11-17", kind: "NO_SCHEDULE", label: "Sem escala publicada", shift: null, exceptions: [], activities: [] })
    expect(describeJourneyDay(input("2026-11-17", unknown))).toMatchObject({ kind: "NO_SCHEDULE", shift: null })
  })

  it("feriado do fallback (política da organização) → Feriado; antes da admissão → Antes da admissão", () => {
    expect(describeJourneyDay(input("2026-11-20", holiday))).toMatchObject({ kind: "HOLIDAY", label: "Feriado" })
    expect(describeJourneyDay(input("2026-11-17", work, { hired: false }))).toMatchObject({ kind: "BEFORE_HIRE" })
  })
})

describe("Minha jornada — linha do tempo do dia", () => {
  it("dia normal: fora da jornada → jornada prevista → fora da jornada, cobrindo 00:00–24:00", () => {
    const day = describeJourneyDay(input("2026-11-17", work, { scheduleDay: { start: "08:00", end: "14:20" } }))
    expect(buildJourneyBlocks(day, null)).toEqual([
      { kind: "SHIFT", label: "Jornada prevista", startMinute: 480, endMinute: 860, continuesFromPreviousDay: false, continuesNextDay: false },
    ])
  })

  it("jornada que cruza a meia-noite: termina no dia seguinte e abre a linha do tempo de amanhã", () => {
    expect(resolveJourneyShift({ start: "22:00", end: "04:20" }, null)).toMatchObject({ crossesMidnight: true })
    const days = buildJourneyDays([
      input("2026-11-16", work, { scheduleDay: { start: "22:00", end: "04:20" } }),
      input("2026-11-17", dayOff),
      input("2026-11-18", work, { scheduleDay: { start: "22:00", end: "04:20" } }),
    ])
    expect(days.map((day) => day.date)).toEqual(["2026-11-17", "2026-11-18"])
    expect(days[0]!.blocks).toEqual([
      { kind: "SHIFT", label: "Jornada prevista", startMinute: 0, endMinute: 260, continuesFromPreviousDay: true, continuesNextDay: false },
      { kind: "NON_WORKING", label: "Folga", startMinute: 260, endMinute: 1440, continuesFromPreviousDay: false, continuesNextDay: false },
    ])
    expect(days[1]!.blocks.at(-1)).toMatchObject({ kind: "SHIFT", startMinute: 1320, endMinute: 1440, continuesNextDay: true })
  })

  it("jornada cadastrada que termina exatamente à meia-noite não deixa resto no dia seguinte", () => {
    const shift = resolveJourneyShift(null, { startTime: "18:00", workMinutes: 360 })
    expect(shift).toMatchObject({ end: "00:00", crossesMidnight: true })
    const days = buildJourneyDays([input("2026-11-16", work, { workShift: { startTime: "18:00", workMinutes: 360 } }), input("2026-11-17", dayOff)])
    expect(days[0]!.blocks).toEqual([{ kind: "NON_WORKING", label: "Folga", startMinute: 0, endMinute: 1440, continuesFromPreviousDay: false, continuesNextDay: false }])
  })

  it("dia sem escala publicada ou de trabalho sem horário: nenhum bloco inventado", () => {
    expect(buildJourneyBlocks(describeJourneyDay(input("2026-11-17", fallback)), null)).toEqual([])
    expect(buildJourneyBlocks(describeJourneyDay(input("2026-11-17", work)), null)).toEqual([])
  })
})

describe("Minha jornada — atividades escaladas (login e pausas)", () => {
  const activities = [
    { type: "LOGGED_IN" as const, name: "Logado", start: "08:00", end: "14:20" },
    { type: "BREAK" as const, name: "Pausa NR17", start: "10:20", end: "10:30" },
    { type: "BREAK" as const, name: "Lanche", start: "11:40", end: "12:00" },
    { type: "OTHER" as const, name: "Feedback", start: "13:00", end: "13:20" },
  ]

  it("pausa e outra atividade aparecem dentro do login, com o nome da fonte; fora dele, fora da jornada", () => {
    const [day] = buildJourneyDays([input("2026-11-16", dayOff), input("2026-11-17", work, { scheduleDay: { start: "08:00", end: "14:20" }, activities })])
    expect(day!.activities.map((activity) => activity.name)).toEqual(["Logado", "Pausa NR17", "Lanche", "Feedback"])
    expect(day!.blocks.map((block) => [block.kind, block.label, block.startMinute, block.endMinute])).toEqual([
      ["LOGGED_IN", "Logado para atendimento", 480, 620],
      ["BREAK", "Pausa NR17", 620, 630],
      ["LOGGED_IN", "Logado para atendimento", 630, 700],
      ["BREAK", "Lanche", 700, 720],
      ["LOGGED_IN", "Logado para atendimento", 720, 780],
      ["OTHER", "Feedback", 780, 800],
      ["LOGGED_IN", "Logado para atendimento", 800, 860],
    ])
  })

  it("só pausas, sem login informado: o resto da jornada fica como jornada prevista (nada inventado como logado)", () => {
    const [day] = buildJourneyDays([input("2026-11-16", dayOff), input("2026-11-17", work, { scheduleDay: { start: "08:00", end: "14:20" }, activities: [activities[1]!] })])
    expect(day!.blocks.map((block) => block.kind)).toEqual(["SHIFT", "BREAK", "SHIFT"])
  })

  it("escala sem horário: entrada e saída vêm das atividades (antes da jornada cadastrada)", () => {
    const day = describeJourneyDay(input("2026-11-17", work, { workShift: { startTime: "09:00", workMinutes: 480 }, activities }))
    expect(day.shift).toEqual({ start: "08:00", end: "14:20", crossesMidnight: false, source: "ACTIVITIES" })
  })

  it("folga, exceção ou situação não produtiva vencem as atividades (nenhuma aparece)", () => {
    expect(describeJourneyDay(input("2026-11-18", banco, { activities })).activities).toEqual([])
    expect(describeJourneyDay(input("2026-11-16", dayOff, { activities })).activities).toEqual([])
    expect(describeJourneyDay(input("2026-11-19", work, { status: "FERIAS", activities })).activities).toEqual([])
  })

  it("turno da noite: login e pausa que passam da meia-noite abrem o dia seguinte", () => {
    const night = [
      { type: "LOGGED_IN" as const, name: "Logado", start: "22:00", end: "04:20" },
      { type: "BREAK" as const, name: "Pausa NR17", start: "23:50", end: "00:10" },
    ]
    const days = buildJourneyDays([input("2026-11-16", dayOff), input("2026-11-17", work, { scheduleDay: { start: "22:00", end: "04:20" }, activities: night }), input("2026-11-18", dayOff)])
    expect(days[0]!.blocks.slice(-2).map((block) => [block.kind, block.startMinute, block.endMinute, block.continuesNextDay])).toEqual([["LOGGED_IN", 1320, 1430, false], ["BREAK", 1430, 1440, true]])
    expect(days[1]!.blocks.map((block) => [block.kind, block.startMinute, block.endMinute, block.continuesFromPreviousDay])).toEqual([["BREAK", 0, 10, true], ["LOGGED_IN", 10, 260, false], ["NON_WORKING", 260, 1440, false]])
  })
})

