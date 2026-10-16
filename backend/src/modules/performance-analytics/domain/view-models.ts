import type { FeedbackView } from "../../reliable-feedback/domain/feedback-view.js"
import type { PrvSupervisorView } from "../../reliable-feedback/domain/prv-closing-views.js"
import type { FeedbackSupportMaterialView } from "../../feedbacks/application/feedback-support-materials.js"
import type { FeedbackOrigin } from "../../feedbacks/domain/feedback-origin.js"
import type { EmploymentStatus } from "../../people/domain/employment-status.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"
import type { AnalyticsSubject, AnalyticsSubjectKind } from "./analytics-subject.js"
import type { Trend } from "./achievement-math.js"
import type { GroupingDimension } from "./hierarchy-levels.js"
import type { OperationalComparisonView } from "./operational-comparison.js"
import type { IndicatorViewCapabilities } from "./view-capabilities.js"

/**
 * Contratos (view-models) das áreas de Indicadores e Equipe/Estrutura. O backend agrega e entrega
 * pronto; o frontend apresenta, filtra visualmente e navega — nenhuma regra de PRV, meta, média ou
 * escopo é recalculada em React. Todo número que pode não existir é `number | null` ("Sem dados"),
 * nunca 0 por omissão.
 */

export type PeriodOption = { period: string; label: string }

export type BreadcrumbEntry = { kind: AnalyticsSubjectKind; id: string; label: string }

export type SubjectDescriptor = {
  subject: AnalyticsSubject
  label: string
  /** Subtítulo curto (cargo/grupo) pra dar contexto ao lado do nome. */
  description: string | null
}

/** Quem está olhando e o que pode ver — a primeira coisa que o frontend carrega. */
export type AnalyticsContext = {
  viewer: { personId: string; role: string; name: string }
  /** Sujeito padrão deste papel (o próprio colaborador, ou a própria estrutura). `null` quando o
   * papel não tem estrutura vinculada (ex.: ADMIN) — a tela mostra um estado vazio explicado. */
  defaultSubject: SubjectDescriptor | null
  capabilities: IndicatorViewCapabilities
  /** Revisões humanas que ainda exigem decisão do viewer (mesma fonte da Surface Pendências). */
  pendingActionCount: number
  /** Competências com dado oficial dentro do escopo do viewer (mais recente primeiro). */
  availablePeriods: PeriodOption[]
  currentPeriod: string
}

export type Insight = { tone: "POSITIVE" | "ATTENTION"; text: string }

/** Análise de IA já persistida (feedback INDICATOR publicado) — nunca gerada na renderização. */
export type PersistedInsight = {
  id: string
  indicatorName: string
  summary: string
  recommendation: string
  publishedAt: string
  source: "FEEDBACK"
}

export type HistoryPoint = { period: string; label: string; value: number | null }

export type PrvSummary = {
  period: string
  achievementPercent: number
  quartile: Quartile
  target: number
  previousAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  source: string
}

export type PrvCompositionEntry = {
  indicatorCode: string
  indicatorName: string
  achievementPercent: number | null
  weightPercent: number | null
}

/** Capacidades do catálogo — decidem o que a tela pode mostrar (ex.: tendência operacional só
 * com medição operacional habilitada), nunca um componente por indicador. */
export type IndicatorCapabilitiesView = { operationalEnabled: boolean; operationalAggregation: string; officialClosureSupported: boolean }

/** Tendência: sinal pela direção oficial do indicador — IMPROVED = performance melhorou (TMA caiu, Qualidade subiu). */
export type PerformanceTrend = "IMPROVED" | "DECLINED" | "STABLE" | null

