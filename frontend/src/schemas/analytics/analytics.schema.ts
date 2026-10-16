import { z } from "zod"

import { feedbackSupportMaterialSchema } from "@/schemas/feedbacks/support-material.schema"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { feedbackOriginSchema } from "@/schemas/feedbacks/feedback-origin.schema"
import { prvSupervisorViewSchema } from "@/schemas/feedbacks/prv-supervisor-view.schema"
import { employmentStatusReadSchema, freshnessBlockSchema, operationalCapitalViewSchema, UNKNOWN_FRESHNESS, workScheduleViewSchema } from "@/schemas/people/employment-status.schema"

/**
 * Contratos da área de Indicadores / Equipe — espelho dos view-models do backend
 * (`performance-analytics/domain/view-models.ts`). O frontend valida na borda e depois só
 * apresenta: nenhuma regra de PRV, média, meta ou escopo é derivada aqui.
 */

export const quartileSchema = z.enum(["Q1", "Q2", "Q3", "Q4"])
export type Quartile = z.infer<typeof quartileSchema>

export const trendSchema = z.enum(["UP", "DOWN", "FLAT", "UNKNOWN"])
export type Trend = z.infer<typeof trendSchema>

export const indicatorDirectionSchema = z.enum(["HIGHER", "LOWER", "TARGET"])

export const analyticsSubjectKindSchema = z.enum([
  "EMPLOYEE",
  "SUPERVISOR_TEAM",
  "SUBTEAM",
  "TEAM",
  "COORDINATOR_STRUCTURE",
  "MANAGER_STRUCTURE",
  "SENIOR_MANAGER_STRUCTURE",
  "DIRECTOR_STRUCTURE",
])
export type AnalyticsSubjectKind = z.infer<typeof analyticsSubjectKindSchema>

export const analyticsSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EMPLOYEE"), employeeId: z.string() }),
  z.object({ kind: z.literal("SUPERVISOR_TEAM"), supervisorId: z.string() }),
  z.object({ kind: z.literal("SUBTEAM"), subteamId: z.string() }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string() }),
  z.object({ kind: z.literal("COORDINATOR_STRUCTURE"), coordinatorId: z.string() }),
  z.object({ kind: z.literal("MANAGER_STRUCTURE"), managerId: z.string() }),
  z.object({ kind: z.literal("SENIOR_MANAGER_STRUCTURE"), seniorManagerId: z.string() }),
  z.object({ kind: z.literal("DIRECTOR_STRUCTURE"), directorId: z.string() }),
])
export type AnalyticsSubject = z.infer<typeof analyticsSubjectSchema>

