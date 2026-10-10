/**
 * CLASSIFICAÇÃO OPERACIONAL DE UM DIA — o que uma pessoa autorizada disse que ACONTECEU num dia
 * programado sem produção, DEPOIS de os dados fecharem. Não é planejamento (isso é exceção de
 * calendário, provisionada ANTES da data) e não é dado observado: é a explicação humana, revisável,
 * porque a verdade operacional pode chegar depois (atestado, RH tardio, carga atrasada).
 *
 *  UNJUSTIFIED_ABSENCE — falta injustificada: situação EM_PRODUCAO, prevista para trabalhar, sem
 *                        produção, sem justificativa conhecida, CONFIRMADA pelo Supervisor. O dia
 *                        CONTINUA esperado/elegível (não sai do universo operacional); indicadores com
 *                        política ZERO_CONTRIBUTION recebem contribuição lógica 0, os demais não têm
 *                        amostra — nunca uma medição sintética.
 *  JUSTIFIED_ABSENCE   — ausência justificada (motivo: atestado, day off, banco de horas, folga
 *                        extraordinária, outro motivo suportado): dia NÃO elegível. Para ATESTADO só o
 *                        motivo é guardado — nunca CID, diagnóstico, documento ou descrição clínica.
 *  WORKED_DATA_MISSING — trabalhou e os dados não chegaram: dia elegível, NADA é inventado (indicadores
 *                        ficam sem valor até o dado real chegar).
 * Nunca por IA: a classificação nasce só de decisão humana autorizada (escopo real do backend).
 */
export const WORKDAY_CLASSIFICATIONS = ["UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING"] as const
export type WorkdayClassificationKind = (typeof WORKDAY_CLASSIFICATIONS)[number]

export const WORKDAY_CLASSIFICATION_LABELS: Record<WorkdayClassificationKind, string> = {
  UNJUSTIFIED_ABSENCE: "Falta injustificada",
  JUSTIFIED_ABSENCE: "Ausência justificada",
  WORKED_DATA_MISSING: "Trabalhou — dados não chegaram",
}

/** Motivos de ausência justificada — os mesmos códigos provisionáveis + "outro motivo suportado". */
export const JUSTIFIED_ABSENCE_REASONS = ["ATESTADO", "DAY_OFF", "BANCO_HORAS", "FOLGA_EXTRAORDINARIA", "OTHER_JUSTIFIED"] as const
export type JustifiedAbsenceReason = (typeof JUSTIFIED_ABSENCE_REASONS)[number]

export const JUSTIFIED_ABSENCE_REASON_LABELS: Record<JustifiedAbsenceReason, string> = {
  ATESTADO: "Atestado",
  DAY_OFF: "Day off",
  BANCO_HORAS: "Banco de horas",
  FOLGA_EXTRAORDINARIA: "Folga extraordinária",
  OTHER_JUSTIFIED: "Outro motivo justificado",
}

/** Por que uma classificação deixou de valer — sempre preservada no histórico. */
export const CLASSIFICATION_SUPERSEDED_REASONS = ["REVISED", "CONTRADICTED_BY_WORK_EVIDENCE", "SUPERSEDED_BY_AUTHORITATIVE_STATUS"] as const
export type ClassificationSupersededReason = (typeof CLASSIFICATION_SUPERSEDED_REASONS)[number]

export const CLASSIFICATION_SUPERSEDED_REASON_LABELS: Record<ClassificationSupersededReason, string> = {
  REVISED: "Revisada pelo Supervisor",
  CONTRADICTED_BY_WORK_EVIDENCE: "Contrariada por evidência de trabalho posterior",
  SUPERSEDED_BY_AUTHORITATIVE_STATUS: "Substituída pela situação funcional da fonte autoritativa",
}

export type WorkdayClassificationRef = {
  id: string
  classification: WorkdayClassificationKind
  reasonCode: JustifiedAbsenceReason | null
}

/** Falta injustificada e "trabalhou — dados não chegaram" mantêm o dia esperado; ausência justificada o tira. */
export function classificationKeepsDayEligible(classification: WorkdayClassificationKind): boolean {
  return classification !== "JUSTIFIED_ABSENCE"
}

export function describeWorkdayClassification(ref: Pick<WorkdayClassificationRef, "classification" | "reasonCode">): string {
  const label = WORKDAY_CLASSIFICATION_LABELS[ref.classification]
  return ref.classification === "JUSTIFIED_ABSENCE" && ref.reasonCode ? `${label} · ${JUSTIFIED_ABSENCE_REASON_LABELS[ref.reasonCode]}` : label
}
