import { z } from "zod"

import { queryTableCardSchema } from "@/schemas/leadership/leadership.schema"

/** Reports recorrentes — contrato da API `/api/v1/reports` (tipos sempre via `z.infer`). */

export const REPORT_TOOLS = ["INDICATOR_QUERY", "WORKFORCE", "INDICATOR_DIAGNOSIS"] as const
export const VISUALIZATION_TYPES = ["TABLE", "KPI", "BAR", "LINE", "AREA", "DISTRIBUTION"] as const
export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
export const PLATFORM_LEVELS = ["OPERATOR", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const

export const reportStructureSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("RECIPIENT") }),
  z.object({ mode: z.literal("FIXED"), subjectKind: z.string(), subjectId: z.string(), label: z.string() }),
])

export const reportPeriodSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("LAST_CLOSED") }),
  z.object({ mode: z.literal("LAST_N_CLOSED"), months: z.number().int(), display: z.enum(["ULTIMA", "MEDIA", "POR_MES", "RECORRENCIA"]) }),
  z.object({ mode: z.literal("FIXED_MONTH"), month: z.string() }),
  z.object({ mode: z.literal("CURRENT"), window: z.enum(["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS"]) }),
  z.object({ mode: z.literal("TODAY") }),
])

export const reportDefinitionSchema = z.object({
  tool: z.enum(REPORT_TOOLS),
  structure: reportStructureSchema,
  period: reportPeriodSchema,
  indicators: z.array(z.string()).default([]),
  view: z.enum(["INDICADOR", "CONSOLIDADO", "QUARTIS"]).optional(),
  groupBy: z.enum(["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM", "PESSOA", "COMPETENCIA"]).optional(),
  situation: z.enum(["FORA", "DENTRO", "SEM_DADO"]).optional(),
  quartiles: z.array(z.enum(["Q1", "Q2", "Q3", "Q4"])).optional(),
  minBelowIndicators: z.number().int().optional(),
  sortBy: z.enum(["PCT_FORA", "FORA", "ATINGIMENTO", "VARIACAO", "Q4", "DISPERSAO", "NOME"]).optional(),
  order: z.enum(["ASC", "DESC"]).optional(),
  limit: z.number().int().default(20),
  statuses: z.array(z.string()).optional(),
  listPeople: z.boolean().optional(),
  includeLeaders: z.boolean().optional(),
  compare: z.enum(["FORA_X_DENTRO", "Q4_X_Q1"]).optional(),
  level: z.enum(["SUBMOTIVO", "MOTIVO"]).optional(),
  interactionMonths: z.number().int().optional(),
})
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>

export const reportVisualizationSchema = z.object({ type: z.enum(VISUALIZATION_TYPES), metric: z.string().optional() })
export type ReportVisualization = z.infer<typeof reportVisualizationSchema>
export type VisualizationType = (typeof VISUALIZATION_TYPES)[number]

export const reportScheduleSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  times: z.array(z.string()),
  weekdays: z.array(z.enum(WEEKDAYS)).optional(),
  dayOfMonth: z.union([z.number().int(), z.literal("LAST")]).optional(),
  onMissingDay: z.enum(["SKIP", "LAST_DAY"]).optional(),
})
export type ReportSchedule = z.infer<typeof reportScheduleSchema>

export const reportAudienceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("SELF") }),
  z.object({ mode: z.literal("DISTRIBUTION"), everyone: z.boolean().default(false), levels: z.array(z.enum(PLATFORM_LEVELS)).default([]), jobTitles: z.array(z.string()).default([]), teamIds: z.array(z.string()).default([]), subteamIds: z.array(z.string()).default([]), personIds: z.array(z.string()).default([]) }),
])
export type ReportAudience = z.infer<typeof reportAudienceSchema>

export const reportAnalysisSchema = z.object({ enabled: z.boolean(), comparison: z.boolean() })

export const reportConfigSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  definition: reportDefinitionSchema,
  visualization: reportVisualizationSchema,
  schedule: reportScheduleSchema,
  audience: reportAudienceSchema,
  analysis: reportAnalysisSchema,
})
export type ReportConfig = z.infer<typeof reportConfigSchema>

export const RUN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "NOT_FORWARDED", "PARTIAL", "BLOCKED", "SKIPPED", "FAILED"] as const
export const runStatusSchema = z.enum(RUN_STATUSES)