export type OperationalWindowView = {
  /** "10/09/2026 → 16/09/2026" no calendário local da organização. */
  label: string
  /** Valor na unidade real do indicador (segundos, %, nota…) — nunca atingimento. */
  value: number | null
  daysWithData: number
  /** Dias ELEGÍVEIS (dias úteis desde a admissão, menos férias/afastamento) — denominador da cobertura. */
  expectedDays: number | null
  coverage: number | null
  sampleCount: number
  /** Dias PROGRAMADOS para trabalho na janela antes das exclusões por admissão/situação (null quando a janela é pooled). */
  businessDays: number | null
  /** Dias do calendário local na janela (null quando pooled). */
  calendarDays: number | null
  /** Dias excluídos por situação funcional, por status (ex.: FERIAS: 3, INSS: 2), com rótulo real. */
  excludedByStatus: { status: string; label: string; days: number }[]
  /** Exceções individuais (banco de horas, day off, folga extraordinária), por código, com rótulo. */
  excludedByScheduleException: { code: string; label: string; days: number }[]
  /** Folgas programadas (escala explícita ou fim de semana do fallback). */
  excludedByScheduledDayOff: number
  /** Feriado aplicável tratado como folga (só no fallback legado, só com política EXCLUDE). */
  excludedByHoliday: number
  /** Medições da janela em datas NÃO elegíveis — preservadas no banco, fora do valor e da cobertura. */
  ignoredMeasurements: number
  /** Regime 6x1 sem folga informada — dia fora do cálculo sem virar "deveria produzir". */
  excludedByUnknownSchedule: number
  /** Nenhum dia elegível na janela (situação não produtiva/folga a janela inteira) — nunca vira 0. */
  noEligibleDays: boolean
  /** Dias elegíveis PRESUMIDOS sob fonte de situação funcional atrasada (0 = confiável ou não configurada). */
  unconfirmedDays: number
  /** Escala: base predominante e dias elegíveis cuja escala é só presumida (fallback legado / fonte de escala atrasada). */
  schedule: { basis: "EXPLICIT_SCHEDULE" | "LEGACY_WEEKDAY_FALLBACK" | "UNKNOWN_SCHEDULE" | "MIXED"; freshness: "FRESH" | "STALE" | "UNKNOWN"; scheduleType: "FIVE_BY_TWO" | "SIX_BY_ONE" | null; unconfirmedScheduleDays: number } | null
  /** Feriados: política da organização e se estadual/municipal puderam ser determinados (capital operacional). */
  holidays: { policy: "IGNORE" | "EXCLUDE_APPLICABLE_HOLIDAYS"; confidence: "CAPITAL_KNOWN" | "CAPITAL_UNKNOWN"; applicableHolidayDays: number } | null
  /**
   * OBSERVADO (PLANEJADO × OBSERVADO): dias elegíveis com evidência confiável de produção; dias trabalhados
   * que o plano dizia folga/day off/banco (divergência preservada); dias programados sem produção após o
   * turno (pendência); produção com situação não produtiva (inconsistência); fontes de evidência.
   */
  observed: {
    workedObservedDays: number
    workedDespitePlan: { exception: { code: string; label: string; days: number }[]; scheduledDayOff: number; holiday: number; unknownSchedule: number }
    missingExpectedProductionDays: number
    productionWithNonEligibleStatusDays: number
    evidenceSources: { interactions: boolean; indicatorCodes: string[]; enabled: boolean }
    /** Disponibilidade (migration 069): dias ainda aguardando dados (D-1/D-2, RH) e dias com fonte atrasada — nunca cobrados. */
    waitingForSourcesDays: number
    dataSourceDelayDays: number
    /** Classificação humana: falta injustificada (continua elegível), ausência justificada (fora), dados não chegaram (elegível). */
    unjustifiedAbsenceDays: number
    justifiedAbsenceDays: number
    workedDataMissingDays: number
    /** Como ESTE indicador tratou a falta injustificada: política e dias com contribuição zero (nunca medição). */
    unjustifiedAbsence: { policy: "NO_SAMPLE" | "ZERO_CONTRIBUTION"; zeroContributionDays: number } | null
  } | null
}

/** Quartil OPERACIONAL com a população EXPLÍCITA: quem foi comparado, quantos, posição. Nunca "Q4" solto. */
export type OperationalQuartileView = {
  quartile: Quartile | null
  position: number | null
  /** Sinônimo de position ("95º de 108") — mantido pra leitura direta na UI. */
  rank: number | null
  rankedCount: number
  /** Tamanho da população comparada (pares). */
  populationCount: number
  /** Quantos dos pares têm ao menos 1 dia elegível na janela. */
  eligiblePopulationCount: number
  /** "Subgrupo Cobrança Ativa" / "Grupo B2C" — os pares considerados. */
  populationLabel: string
  populationType: "SUBGROUP_PEERS" | "GROUP_PEERS" | "WORKFLOW_POPULATION" | "NONE"
  windowLabel: string
  reason: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED" | "NO_VALUE" | "BELOW_MINIMUM_COVERAGE" | "NO_ELIGIBLE_DAYS" | "EMPLOYMENT_STATUS_STALE" | "WORK_SCHEDULE_STALE" | "WORK_SCHEDULE_UNKNOWN"
}

