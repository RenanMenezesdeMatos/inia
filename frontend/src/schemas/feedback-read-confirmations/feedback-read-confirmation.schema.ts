import { z } from "zod"

import { feedbackApplicationSchema, feedbackSourceSchema, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { readAgreementSchema, type ReadAgreementInput } from "@/schemas/feedback-ratings/feedback-rating.schema"

/**
 * Espelho de backend/src/modules/feedback-application (read-confirmation): CIÊNCIA = o próprio colaborador confirma, com o login e
 * a senha da sua conta, que leu o feedback. Conclusão única do feedback, venha do Acompanhamento ou da sessão com a INIA (conclui a
 * aplicação em andamento). Cada abertura do elemento de confirmação é uma tentativa (`attemptId`) — eventos de usabilidade.
 * A confirmação leva a ESCOLHA obrigatória do colaborador (concorda / não concorda + motivo e justificativa), gravada na mesma
 * transação da ciência (migration 186).
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

export type ReadConfirmationRequest = ReadConfirmationAttempt & { login: string; password: string; agreement: ReadAgreementInput }

export const readConfirmationResultSchema = z.object({
  source: feedbackSourceSchema,
  acknowledgedAt: z.string(),
  alreadyConfirmed: z.boolean(),
  /** A escolha registrada (a desta confirmação ou a de antes). Obrigatória: uma API sem a escolha é contrato quebrado. */
  agreement: readAgreementSchema.nullable(),
  /** O pedido trouxe outra escolha do que a já registrada (outra aba, reenvio): valeu a registrada. */
  agreementDiffered: z.boolean(),
  application: feedbackApplicationSchema.nullable(),
})
export type ReadConfirmationResult = z.infer<typeof readConfirmationResultSchema>

/** Detalhes dos erros esperados: 422 (login/senha) com as tentativas que restam; 429 (trava) com o horário em que libera. */
export const readConfirmationErrorDetailsSchema = z.object({ remainingAttempts: z.number().optional(), retryAt: z.string().optional() }).catch({})