export const groupingDimensionSchema = z.enum(["DIRECTOR", "SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
export type GroupingDimension = z.infer<typeof groupingDimensionSchema>

export const GROUPING_LABELS: Record<GroupingDimension, string> = {
  DIRECTOR: "Diretor",
  SENIOR_MANAGER: "Gerente Sênior",
  MANAGER: "Gerente",
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  TEAM: "Grupo",
  SUBTEAM: "Subgrupo",
}

export const subjectDescriptorSchema = z.object({ subject: analyticsSubjectSchema, label: z.string(), description: z.string().nullable() })
export type SubjectDescriptor = z.infer<typeof subjectDescriptorSchema>

export const breadcrumbEntrySchema = z.object({ kind: analyticsSubjectKindSchema, id: z.string(), label: z.string() })
export type BreadcrumbEntry = z.infer<typeof breadcrumbEntrySchema>

export const capabilitiesSchema = z.object({
  mode: z.enum(["EMPLOYEE", "STRUCTURE"]),
  canSeePrv: z.boolean(),
  canSeeStructureSummary: z.boolean(),
  canSeeDistribution: z.boolean(),
  canSeeMembers: z.boolean(),
  canDrillDown: z.boolean(),
  groupingOptions: z.array(groupingDimensionSchema),
  peopleTabLabel: z.enum(["Equipe", "Estrutura"]).nullable(),
  tabs: z.array(z.enum(["FOLLOW_UP", "INDICATORS", "PEOPLE", "PENDING", "STRUCTURE", "CALENDAR"])),
})
export type IndicatorViewCapabilities = z.infer<typeof capabilitiesSchema>

export const analyticsContextSchema = z.object({
  viewer: z.object({ personId: z.string(), role: z.string(), name: z.string() }),
  defaultSubject: subjectDescriptorSchema.nullable(),
  capabilities: capabilitiesSchema,
  pendingActionCount: z.number(),
  availablePeriods: z.array(z.object({ period: z.string(), label: z.string() })),
  currentPeriod: z.string(),
})
export type AnalyticsContext = z.infer<typeof analyticsContextSchema>

export const insightSchema = z.object({ tone: z.enum(["POSITIVE", "ATTENTION"]), text: z.string() })
export type Insight = z.infer<typeof insightSchema>

export const persistedInsightSchema = z.object({ id: z.string(), indicatorName: z.string(), summary: z.string(), recommendation: z.string(), publishedAt: z.string(), source: z.literal("FEEDBACK") })
export type PersistedInsight = z.infer<typeof persistedInsightSchema>

export const historyPointSchema = z.object({ period: z.string(), label: z.string(), value: z.number().nullable() })
export type HistoryPoint = z.infer<typeof historyPointSchema>

export const prvSummarySchema = z.object({
  period: z.string(),
  achievementPercent: z.number(),
  quartile: quartileSchema,
  target: z.number(),
  previousAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  source: z.string(),
})
export type PrvSummary = z.infer<typeof prvSummarySchema>

export const prvCompositionEntrySchema = z.object({ indicatorCode: z.string(), indicatorName: z.string(), achievementPercent: z.number().nullable(), weightPercent: z.number().nullable() })
export type PrvCompositionEntry = z.infer<typeof prvCompositionEntrySchema>

/** Tendência de PERFORMANCE (sinal pela direção oficial): IMPROVED = melhorou (TMA caiu, Qualidade subiu). */
export const performanceTrendSchema = z.enum(["IMPROVED", "DECLINED", "STABLE"]).nullable()
export type PerformanceTrend = z.infer<typeof performanceTrendSchema>

export const operationalWindowSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  daysWithData: z.number(),
  /** Dias ELEGÍVEIS (úteis desde a admissão, menos férias/afastamento). */
  expectedDays: z.number().nullable(),
  coverage: z.number().nullable(),
  sampleCount: z.number(),
  /** Dias PROGRAMADOS para trabalho na janela (antes das exclusões por admissão/situação). */
  businessDays: z.number().nullable().default(null),
  calendarDays: z.number().nullable().default(null),
  excludedByStatus: z.array(z.object({ status: z.string(), label: z.string().optional(), days: z.number() })).default([]),
  /** Exceções individuais (banco de horas, day off, folga extraordinária), com rótulo. */
  excludedByScheduleException: z.array(z.object({ code: z.string(), label: z.string().optional(), days: z.number() })).default([]),
  excludedByScheduledDayOff: z.number().default(0),
  excludedByHoliday: z.number().default(0),
  excludedByUnknownSchedule: z.number().default(0),
  /** Medições da janela em datas NÃO elegíveis — preservadas, fora do valor e da cobertura. */
  ignoredMeasurements: z.number().default(0),
  noEligibleDays: z.boolean().default(false),
  /** Dias elegíveis PRESUMIDOS sob fonte de situação funcional atrasada (0 = confiável ou não configurada). */
  unconfirmedDays: z.number().default(0),
  schedule: z.object({ basis: z.enum(["EXPLICIT_SCHEDULE", "LEGACY_WEEKDAY_FALLBACK", "UNKNOWN_SCHEDULE", "MIXED"]), freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]), scheduleType: z.enum(["FIVE_BY_TWO", "SIX_BY_ONE"]).nullable(), unconfirmedScheduleDays: z.number() }).nullable().default(null),
  holidays: z.object({ policy: z.enum(["IGNORE", "EXCLUDE_APPLICABLE_HOLIDAYS"]), confidence: z.enum(["CAPITAL_KNOWN", "CAPITAL_UNKNOWN"]), applicableHolidayDays: z.number() }).nullable().default(null),
  /** OBSERVADO (migration 068): dias com evidência de produção, plano superado pela realidade, produção ausente pós-turno, inconsistência de situação. */
  observed: z
    .object({
      workedObservedDays: z.number(),
      workedDespitePlan: z.object({ exception: z.array(z.object({ code: z.string(), label: z.string(), days: z.number() })), scheduledDayOff: z.number(), holiday: z.number(), unknownSchedule: z.number() }),
      missingExpectedProductionDays: z.number(),
      productionWithNonEligibleStatusDays: z.number(),
      evidenceSources: z.object({ interactions: z.boolean(), indicatorCodes: z.array(z.string()), enabled: z.boolean() }),
      waitingForSourcesDays: z.number().default(0),
      dataSourceDelayDays: z.number().default(0),
      unjustifiedAbsenceDays: z.number().default(0),
      justifiedAbsenceDays: z.number().default(0),
      workedDataMissingDays: z.number().default(0),
      unjustifiedAbsence: z.object({ policy: z.enum(["NO_SAMPLE", "ZERO_CONTRIBUTION"]), zeroContributionDays: z.number() }).nullable().default(null),
    })
    .nullable()
    .default(null),
})
export type OperationalWindow = z.infer<typeof operationalWindowSchema>