/**
 * ACOMPANHAMENTO OPERACIONAL (camada 1 — medição diária, calculado pela INIA) de um indicador de um
 * colaborador: janela atual × anterior da comparação escolhida na tela (últimos 7 dias × 7
 * anteriores por padrão; semana/mês/bimestre/trimestre corrente × anterior), variação de
 * performance, quartil OPERACIONAL entre os pares e cobertura. Vive ao lado do fechamento oficial no mesmo card, nunca se mistura com
 * atingimento/quartil/PRV oficiais. Ausente no indicador = sem medição diária (sem card).
 */
export type OperationalTrendView = {
  indicatorCode: string
  /** Comparação em vigor (rótulos prontos: "Últimos 7 dias" / "Mês corrente (até hoje)"…). */
  comparison: OperationalComparisonView
  /** Dias de calendário de cada janela ("17 dias" × "62 dias") e, quando a atual é um período civil em curso, o tamanho do período inteiro ("17 de 61 dias"). */
  windowCalendarDays: number
  previousWindowCalendarDays: number
  currentPeriodCalendarDays: number | null
  aggregation: string
  aggregationLabel: string
  method: string | null
  unit: string
  direction: IndicatorDirection
  current: OperationalWindowView
  previous: OperationalWindowView
  /** (atual − anterior) ÷ anterior × 100, na unidade do indicador. */
  changePercent: number | null
  performanceChangePercent: number | null
  performanceTrend: PerformanceTrend
  /** Por que não há variação mesmo com valor nas duas janelas: SOMA em período corrente parcial × anterior completo não é comparável. */
  changeUnavailableReason: "PARTIAL_PERIOD_SUM" | null
  /** Padrões do CATÁLOGO do indicador (IndicatorDefinition) — a tela nunca inventa limiar. */
  minimumCoverage: number | null
  minimumSampleSize: number | null
  sufficiencyRule: "COVERAGE" | "SAMPLE" | "NONE"
  /** false = "Sem dados operacionais suficientes" (sem medição, sem dia elegível, cobertura/amostra abaixo do padrão do indicador). */
  sufficient: boolean
  quartile: OperationalQuartileView
}

export type OperationalStructureIndicatorSummary = {
  code: string
  name: string
  unit: string
  direction: IndicatorDirection
  aggregation: string
  aggregationLabel: string
  method: string | null
  /** Agregado POOLED dos membros (Σ numerador ÷ Σ denominador) — nunca média de médias. */
  currentValue: number | null
  previousValue: number | null
  changePercent: number | null
  performanceChangePercent: number | null
  performanceTrend: PerformanceTrend
  changeUnavailableReason: "PARTIAL_PERIOD_SUM" | null
  membersWithData: number
  membersWithSufficientData: number
  memberCount: number
  /** Membros com ao menos 1 dia elegível na janela ("22 de 25 colaboradores elegíveis"). */
  eligibleMemberCount: number
  minimumCoverage: number | null
  minimumSampleSize: number | null
  sufficiencyRule: "COVERAGE" | "SAMPLE" | "NONE"
}

export type OperationalStructureSummary = {
  comparison: OperationalComparisonView
  windowLabel: string
  previousWindowLabel: string
  windowCalendarDays: number
  previousWindowCalendarDays: number
  /** Tamanho do período civil corrente inteiro quando a janela atual é parcial (null em "últimos 7 dias"). */
  currentPeriodCalendarDays: number | null
  memberCount: number
  eligibleMemberCount: number
  method: string
  indicators: OperationalStructureIndicatorSummary[]
}

export type EmployeeIndicatorSummary = {
  code: string
  name: string
  unit: string
  direction: IndicatorDirection
  capabilities: IndicatorCapabilitiesView
  value: number | null
  targetValue: number | null
  /** Oficial (`achievement_percent`); null = sem dado oficial de atingimento nesta competência. */
  achievementPercent: number | null
  weightPercent: number | null
  quartile: Quartile | null
  /** Meta batida? Deriva de valor x meta x direção (fato determinístico), ou null sem meta. */
  withinTarget: boolean | null
  previousAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  history: HistoryPoint[]
  positives: Insight[]
  attentionPoints: Insight[]
  persistedInsights: PersistedInsight[]
  /** Acompanhamento operacional (camada 1) — null quando o indicador não tem medição diária. */
  operationalTrend: OperationalTrendView | null
}

