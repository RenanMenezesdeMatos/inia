import { apiPost } from "@/lib/api/api-client"
import { readConfirmationResultSchema, type ReadConfirmationAttempt, type ReadConfirmationRequest, type ReadConfirmationResult } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"

const BASE = "/api/v1/feedback-read-confirmations"

/**
 * Confirma a ciência com o login e a senha da própria conta e a escolha do colaborador (concorda / não concorda), gravadas juntas
 * (a senha só trafega nesta chamada; nunca é guardada na tela).
 */
export async function confirmFeedbackReading(input: ReadConfirmationRequest): Promise<ReadConfirmationResult> {
  return readConfirmationResultSchema.parse(await apiPost<unknown>(BASE, input))
}

/** Abrir/fechar o elemento de confirmação — só registro de usabilidade (falha de rede é ignorada pela tela). */
export async function recordReadConfirmationEvent(input: ReadConfirmationAttempt & { event: "OPENED" | "CANCELLED" }): Promise<void> {
  await apiPost(`${BASE}/events`, input)
}