export const reportSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  origin: z.enum(["CHAT", "SCREEN"]),
  audienceMode: z.enum(["SELF", "DISTRIBUTION"]),
  tool: z.enum(REPORT_TOOLS),
  structure: z.string(),
  period: z.string(),
  schedule: z.string(),
  timeZone: z.string(),
  visualization: z.enum(VISUALIZATION_TYPES),
  nextRunAt: z.string().nullable(),
  upcomingRuns: z.array(z.string()),
  lastRunAt: z.string().nullable(),
  lastRunStatus: runStatusSchema.nullable(),
  lastValidDeliveryAt: z.string().nullable(),
  configVersion: z.number(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ReportSummary = z.infer<typeof reportSummarySchema>

export const reportListSchema = z.object({
  capabilities: z.object({ canCreateForSelf: z.boolean(), canDistribute: z.boolean(), timeZone: z.string() }),
  items: z.array(reportSummarySchema),
})

export const reportRunSchema = z.object({
  id: z.string(),
  scheduledFor: z.string(),
  triggerKind: z.enum(["SCHEDULE", "MANUAL"]),
  configVersion: z.number(),
  status: runStatusSchema,
  attempts: z.number(),
  outcome: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type ReportRun = z.infer<typeof reportRunSchema>

export const reportDetailSchema = z.object({ report: reportSummarySchema.extend({ config: reportConfigSchema }), runs: z.array(reportRunSchema) })
export type ReportDetail = z.infer<typeof reportDetailSchema>

export const sourceStateSchema = z.object({ source: z.string(), label: z.string(), watermark: z.string().nullable(), lastUpdatedAt: z.string().nullable(), stale: z.boolean(), detail: z.string().nullable() })
export type SourceState = z.infer<typeof sourceStateSchema>

export const visualizationDataSchema = z.object({
  type: z.enum(VISUALIZATION_TYPES),
  title: z.string(),
  unit: z.string().nullable(),
  metricKey: z.string().nullable(),
  metricLabel: z.string().nullable(),
  categories: z.array(z.string()),
  series: z.array(z.object({ key: z.string(), label: z.string(), values: z.array(z.number().nullable()) })),
  kpis: z.array(z.object({ label: z.string(), text: z.string(), value: z.number().nullable() })),
  fallbackReason: z.string().nullable(),
  empty: z.boolean(),
})
export type VisualizationData = z.infer<typeof visualizationDataSchema>

export const metricChangeSchema = z.object({ row: z.string(), column: z.string(), columnLabel: z.string(), unit: z.string().nullable(), current: z.number(), previous: z.number(), delta: z.number(), deltaPercent: z.number().nullable(), direction: z.string(), assessment: z.enum(["IMPROVED", "WORSENED", "STABLE", "NEUTRAL"]) })
export const comparisonSchema = z.object({
  status: z.enum(["COMPARED", "NOT_COMPARABLE", "NO_HISTORY", "DISABLED"]),
  basis: z.string(),
  reason: z.string().nullable(),
  currentLabel: z.string().nullable(),
  referenceLabel: z.string().nullable(),
  coverage: z.object({ currentRows: z.number(), referenceRows: z.number() }),
  rowsAdded: z.array(z.string()),
  rowsRemoved: z.array(z.string()),
  changes: z.array(metricChangeSchema),
  summary: z.object({ improved: z.number(), worsened: z.number(), stable: z.number(), neutral: z.number() }),
  configurationChanged: z.boolean(),
})
export type ReportComparison = z.infer<typeof comparisonSchema>

export const NOT_FORWARDED_REASONS = ["STALE_SOURCES", "NO_CHANGE", "INSUFFICIENT_COVERAGE"] as const

/** Uma entrega (ou aviso) — mesmo formato no Acompanhamento e na página da entrega. */
export const reportDeliveryContentSchema = z.object({
  deliveryId: z.string(),
  reportId: z.string(),
  kind: z.enum(["DELIVERY", "NOT_FORWARDED"]),
  reason: z.enum(NOT_FORWARDED_REASONS).nullable(),
  periodLabel: z.string().nullable(),
  structureLabel: z.string().nullable(),
  sources: z.array(sourceStateSchema).catch([]),
  visualization: visualizationDataSchema.nullable().catch(null),
  dataset: queryTableCardSchema.nullable().catch(null),
  comparison: comparisonSchema.nullable().catch(null),
  analysisStatus: z.string(),
  analysisText: z.string().nullable(),
  empty: z.boolean(),
  occurrences: z.number(),
  lastCheckedAt: z.string(),
  reportActive: z.boolean().optional(),
})
export type ReportDeliveryContent = z.infer<typeof reportDeliveryContentSchema>

export const receivedDeliverySchema = z.object({
  id: z.string(),
  reportId: z.string(),
  reportName: z.string(),
  kind: z.enum(["DELIVERY", "NOT_FORWARDED"]),
  reason: z.string().nullable(),
  periodLabel: z.string().nullable(),
  structureLabel: z.string().nullable(),
  analysisStatus: z.string(),
  empty: z.boolean(),
  occurrences: z.number(),
  createdAt: z.string(),
  lastCheckedAt: z.string(),
  readAt: z.string().nullable(),
})
export type ReceivedDelivery = z.infer<typeof receivedDeliverySchema>

export const deliveryDetailSchema = z.object({
  delivery: z.object({
    id: z.string(),
    reportId: z.string(),
    kind: z.enum(["DELIVERY", "NOT_FORWARDED"]),
    reason: z.enum(NOT_FORWARDED_REASONS).nullable(),
    structureLabel: z.string().nullable(),
    periodLabel: z.string().nullable(),
    sources: z.array(sourceStateSchema).catch([]),
    dataset: queryTableCardSchema.nullable().catch(null),
    visualization: visualizationDataSchema.nullable().catch(null),
    comparison: comparisonSchema.nullable().catch(null),
    empty: z.boolean(),
    analysisStatus: z.string(),
    analysisText: z.string().nullable(),
    analysisError: z.string().nullable(),
    occurrences: z.number(),
    lastCheckedAt: z.string(),
    createdAt: z.string(),
    configVersion: z.number(),
    readAt: z.string().nullable(),
  }),
  report: z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), status: z.string(), deleted: z.boolean(), isOwner: z.boolean(), configChangedSince: z.boolean() }),
  history: z.array(receivedDeliverySchema),
})
export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>