/** Situação funcional ATUAL do colaborador (people/domain/employment-status.ts) — consumida da fonte de colaboradores, nunca calculada. */
export type EmploymentStatusView = {
  /** Uma das nove situações reais (people/domain/employment-status.ts). */
  status: EmploymentStatus
  label: string
  /** Desde quando (AAAA-MM-DD) — null quando não há período registrado (ATIVO presumido). */
  since: string | null
  /** true = a data de início foi inferida da carga (fonte não informou). */
  sinceInferred: boolean
  /** Fim previsto, quando a fonte informou (ex.: férias 09–20). */
  until: string | null
  source: string | null
  /** De onde vem a resposta: período explícito, período em aberto, presumido após um período terminar, presumido sem histórico. */
  basis: "EXPLICIT_PERIOD" | "OPEN_PERIOD" | "PRESUMED_AFTER_PERIOD" | "PRESUMED_NO_HISTORY"
  basisLabel: string
  /** Id do período vigente (lineage: "por que a INIA acha que está de férias?"), quando há período. */
  periodId: string | null
  /** Fonte/feed da Central que gravou o período vigente, quando identificável. */
  origin: { sourceName: string; feedName: string; feedId: string; sourceId: string } | null
  /** Confiança da fonte de situação funcional (metadata da Central) — nunca alarme quando a situação é sustentada por período explícito. */
  freshness: { state: "FRESH" | "STALE" | "UNKNOWN"; lastSuccessAt: string | null; cadenceLabel: string | null; sourceName: string | null; feedName: string | null }
  /** Histórico de períodos (mais recente primeiro): "EM PRODUÇÃO 01/09–10/09 · INSS 11/09–20/09 · EM PRODUÇÃO desde 21/09". */
  history: EmploymentStatusPeriodView[]
  /** Escala do colaborador (regime + folgas explícitas) — só o que a fonte informou; próxima folga nunca é inferida. */
  schedule: WorkScheduleView | null
  /** Capital operacional informada pela empresa (null = não informada; feriados estaduais/municipais não são determinados). */
  operationalCapital: OperationalCapitalView | null
}

export type EmploymentStatusPeriodView = {
  periodId: string
  status: EmploymentStatus
  label: string
  from: string
  to: string | null
  fromInferred: boolean
  source: string | null
  rawStatus: string | null
}

export type WorkScheduleView = {
  scheduleType: "FIVE_BY_TWO" | "SIX_BY_ONE" | null
  scheduleTypeLabel: string | null
  /** De onde vem a escala usada nos cálculos (explícita, fallback seg–sex, desconhecida). */
  basis: "EXPLICIT_SCHEDULE" | "LEGACY_WEEKDAY_FALLBACK" | "UNKNOWN_SCHEDULE"
  basisLabel: string
  /** Próxima folga programada a partir de hoje — só quando há calendário explícito. */
  nextDayOff: string | null
  /** Quantos dias de calendário explícito a INIA conhece a partir de hoje (horizonte). */
  knownDaysAhead: number
  freshness: { state: "FRESH" | "STALE" | "UNKNOWN"; lastSuccessAt: string | null; cadenceLabel: string | null; sourceName: string | null; feedName: string | null }
  origin: { sourceName: string; feedName: string; feedId: string; sourceId: string } | null
  /** Até que data a fonte informou o calendário desta pessoa (horizonte conhecido; null = nenhum dia a partir de hoje). */
  knownUntil: string | null
  /** Exceções individuais vigentes de hoje em diante (banco de horas, day off, folga extraordinária). */
  upcomingExceptions: { id: string; date: string; code: string; label: string; rawReason: string | null }[]
  todayException: { id: string; code: string; label: string; rawReason: string | null } | null
}

/** Capital operacional — jurisdição de feriados (não é endereço nem lotação). */
export type OperationalCapitalView = { code: string; name: string; stateCode: string; label: string }

export type EmployeeIndicatorDashboard = {
  mode: "EMPLOYEE"
  subject: SubjectDescriptor
  breadcrumb: BreadcrumbEntry[]
  period: string
  periodLabel: string
  employmentStatus: EmploymentStatusView
  prv: PrvSummary | null
  prvHistory: HistoryPoint[]
  prvComposition: PrvCompositionEntry[]
  prvPositives: Insight[]
  prvAttentionPoints: Insight[]
  indicators: EmployeeIndicatorSummary[]
}

