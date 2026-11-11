import { z } from "zod"

/**
 * Espelho de backend/src/modules/feedback-rating (migrations 113, 150 e 186). A avaliação do feedback é a CONCORDÂNCIA registrada
 * na confirmação de ciência: "Concordo com o feedback" ou "Não concordo com o feedback" (nada pré-escolhido). Discordar exige um
 * motivo e a justificativa e vira contestação, respondida pela revisão humana. O antigo "Este conteúdo foi útil?" não grava mais;
 * a avaliação "não foi útil" antiga continua visível como contestação. Quem avalia é sempre a pessoa da sessão.
 */
export const CONTESTATION_REASONS = ["POOR_WRITING", "WRONG_PROCESS", "UNCLEAR", "INIA_COULD_NOT_ANSWER", "INACCURATE", "NOT_HELPFUL", "OTHER"] as const
export const contestationReasonSchema = z.enum(CONTESTATION_REASONS)
export type ContestationReason = z.infer<typeof contestationReasonSchema>

/** Limites do texto do colaborador (justificativa da discordância; descrição do "não foi útil" antigo). */
export const CONTESTATION_TEXT_LIMITS = { min: 3, max: 1000 } as const

/**
 * Rótulo de cada motivo e a pergunta da justificativa. Os códigos são os da avaliação antiga (reaproveitados por pedido); os textos
 * foram revistos para a discordância e servem também à Administração (o rótulo vale para as duas origens).
 */
export const CONTESTATION_REASON_COPY: Record<ContestationReason, { label: string; prompt: string }> = {
  POOR_WRITING: { label: "O texto está confuso ou mal escrito", prompt: "O que no texto atrapalhou o entendimento?" },
  WRONG_PROCESS: { label: "O processo citado está errado", prompt: "Qual orientação está errada e qual seria a correta?" },
  UNCLEAR: { label: "O feedback não ficou claro", prompt: "Qual parte você não entendeu?" },
  INIA_COULD_NOT_ANSWER: { label: "A INIA não soube responder minha dúvida", prompt: "Qual dúvida você fez e o que faltou na resposta?" },
  INACCURATE: { label: "Não condiz com o que aconteceu", prompt: "O que está diferente do que aconteceu na chamada ou nos seus resultados?" },
  NOT_HELPFUL: { label: "A orientação não me ajuda a melhorar", prompt: "Por que essa orientação não ajuda você no dia a dia?" },
  OTHER: { label: "Outro motivo", prompt: "Conte por que você não concorda com este feedback." },
}

/** Conclusão da revisão humana de uma contestação (migration 150). */
export const CONTESTATION_DECISIONS = ["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"] as const
export const contestationDecisionSchema = z.enum(CONTESTATION_DECISIONS)
export type ContestationDecision = z.infer<typeof contestationDecisionSchema>
export const CONTESTATION_DECISION_LABELS: Record<ContestationDecision, string> = {
  ACCEPTED: "Contestação procedente",
  PARTIALLY_ACCEPTED: "Procedente em parte",
  REJECTED: "Feedback mantido",
}

/** Origem de uma contestação: a avaliação "não foi útil" antiga ou a discordância registrada na ciência. */
export const contestationOriginSchema = z.enum(["USEFULNESS_RATING", "READ_AGREEMENT"])
export type ContestationOrigin = z.infer<typeof contestationOriginSchema>
export const CONTESTATION_ORIGIN_LABELS: Record<ContestationOrigin, string> = { READ_AGREEMENT: "Discordância na ciência", USEFULNESS_RATING: "Avaliação “não foi útil”" }

/** A escolha enviada na confirmação de ciência (o backend valida de novo: obrigatória, estrita). */
export const readAgreementInputSchema = z.discriminatedUnion("value", [
  z.object({ value: z.literal("AGREE") }).strict(),
  z
    .object({ value: z.literal("DISAGREE"), reason: contestationReasonSchema, justification: z.string().trim().min(CONTESTATION_TEXT_LIMITS.min).max(CONTESTATION_TEXT_LIMITS.max) })
    .strict(),
])
export type ReadAgreementInput = z.infer<typeof readAgreementInputSchema>

const contestationReviewSchema = z.object({ decision: contestationDecisionSchema, response: z.string(), respondedAt: z.string() })
export type ContestationReview = z.infer<typeof contestationReviewSchema>

/** A escolha registrada, como o próprio colaborador a vê (com a resposta da revisão quando discordou). */
export const readAgreementSchema = z.object({
  value: z.enum(["AGREE", "DISAGREE"]),
  reason: contestationReasonSchema.nullable(),
  justification: z.string().nullable(),
  recordedAt: z.string(),
  review: contestationReviewSchema.nullable(),
})
export type ReadAgreement = z.infer<typeof readAgreementSchema>

/** Avaliação do item do Acompanhamento do PRÓPRIO colaborador: a escolha e a contestação antiga ainda vigente. */
export const feedbackEvaluationSchema = z.object({
  agreement: readAgreementSchema.nullable(),
  legacyContestation: z.object({ reason: contestationReasonSchema, comment: z.string(), contestedAt: z.string(), review: contestationReviewSchema.nullable() }).nullable(),
})
export type FeedbackEvaluation = z.infer<typeof feedbackEvaluationSchema>
