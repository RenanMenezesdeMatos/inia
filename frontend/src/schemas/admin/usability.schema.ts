import { z } from "zod"

/**
 * Contrato da Monitoria de usabilidade (`/api/v1/admin/usability/*`). Todo número chega como VALOR DE MÉTRICA com estado
 * (valor, sem dados, não aplicável, parcial), base e cobertura — a tela nunca transforma "sem dados" em zero.
 */
export const coverageSchema = z.object({ status: z.enum(["FULL", "PARTIAL", "NONE"]), from: z.string().nullable(), note: z.string().nullable() })
export type Coverage = z.infer<typeof coverageSchema>

export const variationSchema = z.object({ kind: z.enum(["PERCENT", "PERCENTAGE_POINTS"]), value: z.number().nullable(), status: z.enum(["VALUE", "NO_BASE", "NOT_APPLICABLE", "NO_DATA"]), previous: z.number().nullable(), label: z.string() })
export const metricValueSchema = z.object({
  metric: z.string(),
  status: z.enum(["VALUE", "NO_DATA", "NOT_APPLICABLE", "PARTIAL"]),
  value: z.number().nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  coverage: coverageSchema,
  variation: variationSchema.nullable(),
})
export type MetricValue = z.infer<typeof metricValueSchema>

export const metaSchema = z
  .object({
    tab: z.string(),
    generatedAt: z.string(),
    timezone: z.string(),
    timezoneSource: z.enum(["OVERRIDE", "OPERATION"]),
    period: z.object({ preset: z.string(), fromDate: z.string(), toDate: z.string(), start: z.string(), end: z.string(), includesPartialToday: z.boolean(), label: z.string() }),
    comparison: z.object({ fromDate: z.string(), toDate: z.string(), start: z.string(), end: z.string(), partialAligned: z.boolean(), label: z.string() }).nullable(),
    filters: z.record(z.string(), z.unknown()),
    structureMode: z.enum(["AT_FACT", "CURRENT"]),
    definitionsVersion: z.string(),
    freshness: z.object({ lastEventReceivedAt: z.string().nullable(), lastProjectionAt: z.string().nullable(), pendingSince: z.string().nullable(), lagSeconds: z.number(), dataUpdatedUntil: z.string() }),
    can: z.object({ people: z.boolean(), export: z.boolean(), comments: z.boolean(), manage: z.boolean(), readConversations: z.boolean() }),
    coverage: z.record(z.string(), z.unknown()).optional(),
    structureBasis: z.object({ value: z.string(), label: z.string() }).optional(),
  })
  .passthrough()
export type UsabilityMeta = z.infer<typeof metaSchema>

export const metricDefinitionSchema = z.object({ id: z.string(), tab: z.string(), label: z.string(), definition: z.string(), formula: z.string(), unit: z.string(), source: z.string(), denominator: z.string().nullable(), dedupe: z.string(), coverage: z.string(), exclusions: z.string(), limitations: z.string() })
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>

const option = z.object({ id: z.string(), name: z.string() })
export const contextSchema = z.object({
  meta: metaSchema,
  periods: z.array(z.object({ value: z.string(), label: z.string() })),
  tabs: z.record(z.string(), z.array(z.string())),
  notApplicableReasons: z.record(z.string(), z.string()),
  collectionStartedAt: z.string().nullable(),
  dictionary: z.array(metricDefinitionSchema),
  segments: z.object({ people: z.record(z.string(), z.string()), feedbacks: z.record(z.string(), z.string()) }),
  options: z.object({
    teams: z.array(option),
    subteams: z.array(option.extend({ teamId: z.string().nullable() })),
    jobTitles: z.array(z.string()),
    accessRoles: z.array(z.object({ code: z.string(), name: z.string() })),
    leaders: z.array(option).nullable(),
    screens: z.array(z.object({ key: z.string(), label: z.string(), area: z.string(), areaLabel: z.string() })),
    features: z.array(z.object({ key: z.string(), label: z.string() })),
    devices: z.array(z.string()),
    appVersions: z.array(z.string()),
    environments: z.array(z.string()),
    workflows: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })),
  }),
})
export type UsabilityContext = z.infer<typeof contextSchema>