export type QuartileDistribution = Record<Quartile, number> & { NO_DATA: number }

export type StructureIndicatorSummary = {
  code: string
  name: string
  unit: string
  direction: IndicatorDirection
  capabilities: IndicatorCapabilitiesView
  /** Média simples dos achievement_percent válidos dos membros nesta competência. */
  consolidatedAchievementPercent: number | null
  /** Quantos membros têm dado oficial nesse indicador nesta competência. */
  membersWithData: number
  membersBelowTarget: number
  previousConsolidatedAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  distribution: QuartileDistribution
  history: HistoryPoint[]
  positives: Insight[]
  attentionPoints: Insight[]
}

export type StructureIndicatorDashboard = {
  mode: "STRUCTURE"
  subject: SubjectDescriptor
  breadcrumb: BreadcrumbEntry[]
  period: string
  periodLabel: string
  memberCount: number
  membersWithData: number
  /** Média aritmética dos achievement_percent válidos de todas as linhas colaborador×indicador
   * da estrutura na competência — método documentado na Wiki; sem peso, SEM DADOS excluído. */
  consolidatedAchievementPercent: number | null
  previousConsolidatedAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  consolidationMethod: string
  history: HistoryPoint[]
  /** Distribuição por quartil de PRV oficial dos membros (Q1 melhor). */
  prvDistribution: QuartileDistribution
  indicators: StructureIndicatorSummary[]
  positives: Insight[]
  attentionPoints: Insight[]
  groupingOptions: GroupingDimension[]
  /** Resumo operacional (camada 1, comparação escolhida na tela) — null sem indicador com medição diária. */
  operationalSummary: OperationalStructureSummary | null
}

export type StructureGroupSummary = {
  subject: AnalyticsSubject | null
  label: string
  description: string | null
  memberCount: number
  membersWithData: number
  consolidatedAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  attentionCount: number
  improvingCount: number
  noDataCount: number
  /** Indicadores com menor atingimento consolidado nesse grupo (até 3). */
  topAttentionIndicators: { code: string; name: string; consolidatedAchievementPercent: number }[]
}

export type StructureBreakdown = {
  subject: SubjectDescriptor
  period: string
  groupBy: GroupingDimension
  groupByLabel: string
  groups: StructureGroupSummary[]
}

export type IndicatorMemberRow = {
  personId: string
  name: string
  avatarUrl: string | null
  jobTitle: string | null
  teamName: string | null
  subteamName: string | null
  value: number | null
  targetValue: number | null
  achievementPercent: number | null
  quartile: Quartile | null
  withinTarget: boolean | null
  deltaPp: number | null
  trend: Trend
}

export type IndicatorMembersPage = {
  indicator: { code: string; name: string; unit: string; direction: IndicatorDirection; capabilities: IndicatorCapabilitiesView }
  period: string
  items: IndicatorMemberRow[]
  total: number
  page: number
  pageSize: number
}

/** Situação determinística de um colaborador na competência — categorias baseadas em fatos
 * simples e auditáveis (ver member-situation.ts), nunca uma classificação opaca. */
export type MemberSituation = "NO_DATA" | "BELOW_REFERENCE" | "IMPROVING" | "WITHIN_REFERENCE"

export type TeamMemberSummary = {
  personId: string
  name: string
  avatarUrl: string | null
  jobTitle: string | null
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  situation: MemberSituation
  /** PRV oficial da competência, quando existe. */
  prvAchievementPercent: number | null
  prvQuartile: Quartile | null
  /** Média dos achievement_percent válidos dos indicadores do colaborador — NÃO é PRV. */
  averageAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  indicatorsWithData: number
  indicatorsBelowTarget: number
  /** Indicadores abaixo da referência (código + atingimento), até 3, pra leitura rápida. */
  attentionIndicators: { code: string; name: string; achievementPercent: number | null }[]
  followUps: { total: number; unacknowledged: number }
  pendingReviews: number
}

export type TeamSummaryCounts = {
  memberCount: number
  withinReference: number
  belowReference: number
  improving: number
  noData: number
  unacknowledgedFollowUps: number
  pendingReviews: number
}

export type StructureUnitSummary = StructureGroupSummary & {
  subject: AnalyticsSubject
  /** Pessoa-âncora (gestor), quando a unidade é ancorada em pessoa. */
  leader: { personId: string; name: string; avatarUrl: string | null; role: string } | null
  pendingReviews: number
}

