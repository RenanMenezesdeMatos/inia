import { isOperationallyEligibleStatus, type EmploymentStatus } from "./employment-status.js"
import { hasWorkActivity, type WorkActivityEvidence } from "./work-activity-evidence.js"
import type { ScheduledDayResolution } from "./work-schedule.js"
import type { WorkdayAvailabilityState } from "./workday-data-availability.js"
import { classificationKeepsDayEligible, type WorkdayClassificationRef } from "./workday-classification.js"

/**
 * ESTADO RESOLVIDO DE UM DIA DE TRABALHO — PLANEJADO + OBSERVADO + DISPONIBILIDADE + CLASSIFICAÇÃO =
 * RESOLVIDO. Função pura, única no sistema (o resolvedor de elegibilidade, o Calendário da equipe e
 * o job de reconciliação chamam esta). Nada é persistido: o estado é derivado dos fatos.
 *
 * PRECEDÊNCIA (explícita e central):
 *  1. situação funcional autoritativa não produtiva (soberana);
 *  2. trabalho REAL observado (evidência confiável);
 *  3. classificação operacional humana (falta injustificada / ausência justificada / trabalhou, dados
 *     não chegaram);
 *  4. exceção / plano;  5. escala explícita;  6. fallback;  7. desconhecido.
 *
 *  BEFORE_HIRE                     — anterior à admissão.
 *  NON_ELIGIBLE_EMPLOYMENT_STATUS  — situação ≠ EM_PRODUCAO. Produção observada aqui NÃO torna a pessoa
 *                                    elegível nem muda a situação — vira `conflict`.
 *  WORKED_OBSERVED                 — EM_PRODUCAO + evidência: elegível, mesmo que o plano ou uma
 *                                    classificação dissessem outra coisa (`overridesPlan`; a classificação
 *                                    anterior fica no histórico como contrariada).
 *  CLASSIFIED_UNJUSTIFIED_ABSENCE  — falta injustificada confirmada por pessoa autorizada: o dia CONTINUA
 *                                    esperado/elegível (política por indicador decide zero × sem amostra).
 *  CLASSIFIED_JUSTIFIED_ABSENCE    — ausência justificada (atestado, day off…): não elegível.
 *  CLASSIFIED_WORKED_DATA_MISSING  — trabalhou, dados não chegaram: elegível; nada é inventado.
 *  PLANNED_WORK                    — programado, sem evidência ainda (dia/turno em curso, organização sem
 *                                    fonte de evidência, ou disponibilidade não configurada): elegível.
 *  WAITING_FOR_SOURCES             — programado, turno encerrado, mas os dados que poderiam explicar o dia
 *                                    ainda NÃO deveriam ter chegado (D-1/D-2, RH): elegível, sem cobrança.
 *  DATA_SOURCE_DELAY               — prazo vencido e a fonte não entregou: problema de dado (alerta
 *                                    administrativo), nunca ausência do colaborador. Elegível.
 *  MISSING_EXPECTED_PRODUCTION     — programado, turno encerrado, fontes FECHADAS e confiáveis, nada
 *                                    observado: ESTADO INTERMEDIÁRIO — continua elegível e vira PENDÊNCIA
 *                                    para o Supervisor classificar. Nunca vira falta sozinho.
 *  PLANNED_NON_WORKING             — folga/day off/banco/atestado/feriado, sem produção: não elegível.
 *  INDETERMINATE                   — regime 6x1 sem calendário informado: a INIA não inventa folga nem cobra.
 */
export const RESOLVED_WORKDAY_STATES = [
  "BEFORE_HIRE",
  "NON_ELIGIBLE_EMPLOYMENT_STATUS",
  "WORKED_OBSERVED",
  "CLASSIFIED_UNJUSTIFIED_ABSENCE",
  "CLASSIFIED_JUSTIFIED_ABSENCE",
  "CLASSIFIED_WORKED_DATA_MISSING",
  "PLANNED_WORK",
  "WAITING_FOR_SOURCES",
  "DATA_SOURCE_DELAY",
  "MISSING_EXPECTED_PRODUCTION",
  "PLANNED_NON_WORKING",
  "INDETERMINATE",
] as const
export type ResolvedWorkdayState = (typeof RESOLVED_WORKDAY_STATES)[number]

export const RESOLVED_WORKDAY_STATE_LABELS: Record<ResolvedWorkdayState, string> = {
  BEFORE_HIRE: "Antes da admissão",
  NON_ELIGIBLE_EMPLOYMENT_STATUS: "Situação funcional não produtiva",
  WORKED_OBSERVED: "Trabalhou (produção observada)",
  CLASSIFIED_UNJUSTIFIED_ABSENCE: "Falta injustificada",
  CLASSIFIED_JUSTIFIED_ABSENCE: "Ausência justificada",
  CLASSIFIED_WORKED_DATA_MISSING: "Trabalhou — dados não recebidos",
  PLANNED_WORK: "Trabalha (planejado)",
  WAITING_FOR_SOURCES: "Aguardando dados",
  DATA_SOURCE_DELAY: "Fonte de dados atrasada",
  MISSING_EXPECTED_PRODUCTION: "Sem produção · classificar",
  PLANNED_NON_WORKING: "Não trabalha (planejado)",
  INDETERMINATE: "Escala desconhecida",
}

/** Por que o PLANO dizia "não trabalha" (uma causa por dia, na precedência do calendário). */
export type PlannedNonWorkingCause = "EXCEPTION" | "SCHEDULED_DAY_OFF" | "HOLIDAY" | "UNKNOWN_SCHEDULE"

export type WorkdayConflict = "PRODUCTION_WITH_NON_ELIGIBLE_STATUS"