/** Quartil operacional com a POPULAÇÃO explícita — nunca "Q4" solto. */
export const operationalQuartileSchema = z.object({
  quartile: quartileSchema.nullable(),
  position: z.number().nullable(),
  rank: z.number().nullable().default(null),
  rankedCount: z.number(),
  populationCount: z.number(),
  eligiblePopulationCount: z.number().default(0),
  populationLabel: z.string(),
  populationType: z.enum(["SUBGROUP_PEERS", "GROUP_PEERS", "WORKFLOW_POPULATION", "NONE"]).default("NONE"),
  windowLabel: z.string().default(""),
  reason: z.enum(["OK", "INSUFFICIENT_POPULATION", "DIRECTION_UNSUPPORTED", "NO_VALUE", "BELOW_MINIMUM_COVERAGE", "NO_ELIGIBLE_DAYS", "EMPLOYMENT_STATUS_STALE", "WORK_SCHEDULE_STALE", "WORK_SCHEDULE_UNKNOWN"]),
})
export type OperationalQuartileView = z.infer<typeof operationalQuartileSchema>

export { EMPLOYMENT_STATUS_LABELS, employmentStatusLabel, type EmploymentStatus } from "@/schemas/people/employment-status.schema"

/** Situação funcional atual do colaborador (consumida da fonte de colaboradores — nunca calculada). */
export const STATUS_BASIS_LABELS = {
  EXPLICIT_PERIOD: "Período informado pela fonte",
  OPEN_PERIOD: "Situação em aberto desde a última carga",
  PRESUMED_AFTER_PERIOD: "Em produção presumido após o fim do período (retorno não confirmado)",
  PRESUMED_NO_HISTORY: "Em produção presumido (sem histórico de situação)",
} as const

export const employmentStatusPeriodViewSchema = z.object({
  periodId: z.string(),
  status: employmentStatusReadSchema,
  label: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  fromInferred: z.boolean().default(false),
  source: z.string().nullable().default(null),
  rawStatus: z.string().nullable().default(null),
})
export type EmploymentStatusPeriodView = z.infer<typeof employmentStatusPeriodViewSchema>

export const employmentStatusViewSchema = z.object({
  status: employmentStatusReadSchema,
  label: z.string(),
  since: z.string().nullable(),
  sinceInferred: z.boolean(),
  until: z.string().nullable(),
  source: z.string().nullable(),
  /** De onde vem a resposta (explícito, em aberto, presumido) — a INIA nunca apresenta presunção como certeza. */
  basis: z.enum(["EXPLICIT_PERIOD", "OPEN_PERIOD", "PRESUMED_AFTER_PERIOD", "PRESUMED_NO_HISTORY"]).default("PRESUMED_NO_HISTORY"),
  basisLabel: z.string().default(STATUS_BASIS_LABELS.PRESUMED_NO_HISTORY),
  periodId: z.string().nullable().default(null),
  origin: z.object({ sourceName: z.string(), feedName: z.string(), feedId: z.string(), sourceId: z.string() }).nullable().default(null),
  /** Confiança da fonte de situação funcional (Central de Dados): conexão saudável ≠ situação atualizada. */
  freshness: freshnessBlockSchema.default(UNKNOWN_FRESHNESS),
  /** Histórico (mais recente primeiro) e escala — só o que a fonte informou. */
  history: z.array(employmentStatusPeriodViewSchema).default([]),
  schedule: workScheduleViewSchema.nullable().default(null),
  /** Capital operacional informada pela empresa (jurisdição de feriados) — null = não informada. */
  operationalCapital: operationalCapitalViewSchema.default(null),
})
export type EmploymentStatusView = z.infer<typeof employmentStatusViewSchema>

