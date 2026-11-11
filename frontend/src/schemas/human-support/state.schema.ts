import { z } from "zod"
import { chatDislikeReasonSchema } from "@/schemas/operator/chat-rating.schema"
import { classificationOutcomeSchema, classificationReasonSchema, evaluationResolvedSchema, pauseReasonSchema, presenceStatusSchema, requestOriginSchema, requestStatusSchema } from "./catalogs.schema"

/**
 * Espelho de backend/src/modules/human-support/domain/views.ts (Apêndice C): a chamada de estado (`GET /api/v1/human-support/me/state`)
 * e o pedido do operador. A visão do operador nunca tem presença ou pausa de Anjo.
 */
export const waitEstimateSchema = z.union([
  z.object({ kind: z.enum(["ABOUT", "MORE_THAN"]), minutes: z.number(), basis: z.enum(["SUBGROUP", "GROUP", "ORGANIZATION"]) }),
  z.object({ kind: z.literal("NO_HISTORY") }),
])
export type WaitEstimate = z.infer<typeof waitEstimateSchema>

export const availabilitySchema = z.object({
  status: z.enum(["DISABLED", "NONE_IN_SERVICE", "AVAILABLE_NOW", "ALL_BUSY", "NONE_AVAILABLE"]),
  estimate: waitEstimateSchema.nullable(),
  queueDeadline: z.string().nullable(),
})
export type Availability = z.infer<typeof availabilitySchema>

export const sharedContextSchema = z.object({
  question: z.string().nullable(),
  answer: z.string().nullable(),
  dislike: z.object({ reason: chatDislikeReasonSchema, reasonLabel: z.string(), comment: z.string().nullable() }).nullable(),
  note: z.string().nullable(),
})
export type SharedContext = z.infer<typeof sharedContextSchema>

export const messageViewSchema = z.object({
  id: z.string(),
  seq: z.number(),
  authorKind: z.enum(["OPERATOR", "ANJO", "SYSTEM"]),
  authorName: z.string().nullable(),
  body: z.string(),
  systemCode: z.string().nullable(),
  occurredAt: z.string(),
})
export type MessageView = z.infer<typeof messageViewSchema>

/** Até onde a OUTRA ponta recebeu (entregue) e viu (lida) as mensagens do pedido — cursores sobre o `seq` (migration 184). */
export const receiptsSchema = z.object({ deliveredSeq: z.number(), readSeq: z.number() })
export type Receipts = z.infer<typeof receiptsSchema>

export const operatorRequestViewSchema = z.object({
  id: z.string(),
  protocol: z.string(),
  status: requestStatusSchema,
  endCause: z.string().nullable(),
  origin: requestOriginSchema,
  createdAt: z.string(),
  queuedAt: z.string(),
  queueExpiresAt: z.string().nullable(),
  sharedContext: sharedContextSchema,
  anjo: z.object({ name: z.string(), avatarUrl: z.string().nullable(), awaitingFirstResponse: z.boolean() }).nullable(),
  messages: z.array(messageViewSchema),
  hasOlder: z.boolean(),
  canCancel: z.boolean(),
  canClose: z.boolean(),
  /** Recibos do lado do Anjo: os tiques das mensagens do operador. */
  peerReceipts: receiptsSchema,
  /** Por quantos ms ainda vale o "digitando" do Anjo (null = não está digitando). */
  peerTypingMs: z.number().nullable(),
  /** Até onde o PRÓPRIO operador já leu (o "lida" que a sala confirmou): mensagens do Anjo depois disso são novas. */
  readSeq: z.number(),
})
export type OperatorRequestView = z.infer<typeof operatorRequestViewSchema>

export const evaluationCurrentSchema = z.object({ resolved: evaluationResolvedSchema.nullable(), stars: z.number().nullable() })
export type EvaluationCurrent = z.infer<typeof evaluationCurrentSchema>

export const pendingEvaluationSchema = z.object({ attendanceId: z.string(), requestId: z.string(), protocol: z.string(), anjoName: z.string(), openUntil: z.string(), current: evaluationCurrentSchema })
export type PendingEvaluation = z.infer<typeof pendingEvaluationSchema>

export const operatorViewSchema = z.object({ enabled: z.boolean(), availability: availabilitySchema.nullable(), openRequest: operatorRequestViewSchema.nullable(), pendingEvaluations: z.array(pendingEvaluationSchema) })
export type OperatorView = z.infer<typeof operatorViewSchema>

