import { z } from "zod"
import { EVALUATION_RESOLVED, HUMAN_SUPPORT_LIMITS, type AttendanceEndCause, type EvaluationResolved } from "./catalogs.js"

/**
 * AVALIAÇÃO DO ATENDIMENTO PELO OPERADOR (design_draft.md seção 12): "Sua dúvida foi resolvida?" (Sim / Em parte / Não) e as
 * estrelas de 1 a 5. Ambas opcionais e independentes (ao menos uma por envio), alteráveis até 24 h depois do fim do atendimento;
 * cada mudança grava nova linha e encerra a anterior. Atendimento Interrompido não é avaliado. Separada das outras duas avaliações
 * (feedback do Acompanhamento e resposta da INIA): nunca se misturam.
 */
export const evaluationInputSchema = z
  .object({ resolved: z.enum(EVALUATION_RESOLVED).optional(), stars: z.number().int().min(1).max(5).optional() })
  .strict()
  .refine((input) => input.resolved !== undefined || input.stars !== undefined, { message: "Responda ao menos uma das perguntas." })
export type EvaluationInput = z.infer<typeof evaluationInputSchema>
export type EvaluationCurrent = { resolved: EvaluationResolved | null; stars: number | null }

/** Até quando o atendimento aceita avaliação (null = não aceita: em andamento ou Interrompido). */
export function evaluationOpenUntil(attendance: { endedAt: Date | null; endCause: AttendanceEndCause | null }): Date | null {
  if (!attendance.endedAt || !attendance.endCause || attendance.endCause === "ANJO_LOST") return null
  return new Date(attendance.endedAt.getTime() + HUMAN_SUPPORT_LIMITS.evaluationWindowMs)
}

export const evaluationOpen = (attendance: { endedAt: Date | null; endCause: AttendanceEndCause | null }, now: Date) => {
  const until = evaluationOpenUntil(attendance)
  return until !== null && now.getTime() < until.getTime()
}

/** A nova versão completa: o que não veio no envio continua como estava (cada pergunta é independente). */
export const mergeEvaluation = (current: EvaluationCurrent | null, input: EvaluationInput): EvaluationCurrent => ({
  resolved: input.resolved ?? current?.resolved ?? null,
  stars: input.stars ?? current?.stars ?? null,
})