/**
 * COMPARAÇÃO OPERACIONAL — escolhida na tela (URL `compare`, query `comparison`): qual janela
 * "atual" × "anterior" o acompanhamento operacional usa. ROLLING_7_DAYS = últimos 7 dias × 7
 * anteriores (padrão, comportamento original); as demais = período civil CORRENTE (parcial até
 * hoje) × o ANTERIOR completo. Os rótulos de cada janela vêm prontos do backend (`comparison`
 * dentro do trend/resumo) — aqui só o catálogo pro seletor.
 */
export const operationalComparisonSchema = z.enum(["ROLLING_7_DAYS", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER"])
export type OperationalComparison = z.infer<typeof operationalComparisonSchema>
export const DEFAULT_OPERATIONAL_COMPARISON: OperationalComparison = "ROLLING_7_DAYS"
export const OPERATIONAL_COMPARISON_LABELS: Record<OperationalComparison, string> = {
  ROLLING_7_DAYS: "Últimos 7 dias × 7 dias anteriores",
  WEEK: "Semana corrente (até hoje) × semana anterior",
  MONTH: "Mês corrente (até hoje) × mês anterior",
  TWO_MONTHS: "Bimestre corrente (até hoje) × bimestre anterior",
  QUARTER: "Trimestre corrente (até hoje) × trimestre anterior",
}

export const operationalComparisonViewSchema = z.object({
  kind: operationalComparisonSchema,
  label: z.string(),
  /** "Últimos 7 dias" / "Mês corrente (até hoje)" — rótulo da janela atual. */
  currentLabel: z.string(),
  /** "7 dias anteriores" / "Mês anterior" — rótulo da janela anterior. */
  previousLabel: z.string(),
  /** "nos últimos 7 dias" / "no mês corrente (até hoje)" — frase com preposição pra compor sentenças. */
  currentPhrase: z.string(),
  /** "os 7 dias anteriores" / "o mês anterior" — complemento de "comparado com …". */
  previousPhrase: z.string(),
  /** "7d" / "mês" — sufixo do chip "Operacional …". */
  shortLabel: z.string(),
  currentIsPartial: z.boolean(),
})
export type OperationalComparisonView = z.infer<typeof operationalComparisonViewSchema>

/**
 * ACOMPANHAMENTO OPERACIONAL (camada 1 — medição diária, calculado pela INIA pelo mesmo resolvedor
 * das Conditions/Ranking): janela atual × anterior da comparação escolhida, variação de performance,
 * quartil OPERACIONAL entre os pares e cobertura. Nunca é o atingimento/quartil/PRV do fechamento oficial.
 */
export const operationalTrendSchema = z.object({
  indicatorCode: z.string(),
  comparison: operationalComparisonViewSchema,
  /** Dias de calendário de cada janela e, quando a atual é um período civil em curso, o tamanho do período inteiro ("17 de 61 dias"). */
  windowCalendarDays: z.number().default(0),
  previousWindowCalendarDays: z.number().default(0),
  currentPeriodCalendarDays: z.number().nullable().default(null),
  aggregation: z.string(),
  aggregationLabel: z.string(),
  method: z.string().nullable(),
  unit: z.string(),
  direction: indicatorDirectionSchema,
  current: operationalWindowSchema,
  previous: operationalWindowSchema,
  changePercent: z.number().nullable(),
  performanceChangePercent: z.number().nullable(),
  performanceTrend: performanceTrendSchema,
  /** SOMA em período corrente parcial × anterior completo não é comparável — a variação fica nula com o motivo. */
  changeUnavailableReason: z.enum(["PARTIAL_PERIOD_SUM"]).nullable().default(null),
  /** Padrões do catálogo do indicador — a tela nunca inventa limiar. */
  minimumCoverage: z.number().nullable(),
  minimumSampleSize: z.number().nullable().default(null),
  sufficiencyRule: z.enum(["COVERAGE", "SAMPLE", "NONE"]).default("NONE"),
  sufficient: z.boolean(),
  quartile: operationalQuartileSchema,
})
export type OperationalTrend = z.infer<typeof operationalTrendSchema>

export const operationalStructureIndicatorSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  direction: indicatorDirectionSchema,
  aggregation: z.string(),
  aggregationLabel: z.string(),
  method: z.string().nullable(),
  currentValue: z.number().nullable(),
  previousValue: z.number().nullable(),
  changePercent: z.number().nullable(),
  performanceChangePercent: z.number().nullable(),
  performanceTrend: performanceTrendSchema,
  changeUnavailableReason: z.enum(["PARTIAL_PERIOD_SUM"]).nullable().default(null),
  membersWithData: z.number(),
  membersWithSufficientData: z.number(),
  memberCount: z.number(),
  eligibleMemberCount: z.number().default(0),
  minimumCoverage: z.number().nullable().default(null),
  minimumSampleSize: z.number().nullable().default(null),
  sufficiencyRule: z.enum(["COVERAGE", "SAMPLE", "NONE"]).default("NONE"),
})
export type OperationalStructureIndicatorSummary = z.infer<typeof operationalStructureIndicatorSummarySchema>

