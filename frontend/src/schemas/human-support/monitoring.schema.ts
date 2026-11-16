import { z } from "zod"
import { classificationOutcomeSchema, classificationReasonSchema, evaluationResolvedSchema, pauseReasonSchema, presenceStatusSchema, requestOriginSchema, requestStatusSchema } from "./catalogs.schema"
import { messageViewSchema, sharedContextSchema, waitEstimateSchema } from "./state.schema"

/**
 * Espelho do painel do apoio (`/api/v1/admin/human-support-monitoring`; Coordenador de Anjos e Administrador geral, D7). Toda taxa
 * vem com numerador e denominador; `SMALL_SAMPLE` = taxa oculta ("amostra pequena"); `NO_DATA` = "sem dados", nunca 0%.
 */
export const ratioSchema = z.object({ numerator: z.number().nullable(), denominator: z.number().nullable(), value: z.number().nullable(), status: z.enum(["OK", "SMALL_SAMPLE", "NO_DATA"]) })
export type Ratio = z.infer<typeof ratioSchema>

export const measureSchema = z.object({
  id: z.string(),
  kind: z.enum(["COUNT", "RATE", "DISTRIBUTION", "PERCENTILE", "AVERAGE"]),
  main: ratioSchema,
  coverage: ratioSchema.optional(),
  conversion: ratioSchema.optional(),
  noResponse: ratioSchema.optional(),
  percentiles: z.object({ p50: z.number().nullable(), p90: z.number().nullable(), estimate: waitEstimateSchema.nullable() }).optional(),
  breakdown: z.array(z.object({ key: z.string(), label: z.string(), count: z.number(), value: z.number().nullable().optional() })).optional(),
  extra: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })).optional(),
})
export type Measure = z.infer<typeof measureSchema>

export const funnelResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  cutoffs: z.object({ dislikeDetailsSince: z.string().nullable(), signalsSince: z.string().nullable(), disabledPeriods: z.array(z.object({ from: z.string(), to: z.string().nullable() })) }),
  measures: z.array(measureSchema),
})
export type FunnelResponse = z.infer<typeof funnelResponseSchema>

export const requestListItemSchema = z.object({
  id: z.string(),
  protocol: z.string(),
  operatorName: z.string(),
  operatorAvatarUrl: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamName: z.string().nullable(),
  origin: requestOriginSchema,
  status: requestStatusSchema,
  endCause: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  anjoNames: z.array(z.string()),
  firstResponseSeconds: z.number().nullable(),
  /** Só a contagem das mensagens de operador e Anjo: o conteúdo aparece ao abrir o pedido (registro LGPD). */
  messageCount: z.number(),
  classificationReason: classificationReasonSchema.nullable(),
  outcome: classificationOutcomeSchema.nullable(),
  resolved: evaluationResolvedSchema.nullable(),
  stars: z.number().nullable(),
})
export type RequestListItem = z.infer<typeof requestListItemSchema>
/** `total` vem só na primeira página (sem cursor): quantos pedidos atendem aos filtros. */
export const requestListSchema = z.object({ items: z.array(requestListItemSchema), nextCursor: z.string().nullable(), total: z.number().nullable() })
export type RequestList = z.infer<typeof requestListSchema>

export const classificationViewSchema = z.object({ reason: classificationReasonSchema, referenceTitle: z.string().nullable(), referenceUrl: z.string().nullable(), otherDescription: z.string().nullable(), outcome: classificationOutcomeSchema })
export type ClassificationView = z.infer<typeof classificationViewSchema>

export const requestDetailSchema = requestListItemSchema.extend({
  sharedContext: sharedContextSchema,
  messages: z.array(messageViewSchema),
  attendances: z.array(z.object({ id: z.string(), anjoName: z.string(), startedAt: z.string(), firstAnjoMessageAt: z.string().nullable(), endedAt: z.string().nullable(), endCause: z.string().nullable() })),
  classification: classificationViewSchema.nullable(),
})
export type RequestDetail = z.infer<typeof requestDetailSchema>

