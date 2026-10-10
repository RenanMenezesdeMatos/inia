import { z } from "zod"

import { feedbackSourceSchema, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * Espelho de backend/src/modules/feedback-rating (migration 113): "Este conteúdo foi útil?" do Acompanhamento. Curtir só
 * registra; descurtir leva o motivo (lista fechada) e a descrição do colaborador. Quem avalia é sempre a pessoa da sessão.
 */
export const FEEDBACK_DISLIKE_REASONS = ["POOR_WRITING", "WRONG_PROCESS", "UNCLEAR", "INIA_COULD_NOT_ANSWER", "INACCURATE", "NOT_HELPFUL", "OTHER"] as const
export const feedbackDislikeReasonSchema = z.enum(FEEDBACK_DISLIKE_REASONS)
export type FeedbackDislikeReason = z.infer<typeof feedbackDislikeReasonSchema>

export const FEEDBACK_RATING_COMMENT_LIMITS = { min: 3, max: 1000 } as const

export const feedbackRatingSchema = z.object({
  source: feedbackSourceSchema,
  value: z.enum(["UP", "DOWN"]),
  reason: feedbackDislikeReasonSchema.nullable(),
  comment: z.string().nullable(),
  ratedAt: z.string(),
})
export type FeedbackRating = z.infer<typeof feedbackRatingSchema>

export const feedbackRatingListSchema = z.object({ items: z.array(feedbackRatingSchema) })
export const feedbackRatingResultSchema = z.object({ rating: feedbackRatingSchema.nullable() })

export type FeedbackRatingInput =
  | { source: FeedbackSourceRef; value: "UP" }
  | { source: FeedbackSourceRef; value: "DOWN"; reason: FeedbackDislikeReason; comment: string }
  | { source: FeedbackSourceRef; value: "NONE" }

/** Rótulo de cada motivo e a pergunta da segunda etapa (o que o colaborador descreve). */
export const DISLIKE_REASON_COPY: Record<FeedbackDislikeReason, { label: string; prompt: string }> = {
  POOR_WRITING: { label: "A escrita está ruim", prompt: "O que atrapalhou a leitura? Uma frase confusa, o texto longo demais, o tom…" },
  WRONG_PROCESS: { label: "O processo citado está errado", prompt: "Qual orientação está errada e qual seria a correta?" },
  UNCLEAR: { label: "O feedback não ficou claro", prompt: "Qual parte você não entendeu?" },
  INIA_COULD_NOT_ANSWER: { label: "A INIA não soube responder minha dúvida", prompt: "Qual dúvida você fez e o que faltou na resposta?" },
  INACCURATE: { label: "Não condiz com o que aconteceu", prompt: "O que está diferente do que aconteceu na chamada ou nos seus resultados?" },
  NOT_HELPFUL: { label: "Não me ajudou a melhorar", prompt: "O que faltou para este feedback ser útil para você?" },
  OTHER: { label: "Outro motivo", prompt: "Conte o que está errado neste feedback." },
}