export const anjoAttendanceViewSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  protocol: z.string(),
  operatorName: z.string(),
  teamName: z.string().nullable(),
  subteamName: z.string().nullable(),
  startedAt: z.string(),
  firstAnjoMessageAt: z.string().nullable(),
  lastSeq: z.number(),
  operatorAbsentSince: z.string().nullable(),
  sharedContext: sharedContextSchema,
  /** Recibos do lado do operador: os tiques das mensagens do Anjo. */
  peerReceipts: receiptsSchema,
  /** Por quantos ms ainda vale o "digitando" do operador (null = não está digitando). */
  peerTypingMs: z.number().nullable(),
})
export type AnjoAttendanceView = z.infer<typeof anjoAttendanceViewSchema>

export const anjoViewSchema = z.object({
  /** Instante do servidor na resposta: corrige o relógio da tela nos contadores ("há quanto tempo"). */
  serverTime: z.string(),
  presence: z.object({ status: presenceStatusSchema, pauseReason: pauseReasonSchema.nullable(), connected: z.boolean(), since: z.string() }),
  capacity: z.object({ max: z.number(), used: z.number() }),
  attendances: z.array(anjoAttendanceViewSchema),
  /** `startedAt`/`endedAt`: início e fim reais do atendimento — a duração final, congelada. */
  pendingClassifications: z.array(z.object({ attendanceId: z.string(), protocol: z.string(), operatorName: z.string(), startedAt: z.string(), endedAt: z.string(), endCause: z.string() })),
})
export type AnjoView = z.infer<typeof anjoViewSchema>

export const stateResponseSchema = z.object({ version: z.string(), reconnect: z.literal(true).optional(), operator: operatorViewSchema.nullable(), anjo: anjoViewSchema.nullable() })
export type StateResponse = z.infer<typeof stateResponseSchema>

export const previewResponseSchema = z.object({ origin: requestOriginSchema, interactionId: z.string().nullable(), ratingId: z.string().nullable(), sharedContext: sharedContextSchema, availability: availabilitySchema })
export type PreviewResponse = z.infer<typeof previewResponseSchema>

export const messagesPageSchema = z.object({ messages: z.array(messageViewSchema), hasMore: z.boolean() })
export type MessagesPage = z.infer<typeof messagesPageSchema>

export const myRequestsSchema = z.object({
  items: z.array(z.object({ id: z.string(), protocol: z.string(), status: requestStatusSchema, origin: requestOriginSchema, createdAt: z.string(), endedAt: z.string().nullable(), anjoName: z.string().nullable(), evaluation: evaluationCurrentSchema.nullable(), evaluationOpenUntil: z.string().nullable() })),
  nextCursor: z.string().nullable(),
})
export type MyRequests = z.infer<typeof myRequestsSchema>

export const anjoAttendanceHistorySchema = z.object({
  items: z.array(
    z.object({
      attendanceId: z.string(),
      requestId: z.string(),
      protocol: z.string(),
      operatorName: z.string(),
      startedAt: z.string(),
      firstAnjoMessageAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      endCause: z.string().nullable(),
      classified: z.boolean(),
      /** Motivo, resultado e ferramenta/processo da classificação (null = sem classificação ainda). */
      classification: z.object({ reason: classificationReasonSchema, outcome: classificationOutcomeSchema, referenceTitle: z.string().nullable() }).nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
})
export type AnjoAttendanceHistory = z.infer<typeof anjoAttendanceHistorySchema>

/** Texto da disponibilidade para o operador (seção 9) — o operador nunca vê quantos Anjos estão em pausa, nem por quê. */
export const AVAILABILITY_TEXT: Record<Availability["status"], string> = {
  DISABLED: "O apoio com Anjo ainda não está disponível para sua equipe.",
  NONE_IN_SERVICE: "Nenhum Anjo em serviço agora.",
  AVAILABLE_NOW: "Há Anjos disponíveis: seu pedido vai direto para um deles.",
  ALL_BUSY: "Todos os Anjos estão em atendimento.",
  NONE_AVAILABLE: "Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila.",
}

const BASIS_TEXT = { SUBGROUP: "do seu Subgrupo", GROUP: "do seu Grupo", ORGANIZATION: "da organização" } as const
/** "Espera estimada: cerca de 4 min" + a nota da base; nunca zero, nunca tempo inventado. */
export function waitEstimateText(estimate: WaitEstimate | null): { headline: string; note: string | null } | null {
  if (!estimate) return null
  if (estimate.kind === "NO_HISTORY") return { headline: "Ainda não há histórico para estimar a espera.", note: null }
  const headline = estimate.kind === "ABOUT" ? `Espera estimada: cerca de ${estimate.minutes} min` : `Espera estimada: mais de ${estimate.minutes} min`
  return { headline, note: `Estimativa pelos pedidos dos últimos 14 dias ${BASIS_TEXT[estimate.basis]}.` }
}
