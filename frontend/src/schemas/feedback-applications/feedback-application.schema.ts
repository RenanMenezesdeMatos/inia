import { z } from "zod"

import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"

/**
 * Espelho de backend/src/modules/feedback-application (aplicação de feedback conversacional). Duas fontes com identidades
 * DIFERENTES — o tipo faz parte da chave (`PUBLISHED_FEEDBACK:<id>` ≠ `INTERACTION_FEEDBACK_DELIVERY:<id>`).
 */
export const feedbackSourceKindSchema = z.enum(["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"])
export const feedbackSourceSchema = z.object({ kind: feedbackSourceKindSchema, id: z.string() })
export type FeedbackSourceRef = z.infer<typeof feedbackSourceSchema>
export const feedbackSourceKey = (source: FeedbackSourceRef) => `${source.kind}:${source.id}`

export const feedbackApplicationStatusSchema = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"])
export type FeedbackApplicationStatus = z.infer<typeof feedbackApplicationStatusSchema>

export const feedbackApplicationSchema = z.object({
  id: z.string(),
  source: feedbackSourceSchema,
  status: feedbackApplicationStatusSchema,
  conversationId: z.string().nullable(),
  /** Conversa COMPLEMENTAR ativa (dúvidas depois da conclusão) — só existe depois da primeira dúvida. */
  followUpConversationId: z.string().nullable().default(null),
  title: z.string().nullable(),
  periodLabel: z.string().nullable(),
  publishedDay: z.string().nullable(),
  historical: z.boolean(),
  startedAt: z.string().nullable(),
  lastOpenedAt: z.string().nullable(),
  pausedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  presentation: z.object({ startedAt: z.string().nullable(), completedAt: z.string().nullable(), interruptedAt: z.string().nullable(), playCount: z.number() }),
  invite: z.object({ offeredAt: z.string().nullable(), resolvedAt: z.string().nullable(), resolution: z.enum(["ACCEPTED", "READ", "SNOOZED"]).nullable() }),
  sourceVersion: z.number().nullable(),
  /** Ciência da fonte (confirmada com login e senha) — a conclusão do feedback. */
  acknowledgedAt: z.string().nullable().default(null),
})
export type FeedbackApplication = z.infer<typeof feedbackApplicationSchema>

/**
 * Conteúdo do feedback exibido na sessão — o REGISTRO aplicado (nunca dado atual). `view` = a apresentação publicada na mesma
 * versão (o mesmo formato do Acompanhamento); sem ela, o texto e as seções do registro congelado.
 */
export const feedbackApplicationContentSchema = z.object({
  view: feedbackViewSchema.nullable().catch(null),
  text: z.string(),
  summary: z.string().nullable(),
  indicators: z.array(z.object({ name: z.string(), lines: z.array(z.object({ label: z.string(), value: z.string() })), notes: z.array(z.string()) })),
  evidence: z.array(z.string()),
  guidance: z.array(z.string()),
  strengths: z.array(z.string()),
  materials: z.array(z.object({ documentId: z.string(), title: z.string(), sections: z.array(z.string()), reason: z.string().nullable(), href: z.string().nullable() })),
})
export type FeedbackApplicationContent = z.infer<typeof feedbackApplicationContentSchema>

export const feedbackApplicationDetailSchema = feedbackApplicationSchema.extend({
  script: z.object({ chatText: z.string(), speechText: z.string(), speechTruncated: z.boolean(), suggestions: z.array(z.string()) }).nullable(),
  limitations: z.array(z.string()),
  sourceCorrected: z.boolean(),
  content: feedbackApplicationContentSchema.nullable().default(null),
})
export type FeedbackApplicationDetail = z.infer<typeof feedbackApplicationDetailSchema>

export const startedFeedbackApplicationSchema = z.object({ application: feedbackApplicationDetailSchema, created: z.boolean() })
export const feedbackApplicationListSchema = z.object({ items: z.array(feedbackApplicationSchema) })

export const feedbackInviteSchema = z.object({ source: feedbackSourceSchema, subject: z.string(), periodLabel: z.string().nullable(), publishedAt: z.string(), offeredAt: z.string().nullable() })
export type FeedbackInvite = z.infer<typeof feedbackInviteSchema>
export const feedbackInviteResponseSchema = z.object({ invite: feedbackInviteSchema.nullable() })

export type FeedbackInviteEvent = "OFFER" | "ACCEPT" | "READ" | "SNOOZE"
export type FeedbackPresentationEvent = "STARTED" | "COMPLETED" | "INTERRUPTED" | "FAILED"

/** Ação principal de um feedback no Acompanhamento, pelo estado da SUA aplicação (sem linha = não iniciada). */
export type FeedbackApplicationAction = "listen" | "continue" | "view"
export function feedbackApplicationActionOf(status: FeedbackApplicationStatus | null | undefined): FeedbackApplicationAction {
  if (status === "COMPLETED") return "view"
  if (status === "IN_PROGRESS") return "continue"
  return "listen"
}