const distributionSchema = z.object({ count: z.number(), mean: z.number().nullable(), median: z.number().nullable(), p95: z.number().nullable() })
const signalSchema = z.object({ key: z.string(), label: z.string(), heuristic: z.literal(true), value: z.number(), base: z.number().nullable(), rate: z.number().nullable(), previous: z.number().nullable(), detail: z.array(z.object({ label: z.string(), count: z.number() })), evidence: z.string(), drill: z.object({ tab: z.string(), params: z.record(z.string(), z.string()) }) })
export type DifficultySignal = z.infer<typeof signalSchema>

export const overviewSchema = z.object({
  meta: metaSchema,
  kpis: z.array(metricValueSchema),
  reference: z.object({ date: z.string(), dau: z.number().nullable(), wau: z.number().nullable(), mau: z.number().nullable(), dauMau: z.number().nullable(), wauFullCoverage: z.boolean(), mauFullCoverage: z.boolean() }).nullable(),
  distributions: z.object({ sessionDurationSeconds: distributionSchema, activeSecondsPerPerson: distributionSchema, activeDaysPerPerson: distributionSchema, sessionsPerActivePersonDay: z.number().nullable() }),
  series: z.array(z.object({ date: z.string(), measured: z.boolean(), dau: z.number().nullable(), wau: z.number().nullable(), wauFullCoverage: z.boolean(), mau: z.number().nullable(), mauFullCoverage: z.boolean(), sessions: z.number().nullable(), activeSeconds: z.number().nullable() })),
  heatmap: z.array(z.object({ weekday: z.number(), hour: z.number(), sessions: z.number() })),
  topScreens: z.array(z.object({ screenKey: z.string(), label: z.string(), views: z.number(), people: z.number(), sharePercent: z.number().nullable() })),
  topFeatures: z.array(z.object({ featureKey: z.string(), label: z.string(), views: z.number() })),
  summary: z.object({ feedbackAvailable: z.number(), feedbackAcked: z.number(), chatPeople: z.number(), workflowRoots: z.number() }),
  population: z.object({ basis: z.string(), registered: z.number(), withAccount: z.number(), eligibleNow: z.number(), noAccount: z.number(), accountDisabled: z.number(), away: z.number(), terminated: z.number() }),
  signals: z.array(signalSchema),
})
export type UsabilityOverview = z.infer<typeof overviewSchema>

export const peopleRowSchema = z.object({
  personId: z.string(), name: z.string(), matricula: z.string().nullable(), jobTitle: z.string().nullable(), level: z.string(), teamName: z.string().nullable(), subteamName: z.string().nullable(),
  personActive: z.boolean(), employmentStatus: z.string(), accountStatus: z.enum(["ENABLED", "DISABLED", "NONE"]), roles: z.array(z.string()), eligibleNow: z.boolean(), eligibleFrom: z.string().nullable(), eligibilityBasis: z.string().nullable(),
  activeInPeriod: z.boolean(), engagedInPeriod: z.boolean(), activeDays: z.number(), sessions: z.number(), sessionsPerActiveDay: z.number().nullable(), activeSeconds: z.number(),
  firstObservedAt: z.string().nullable(), lastObservedAt: z.string().nullable(), legacyLastLoginAt: z.string().nullable(), lastLoginAt: z.string().nullable(),
})
export type PeopleRow = z.infer<typeof peopleRowSchema>
export const peopleSchema = z.object({
  meta: metaSchema,
  segment: z.string(),
  segmentLabel: z.string(),
  counts: z.record(z.string(), z.number()),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  identified: z.boolean(),
  items: z.array(peopleRowSchema).nullable(),
  retention: z.object({
    cohortSize: z.number(),
    basis: z.string(),
    days: z.array(z.object({ offset: z.number(), label: z.string(), matureCohort: z.number(), immature: z.number(), returned: z.number(), rate: z.number().nullable(), cumulativeReturned: z.number() })),
    weekly: z.array(z.object({ week: z.string(), size: z.number(), weeks: z.array(z.object({ offset: z.number(), mature: z.boolean(), returned: z.number().nullable(), rate: z.number().nullable() })) })),
  }),
})
export type UsabilityPeople = z.infer<typeof peopleSchema>