/** Aba Equipe/Estrutura. Estrutura de Supervisor → membros direto; acima disso → unidades primeiro. */
export type TeamOverview = {
  subject: SubjectDescriptor
  breadcrumb: BreadcrumbEntry[]
  period: string
  periodLabel: string
  summary: TeamSummaryCounts
  /** Unidades subordinadas (gestores/grupos) — vazio quando o sujeito já é uma equipe de operadores. */
  units: StructureUnitSummary[]
  unitsGroupBy: GroupingDimension | null
  /** Quando `units` está vazio, os membros vêm paginados por `TeamMembersPage`. */
  showsMembersDirectly: boolean
  /** Operadores ligados diretamente à âncora quando há unidades — listados à parte (`directOnly`). */
  directMemberCount: number
  filterOptions: { teams: { id: string; name: string }[]; subteams: { id: string; name: string; teamId: string }[]; indicators: { code: string; name: string }[] }
}

export type TeamMembersPage = {
  items: TeamMemberSummary[]
  total: number
  page: number
  pageSize: number
}

export type FollowUpItem = {
  id: string
  kind: "FEEDBACK" | "ALERT" | "REPORT"
  /** INTERVENTION = atualização de uma intervenção (aberta, aprovada, decidida, novo sinal) — o link vai para o caso.
   * REPORT = entrega válida de um report recorrente; REPORT_NOT_FORWARDED = aviso de execução não encaminhada (nunca um report novo). */
  category: "INDICATOR" | "MONITORING" | "WORKFLOW_OUTPUT" | "WORKFLOW_HUMAN_REVIEW" | "WORKFLOW_ESCALATION" | "INTERVENTION" | "REPORT" | "REPORT_NOT_FORWARDED" | "OTHER"
  title: string
  /** Metadado do título (ex.: "Atendimento de 29/09/2026") — só feedbacks com cabeçalho; null = sem subtítulo. */
  subtitle?: string | null
  summary: string
  detail: string | null
  severity: "INFO" | "MEDIUM" | "HIGH" | "CRITICAL" | null
  operator: { personId: string; name: string } | null
  caseId: string | null
  createdAt: string
  acknowledgedAt: string | null
  /** Motivo do feedback (flag que disparou a monitoria, rotina, avulsa, indicador) — o MESMO cabeçalho do Acompanhamento do
   * colaborador. Só em feedbacks (kind = FEEDBACK); `null` = alerta ou motivo desconhecido. */
  origin?: FeedbackOrigin | null
  /** Conteúdo estruturado do feedback (quando kind = FEEDBACK). `supportMaterials` = materiais
   * da Base de Conhecimento recomendados pela IA, já resolvidos para ESTE viewer (título real ou
   * marcador de indisponível — nunca URL do modelo). */
  feedback: { evidenceFound: string; observedBehavior: string; relatedProcedure: string; recommendation: string; supportMaterials: FeedbackSupportMaterialView[]
    /** Feedback por Flag V2 — narrativa + detalhes (null = feedback anterior: vale o texto publicado). */
    view?: FeedbackView | null
    /** INDICATOR DIAGNOSIS V1 — visão TÉCNICA do diagnóstico do fechamento (só para quem lidera; nunca na leitura do próprio colaborador). */
    supervisorView?: PrvSupervisorView | null } | null
  /** Entrega (ou aviso) de report recorrente — só quando kind = REPORT; o item é de quem RECEBEU (escopo dele). */
  report?: FollowUpReportDelivery | null
}

export type FollowUpReportDelivery = {
  deliveryId: string
  reportId: string
  kind: "DELIVERY" | "NOT_FORWARDED"
  reason: "STALE_SOURCES" | "NO_CHANGE" | "INSUFFICIENT_COVERAGE" | null
  periodLabel: string | null
  structureLabel: string | null
  sources: unknown[]
  visualization: unknown | null
  dataset: unknown | null
  comparison: unknown | null
  analysisStatus: string
  analysisText: string | null
  empty: boolean
  occurrences: number
  lastCheckedAt: string
  reportActive: boolean
}

/** Página do feed da estrutura (mais recente primeiro). `nextCursor` = cursor opaco do último item, para pedir a seguinte;
 * null = o feed acaba nesta página. */
export type FollowUpFeed = { items: FollowUpItem[]; nextCursor: string | null }
