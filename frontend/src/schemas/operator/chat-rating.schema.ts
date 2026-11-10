import { z } from "zod"

/**
 * Espelho de backend/src/modules/assistant/domain/assistant-interaction-rating.ts e reply-signals.ts (migration 181 — Apoio com
 * Anjo, Parte A): o motivo da descurtida de uma resposta da INIA no CHAT LIVRE e os sinais calculados pelo servidor em cada mensagem.
 * Lista própria do chat — nunca a do "Este conteúdo foi útil?" do Acompanhamento (avaliações que não se misturam).
 */
export const CHAT_DISLIKE_REASONS = ["WRONG_INFORMATION", "DID_NOT_ANSWER", "NOT_FOUND", "INCOMPLETE", "HARD_TO_UNDERSTAND", "OTHER"] as const
export const chatDislikeReasonSchema = z.enum(CHAT_DISLIKE_REASONS)
export type ChatDislikeReason = z.infer<typeof chatDislikeReasonSchema>

export const CHAT_DISLIKE_REASON_LABELS: Record<ChatDislikeReason, string> = {
  WRONG_INFORMATION: "Informação errada",
  DID_NOT_ANSWER: "Não respondeu o que perguntei",
  NOT_FOUND: "Não encontrou a informação",
  INCOMPLETE: "Resposta incompleta",
  HARD_TO_UNDERSTAND: "Difícil de entender",
  OTHER: "Outro",
}

/** Comentário: opcional (obrigatório em "Outro"); com texto, 3–1000 caracteres sem os espaços das pontas. */
export const CHAT_DISLIKE_COMMENT_LIMITS = { min: 3, max: 1000 } as const

/** O motivo gravado (o que o servidor devolve). */
export const chatRatingDetailsSchema = z.object({ reason: chatDislikeReasonSchema, comment: z.string().nullable(), stillNeedsHelp: z.boolean() })
export type ChatRatingDetails = z.infer<typeof chatRatingDetailsSchema>

/** O que o formulário envia: o servidor tira os espaços e trata vazio como ausente. */
export const chatDislikeInputSchema = z
  .object({ reason: chatDislikeReasonSchema, comment: z.string().max(CHAT_DISLIKE_COMMENT_LIMITS.max * 2), stillNeedsHelp: z.boolean() })
  .superRefine((input, context) => {
    const comment = input.comment.trim()
    if (input.reason === "OTHER" && !comment) context.addIssue({ code: "custom", path: ["comment"], message: "Conte o que aconteceu." })
    else if (comment && comment.length < CHAT_DISLIKE_COMMENT_LIMITS.min) context.addIssue({ code: "custom", path: ["comment"], message: `Escreva pelo menos ${CHAT_DISLIKE_COMMENT_LIMITS.min} caracteres.` })
    else if (comment.length > CHAT_DISLIKE_COMMENT_LIMITS.max) context.addIssue({ code: "custom", path: ["comment"], message: `Use no máximo ${CHAT_DISLIKE_COMMENT_LIMITS.max} caracteres.` })
  })
export type ChatDislikeInput = z.infer<typeof chatDislikeInputSchema>

/** Resposta de `PUT …/messages/:interactionId/rating`: a avaliação vigente depois da chamada. */
export const chatRatingResultSchema = z.object({
  interactionId: z.string(),
  rating: z.enum(["up", "down"]).nullable(),
  ratingId: z.string().nullable().default(null),
  details: chatRatingDetailsSchema.nullable().default(null),
})
export type ChatRatingResult = z.infer<typeof chatRatingResultSchema>

/** Sinais da mensagem (`SUPPORT_SIGNALS_V1`), calculados pelo servidor — a tela nunca os deduz do texto. */
export const SUPPORT_SIGNALS = ["KNOWLEDGE_NOT_FOUND", "KNOWLEDGE_INSUFFICIENT", "CONSULTATION_FAILED", "SPECIALIST_BLOCKED", "NO_REPLY"] as const
export const supportSignalSchema = z.enum(SUPPORT_SIGNALS)
export type SupportSignal = z.infer<typeof supportSignalSchema>

/** Motivo gravado de uma mensagem do histórico (dado de outra versão = sem motivo, nunca erro na tela). */
export function parseChatRatingDetails(value: unknown): ChatRatingDetails | null {
  const parsed = chatRatingDetailsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Sinais de uma mensagem: `null` = não calculados (mensagem anterior à gravação dos sinais); códigos desconhecidos são ignorados. */
export function parseSupportSignals(value: unknown): SupportSignal[] | null {
  if (!Array.isArray(value)) return null
  return SUPPORT_SIGNALS.filter((signal) => value.includes(signal))
}