export const operationalStructureSummarySchema = z.object({
  comparison: operationalComparisonViewSchema,
  windowLabel: z.string(),
  previousWindowLabel: z.string(),
  windowCalendarDays: z.number().default(0),
  previousWindowCalendarDays: z.number().default(0),
  currentPeriodCalendarDays: z.number().nullable().default(null),
  memberCount: z.number().default(0),
  eligibleMemberCount: z.number().default(0),
  method: z.string(),
  indicators: z.array(operationalStructureIndicatorSummarySchema),
})
export type OperationalStructureSummary = z.infer<typeof operationalStructureSummarySchema>

/** Capacidades do CATÁLOGO de indicadores (migration 055) — a tela descreve qualquer indicador
 * por unidade/direção/capacidades, nunca por componente específico de um código. Opcional pra
 * tolerar backend anterior. */
export const indicatorCapabilitiesSchema = z.object({
  operationalEnabled: z.boolean(),
  operationalAggregation: z.string(),
  officialClosureSupported: z.boolean(),
})
export type IndicatorCapabilities = z.infer<typeof indicatorCapabilitiesSchema>

export const employeeIndicatorSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  direction: indicatorDirectionSchema,
  capabilities: indicatorCapabilitiesSchema.optional(),
  value: z.number().nullable(),
  targetValue: z.number().nullable(),
  achievementPercent: z.number().nullable(),
  weightPercent: z.number().nullable(),
  quartile: quartileSchema.nullable(),
  withinTarget: z.boolean().nullable(),
  previousAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  history: z.array(historyPointSchema),
  positives: z.array(insightSchema),
  attentionPoints: z.array(insightSchema),
  persistedInsights: z.array(persistedInsightSchema),
  /** null = indicador sem medição operacional diária (sem card operacional). */
  operationalTrend: operationalTrendSchema.nullable().default(null),
})
export type EmployeeIndicatorSummary = z.infer<typeof employeeIndicatorSummarySchema>

export const employeeIndicatorDashboardSchema = z.object({
  mode: z.literal("EMPLOYEE"),
  subject: subjectDescriptorSchema,
  breadcrumb: z.array(breadcrumbEntrySchema),
  period: z.string(),
  periodLabel: z.string(),
  employmentStatus: employmentStatusViewSchema.optional(),
  prv: prvSummarySchema.nullable(),
  prvHistory: z.array(historyPointSchema),
  prvComposition: z.array(prvCompositionEntrySchema),
  prvPositives: z.array(insightSchema),
  prvAttentionPoints: z.array(insightSchema),
  indicators: z.array(employeeIndicatorSummarySchema),
})
export type EmployeeIndicatorDashboard = z.infer<typeof employeeIndicatorDashboardSchema>

export const quartileDistributionSchema = z.object({ Q1: z.number(), Q2: z.number(), Q3: z.number(), Q4: z.number(), NO_DATA: z.number() })
export type QuartileDistribution = z.infer<typeof quartileDistributionSchema>

export const structureIndicatorSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  direction: indicatorDirectionSchema,
  capabilities: indicatorCapabilitiesSchema.optional(),
  consolidatedAchievementPercent: z.number().nullable(),
  membersWithData: z.number(),
  membersBelowTarget: z.number(),
  previousConsolidatedAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  distribution: quartileDistributionSchema,
  history: z.array(historyPointSchema),
  positives: z.array(insightSchema),
  attentionPoints: z.array(insightSchema),
})
export type StructureIndicatorSummary = z.infer<typeof structureIndicatorSummarySchema>