/** Destinos de uma transferência pela coordenação (migration 190): os Anjos do Grupo/Subgrupo do pedido e se cada um pode receber agora. */
export const transferCandidatesSchema = z.object({
  currentAnjoName: z.string().nullable(),
  candidates: z.array(
    z.object({ personId: z.string(), name: z.string(), status: presenceStatusSchema, connected: z.boolean(), used: z.number(), capacity: z.number(), canReceive: z.boolean(), reason: z.string().nullable() }),
  ),
})
export type TransferCandidates = z.infer<typeof transferCandidatesSchema>
/** Motivo da transferência: obrigatório, de 3 a 500 caracteres (o servidor confere de novo). */
export const TRANSFER_REASON_MIN = 3
export const TRANSFER_REASON_MAX = 500

export const unavailableAttemptsSchema = z.object({ items: z.array(z.object({ occurredAt: z.string(), personName: z.string(), teamName: z.string().nullable(), subteamName: z.string().nullable(), origin: requestOriginSchema.nullable() })), nextCursor: z.string().nullable() })
export type UnavailableAttempts = z.infer<typeof unavailableAttemptsSchema>


/** Situação dos Anjos AGORA (não depende do período): cadastral × operacional; `since` = transição real (null = sem contador). */
export const anjoNowStatusSchema = z.enum(["AVAILABLE", "IN_ATTENDANCE", "PAUSED", "UNAVAILABLE"])
export type AnjoNowStatus = z.infer<typeof anjoNowStatusSchema>
export const anjoNowItemSchema = z.object({
  personId: z.string(),
  name: z.string(),
  scopes: z.array(z.object({ type: z.enum(["ORGANIZATION", "GROUP", "SUBGROUP"]), id: z.string().nullable(), name: z.string() })),
  active: z.boolean(),
  status: anjoNowStatusSchema,
  pauseReason: pauseReasonSchema.nullable(),
  since: z.string().nullable(),
  connected: z.boolean(),
  connectionLostSince: z.string().nullable(),
  /** Migration 191: aberta, queda de rede, sessão encerrada ou área fechada (Indisponível sem a área = offline). */
  connection: z.enum(["CONNECTED", "CONNECTION_LOST", "SESSION_ENDED", "CLOSED"]).default("CONNECTED"),
  scheduled: z.object({ status: z.enum(["PAUSED", "OFFLINE"]), pauseReason: pauseReasonSchema.nullable() }).nullable().default(null),
  attendances: z.object({ active: z.number(), capacity: z.number() }),
})
export type AnjoNowItem = z.infer<typeof anjoNowItemSchema>
/** Fila agora: aguardando um Anjo (desde a entrada original) e acolhidos ainda sem a primeira resposta do Anjo. */
export const queueNowSchema = z.object({ waiting: z.number(), oldestWaitingSince: z.string().nullable(), awaitingFirstResponse: z.number(), oldestAwaitingSince: z.string().nullable() })
export type QueueNow = z.infer<typeof queueNowSchema>
/** Quem está na fila agora (clicar no indicador de fila): `waitingSince` = entrada original. */
export const queueWaitingSchema = z.object({
  items: z.array(z.object({ requestId: z.string(), protocol: z.string(), operatorName: z.string(), operatorAvatarUrl: z.string().nullable(), teamName: z.string().nullable(), subteamName: z.string().nullable(), origin: z.string(), waitingSince: z.string(), requeued: z.boolean() })),
})
export type QueueWaitingItem = z.infer<typeof queueWaitingSchema>["items"][number]
export const anjosNowSchema = z.object({ serverTime: z.string(), items: z.array(anjoNowItemSchema), queue: queueNowSchema.nullable().default(null) })
export type AnjosNow = z.infer<typeof anjosNowSchema>

export const presenceTimelineSchema = z.object({ events: z.array(z.object({ occurredAt: z.string(), fromStatus: presenceStatusSchema.nullable(), toStatus: presenceStatusSchema, pauseReason: pauseReasonSchema.nullable(), cause: z.string() })) })
export type PresenceTimeline = z.infer<typeof presenceTimelineSchema>