const loose = z.record(z.string(), z.unknown())
export const screensSchema = z.object({ meta: metaSchema, totalViews: z.number(), screens: z.array(loose), features: z.array(loose), actions: z.array(loose), elements: z.array(loose), transitions: z.array(loose), entries: z.array(loose), exits: z.array(loose), heatmap: z.array(loose), scroll: z.array(loose), search: z.array(loose), filters: z.array(loose), exports: z.record(z.string(), z.number()) })
export type UsabilityScreens = z.infer<typeof screensSchema>
export const feedbacksSchema = z.object({ meta: metaSchema, cohort: loose, volume: z.record(z.string(), z.number()), reasons: z.array(z.object({ reason: z.string(), label: z.string(), count: z.number(), previous: z.number().nullable() })), confirmation: loose, comments: z.array(loose).nullable(), segment: z.string(), segmentLabel: z.string(), total: z.number(), page: z.number(), pageSize: z.number(), identified: z.boolean(), items: z.array(loose).nullable() })
export type UsabilityFeedbacks = z.infer<typeof feedbacksSchema>
export const conversationsSchema = z.object({ meta: metaSchema, people: z.record(z.string(), z.number()), messages: z.record(z.string(), z.number()), conversations: loose, perPersonDay: loose, perConversation: distributionSchema, origins: z.array(loose), responseRate: loose, chatUi: z.record(z.string(), z.number()), voice: z.record(z.string(), z.number().nullable()), latency: loose, cost: loose, page: z.number(), pageSize: z.number(), total: z.number().nullable(), identified: z.boolean(), items: z.array(loose).nullable() })
export type UsabilityConversations = z.infer<typeof conversationsSchema>
export const workflowsSchema = z.object({ meta: metaSchema, totalRoots: z.number(), ranking: z.array(loose), versions: z.array(loose), series: z.array(z.object({ day: z.string(), workflowId: z.string(), roots: z.number(), completedInDay: z.number() })), failures: z.array(loose), humanReviews: loose, timing: loose, completionsInPeriod: loose, withoutExecution: z.array(loose), page: z.number(), pageSize: z.number(), identified: z.boolean(), items: z.array(loose).nullable() })
export type UsabilityWorkflows = z.infer<typeof workflowsSchema>
export const journeysSchema = z.object({ meta: metaSchema, funnels: z.array(z.object({ key: z.string(), label: z.string(), correlation: z.string(), windowLabel: z.string(), steps: z.array(z.object({ key: z.string(), label: z.string(), source: z.string(), reached: z.number(), conversionFromPrevious: z.number().nullable(), conversionFromStart: z.number().nullable(), pending: z.number(), stopped: z.number().nullable(), timeFromStart: z.object({ median: z.number().nullable(), p95: z.number().nullable() }).nullable() })) })), signals: z.array(signalSchema), stoppedCases: z.array(loose).nullable(), identified: z.boolean() })
export type UsabilityJourneys = z.infer<typeof journeysSchema>
export const qualitySchema = z.object({ meta: metaSchema, collection: loose, families: z.array(loose), officialSources: z.array(loose), eligibility: loose, ingestion: loose, projection: loose, catalog: z.array(loose), versions: z.record(z.string(), z.union([z.string(), z.number()])), dictionary: z.array(metricDefinitionSchema), events: z.array(loose), classifications: z.array(loose).nullable(), authFailures: loose.nullable() })
export type UsabilityQuality = z.infer<typeof qualitySchema>
export const personDetailSchema = z.object({ meta: metaSchema, person: loose, milestones: loose, eligibility: z.array(loose), calendar: z.array(z.object({ date: z.string(), active: z.boolean(), sessionsStarted: z.number(), sessionsActive: z.number(), activeSeconds: z.number(), screenViews: z.number(), activations: z.number() })), totals: loose, hours: z.array(z.object({ hour: z.number(), activeDays: z.number() })), sessions: z.array(loose), screens: z.array(loose), actions: z.array(loose), feedback: z.record(z.string(), z.number()), chat: z.record(z.string(), z.number()) })
export type UsabilityPersonDetail = z.infer<typeof personDetailSchema>
export const timelineSchema = z.object({ page: z.number(), pageSize: z.number(), hasMore: z.boolean(), items: z.array(z.object({ at: z.string(), kind: z.string(), source: z.string(), label: z.string(), screenLabel: z.string().nullable(), elementLabel: z.string().nullable(), entity: z.object({ type: z.string(), id: z.string() }).nullable(), href: z.string().nullable() })) })
export type UsabilityTimeline = z.infer<typeof timelineSchema>
