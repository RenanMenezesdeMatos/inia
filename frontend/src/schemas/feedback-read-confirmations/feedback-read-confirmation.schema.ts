import { z } from "zod"

import { feedbackApplicationSchema, feedbackSourceSchema, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * Espelho de backend/src/modules/feedback-application (read-confirmation): CIÊNCIA = o próprio colaborador confirma, com o login e
 * a senha da sua conta, que leu o feedback. Conclusão única do feedback, venha do Acompanhamento ou da sessão com a INIA (conclui a
 * aplicação em andamento). Cada abertura do elemento de confirmação é uma tentativa (`attemptId`) — eventos de usabilidade.
 */
export type ReadConfirmationEntryPoint = "FOLLOW_UP_FEED" | "FEEDBACK_SESSION"
export type ReadConfirmationDevice = "DESKTOP" | "MOBILE"
export type ReadConfirmationAttempt = {
  source: FeedbackSourceRef
  entryPoint: ReadConfirmationEntryPoint
  attemptId: string
  device: ReadConfirmationDevice | null
  elapsedMs: number | null
}

export const readConfirmationResultSchema = z.object({
  source: feedbackSourceSchema,
  acknowledgedAt: z.string(),
  alreadyConfirmed: z.boolean(),
  application: feedbackApplicationSchema.nullable(),
})
export type ReadConfirmationResult = z.infer<typeof readConfirmationResultSchema>

/** Detalhes dos erros esperados: 422 (login/senha) com as tentativas que restam; 429 (trava) com o horário em que libera. */
export const readConfirmationErrorDetailsSchema = z.object({ remainingAttempts: z.number().optional(), retryAt: z.string().optional() }).catch({})