export const structureIndicatorDashboardSchema = z.object({
  mode: z.literal("STRUCTURE"),
  subject: subjectDescriptorSchema,
  breadcrumb: z.array(breadcrumbEntrySchema),
  period: z.string(),
  periodLabel: z.string(),
  memberCount: z.number(),
  membersWithData: z.number(),
  consolidatedAchievementPercent: z.number().nullable(),
  previousConsolidatedAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  consolidationMethod: z.string(),
  history: z.array(historyPointSchema),
  prvDistribution: quartileDistributionSchema,
  indicators: z.array(structureIndicatorSummarySchema),
  positives: z.array(insightSchema),
  attentionPoints: z.array(insightSchema),
  groupingOptions: z.array(groupingDimensionSchema),
  operationalSummary: operationalStructureSummarySchema.nullable().default(null),
})
export type StructureIndicatorDashboard = z.infer<typeof structureIndicatorDashboardSchema>

export const indicatorDashboardSchema = z.discriminatedUnion("mode", [employeeIndicatorDashboardSchema, structureIndicatorDashboardSchema])
export type IndicatorDashboard = z.infer<typeof indicatorDashboardSchema>

export const structureGroupSummarySchema = z.object({
  subject: analyticsSubjectSchema.nullable(),
  label: z.string(),
  description: z.string().nullable(),
  memberCount: z.number(),
  membersWithData: z.number(),
  consolidatedAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  attentionCount: z.number(),
  improvingCount: z.number(),
  noDataCount: z.number(),
  topAttentionIndicators: z.array(z.object({ code: z.string(), name: z.string(), consolidatedAchievementPercent: z.number() })),
})
export type StructureGroupSummary = z.infer<typeof structureGroupSummarySchema>

export const structureBreakdownSchema = z.object({
  subject: subjectDescriptorSchema,
  period: z.string(),
  groupBy: groupingDimensionSchema,
  groupByLabel: z.string(),
  groups: z.array(structureGroupSummarySchema),
})
export type StructureBreakdown = z.infer<typeof structureBreakdownSchema>

export const indicatorMemberRowSchema = z.object({
  personId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  jobTitle: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamName: z.string().nullable(),
  value: z.number().nullable(),
  targetValue: z.number().nullable(),
  achievementPercent: z.number().nullable(),
  quartile: quartileSchema.nullable(),
  withinTarget: z.boolean().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
})
export type IndicatorMemberRow = z.infer<typeof indicatorMemberRowSchema>

export const indicatorMembersPageSchema = z.object({
  indicator: z.object({ code: z.string(), name: z.string(), unit: z.string(), direction: indicatorDirectionSchema, capabilities: indicatorCapabilitiesSchema.optional() }),
  period: z.string(),
  items: z.array(indicatorMemberRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})
export type IndicatorMembersPage = z.infer<typeof indicatorMembersPageSchema>

export const memberSituationSchema = z.enum(["NO_DATA", "BELOW_REFERENCE", "IMPROVING", "WITHIN_REFERENCE"])
export type MemberSituation = z.infer<typeof memberSituationSchema>

export const MEMBER_SITUATION_LABELS: Record<MemberSituation, string> = {
  NO_DATA: "Sem dados",
  BELOW_REFERENCE: "Abaixo da referência",
  IMPROVING: "Em evolução",
  WITHIN_REFERENCE: "Dentro da referência",
}

export const teamMemberSummarySchema = z.object({
  personId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  jobTitle: z.string().nullable(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  situation: memberSituationSchema,
  prvAchievementPercent: z.number().nullable(),
  prvQuartile: quartileSchema.nullable(),
  averageAchievementPercent: z.number().nullable(),
  deltaPp: z.number().nullable(),
  trend: trendSchema,
  indicatorsWithData: z.number(),
  indicatorsBelowTarget: z.number(),
  attentionIndicators: z.array(z.object({ code: z.string(), name: z.string(), achievementPercent: z.number().nullable() })),
  followUps: z.object({ total: z.number(), unacknowledged: z.number() }),
  pendingReviews: z.number(),
})
export type TeamMemberSummary = z.infer<typeof teamMemberSummarySchema>

export const teamSummaryCountsSchema = z.object({
  memberCount: z.number(),
  withinReference: z.number(),
  belowReference: z.number(),
  improving: z.number(),
  noData: z.number(),
  unacknowledgedFollowUps: z.number(),
  pendingReviews: z.number(),
})
export type TeamSummaryCounts = z.infer<typeof teamSummaryCountsSchema>

export const structureUnitSummarySchema = structureGroupSummarySchema.extend({
  subject: analyticsSubjectSchema,
  leader: z.object({ personId: z.string(), name: z.string(), avatarUrl: z.string().nullable(), role: z.string() }).nullable(),
  pendingReviews: z.number(),
})
export type StructureUnitSummary = z.infer<typeof structureUnitSummarySchema>

export const teamOverviewSchema = z.object({
  subject: subjectDescriptorSchema,
  breadcrumb: z.array(breadcrumbEntrySchema),
  period: z.string(),
  periodLabel: z.string(),
  summary: teamSummaryCountsSchema,
  units: z.array(structureUnitSummarySchema),
  unitsGroupBy: groupingDimensionSchema.nullable(),
  showsMembersDirectly: z.boolean(),
  directMemberCount: z.number(),
  filterOptions: z.object({
    teams: z.array(z.object({ id: z.string(), name: z.string() })),
    subteams: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() })),
    indicators: z.array(z.object({ code: z.string(), name: z.string() })),
  }),
})
export type TeamOverview = z.infer<typeof teamOverviewSchema>

