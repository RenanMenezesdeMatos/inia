import { z } from "zod"

/**
 * AVALIAÇÃO DO FEEDBACK PELO PRÓPRIO DESTINATÁRIO — regras puras.
 *
 * Desde 10/11/2026 (migration 186) a avaliação é a CONCORDÂNCIA registrada na confirmação de ciência: "Concordo com o feedback"
 * ou "Não concordo com o feedback" — nada vem pré-escolhido. Discordar exige um motivo da lista fechada e a justificativa. É uma
 * escolha por fonte, gravada na mesma transação da ciência e nunca alterada; a discordância é uma CONTESTAÇÃO respondida pela
 * revisão humana (migration 150).
 *
 * Antes havia o "Este conteúdo foi útil?" (`feedback_ratings`, migration 113: UP | DOWN | NONE). Ele não grava mais nada; o
 * histórico continua lido como está — a avaliação "não foi útil" antiga continua sendo contestação — e nunca vira concordância.
 */

/** Motivos de contestação (os mesmos códigos da avaliação "não foi útil" de 113, reaproveitados na discordância). */
export const CONTESTATION_REASONS = ["POOR_WRITING", "WRONG_PROCESS", "UNCLEAR", "INIA_COULD_NOT_ANSWER", "INACCURATE", "NOT_HELPFUL", "OTHER"] as const
export type ContestationReason = (typeof CONTESTATION_REASONS)[number]

/** Limites do texto do colaborador (justificativa da discordância; descrição do "não foi útil" antigo). */
export const CONTESTATION_TEXT_LIMITS = { min: 3, max: 1000 } as const

/** Rótulo do motivo para os avisos do sino e a auditoria (o catálogo da tela, com as perguntas, fica no frontend). */
export const CONTESTATION_REASON_LABELS: Record<ContestationReason, string> = {
  POOR_WRITING: "O texto está confuso ou mal escrito",
  WRONG_PROCESS: "O processo citado está errado",
  UNCLEAR: "O feedback não ficou claro",
  INIA_COULD_NOT_ANSWER: "A INIA não soube responder minha dúvida",
  INACCURATE: "Não condiz com o que aconteceu",
  NOT_HELPFUL: "A orientação não me ajuda a melhorar",
  OTHER: "Outro motivo",
}

export const READ_AGREEMENT_VALUES = ["AGREE", "DISAGREE"] as const
export type ReadAgreementValue = (typeof READ_AGREEMENT_VALUES)[number]

const justificationSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(CONTESTATION_TEXT_LIMITS.min, "Escreva a sua justificativa.").max(CONTESTATION_TEXT_LIMITS.max))

/** `agreement` do corpo de `POST /feedback-read-confirmations` — obrigatório. */
export const readAgreementInputSchema = z.discriminatedUnion("value", [
  z.object({ value: z.literal("AGREE") }).strict(),
  z.object({ value: z.literal("DISAGREE"), reason: z.enum(CONTESTATION_REASONS), justification: justificationSchema }).strict(),
])
export type ReadAgreementInput = z.infer<typeof readAgreementInputSchema>

/** Mesma escolha (valor, motivo e texto)? Diferente = o pedido trouxe outra escolha do que a registrada (outra aba, reenvio). */
export function sameAgreement(recorded: Pick<ReadAgreementView, "value" | "reason" | "justification">, input: ReadAgreementInput): boolean {
  if (recorded.value !== input.value) return false
  if (input.value === "AGREE") return true
  return recorded.reason === input.reason && recorded.justification === input.justification
}

/**
 * REVISÃO da contestação (migration 150, LGPD art. 20): quem tem `feedback_contestations.review` no escopo responde a cada
 * contestação com uma conclusão e um texto que o colaborador lê. Nunca altera o feedback.
 */
export const CONTESTATION_DECISIONS = ["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"] as const
export type ContestationDecision = (typeof CONTESTATION_DECISIONS)[number]
export const CONTESTATION_DECISION_LABELS: Record<ContestationDecision, string> = {
  ACCEPTED: "Contestação procedente",
  PARTIALLY_ACCEPTED: "Procedente em parte",
  REJECTED: "Feedback mantido",
}
export const CONTESTATION_RESPONSE_LIMITS = { min: 3, max: 2000 } as const

export const contestationReviewInputSchema = z
  .object({
    decision: z.enum(CONTESTATION_DECISIONS),
    response: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(CONTESTATION_RESPONSE_LIMITS.min, "Escreva a resposta ao colaborador.").max(CONTESTATION_RESPONSE_LIMITS.max)),
  })
  .strict()
export type ContestationReviewInput = z.infer<typeof contestationReviewInputSchema>

/** Origem de uma contestação: a avaliação "não foi útil" antiga ou a discordância registrada na ciência. */
export const CONTESTATION_ORIGINS = ["USEFULNESS_RATING", "READ_AGREEMENT"] as const
export type ContestationOrigin = (typeof CONTESTATION_ORIGINS)[number]

/** Tipo de entidade da auditoria da resposta, pela origem da contestação. */
export const CONTESTATION_AUDIT_ENTITY: Record<ContestationOrigin, string> = { USEFULNESS_RATING: "feedback_rating", READ_AGREEMENT: "feedback_read_agreement" }

/** Resposta à contestação como o colaborador a vê (sem o nome de quem respondeu). */
export type ContestationReviewView = { decision: ContestationDecision; response: string; respondedAt: string }

/** A escolha registrada na ciência, como o próprio colaborador a vê (com a resposta da revisão quando discordou). */
export type ReadAgreementView = {
  value: ReadAgreementValue
  reason: ContestationReason | null
  justification: string | null
  recordedAt: string
  review: ContestationReviewView | null
}

/** Avaliação "não foi útil" antiga e vigente — continua visível ao colaborador, com a resposta da revisão. */
export type LegacyContestationView = { reason: ContestationReason; comment: string; contestedAt: string; review: ContestationReviewView | null }

/** O que o item do Acompanhamento do PRÓPRIO colaborador mostra sobre a avaliação dele. */
export type FeedbackEvaluationView = { agreement: ReadAgreementView | null; legacyContestation: LegacyContestationView | null }

export const EMPTY_EVALUATION: FeedbackEvaluationView = { agreement: null, legacyContestation: null }
