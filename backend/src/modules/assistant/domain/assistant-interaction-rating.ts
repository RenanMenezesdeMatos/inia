import { z } from "zod"

/**
 * Curtir/descurtir de uma resposta da INIA no chat pela PRÓPRIA dona da conversa (migration 158). `NONE` = retirar (fica no
 * histórico). Desde a migration 181, a descurtida do CHAT LIVRE vem do formulário com o motivo (lista fechada, separada da lista do
 * Acompanhamento), um comentário opcional (obrigatório em "Outro") e a resposta a "Você ainda precisa de ajuda com isso?" — gravados
 * junto da versão DOWN (`assistant_interaction_rating_details`). O servidor continua aceitando DOWN sem detalhes (sessão de feedback,
 * recado e abas abertas antes da publicação): nenhuma descurtida se perde em silêncio. Especificação:
 * docs/designs/apoio-com-anjo/design_draft.md, seção 2.
 */
export const ASSISTANT_RATING_VALUES = ["UP", "DOWN", "NONE"] as const
export type AssistantRatingValue = (typeof ASSISTANT_RATING_VALUES)[number]

/** Motivos da descurtida no chat (contrato versionado: gravado em `catalog_version`). */
export const CHAT_DISLIKE_REASONS_VERSION = "CHAT_DISLIKE_REASONS_V1" as const
export const CHAT_DISLIKE_REASONS = ["WRONG_INFORMATION", "DID_NOT_ANSWER", "NOT_FOUND", "INCOMPLETE", "HARD_TO_UNDERSTAND", "OTHER"] as const
export type ChatDislikeReason = (typeof CHAT_DISLIKE_REASONS)[number]
export const CHAT_DISLIKE_REASON_LABELS: Record<ChatDislikeReason, string> = {
  WRONG_INFORMATION: "Informação errada",
  DID_NOT_ANSWER: "Não respondeu o que perguntei",
  NOT_FOUND: "Não encontrou a informação",
  INCOMPLETE: "Resposta incompleta",
  HARD_TO_UNDERSTAND: "Difícil de entender",
  OTHER: "Outro",
}
export const CHAT_DISLIKE_COMMENT_LIMITS = { min: 3, max: 1000 } as const

export type AssistantRatingDetails = { reason: ChatDislikeReason; comment: string | null; stillNeedsHelp: boolean }

const detailsSchema = z
  .object({
    reason: z.enum(CHAT_DISLIKE_REASONS),
    // Vazio = sem comentário; com texto, 3–1000 caracteres depois de tirar os espaços das pontas.
    comment: z
      .string()
      .max(CHAT_DISLIKE_COMMENT_LIMITS.max * 2)
      .transform((value) => value.trim())
      .pipe(z.union([z.literal(""), z.string().min(CHAT_DISLIKE_COMMENT_LIMITS.min, "Escreva pelo menos 3 caracteres.").max(CHAT_DISLIKE_COMMENT_LIMITS.max)]))
      .optional(),
    stillNeedsHelp: z.boolean(),
  })
  .strict()
  .superRefine((details, context) => {
    if (details.reason === "OTHER" && !details.comment) context.addIssue({ code: "custom", path: ["comment"], message: "Conte o que aconteceu." })
  })
  .transform((details): AssistantRatingDetails => ({ reason: details.reason, comment: details.comment ? details.comment : null, stillNeedsHelp: details.stillNeedsHelp }))

/** Corpo de `PUT /realtime/conversations/:conversationId/messages/:interactionId/rating`. `details` só acompanha `DOWN`. */
export const assistantRatingInputSchema = z
  .object({ value: z.enum(ASSISTANT_RATING_VALUES), details: detailsSchema.optional() })
  .strict()
  .superRefine((input, context) => {
    if (input.details && input.value !== "DOWN") context.addIssue({ code: "custom", path: ["details"], message: "O motivo acompanha só a descurtida." })
  })
export type AssistantRatingInput = z.infer<typeof assistantRatingInputSchema>

/** A avaliação vigente como a tela a mostra: retirada (ou nunca dada) = sem marcação. */
export type AssistantRatingView = "up" | "down" | null

export function ratingView(value: AssistantRatingValue | null | undefined): AssistantRatingView {
  return value === "UP" ? "up" : value === "DOWN" ? "down" : null
}

/** A versão vigente de uma avaliação (o que já está gravado). */
export type CurrentRating = { value: AssistantRatingValue; details: AssistantRatingDetails | null }

const sameDetails = (a: AssistantRatingDetails, b: AssistantRatingDetails) => a.reason === b.reason && a.comment === b.comment && a.stillNeedsHelp === b.stillNeedsHelp

/**
 * Grava ou não uma nova versão, nesta ordem (seção 2 da especificação):
 *  1. DOWN sem detalhes sobre uma DOWN vigente COM detalhes: não grava (uma chamada atrasada nunca apaga o motivo);
 *  2. DOWN sem detalhes nos demais casos: como sempre (o mesmo valor vigente não grava de novo);
 *  3. DOWN com detalhes diferentes dos vigentes: grava nova versão (trocar só o motivo, o comentário ou a resposta conta).
 * UP e NONE: o mesmo valor vigente não grava; retirar o que não existe também não.
 */
export function shouldWriteRating(current: CurrentRating | null, next: { value: AssistantRatingValue; details?: AssistantRatingDetails | null }): boolean {
  const currentValue = current?.value ?? "NONE"
  if (next.value !== "DOWN") return currentValue !== next.value
  if (!next.details) return currentValue !== "DOWN"
  if (currentValue !== "DOWN" || !current?.details) return true
  return !sameDetails(current.details, next.details)
}
