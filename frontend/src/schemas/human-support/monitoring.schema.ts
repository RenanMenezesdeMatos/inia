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
  teamName: z.string().nullable(),
  subteamName: z.string().nullable(),
  origin: requestOriginSchema,
  status: requestStatusSchema,
  endCause: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  anjoNames: z.array(z.string()),
  firstResponseSeconds: z.number().nullable(),
  classificationReason: classificationReasonSchema.nullable(),
  outcome: classificationOutcomeSchema.nullable(),
  resolved: evaluationResolvedSchema.nullable(),
  stars: z.number().nullable(),
})
export type RequestListItem = z.infer<typeof requestListItemSchema>
export const requestListSchema = z.object({ items: z.array(requestListItemSchema), nextCursor: z.string().nullable() })

export const classificationViewSchema = z.object({ reason: classificationReasonSchema, referenceTitle: z.string().nullable(), referenceUrl: z.string().nullable(), otherDescription: z.string().nullable(), outcome: classificationOutcomeSchema })
export type ClassificationView = z.infer<typeof classificationViewSchema>

export const requestDetailSchema = requestListItemSchema.extend({
  sharedContext: sharedContextSchema,
  messages: z.array(messageViewSchema),
  attendances: z.array(z.object({ id: z.string(), anjoName: z.string(), startedAt: z.string(), firstAnjoMessageAt: z.string().nullable(), endedAt: z.string().nullable(), endCause: z.string().nullable() })),
  classification: classificationViewSchema.nullable(),
})
export type RequestDetail = z.infer<typeof requestDetailSchema>

export const unavailableAttemptsSchema = z.object({ items: z.array(z.object({ occurredAt: z.string(), personName: z.string(), teamName: z.string().nullable(), subteamName: z.string().nullable(), origin: requestOriginSchema.nullable() })), nextCursor: z.string().nullable() })
export type UnavailableAttempts = z.infer<typeof unavailableAttemptsSchema>

export const anjoActivitySchema = z.object({
  personId: z.string(),
  name: z.string(),
  hoursAvailable: z.number(),
  hoursPaused: z.record(pauseReasonSchema, z.number()),
  hoursDisconnected: z.number(),
  attendances: z.number(),
  firstResponse: z.object({ p50Seconds: z.number().nullable(), p90Seconds: z.number().nullable(), withoutResponse: z.number() }),
  averageStars: z.number().nullable(),
})
export type AnjoActivity = z.infer<typeof anjoActivitySchema>
export const anjoActivityListSchema = z.object({ items: z.array(anjoActivitySchema) })

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
  attendances: z.object({ active: z.number(), capacity: z.number() }),
})
export type AnjoNowItem = z.infer<typeof anjoNowItemSchema>
export const anjosNowSchema = z.object({ serverTime: z.string(), items: z.array(anjoNowItemSchema) })
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