export type WorkdayResolutionInput = {
  date: string
  /** false = data anterior a `people.hired_at`. */
  hired: boolean
  /** Situação funcional vigente na data (null = nenhum período não produtivo cobre a data → EM_PRODUCAO). */
  status: EmploymentStatus | null
  planned: ScheduledDayResolution
  evidence: WorkActivityEvidence | null
  /** A organização tem ao menos uma fonte de evidência (interações ou indicador marcado). */
  evidenceEnabled: boolean
  /** Turno (ou dia local) já encerrado — antes disso nada é cobrado. */
  dayClosed: boolean
  /** Os dados que poderiam explicar o dia já deveriam ter chegado — e chegaram? (workday-data-availability.ts). */
  availability: WorkdayAvailabilityState
  /** Classificação operacional vigente (humana) para este dia, se houver. */
  classification: WorkdayClassificationRef | null
}

export type ResolvedWorkday = {
  date: string
  state: ResolvedWorkdayState
  /** Entra nos cálculos operacionais (numerador/denominador, cobertura, ranking, quartil). */
  eligible: boolean
  plannedToWork: boolean
  plannedCause: PlannedNonWorkingCause | null
  status: EmploymentStatus | null
  planned: ScheduledDayResolution
  observed: boolean
  evidence: WorkActivityEvidence | null
  /** Produção observada num dia planejado como não trabalhado (day off, folga, banco…). */
  overridesPlan: boolean
  conflict: WorkdayConflict | null
  availability: WorkdayAvailabilityState
  /** Classificação vigente (mesmo quando superada por evidência/situação — o job a marca no histórico). */
  classification: WorkdayClassificationRef | null
  /** A classificação vigente foi contrariada por fato mais forte (trabalho observado ou situação autoritativa). */
  classificationContradictedBy: "WORK_EVIDENCE" | "AUTHORITATIVE_STATUS" | null
}

export function plannedNonWorkingCause(planned: ScheduledDayResolution): PlannedNonWorkingCause | null {
  if (planned.scheduledToWork) return null
  if (planned.exception) return "EXCEPTION"
  if (planned.basis === "UNKNOWN_SCHEDULE") return "UNKNOWN_SCHEDULE"
  if (planned.holiday) return "HOLIDAY"
  return "SCHEDULED_DAY_OFF"
}

function classifiedState(classification: WorkdayClassificationRef): ResolvedWorkdayState {
  switch (classification.classification) {
    case "UNJUSTIFIED_ABSENCE":
      return "CLASSIFIED_UNJUSTIFIED_ABSENCE"
    case "JUSTIFIED_ABSENCE":
      return "CLASSIFIED_JUSTIFIED_ABSENCE"
    case "WORKED_DATA_MISSING":
      return "CLASSIFIED_WORKED_DATA_MISSING"
  }
}

/** Sem evidência num dia programado e encerrado: o que a DISPONIBILIDADE dos dados permite concluir. */
function unobservedPlannedState(availability: WorkdayAvailabilityState): ResolvedWorkdayState {
  switch (availability) {
    case "READY":
      return "MISSING_EXPECTED_PRODUCTION"
    case "WAITING_FOR_SOURCES":
      return "WAITING_FOR_SOURCES"
    case "DATA_SOURCE_DELAY":
      return "DATA_SOURCE_DELAY"
    case "AVAILABILITY_UNKNOWN":
      return "PLANNED_WORK"
  }
}

export function resolveWorkday(input: WorkdayResolutionInput): ResolvedWorkday {
  const observed = hasWorkActivity(input.evidence)
  const plannedToWork = input.planned.scheduledToWork
  const plannedCause = plannedNonWorkingCause(input.planned)
  const base = { date: input.date, plannedToWork, plannedCause, status: input.status, planned: input.planned, observed, evidence: input.evidence, availability: input.availability, classification: input.classification, classificationContradictedBy: null, overridesPlan: false, conflict: null }
  if (!input.hired) return { ...base, state: "BEFORE_HIRE", eligible: false, conflict: observed ? "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" : null }
  // 1) Situação funcional é o GATE — soberana sobre evidência e sobre classificação humana.
  if (input.status !== null && !isOperationallyEligibleStatus(input.status)) {
    return { ...base, state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", eligible: false, conflict: observed ? "PRODUCTION_WITH_NON_ELIGIBLE_STATUS" : null, classificationContradictedBy: input.classification ? "AUTHORITATIVE_STATUS" : null }
  }
  // 2) EM_PRODUCAO + evidência: trabalhou — plano e classificação podem ter dito outra coisa (ficam registrados).
  if (observed) {
    const contradicted = input.classification !== null && input.classification.classification !== "WORKED_DATA_MISSING"
    return { ...base, state: "WORKED_OBSERVED", eligible: true, overridesPlan: !plannedToWork, classificationContradictedBy: contradicted ? "WORK_EVIDENCE" : null }
  }
  // 3) Classificação humana vigente explica o dia.
  if (input.classification) return { ...base, state: classifiedState(input.classification), eligible: classificationKeepsDayEligible(input.classification.classification) }
  // 4) Sem evidência: vale o PLANEJADO — e, depois do turno, a DISPONIBILIDADE dos dados.
  if (plannedToWork) {
    return { ...base, state: input.evidenceEnabled && input.dayClosed ? unobservedPlannedState(input.availability) : "PLANNED_WORK", eligible: true }
  }
  if (plannedCause === "UNKNOWN_SCHEDULE") return { ...base, state: "INDETERMINATE", eligible: false }
  return { ...base, state: "PLANNED_NON_WORKING", eligible: false }
}
