import { z } from "zod"

import { FEEDBACK_SOURCE_KINDS, type FeedbackSourceRef } from "../../feedback-application/domain/feedback-application.js"

/**
 * Avaliação de um feedback pelo PRÓPRIO destinatário ("Este conteúdo foi útil?", migration 113). Curtir só registra; descurtir
 * exige o motivo (lista fechada) e a descrição do que está errado — é o retorno que permite à INIA aprender com o uso real.
 * As fontes e a identidade são as mesmas da aplicação de feedback: o tipo faz parte da chave.
 */
export const FEEDBACK_RATING_VALUES = ["UP", "DOWN"] as const
export type FeedbackRatingValue = (typeof FEEDBACK_RATING_VALUES)[number]

export const FEEDBACK_DISLIKE_REASONS = ["POOR_WRITING", "WRONG_PROCESS", "UNCLEAR", "INIA_COULD_NOT_ANSWER", "INACCURATE", "NOT_HELPFUL", "OTHER"] as const
export type FeedbackDislikeReason = (typeof FEEDBACK_DISLIKE_REASONS)[number]

export const FEEDBACK_RATING_COMMENT_LIMITS = { min: 3, max: 1000 } as const

const sourceSchema = z.object({ kind: z.enum(FEEDBACK_SOURCE_KINDS), id: z.string().uuid() }).strict()
const commentSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(FEEDBACK_RATING_COMMENT_LIMITS.min, "Descreva o que está errado.").max(FEEDBACK_RATING_COMMENT_LIMITS.max))

/** Corpo de `POST /feedback-ratings`. `NONE` = retirar a avaliação (fica no histórico). */
export const feedbackRatingInputSchema = z.discriminatedUnion("value", [
  z.object({ source: sourceSchema, value: z.literal("UP") }).strict(),
  z.object({ source: sourceSchema, value: z.literal("DOWN"), reason: z.enum(FEEDBACK_DISLIKE_REASONS), comment: commentSchema }).strict(),
  z.object({ source: sourceSchema, value: z.literal("NONE") }).strict(),
])
export type FeedbackRatingInput = z.infer<typeof feedbackRatingInputSchema>

export type FeedbackRatingView = {
  source: FeedbackSourceRef
  value: FeedbackRatingValue
  reason: FeedbackDislikeReason | null
  comment: string | null
  ratedAt: string
}

type Comparable = { value: FeedbackRatingValue | "NONE"; reason: FeedbackDislikeReason | null; comment: string | null }

/** Mesma avaliação já vigente = nada a gravar (clique repetido, outra aba, retentativa). */
export function sameRating(current: Comparable | null, next: FeedbackRatingInput): boolean {
  const target: Comparable = next.value === "DOWN" ? { value: "DOWN", reason: next.reason, comment: next.comment } : { value: next.value, reason: null, comment: null }
  if (!current) return target.value === "NONE"
  return current.value === target.value && current.reason === target.reason && current.comment === target.comment
}