export const reportOptionsSchema = z.object({
  capabilities: z.object({ canCreateForSelf: z.boolean(), canDistribute: z.boolean() }),
  timeZone: z.string(),
  ownStructure: z.string().nullable(),
  structures: z.array(z.object({ subjectKind: z.string(), subjectId: z.string(), label: z.string(), description: z.string() })),
  indicators: z.array(z.object({ code: z.string(), name: z.string(), active: z.boolean() })),
  audience: z
    .object({
      scope: z.object({ organizationWide: z.boolean(), teamIds: z.array(z.string()), subteamIds: z.array(z.string()) }),
      jobTitles: z.array(z.string()),
      teams: z.array(z.object({ id: z.string(), name: z.string() })),
      subteams: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() })),
    })
    .nullable(),
})
export type ReportOptions = z.infer<typeof reportOptionsSchema>

export const reportPreviewSchema = z.object({
  preview: z.literal(true),
  structure: z.string(),
  period: z.string(),
  card: queryTableCardSchema,
  compatible: z.array(z.enum(VISUALIZATION_TYPES)),
  suggested: reportVisualizationSchema,
  visualization: visualizationDataSchema,
  sources: z.array(sourceStateSchema),
  coverage: z.number().nullable(),
})
export type ReportPreview = z.infer<typeof reportPreviewSchema>

export const reportProposalSchema = z.object({
  id: z.string(),
  status: z.string(),
  reportId: z.string().nullable(),
  draft: z.object({ name: z.string(), description: z.string().nullable(), definition: reportDefinitionSchema, visualization: reportVisualizationSchema }),
})
export type ReportProposal = z.infer<typeof reportProposalSchema>

export const audiencePersonSchema = z.object({ personId: z.string(), name: z.string(), role: z.string(), jobTitle: z.string().nullable() })
export type AudiencePerson = z.infer<typeof audiencePersonSchema>

/** Oferta "Criar report desta consulta" numa resposta do chat. */
export const reportOfferSchema = z.object({ proposalId: z.string(), title: z.string(), status: z.string(), reportId: z.string().nullable().optional() })
export type ReportOffer = z.infer<typeof reportOfferSchema>
