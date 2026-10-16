import { z } from "zod"

import { analyticsSubjectSchema, groupingDimensionSchema, indicatorDirectionSchema, memberSituationSchema, quartileSchema } from "@/schemas/analytics/analytics.schema"

/**
 * Cartões de dados da liderança (backend `leadership-analytics/domain/view-models.ts`). Os números vêm do backend — a tela só
 * formata e monta os links a partir de `subject`/`period`/`indicatorCode`/`personId`. Chegam pelo evento `analytics` do chat,
 * pelo histórico da conversa e por `/api/v1/leadership/*`.
 */

const decileSchema = z.enum(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"])
export type Decile = z.infer<typeof decileSchema>

const structureRefSchema = z.object({ subject: analyticsSubjectSchema, label: z.string(), description: z.string().nullable() })
const indicatorRefSchema = z.object({ code: z.string(), name: z.string(), unit: z.string(), direction: indicatorDirectionSchema })

const analysisMemberSchema = z.object({
  personId: z.string(),
  name: z.string(),
  value: z.number().nullable(),
  targetValue: z.number().nullable(),
  achievementPercent: z.number().nullable(),
  position: z.number().nullable(),
  decile: decileSchema.nullable(),
  officialQuartile: quartileSchema.nullable(),
  within: z.boolean().nullable(),
  unitLabel: z.string().nullable(),
})
export type AnalysisMember = z.infer<typeof analysisMemberSchema>

const analysisUnitSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  subject: analyticsSubjectSchema.nullable(),
  memberCount: z.number(),
  membersWithData: z.number(),
  withReference: z.number(),
  within: z.number(),
  below: z.number(),
  belowPercent: z.number().nullable(),
  shareOfDeviationsPercent: z.number().nullable(),
  averageAchievementPercent: z.number().nullable(),
  comparable: z.boolean(),
  comparabilityReasons: z.array(z.string()),
  groupName: z.string().nullable(),
})
export type AnalysisUnit = z.infer<typeof analysisUnitSchema>

const concentrationSchema = z.object({
  pattern: z.enum(["CONCENTRATED", "DISSEMINATED", "MIXED", "NONE", "UNDETERMINED"]),
  focusKeys: z.array(z.string()),
  overallRatePercent: z.number().nullable(),
  explanation: z.string(),
})

export const indicatorAnalysisCardSchema = z.object({
  type: z.literal("INDICATOR_ANALYSIS"),
  generatedAt: z.string(),
  structure: structureRefSchema,
  period: z.string(),
  periodLabel: z.string(),
  indicator: indicatorRefSchema,
  population: z.object({ memberCount: z.number(), membersWithData: z.number(), withReference: z.number(), noData: z.number(), coveragePercent: z.number().nullable() }),
  reference: z.object({ within: z.number(), below: z.number(), withinPercent: z.number().nullable(), belowPercent: z.number().nullable() }),
  previous: z.object({ period: z.string(), periodLabel: z.string(), withReference: z.number(), belowPercent: z.number().nullable(), deltaPp: z.number().nullable() }),
  averageAchievementPercent: z.number().nullable(),
  ranking: z.object({ reason: z.enum(["OK", "DIRECTION_UNSUPPORTED", "NO_DATA"]), rankedCount: z.number(), best: z.array(analysisMemberSchema), worst: z.array(analysisMemberSchema) }),
  officialQuartiles: z.object({ Q1: z.number(), Q2: z.number(), Q3: z.number(), Q4: z.number(), NO_DATA: z.number() }),
  deciles: z.object({ reason: z.enum(["OK", "INSUFFICIENT_POPULATION", "DIRECTION_UNSUPPORTED"]), rankedCount: z.number(), counts: z.record(decileSchema, z.number()) }),
  units: z.array(analysisUnitSchema),
  unitsGroupBy: groupingDimensionSchema.nullable(),
  unitsGroupByLabel: z.string().nullable(),
  concentration: concentrationSchema.nullable(),
  comparison: z.object({ groups: z.array(z.object({ teamName: z.string().nullable(), unitKeys: z.array(z.string()) })), note: z.string().nullable() }),
  limitations: z.array(z.string()),
  methods: z.array(z.string()),
})
export type IndicatorAnalysisCard = z.infer<typeof indicatorAnalysisCardSchema>

export const structureOverviewCardSchema = z.object({
  type: z.literal("STRUCTURE_OVERVIEW"),
  generatedAt: z.string(),
  structure: structureRefSchema,
  period: z.string(),
  periodLabel: z.string(),
  members: z.object({ total: z.number(), withData: z.number(), belowReference: z.number(), withinReference: z.number(), improving: z.number(), noData: z.number(), coveragePercent: z.number().nullable() }),
  indicators: z.array(
    indicatorRefSchema.extend({ withReference: z.number(), below: z.number(), belowPercent: z.number().nullable(), previousBelowPercent: z.number().nullable(), deltaPp: z.number().nullable(), averageAchievementPercent: z.number().nullable() }),
  ),
  units: z.array(
    z.object({
      label: z.string(),
      description: z.string().nullable(),
      subject: analyticsSubjectSchema,
      memberCount: z.number(),
      membersWithData: z.number(),
      belowReferenceCount: z.number(),
      belowReferencePercent: z.number().nullable(),
      topAttentionIndicators: z.array(z.object({ code: z.string(), name: z.string() })),
    }),
  ),
  unitsGroupByLabel: z.string().nullable(),
  awaitingAcknowledgement: z.number(),
  /** Mês corrente pela medição diária (cartões antigos não têm). */
  operational: z
    .object({
      label: z.string(),
      windowLabel: z.string(),
      previousWindowLabel: z.string(),
      indicators: z.array(z.object({ code: z.string(), name: z.string(), current: z.string(), previous: z.string(), trend: z.enum(["melhorou", "piorou", "estável"]).nullable(), coverage: z.string() })),
    })
    .nullable()
    .optional(),
  limitations: z.array(z.string()),
  methods: z.array(z.string()),
})
export type StructureOverviewCard = z.infer<typeof structureOverviewCardSchema>