export const teamMembersPageSchema = z.object({ items: z.array(teamMemberSummarySchema), total: z.number(), page: z.number(), pageSize: z.number() })
export type TeamMembersPage = z.infer<typeof teamMembersPageSchema>

export const followUpItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["FEEDBACK", "ALERT", "REPORT"]),
  category: z.enum(["INDICATOR", "MONITORING", "WORKFLOW_OUTPUT", "WORKFLOW_HUMAN_REVIEW", "WORKFLOW_ESCALATION", "INTERVENTION", "REPORT", "REPORT_NOT_FORWARDED", "OTHER"]),
  title: z.string(),
  /** Metadado do título ("Atendimento de 29/09/2026") — `FEEDBACK_HEADING_V1`. */
  subtitle: z.string().nullish(),
  summary: z.string(),
  detail: z.string().nullable(),
  severity: z.enum(["INFO", "MEDIUM", "HIGH", "CRITICAL"]).nullable(),
  operator: z.object({ personId: z.string(), name: z.string() }).nullable(),
  caseId: z.string().nullable(),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  /** Motivo do feedback — o MESMO cabeçalho do Acompanhamento do colaborador (só em feedbacks; ausente/null = alerta ou desconhecido). */
  origin: feedbackOriginSchema.nullable().optional(),
  feedback: z
    .object({
      evidenceFound: z.string(),
      observedBehavior: z.string(),
      relatedProcedure: z.string(),
      recommendation: z.string(),
      /** Materiais de apoio recomendados pela IA, resolvidos pelo backend para este viewer. */
      supportMaterials: z.array(feedbackSupportMaterialSchema).default([]),
      /** Feedback por Flag V2 — narrativa + detalhes (null = feedback anterior). */
      view: feedbackViewSchema.nullable().optional(),
      /** Indicator Diagnosis V1 — visão técnica do diagnóstico do fechamento (só na leitura de quem lidera). */
      supervisorView: prvSupervisorViewSchema.nullable().optional(),
    })
    .nullable(),
  /** Entrega ou aviso de report recorrente (kind = REPORT) — a versão do escopo de QUEM LÊ. Validado no item com o schema de
   * reports (`reportDeliveryContentSchema`), que depende do schema da liderança — aqui sem tipo para não criar ciclo de importação. */
  report: z.unknown().optional(),
})
export type FollowUpItem = z.infer<typeof followUpItemSchema>

/** Página de `GET /analytics/follow-ups` (mais recente primeiro). `nextCursor` = cursor opaco para pedir a seguinte; null = o feed acaba
 * nesta página. */
export const followUpFeedSchema = z.object({ items: z.array(followUpItemSchema), nextCursor: z.string().nullable() })
export type FollowUpFeed = z.infer<typeof followUpFeedSchema>
