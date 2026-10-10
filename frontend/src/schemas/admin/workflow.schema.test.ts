import { describe, expect, it } from "vitest"
import { describeRelativeSchedule, describeScheduleFrequency, triggerBadgeText, triggerLabel, type WorkflowTrigger } from "./workflow.schema"

function scheduleTrigger(overrides: Partial<Extract<WorkflowTrigger, { kind: "schedule" }>> = {}): Extract<WorkflowTrigger, { kind: "schedule" }> {
  return { kind: "schedule", times: ["09:00"], intervalDays: 1, ...overrides }
}

function relativeTrigger(overrides: Partial<Extract<WorkflowTrigger, { kind: "schedule" }>> = {}): Extract<WorkflowTrigger, { kind: "schedule" }> {
  return { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, ...overrides }
}

describe("describeScheduleFrequency — evolução do Trigger por agenda (Parte 12 do pedido)", () => {
  it("Diariamente", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ frequency: { type: "DAILY" } }))).toBe("Todos os dias às 09:00")
  })

  it("A cada X dias", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ intervalDays: 3, frequency: { type: "EVERY_N_DAYS" } }))).toBe("A cada 3 dias às 09:00")
  })

  it("Semanalmente, com múltiplos dias na ordem certa (não na ordem que foram marcados)", () => {
    const trigger = scheduleTrigger({ frequency: { type: "WEEKLY", weekdays: ["FRI", "MON", "WED"] } })
    expect(describeScheduleFrequency(trigger)).toBe("Seg, Qua e Sex às 09:00")
  })

  it("Semanalmente, um único dia (sem 'e' sobrando)", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ frequency: { type: "WEEKLY", weekdays: ["MON"] } }))).toBe("Seg às 09:00")
  })

  it("Mensalmente por dia do mês", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } }))).toBe("Todo dia 5 às 09:00")
  })

  it("Mensalmente, último dia do mês", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ frequency: { type: "MONTHLY", mode: "LAST_DAY" } }))).toBe("Último dia do mês às 09:00")
  })

  it("múltiplos horários aparecem todos, nunca só o primeiro", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ times: ["09:00", "15:00", "18:00"], frequency: { type: "DAILY" } }))).toBe(
      "Todos os dias às 09:00 · 15:00 · 18:00",
    )
  })

  it("nunca expõe cron técnico ou estrutura interna (Parte 13 do pedido)", () => {
    const description = describeScheduleFrequency(scheduleTrigger({ frequency: { type: "WEEKLY", weekdays: ["MON", "WED", "FRI"] } }))
    expect(description).not.toMatch(/[*/]|cron/i)
  })

  it("shape legado (frequency ausente): intervalDays === 1 vira Diariamente", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ intervalDays: 1 }))).toBe("Todos os dias às 09:00")
  })

  it("shape legado (frequency ausente): intervalDays > 1 vira A cada N dias", () => {
    expect(describeScheduleFrequency(scheduleTrigger({ intervalDays: 7 }))).toBe("A cada 7 dias às 09:00")
  })
})

describe("describeRelativeSchedule — evolução do agendamento relativo ao expediente (Parte 39 do pedido)", () => {
  it("X minutos após o início", () => {
    expect(describeRelativeSchedule({ anchor: "START", offsetMinutes: 15 })).toBe("15 min após início do expediente")
  })

  it("X minutos antes do fim", () => {
    expect(describeRelativeSchedule({ anchor: "END", offsetMinutes: 30 })).toBe("30 min antes do fim do expediente")
  })

  it("percentual genérico", () => {
    expect(describeRelativeSchedule({ anchor: "PERCENTAGE", percentage: 50 })).toBe("50% da jornada")
  })

  it("0% vira 'Início do expediente', não '0% da jornada'", () => {
    expect(describeRelativeSchedule({ anchor: "PERCENTAGE", percentage: 0 })).toBe("Início do expediente")
  })

  it("100% vira 'Fim do expediente'", () => {
    expect(describeRelativeSchedule({ anchor: "PERCENTAGE", percentage: 100 })).toBe("Fim do expediente")
  })

  it("nunca expõe anchor/offsetMinutes/percentage crus", () => {
    const description = describeRelativeSchedule({ anchor: "START", offsetMinutes: 15 })
    expect(description).not.toMatch(/anchor|offsetMinutes|START/i)
  })
})

describe("describeScheduleFrequency — modo relativo ao expediente (evolução do agendamento relativo)", () => {
  it("reaproveita describeRelativeSchedule quando mode é RELATIVE_TO_SHIFT", () => {
    const trigger = relativeTrigger({ relative: { anchor: "START", offsetMinutes: 15 } })
    expect(describeScheduleFrequency(trigger)).toBe("15 min após início do expediente")
  })

  it("nunca usa times/frequency de calendário quando o modo é relativo", () => {
    const trigger = relativeTrigger({ relative: { anchor: "PERCENTAGE", percentage: 50 }, times: ["09:00"], frequency: { type: "DAILY" } })
    expect(describeScheduleFrequency(trigger)).toBe("50% da jornada")
  })
})

describe("triggerLabel / triggerBadgeText — Agenda reaproveita describeScheduleFrequency", () => {
  it("triggerLabel de um gatilho por agenda é a mesma frase amigável", () => {
    const trigger = scheduleTrigger({ frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } })
    expect(triggerLabel(trigger)).toBe("Todo dia 5 às 09:00")
  })

  it("triggerBadgeText prefixa com 'Agenda ·'", () => {
    const trigger = scheduleTrigger({ frequency: { type: "DAILY" } })
    expect(triggerBadgeText(trigger)).toBe("Agenda · Todos os dias às 09:00")
  })

  it("flag de canal e indicador continuam com o comportamento de sempre", () => {
    const flagTrigger: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Nota URA", valueType: "NUMERIC" }
    expect(triggerLabel(flagTrigger)).toBe("Nota URA")
    expect(triggerBadgeText(flagTrigger)).toBe("VOICE · Nota URA")
  })
})