export const peopleCardSchema = z.object({
  type: z.literal("PEOPLE"),
  generatedAt: z.string(),
  structure: structureRefSchema,
  period: z.string(),
  periodLabel: z.string(),
  filter: z.object({ situation: memberSituationSchema.nullable(), indicatorCode: z.string().nullable(), indicatorName: z.string().nullable(), pendingOnly: z.boolean(), label: z.string() }),
  total: z.number(),
  members: z.array(
    z.object({
      personId: z.string(),
      name: z.string(),
      jobTitle: z.string().nullable(),
      situation: memberSituationSchema,
      averageAchievementPercent: z.number().nullable(),
      attentionIndicators: z.array(z.object({ code: z.string(), name: z.string(), achievementPercent: z.number().nullable() })),
      indicator: z.object({ value: z.number().nullable(), targetValue: z.number().nullable(), achievementPercent: z.number().nullable() }).nullable(),
      awaitingAcknowledgement: z.number(),
      pendingReviews: z.number(),
    }),
  ),
  methods: z.array(z.string()),
})
export type PeopleCard = z.infer<typeof peopleCardSchema>

const priorityTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PENDING"), operatorId: z.string().nullable(), caseId: z.string().nullable() }),
  z.object({ kind: z.literal("INDICATOR"), subject: analyticsSubjectSchema, indicatorCode: z.string(), indicatorName: z.string(), period: z.string() }),
  z.object({ kind: z.literal("TEAM"), subject: analyticsSubjectSchema, period: z.string(), situation: memberSituationSchema.nullable(), indicatorCode: z.string().nullable() }),
  z.object({ kind: z.literal("FOLLOW_UP_PENDING_ACK") }),
])
export type PriorityTarget = z.infer<typeof priorityTargetSchema>

const priorityItemSchema = z.object({
  kind: z.enum(["PENDING_DECISION", "INDICATOR_DEVIATION", "UNIT_CONCENTRATION", "AWAITING_ACKNOWLEDGEMENT", "DATA_GAP"]),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  title: z.string(),
  evidence: z.string(),
  target: priorityTargetSchema,
  question: z.string().nullable(),
})
export type PriorityItem = z.infer<typeof priorityItemSchema>

export const prioritiesCardSchema = z.object({
  type: z.literal("PRIORITIES"),
  generatedAt: z.string(),
  structure: structureRefSchema.nullable(),
  period: z.string().nullable(),
  periodLabel: z.string().nullable(),
  items: z.array(priorityItemSchema),
  method: z.string(),
  limitations: z.array(z.string()),
})
export type PrioritiesCard = z.infer<typeof prioritiesCardSchema>

export const queryTableCardSchema = z.object({
  type: z.literal("QUERY_TABLE"),
  generatedAt: z.string(),
  structure: structureRefSchema,
  source: z.enum(["OFFICIAL", "OPERATIONAL"]),
  title: z.string(),
  scopeNote: z.string(),
  period: z.string().nullable(),
  indicatorCode: z.string().nullable(),
  columns: z.array(z.object({ key: z.string(), label: z.string(), numeric: z.boolean() })),
  rows: z.array(z.object({ cells: z.record(z.string(), z.string()), subject: analyticsSubjectSchema.nullable(), personId: z.string().nullable() })),
  totalRows: z.number(),
  /** Achados-resumo calculados (cartões antigos não têm). */
  highlights: z.array(z.string()).optional(),
  methods: z.array(z.string()),
  limitations: z.array(z.string()),
})
export type QueryTableCard = z.infer<typeof queryTableCardSchema>

export const leadershipCardSchema = z.discriminatedUnion("type", [indicatorAnalysisCardSchema, structureOverviewCardSchema, peopleCardSchema, prioritiesCardSchema, queryTableCardSchema])
export type LeadershipCard = z.infer<typeof leadershipCardSchema>

/** Cartões válidos de uma lista vinda do chat/histórico — um cartão de formato antigo/desconhecido é ignorado, nunca quebra o chat. */
export function parseLeadershipCards(value: unknown): LeadershipCard[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((card) => {
    const parsed = leadershipCardSchema.safeParse(card)
    return parsed.success ? [parsed.data] : []
  })
}

export const leadershipHomeSchema = z.object({ enabled: z.boolean(), priorities: prioritiesCardSchema.nullable(), suggestions: z.array(z.string()) })
export type LeadershipHome = z.infer<typeof leadershipHomeSchema>
