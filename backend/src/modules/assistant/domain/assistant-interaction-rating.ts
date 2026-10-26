import { z } from "zod"

/**
 * Curtir/descurtir de uma resposta da INIA no chat pela PRÓPRIA dona da conversa (migration 158). Só o valor — a tela do chat não
 * pede motivo nem descrição (diferente do "Este conteúdo foi útil?" do Acompanhamento). `NONE` = retirar (fica no histórico).
 */
export const ASSISTANT_RATING_VALUES = ["UP", "DOWN", "NONE"] as const
export type AssistantRatingValue = (typeof ASSISTANT_RATING_VALUES)[number]

/** Corpo de `PUT /realtime/conversations/:conversationId/messages/:interactionId/rating`. */
export const assistantRatingInputSchema = z.object({ value: z.enum(ASSISTANT_RATING_VALUES) }).strict()

/** A avaliação vigente como a tela a mostra: retirada (ou nunca dada) = sem marcação. */
export type AssistantRatingView = "up" | "down" | null

export function ratingView(value: AssistantRatingValue | null | undefined): AssistantRatingView {
  return value === "UP" ? "up" : value === "DOWN" ? "down" : null
}

/** Nada a gravar: o mesmo valor já está vigente (duplo clique, outra aba) — retirar o que não existe também não grava. */
export function sameRating(current: AssistantRatingValue | null, next: AssistantRatingValue): boolean {
  return (current ?? "NONE") === next
}
