import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"
import type { AnalyticsSubject } from "../../performance-analytics/domain/analytics-subject.js"
import type { GroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { MemberSituation } from "../../performance-analytics/domain/view-models.js"
import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import type { ConcentrationResult, Decile } from "./analytic-rules.js"

/**
 * Cartões de dados da liderança — o MESMO payload serve à rota determinística (`/api/v1/leadership/*`), ao chat (evento
 * `analytics`, gravado em `assistant_interactions.tool_calls`) e ao cartão "Onde atuar hoje". Os números vêm daqui, nunca do
 * texto do modelo. As rotas da tela (links) são montadas no frontend a partir de `subject`/`period`/`indicatorCode`/`personId`.
 */

/** `subject`: uma estrutura — ou o próprio colaborador (EMPLOYEE), nos cartões "meus resultados" do operador. */
export type StructureRef = { subject: StructureAnchor | { kind: "EMPLOYEE"; employeeId: string }; label: string; description: string | null }
export type IndicatorRef = { code: string; name: string; unit: string; direction: IndicatorDirection }

export type AnalysisMember = {
  personId: string
  name: string
  value: number | null
  targetValue: number | null
  achievementPercent: number | null
  position: number | null
  decile: Decile | null
  officialQuartile: Quartile | null
  within: boolean | null
  unitLabel: string | null
}

export type AnalysisUnit = {
  key: string
  label: string
  description: string | null
  /** Navegável (drill-down); null = pessoas ligadas diretamente à estrutura, sem gestor intermediário. */
  subject: AnalyticsSubject | null
  memberCount: number
  membersWithData: number
  withReference: number
  within: number
  below: number
  belowPercent: number | null
  /** Participação da unidade no total de pessoas fora da estrutura (volume de desvios). */
  shareOfDeviationsPercent: number | null
  averageAchievementPercent: number | null
  comparable: boolean
  comparabilityReasons: string[]
  groupName: string | null
}

export type IndicatorAnalysisCard = {
  type: "INDICATOR_ANALYSIS"
  generatedAt: string
  structure: StructureRef
  period: string
  periodLabel: string
  indicator: IndicatorRef
  population: { memberCount: number; membersWithData: number; withReference: number; noData: number; coveragePercent: number | null }
  reference: { within: number; below: number; withinPercent: number | null; belowPercent: number | null }
  previous: { period: string; periodLabel: string; withReference: number; belowPercent: number | null; deltaPp: number | null }
  averageAchievementPercent: number | null
  ranking: { reason: "OK" | "DIRECTION_UNSUPPORTED" | "NO_DATA"; rankedCount: number; best: AnalysisMember[]; worst: AnalysisMember[] }
  officialQuartiles: Record<Quartile | "NO_DATA", number>
  deciles: { reason: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED"; rankedCount: number; counts: Record<Decile, number> }
  units: AnalysisUnit[]
  unitsGroupBy: GroupingDimension | null
  unitsGroupByLabel: string | null
  concentration: ConcentrationResult | null
  comparison: { groups: { teamName: string | null; unitKeys: string[] }[]; note: string | null }
  limitations: string[]
  methods: string[]
}

export type OverviewIndicator = IndicatorRef & {
  withReference: number
  below: number
  belowPercent: number | null
  previousBelowPercent: number | null
  deltaPp: number | null
  averageAchievementPercent: number | null
}

export type OverviewUnit = {
  label: string
  description: string | null
  subject: AnalyticsSubject
  memberCount: number
  membersWithData: number
  /** Pessoas com ALGUM indicador abaixo da referência (situação do colaborador). */
  belowReferenceCount: number
  belowReferencePercent: number | null
  topAttentionIndicators: { code: string; name: string }[]
}

export type StructureOverviewCard = {
  type: "STRUCTURE_OVERVIEW"
  generatedAt: string
  structure: StructureRef
  period: string
  periodLabel: string
  members: { total: number; withData: number; belowReference: number; withinReference: number; improving: number; noData: number; coveragePercent: number | null }
  indicators: OverviewIndicator[]
  units: OverviewUnit[]
  unitsGroupByLabel: string | null
  awaitingAcknowledgement: number
  /** Mês corrente pela MEDIÇÃO DIÁRIA (parcial, sem meta oficial) — null quando não há indicador diário. */
  operational: { label: string; windowLabel: string; previousWindowLabel: string; indicators: { code: string; name: string; current: string; previous: string; trend: "melhorou" | "piorou" | "estável" | null; coverage: string }[] } | null
  limitations: string[]
  methods: string[]
}

export type PeopleCardMember = {
  personId: string
  name: string
  jobTitle: string | null
  situation: MemberSituation
  averageAchievementPercent: number | null
  attentionIndicators: { code: string; name: string; achievementPercent: number | null }[]
  /** Só no filtro por indicador: a linha oficial da pessoa NESSE indicador. */
  indicator: { value: number | null; targetValue: number | null; achievementPercent: number | null } | null
  awaitingAcknowledgement: number
  pendingReviews: number
}

export type PeopleCard = {
  type: "PEOPLE"
  generatedAt: string
  structure: StructureRef
  period: string
  periodLabel: string
  filter: { situation: MemberSituation | null; indicatorCode: string | null; indicatorName: string | null; pendingOnly: boolean; label: string }
  total: number
  members: PeopleCardMember[]
  methods: string[]
}

export type PriorityKind = "PENDING_DECISION" | "INDICATOR_DEVIATION" | "UNIT_CONCENTRATION" | "AWAITING_ACKNOWLEDGEMENT" | "DATA_GAP"
export type PriorityTarget =
  | { kind: "PENDING"; operatorId: string | null; caseId: string | null }
  | { kind: "INDICATOR"; subject: AnalyticsSubject; indicatorCode: string; indicatorName: string; period: string }
  | { kind: "TEAM"; subject: AnalyticsSubject; period: string; situation: MemberSituation | null; indicatorCode: string | null }
  | { kind: "FOLLOW_UP_PENDING_ACK" }

export type PriorityItem = {
  kind: PriorityKind
  severity: "HIGH" | "MEDIUM" | "LOW"
  title: string
  evidence: string
  target: PriorityTarget
  /** Pergunta para aprofundar com a INIA (nada é enviado sozinho). */
  question: string | null
}

export type PrioritiesCard = {
  type: "PRIORITIES"
  generatedAt: string
  structure: StructureRef | null
  period: string | null
  periodLabel: string | null
  items: PriorityItem[]
  /** Ordem aplicada — a mesma em todos os níveis. */
  method: string
  limitations: string[]
}

export type QueryTableColumn = { key: string; label: string; numeric: boolean }
/** Linha já formatada (pt-BR, unidade do indicador); `subject`/`personId` permitem o link de aprofundamento. */
export type QueryTableRow = { cells: Record<string, string>; subject: AnalyticsSubject | null; personId: string | null }

/** Resultado da consulta flexível (`leadership_indicator_query`): uma tabela calculada no backend, com escopo, fonte e método. */
export type QueryTableCard = {
  type: "QUERY_TABLE"
  generatedAt: string
  structure: StructureRef
  source: "OFFICIAL" | "OPERATIONAL"
  title: string
  /** "Competência oficial: Agosto 2026" / "01/10/2026 → 15/10/2026 × 01/09/2026 → 30/09/2026 (parcial, medição diária)". */
  scopeNote: string
  /** Competência oficial de referência das linhas (links); null na fonte operacional. */
  period: string | null
  indicatorCode: string | null
  columns: QueryTableColumn[]
  rows: QueryTableRow[]
  /** Linhas antes do limite. */
  totalRows: number
  /** Achados-resumo calculados (ex.: tamanho dos grupos, médias, onde estão os piores) — fatos, não limitações. */
  highlights: string[]
  methods: string[]
  limitations: string[]
}

export type LeadershipCard = IndicatorAnalysisCard | StructureOverviewCard | PeopleCard | PrioritiesCard | QueryTableCard
