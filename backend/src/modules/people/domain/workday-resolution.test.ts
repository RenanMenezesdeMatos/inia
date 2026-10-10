import { describe, expect, it } from "vitest"
import { describeWorkActivityEvidence, evidenceSourcesEnabled, hasWorkActivity, type WorkActivityEvidence } from "./work-activity-evidence.js"
import type { ScheduledDayResolution } from "./work-schedule.js"
import type { WorkdayClassificationRef } from "./workday-classification.js"
import { plannedNonWorkingCause, resolveWorkday } from "./workday-resolution.js"

const work: ScheduledDayResolution = { scheduledToWork: true, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null }
const dayOff: ScheduledDayResolution = { scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null }
const exceptionDayOff: ScheduledDayResolution = { scheduledToWork: false, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: { date: "2026-09-17", code: "DAY_OFF", effect: "NON_WORKING", rawReason: null } }
const exceptionBanco: ScheduledDayResolution = { ...exceptionDayOff, exception: { date: "2026-09-17", code: "BANCO_HORAS", effect: "NON_WORKING", rawReason: null } }
const unknown: ScheduledDayResolution = { scheduledToWork: false, basis: "UNKNOWN_SCHEDULE", holiday: false, exception: null }
const holiday: ScheduledDayResolution = { scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: true, exception: null }
const production: WorkActivityEvidence = { date: "2026-09-17", interactionCount: 3, indicatorCodes: [] }
const measurementProof: WorkActivityEvidence = { date: "2026-09-17", interactionCount: 0, indicatorCodes: ["VOLUME"] }
const base = { date: "2026-09-17", hired: true, status: null, evidenceEnabled: true, dayClosed: true, availability: "READY" as const, classification: null }
const unjustified: WorkdayClassificationRef = { id: "c1", classification: "UNJUSTIFIED_ABSENCE", reasonCode: null }
const atestado: WorkdayClassificationRef = { id: "c2", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" }
const workedDataMissing: WorkdayClassificationRef = { id: "c3", classification: "WORKED_DATA_MISSING", reasonCode: null }

describe("dia de trabalho resolvido — PLANEJADO × OBSERVADO", () => {
  it("programado + produção → WORKED_OBSERVED, elegível, sem divergência", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: false, conflict: null, observed: true })
  })

  it("programado + sem produção com turno encerrado, fontes configuradas e FECHADAS → MISSING_EXPECTED_PRODUCTION (continua elegível: pendência, nunca falta nem exceção automática)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null })).toMatchObject({ state: "MISSING_EXPECTED_PRODUCTION", eligible: true })
  })

  it("fim do turno NÃO é dado fechado: fontes ainda dentro do prazo (D-1/D-2, RH) → WAITING_FOR_SOURCES, elegível, sem pendência", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, availability: "WAITING_FOR_SOURCES" })).toMatchObject({ state: "WAITING_FOR_SOURCES", eligible: true })
  })

  it("prazo vencido e fonte atrasada/falhando → DATA_SOURCE_DELAY (problema de dado, nunca ausência do colaborador)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, availability: "DATA_SOURCE_DELAY" })).toMatchObject({ state: "DATA_SOURCE_DELAY", eligible: true })
  })

  it("fonte relevante sem política de disponibilidade → PLANNED_WORK (a INIA não assume D+1 e não conclui ausência)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, availability: "AVAILABILITY_UNKNOWN" })).toMatchObject({ state: "PLANNED_WORK", eligible: true, availability: "AVAILABILITY_UNKNOWN" })
  })

  it("disponibilidade só importa DEPOIS do turno e com fonte de evidência: antes do fim do turno é PLANNED_WORK mesmo com fontes fechadas", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, dayClosed: false, availability: "READY" })).toMatchObject({ state: "PLANNED_WORK" })
    expect(resolveWorkday({ ...base, planned: work, evidence: null, evidenceEnabled: false, availability: "DATA_SOURCE_DELAY" })).toMatchObject({ state: "PLANNED_WORK" })
  })

  it("classificação humana: falta injustificada → dia CONTINUA elegível; ausência justificada (atestado) → não elegível; dados não chegaram → elegível", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, classification: unjustified })).toMatchObject({ state: "CLASSIFIED_UNJUSTIFIED_ABSENCE", eligible: true, classification: unjustified, classificationContradictedBy: null })
    expect(resolveWorkday({ ...base, planned: work, evidence: null, classification: atestado })).toMatchObject({ state: "CLASSIFIED_JUSTIFIED_ABSENCE", eligible: false })
    expect(resolveWorkday({ ...base, planned: work, evidence: null, classification: workedDataMissing })).toMatchObject({ state: "CLASSIFIED_WORKED_DATA_MISSING", eligible: true })
  })

  it("classificação vence plano/disponibilidade, mas produção real vence a classificação (contrariada, nunca apagada)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, availability: "WAITING_FOR_SOURCES", classification: unjustified })).toMatchObject({ state: "CLASSIFIED_UNJUSTIFIED_ABSENCE" })
    expect(resolveWorkday({ ...base, planned: exceptionDayOff, evidence: null, classification: unjustified })).toMatchObject({ state: "CLASSIFIED_UNJUSTIFIED_ABSENCE", eligible: true })
    const day = resolveWorkday({ ...base, planned: work, evidence: production, classification: unjustified })
    expect(day).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, classificationContradictedBy: "WORK_EVIDENCE", classification: unjustified })
    expect(resolveWorkday({ ...base, planned: work, evidence: production, classification: atestado })).toMatchObject({ state: "WORKED_OBSERVED", classificationContradictedBy: "WORK_EVIDENCE" })
    // "Trabalhou — dados não chegaram" + dado real depois: confirmação, não contradição.
    expect(resolveWorkday({ ...base, planned: work, evidence: production, classification: workedDataMissing })).toMatchObject({ state: "WORKED_OBSERVED", classificationContradictedBy: null })
  })

  it("RH tardio: situação autoritativa não produtiva vence a classificação (preservada como superada)", () => {
    expect(resolveWorkday({ ...base, status: "FERIAS", planned: work, evidence: null, classification: unjustified })).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, classificationContradictedBy: "AUTHORITATIVE_STATUS" })
    // RH confirmando EM_PRODUCAO não apaga uma justificativa manual (atestado pode não estar nesse feed).
    expect(resolveWorkday({ ...base, status: "EM_PRODUCAO", planned: work, evidence: null, classification: atestado })).toMatchObject({ state: "CLASSIFIED_JUSTIFIED_ABSENCE", classificationContradictedBy: null })
  })

  it("programado + sem produção ANTES do fim do turno → PLANNED_WORK (nada a cobrar ainda)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, dayClosed: false })).toMatchObject({ state: "PLANNED_WORK", eligible: true })
  })

  it("programado + sem produção numa organização SEM fonte de evidência → PLANNED_WORK (ausência de evidência não significa nada)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: null, evidenceEnabled: false })).toMatchObject({ state: "PLANNED_WORK", eligible: true })
  })

  it("day off + sem produção → PLANNED_NON_WORKING, não elegível, causa EXCEPTION", () => {
    expect(resolveWorkday({ ...base, planned: exceptionDayOff, evidence: null })).toMatchObject({ state: "PLANNED_NON_WORKING", eligible: false, plannedCause: "EXCEPTION" })
  })

  it("day off + produção → WORKED_OBSERVED elegível com overridesPlan (a exceção fica registrada, não é apagada)", () => {
    const day = resolveWorkday({ ...base, planned: exceptionDayOff, evidence: production })
    expect(day).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: true, plannedCause: "EXCEPTION" })
    expect(day.planned.exception?.code).toBe("DAY_OFF")
  })

  it("banco de horas + produção → WORKED_OBSERVED elegível (efeito, não código)", () => {
    expect(resolveWorkday({ ...base, planned: exceptionBanco, evidence: measurementProof })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: true })
  })

  it("folga 6x1 (escala explícita) + produção → WORKED_OBSERVED elegível + divergência (SCHEDULED_DAY_OFF)", () => {
    expect(resolveWorkday({ ...base, planned: dayOff, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: true, plannedCause: "SCHEDULED_DAY_OFF" })
  })

  it("feriado (fallback + EXCLUDE) + produção → trabalhou; sem produção → não elegível por feriado", () => {
    expect(resolveWorkday({ ...base, planned: holiday, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", overridesPlan: true, plannedCause: "HOLIDAY" })
    expect(resolveWorkday({ ...base, planned: holiday, evidence: null })).toMatchObject({ state: "PLANNED_NON_WORKING", plannedCause: "HOLIDAY" })
  })

  it("6x1 sem calendário: sem produção → INDETERMINATE (a INIA não inventa folga nem cobra); com produção → trabalhou", () => {
    expect(resolveWorkday({ ...base, planned: unknown, evidence: null })).toMatchObject({ state: "INDETERMINATE", eligible: false, plannedCause: "UNKNOWN_SCHEDULE" })
    expect(resolveWorkday({ ...base, planned: unknown, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, plannedCause: "UNKNOWN_SCHEDULE" })
  })

  it.each(["INSS", "FERIAS", "MATERNIDADE", "APOSENTADO", "TRANSFERIDO", "PILOTO", "PATERNIDADE", "ATIVIDADE_OFF"] as const)("%s + produção → NÃO elegível + conflito PRODUCTION_WITH_NON_ELIGIBLE_STATUS; a situação é soberana e nunca muda", (status) => {
    const day = resolveWorkday({ ...base, status, planned: work, evidence: production })
    expect(day).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, conflict: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS", status })
    expect(resolveWorkday({ ...base, status, planned: work, evidence: null })).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, conflict: null })
  })

  it("EM_PRODUCAO explícito + produção → elegível (status positivo único)", () => {
    expect(resolveWorkday({ ...base, status: "EM_PRODUCAO", planned: work, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true })
  })

  it("antes da admissão → BEFORE_HIRE, nunca elegível (produção vira conflito)", () => {
    expect(resolveWorkday({ ...base, hired: false, planned: work, evidence: null })).toMatchObject({ state: "BEFORE_HIRE", eligible: false, conflict: null })
    expect(resolveWorkday({ ...base, hired: false, planned: work, evidence: production })).toMatchObject({ state: "BEFORE_HIRE", eligible: false, conflict: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" })
  })

  it("causa do plano: exceção > escala desconhecida > feriado > folga programada; trabalha = null", () => {
    expect(plannedNonWorkingCause(work)).toBeNull()
    expect(plannedNonWorkingCause(exceptionDayOff)).toBe("EXCEPTION")
    expect(plannedNonWorkingCause(unknown)).toBe("UNKNOWN_SCHEDULE")
    expect(plannedNonWorkingCause(holiday)).toBe("HOLIDAY")
    expect(plannedNonWorkingCause(dayOff)).toBe("SCHEDULED_DAY_OFF")
  })

  it("evidência: interação OU medição de indicador marcado; sem nenhuma = não observado; fontes habilitadas só com interação ou indicador", () => {
    expect(hasWorkActivity({ date: "2026-09-17", interactionCount: 0, indicatorCodes: [] })).toBe(false)
    expect(hasWorkActivity(production)).toBe(true)
    expect(hasWorkActivity(measurementProof)).toBe(true)
    expect(hasWorkActivity(null)).toBe(false)
    expect(evidenceSourcesEnabled({ interactions: false, indicatorCodes: [] })).toBe(false)
    expect(evidenceSourcesEnabled({ interactions: true, indicatorCodes: [] })).toBe(true)
    expect(evidenceSourcesEnabled({ interactions: false, indicatorCodes: ["VOLUME"] })).toBe(true)
    expect(describeWorkActivityEvidence({ date: "2026-09-17", interactionCount: 2, indicatorCodes: ["VOLUME"] })).toBe("2 interação(ões) · medição de VOLUME")
  })
})

describe("PRECEDÊNCIA FINAL do dia (consolidada): situação não produtiva → trabalho observado → classificação humana → exceção → escala explícita → fallback → desconhecido", () => {
  const fallbackWork: ScheduledDayResolution = { scheduledToWork: true, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null }

  it("1. INSS + interação → INSS, não elegível, conflito; FÉRIAS + produção (medição de prova) → FÉRIAS, conflito", () => {
    expect(resolveWorkday({ ...base, status: "INSS", planned: work, evidence: production })).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, conflict: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS", status: "INSS" })
    expect(resolveWorkday({ ...base, status: "FERIAS", planned: work, evidence: measurementProof })).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, conflict: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS", status: "FERIAS" })
  })

  it("2. trabalho observado vence exceção planejada: DAY_OFF + interação e BANCO_HORAS + interação → WORKED_OBSERVED (plano preservado)", () => {
    expect(resolveWorkday({ ...base, planned: exceptionDayOff, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: true, plannedCause: "EXCEPTION" })
    expect(resolveWorkday({ ...base, planned: exceptionBanco, evidence: production })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, overridesPlan: true, plannedCause: "EXCEPTION" })
  })

  it("3. trabalho observado vence classificação: FALTA_INJUSTIFICADA + interação tardia → WORKED_OBSERVED, classificação marcada como contrariada (nunca apagada)", () => {
    expect(resolveWorkday({ ...base, planned: work, evidence: production, classification: unjustified })).toMatchObject({ state: "WORKED_OBSERVED", eligible: true, classification: unjustified, classificationContradictedBy: "WORK_EVIDENCE" })
  })

  it("4. situação autoritativa vence classificação: FALTA_INJUSTIFICADA + RH informa FÉRIAS → FÉRIAS, não elegível, classificação preservada como superada", () => {
    expect(resolveWorkday({ ...base, status: "FERIAS", planned: work, evidence: null, classification: unjustified })).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, classification: unjustified, classificationContradictedBy: "AUTHORITATIVE_STATUS" })
  })

  it("5. classificação vence exceção/plano; exceção vence escala; escala explícita vence fallback; 6x1 sem calendário = desconhecido", () => {
    expect(resolveWorkday({ ...base, planned: exceptionDayOff, evidence: null, classification: unjustified })).toMatchObject({ state: "CLASSIFIED_UNJUSTIFIED_ABSENCE", eligible: true })
    expect(resolveWorkday({ ...base, planned: exceptionDayOff, evidence: null })).toMatchObject({ state: "PLANNED_NON_WORKING", plannedCause: "EXCEPTION" })
    expect(resolveWorkday({ ...base, planned: dayOff, evidence: null })).toMatchObject({ state: "PLANNED_NON_WORKING", plannedCause: "SCHEDULED_DAY_OFF" })
    expect(resolveWorkday({ ...base, planned: fallbackWork, evidence: null, dayClosed: false })).toMatchObject({ state: "PLANNED_WORK", eligible: true })
    expect(resolveWorkday({ ...base, planned: unknown, evidence: null })).toMatchObject({ state: "INDETERMINATE", eligible: false })
  })
})
