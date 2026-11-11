import { z } from "zod"

import { measureSchema } from "@/schemas/human-support/monitoring.schema"

/**
 * Espelho da API `/api/v1/admin/inia-success` (Indicadores de sucesso da INIA). Toda taxa vem com numerador e denominador e o estado:
 * `NO_DATA` = denominador zero ("Sem base para cálculo", nunca 0%); `SMALL_SAMPLE` = denominador abaixo de 5 (a porcentagem não é
 * mostrada); `OK`. Toda média vem com a soma e a quantidade de observações. Regras e fórmulas: `docs/dev/indicadores-de-sucesso-da-inia.md`.
 */
export const rateSchema = z.object({ numerator: z.number().nullable(), denominator: z.number().nullable(), value: z.number().nullable(), status: z.enum(["OK", "SMALL_SAMPLE", "NO_DATA"]) })
export type Rate = z.infer<typeof rateSchema>
export const averageSchema = z.object({ sum: z.number(), count: z.number(), value: z.number().nullable(), status: z.enum(["OK", "SMALL_SAMPLE", "NO_DATA"]) })
export type Average = z.infer<typeof averageSchema>

export const bucketSchema = z.object({ key: z.string(), from: z.string(), to: z.string(), days: z.number(), partial: z.boolean() })
export type Bucket = z.infer<typeof bucketSchema>
const periodSchema = z.object({ from: z.string(), to: z.string(), days: z.number(), granularity: z.enum(["DAY", "WEEK"]), buckets: z.array(bucketSchema) })
export type SuccessPeriod = z.infer<typeof periodSchema>

export const SUCCESS_SECTIONS = ["responseTime", "routes", "replies", "support", "feedback", "compliance"] as const
export type SuccessSection = (typeof SUCCESS_SECTIONS)[number]
export const successContextSchema = z.object({
  sections: z.object({ responseTime: z.boolean(), routes: z.boolean(), replies: z.boolean(), support: z.boolean(), feedback: z.boolean(), compliance: z.boolean() }),
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
  subteams: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string().nullable() })),
})
export type SuccessContext = z.infer<typeof successContextSchema>

export const responseTimeSchema = z.object({
  period: periodSchema,
  text: z.object({
    average: averageSchema,
    medianSeconds: z.number().nullable(),
    p90Seconds: z.number().nullable(),
    questions: z.number(),
    measured: z.number(),
    coverage: rateSchema,
    noKey: z.number(),
    noReply: z.number(),
    unpaired: z.number(),
    invalid: z.number(),
    replacedByCheck: z.number(),
  }),
  voice: z.object({ status: z.literal("NOT_MEASURED"), answers: z.number(), typedQuestions: z.number() }),
  series: z.array(z.object({ bucket: bucketSchema, questions: z.number(), measured: z.number(), average: averageSchema })),
})
export type ResponseTimeData = z.infer<typeof responseTimeSchema>

const routeSchema = z.object({ kind: z.enum(["SPECIALIST", "DIRECT", "NONE"]), key: z.string(), label: z.string(), detail: z.string().nullable(), answers: z.number(), share: z.number().nullable() })
export type RouteItem = z.infer<typeof routeSchema>
export const routesSchema = z.object({
  period: periodSchema,
  answers: z.number(),
  routes: z.array(routeSchema),
  others: z.object({ routes: z.number(), answers: z.number() }).nullable(),
  withoutRoute: z.object({ answers: z.number(), share: rateSchema }),
  multiRoute: z.number(),
  byChannel: z.object({ chat: z.number(), voice: z.number() }),
})
export type RoutesData = z.infer<typeof routesSchema>

export const repliesSchema = z.object({
  period: periodSchema,
  funnel: z.object({ period: z.object({ from: z.string(), to: z.string() }), cutoffs: z.object({ dislikeDetailsSince: z.string().nullable(), signalsSince: z.string().nullable() }), measures: z.array(measureSchema) }),
  byChannel: z.array(z.object({ channel: z.enum(["chat", "voice"]), answers: z.number(), up: z.number(), down: z.number(), positive: rateSchema, rated: rateSchema })),
  series: z.array(z.object({ bucket: bucketSchema, answers: z.number(), up: z.number(), down: z.number(), positive: rateSchema, withSignalRow: z.number(), withSignal: z.number(), signalRate: rateSchema })),
})
export type RepliesData = z.infer<typeof repliesSchema>

const catalogEntry = z.object({ key: z.string(), label: z.string() })
export const supportSchema = z.object({
  period: periodSchema,
  measures: z.array(measureSchema),
  disabledPeriods: z.array(z.object({ from: z.string(), to: z.string().nullable() })),
  catalogs: z.object({ reasons: z.array(catalogEntry), outcomes: z.array(catalogEntry), origins: z.array(catalogEntry) }),
  series: z.array(z.object({ bucket: bucketSchema, requests: z.number(), requestsByOrigin: z.record(z.string(), z.number()), classified: z.number(), byReason: z.record(z.string(), z.number()) })),
})
export type SupportData = z.infer<typeof supportSchema>

const feedbackCountsSchema = z.object({ delivered: z.number(), acknowledged: z.number(), up: z.number(), down: z.number(), withdrawn: z.number(), changed: z.number(), contested: z.number(), pending: z.number(), accepted: z.number(), partial: z.number(), rejected: z.number() })
export type FeedbackCounts = z.infer<typeof feedbackCountsSchema>
export const feedbackSchema = z.object({
  period: periodSchema,
  counts: feedbackCountsSchema,
  acknowledgement: rateSchema,
  ratingRate: rateSchema,
  positive: rateSchema,
  negative: rateSchema,
  contestation: rateSchema,
  reviewed: z.number(),
  procedence: z.object({ accepted: rateSchema, partial: rateSchema, rejected: rateSchema }),
  reasons: z.array(z.object({ reason: z.string(), label: z.string(), count: z.number(), share: rateSchema })),
  decisionLabels: z.record(z.string(), z.string()),
  byKind: z.array(z.object({ kind: z.enum(["INDICATOR", "MONITORING"]), counts: feedbackCountsSchema, contestation: rateSchema, positive: rateSchema })),
  agreement: z.object({ status: z.literal("NOT_COLLECTED") }),
  series: z.array(z.object({ bucket: bucketSchema, delivered: z.number(), contested: z.number(), up: z.number(), down: z.number(), contestation: rateSchema, positive: rateSchema })),
})
export type FeedbackData = z.infer<typeof feedbackSchema>

const complianceCountsSchema = z.object({ checks: z.number(), allowed: z.number(), violations: z.number(), blocked: z.number(), recorded: z.number(), failed: z.number() })
export const complianceSchema = z.object({
  period: periodSchema,
  mode: z.string(),
  counts: complianceCountsSchema,
  conformity: rateSchema,
  violation: rateSchema,
  inconclusive: rateSchema,
  bySurface: z.array(z.object({ surface: z.string(), label: z.string(), counts: complianceCountsSchema, violation: rateSchema })),
  series: z.array(z.object({ bucket: bucketSchema, checks: z.number(), violations: z.number(), conclusive: z.number(), violation: rateSchema })),
})
export type ComplianceData = z.infer<typeof complianceSchema>

/** Filtros da tela: os MESMOS em todos os blocos. */
export type SuccessFilter = { from: string; to: string; teamId: string | null; subteamId: string | null }
