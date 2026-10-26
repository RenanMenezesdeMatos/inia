import { z } from "zod"
import { renderProductForModel, type FeedbackHistoricalContext } from "./historical-context.js"

/**
 * CONFIRMAÇÃO DO PRODUTO NA SESSÃO DE FEEDBACK (`PRODUCT_APPLICABILITY_V1`). Quando a análise da gravação não estabeleceu o produto do
 * pedido, a pessoa pode confirmá-lo na conversa sobre o feedback para receber a orientação certa (pelo esclarecimento pelas bases). A
 * resposta dela fica gravada na conversa com esta procedência — `CHAT_CONFIRMATION` —, separada da evidência da gravação: nada da
 * conversa volta para a análise da chamada nem muda o feedback publicado.
 */
export const feedbackSessionClarificationScopeSchema = z.object({
  kind: z.literal("FEEDBACK_SESSION"),
  applicationId: z.string().min(1).max(64),
  provenance: z.literal("CHAT_CONFIRMATION"),
})
export type FeedbackSessionClarificationScope = z.infer<typeof feedbackSessionClarificationScopeSchema>

export function parseFeedbackSessionClarificationScope(value: unknown): FeedbackSessionClarificationScope | null {
  const parsed = feedbackSessionClarificationScopeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Contexto da sessão para o esclarecimento: só quando o registro diz que o produto ficou indefinido (senão, nada muda na sessão). */
export function productSessionContextOf(context: Pick<FeedbackHistoricalContext, "subject" | "periodLabel" | "product">): string | null {
  if (!context.product?.undetermined) return null
  return [`Feedback sobre: ${context.subject}${context.periodLabel ? ` (${context.periodLabel})` : ""}.`, renderProductForModel(context.product)].join("\n")
}