/** Parcela em porcentagem no formato brasileiro: 0,111 → "11,1%". */
export function percentText(value: number): string {
  return `${(Math.round(value * 1000) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

/** Duração legível: "menos de 1 s", "45 s", "2 min 35 s", "3 min", "1 h 5 min". Sem medição: "—" (zero medido nunca vira "sem dado"). */
export function durationText(seconds: number | null): string {
  if (seconds === null) return "—"
  const total = Math.max(0, Math.round(seconds))
  if (total < 1) return "menos de 1 s"
  if (total < 60) return `${total} s`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
}

/**
 * HISTÓRICO DA OPERAÇÃO DO ANJO (migration 191): jornada por dia e no período (durações em ms, percentuais SEM arredondar — a tela
 * arredonda) e indicadores de atendimento. Atribuição direta (D2): não há oferta, aceite nem tempo de acolhimento.
 */
const pausedMsSchema = z.object({ LUNCH: z.number(), PERSONAL: z.number(), PROCESS_ACTIVITY: z.number(), MEETING: z.number() })
/** `unavailableMs` = Indisponível, que é o mesmo estado que offline: fora do tempo online. */
const durationsSchema = z.object({ availableMs: z.number(), attendanceMs: z.number(), pausedMs: pausedMsSchema, unavailableMs: z.number() })
const sharesSchema = z.object({
  available: z.number().nullable(),
  attendance: z.number().nullable(),
  pausedTotal: z.number().nullable(),
  paused: z.object({ LUNCH: z.number().nullable(), PERSONAL: z.number().nullable(), PROCESS_ACTIVITY: z.number().nullable(), MEETING: z.number().nullable() }),
  productive: z.number().nullable(),
})
export const journeySummarySchema = z.object({
  total: durationsSchema,
  baseMs: z.number(),
  shares: sharesSchema,
  daysWithOnline: z.number(),
  dailyAverage: z.object({ availableMs: z.number(), attendanceMs: z.number() }).nullable(),
})
export type JourneySummary = z.infer<typeof journeySummarySchema>
export const journeyDaySchema = durationsSchema.extend({ day: z.string(), baseMs: z.number() })
export type JourneyDay = z.infer<typeof journeyDaySchema>
const averageSchema = z.object({ averageSeconds: z.number().nullable(), count: z.number() })
export type Average = z.infer<typeof averageSchema>
export const attendanceIndicatorsSchema = z.object({
  acolhimentos: z.number(),
  operatorWait: averageSchema,
  firstResponse: averageSchema,
  handling: averageSchema.extend({ normal: averageSchema, other: averageSchema, otherByCause: z.record(z.string(), z.number()) }),
  reasons: z.object({ total: z.number(), items: z.array(z.object({ key: z.string(), label: z.string(), count: z.number(), share: z.number().nullable() })) }),
  pertinence: z.object({ pertinent: z.number(), notPertinent: z.number(), notEvaluated: z.number(), rate: ratioSchema }),
  noReply: z.object({ rate: ratioSchema, anjoSide: z.number(), operatorSide: z.number() }),
  abandonedAfterAcolhimento: z.number(),
  interruptedBySystem: z.object({ connection: z.number(), session: z.number(), roleRevoked: z.number(), unknown: z.number() }),
  /** Média das estrelas do operador (só com 5 notas ou mais). */
  stars: z.object({ average: z.number().nullable(), count: z.number() }).default({ average: null, count: 0 }),
})
export type AttendanceIndicators = z.infer<typeof attendanceIndicatorsSchema>
export const operationIndicatorsSchema = z.object({
  requests: z.number(),
  acolhidos: z.number(),
  waiting: z.number(),
  inProgress: z.number(),
  endedWithoutAcolhimento: z.number(),
  noAnjoLogged: z.object({ count: z.number(), withAnjos: z.number(), unrecorded: z.number() }),
  abandonedBeforeAcolhimento: z.object({ abandoned: z.number(), cancelled: z.number() }),
  expired: z.number(),
  endedInQueueAfterAcolhimento: z.number(),
})
export type OperationIndicators = z.infer<typeof operationIndicatorsSchema>
const refSchema = z.object({ id: z.string(), name: z.string() }).nullable()
/** Onde o Anjo está na estrutura atual: Grupo, Subgrupo e o líder mais próximo de cada cargo (filtros da tabela "Por Anjo"). */
export const anjoStructureSchema = z.object({
  team: refSchema,
  subteam: refSchema,
  leaders: z.object({ SUPERVISOR: refSchema, COORDINATOR: refSchema, MANAGER: refSchema, SENIOR_MANAGER: refSchema }),
})
export type AnjoStructure = z.infer<typeof anjoStructureSchema>
export const anjoHistorySchema = z.object({
  personId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  structure: anjoStructureSchema.nullable().default(null),
  journey: z.object({ days: z.array(journeyDaySchema), summary: journeySummarySchema }),
  attendance: attendanceIndicatorsSchema,
})
export type AnjoHistory = z.infer<typeof anjoHistorySchema>
export const operationHistorySchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  serverTime: z.string(),
  coverage: z.object({ baseSince: z.string().nullable(), connectionSince: z.string().nullable() }),
  days: z.array(z.string()),
  anjos: z.array(anjoHistorySchema),
  consolidated: z.object({ journey: journeySummarySchema, attendance: attendanceIndicatorsSchema, operation: operationIndicatorsSchema }).nullable(),
})
export type OperationHistory = z.infer<typeof operationHistorySchema>

/** "7 h 30 min", "45 min", "0 min" — a base e as durações da jornada em horas e minutos. */
export function hoursMinutesText(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
}

/** Percentual de 0 a 100 (sem arredondar no servidor) com até 1 casa: "37,5%"; null = "—". */
export function pctText(value: number | null): string {
  return value === null ? "—" : `${(Math.round(value * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
}

/** Acionamentos do período (aba Indicadores): demanda, espera, quem mais aciona, produtivos × não produtivos e números da fila. */
export const PRODUCTIVITY = ["PRODUCTIVE", "NOT_PRODUCTIVE", "NOT_EVALUATED"] as const
export type Productivity = (typeof PRODUCTIVITY)[number]
export const PRODUCTIVITY_LABELS: Record<Productivity, string> = { PRODUCTIVE: "Produtivos", NOT_PRODUCTIVE: "Não produtivos", NOT_EVALUATED: "Não avaliados" }
const rankedSchema = z.array(z.object({ key: z.string(), label: z.string(), count: z.number(), share: z.number() }))
export const demandSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  productivity: z.object({ PRODUCTIVE: z.number(), NOT_PRODUCTIVE: z.number(), NOT_EVALUATED: z.number() }),
  filter: z.enum(PRODUCTIVITY).nullable(),
  total: z.number(),
  byHour: z.array(z.number()),
  wait: z.object({
    averageSeconds: z.number().nullable(),
    p50Seconds: z.number().nullable(),
    p90Seconds: z.number().nullable(),
    count: z.number(),
    byDay: z.array(z.object({ day: z.string(), averageSeconds: z.number().nullable(), count: z.number() })),
  }),
  top: z.object({ operators: rankedSchema, groups: rankedSchema, subgroups: rankedSchema }),
  operation: operationIndicatorsSchema,
})
export type Demand = z.infer<typeof demandSchema>

/** Abandonos (espera e atendimento) no recorte: hoje na Monitoria Online, o período em Indicadores. Encerramento normal nunca entra. */
export const abandonmentSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  waiting: z.object({ requests: z.number(), closedInia: z.number(), cancelled: z.number(), abandoned: z.number(), rate: ratioSchema, expired: z.number() }),
  attendance: z.object({
    ended: z.number(),
    byOperator: z.object({ leftInia: z.number(), noReply: z.number(), total: z.number() }),
    byAnjo: z.object({ connection: z.number(), session: z.number(), roleRevoked: z.number(), unknownDrop: z.number(), noReply: z.number(), total: z.number() }),
    abandoned: z.number(),
    rate: ratioSchema,
  }),
})
export type Abandonment = z.infer<typeof abandonmentSchema>

