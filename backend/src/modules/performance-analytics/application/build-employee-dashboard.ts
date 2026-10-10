import type { AnalyticsSubject } from "../domain/analytics-subject.js"
import { buildAchievementInsights } from "../domain/deterministic-insights.js"
import { DEFAULT_OPERATIONAL_COMPARISON, type OperationalComparison } from "../domain/operational-comparison.js"
import { longPeriodLabel } from "../domain/reference-period.js"
import type { EmployeeIndicatorDashboard, EmployeeIndicatorSummary, OperationalTrendView, PrvCompositionEntry, PrvSummary } from "../domain/view-models.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import { isWithinReference } from "./member-performance.js"
import { comparison, historyOf, indicatorRowOf, indicatorRowsOf, loadPerformanceDataset, prvRowOf, type PerformanceDataset } from "./performance-dataset.js"
import { buildBreadcrumb, resolveSubject, type ViewerScope } from "./viewer-scope.js"

/** Meta de PRV é 100% de atingimento por definição do programa — o dado oficial já chega como
 * atingimento, então a "meta" aqui é só a referência de leitura, nunca um recálculo. */
const PRV_TARGET_PERCENT = 100

/**
 * Visão EMPLOYEE: PRV oficial (exatamente como persistido), composição (peso oficial por indicador
 * na competência), histórico mensal oficial e indicadores individuais com insights determinísticos
 * + análises de IA já persistidas. Nada aqui recalcula PRV, atingimento ou quartil.
 */
export async function buildEmployeeDashboard(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  subject: AnalyticsSubject & { kind: "EMPLOYEE" },
  period: string,
  now: Date = new Date(),
  comparison: OperationalComparison = DEFAULT_OPERATIONAL_COMPARISON,
): Promise<EmployeeIndicatorDashboard> {
  const resolved = resolveSubject(scope, subject)
  const personId = subject.employeeId
  // Fechamento oficial (competência escolhida) e acompanhamento operacional (comparação escolhida
  // na tela a partir de AGORA — a janela operacional nunca segue a competência oficial selecionada).
  const [dataset, employmentStatus] = await Promise.all([loadPerformanceDataset(repository, scope.organizationId, [personId], period), repository.loadEmploymentStatus(scope.organizationId, personId, now)])
  // Indicadores relevantes pro colaborador = os com fechamento oficial no histórico dele: um
  // indicador diário sem medição nas duas janelas (ex.: férias) ainda ganha card se for dele.
  const officialCodes = [...dataset.definitions.keys()].filter((code) => dataset.historyPeriods.some((historyPeriod) => indicatorRowOf(dataset, personId, historyPeriod, code)))
  const operationalTrends = await repository.loadEmployeeOperationalTrends(scope.organizationId, personId, now, comparison, officialCodes)

  const prv = buildPrvSummary(dataset, personId)
  const prvHistoryValues = dataset.historyPeriods.map((historyPeriod) => prvRowOf(dataset, personId, historyPeriod)?.achievementPercent ?? null)
  const prvInsights = prv
    ? buildAchievementInsights({ label: "PRV", achievementPercent: prv.achievementPercent, quartile: prv.quartile, deltaPp: prv.deltaPp, history: prvHistoryValues, withinTarget: prv.achievementPercent >= PRV_TARGET_PERCENT })
    : { positives: [], attentionPoints: [] }

  // Indicador entra na lista com dado oficial no histórico OU com acompanhamento operacional —
  // um indicador diário sem fechamento ainda também aparece (só com o lado operacional).
  const codes = [...dataset.definitions.keys()].filter((code) => dataset.historyPeriods.some((historyPeriod) => indicatorRowOf(dataset, personId, historyPeriod, code)) || operationalTrends.has(code))
  const names = codes.map((code) => dataset.definitions.get(code)!.name)
  const persistedInsights = await repository.loadPersistedIndicatorInsights(personId, names)

  const indicators = codes.map((code) => buildIndicatorSummary(dataset, personId, code, persistedInsights.filter((insight) => insight.indicatorName === dataset.definitions.get(code)!.name), operationalTrends.get(code) ?? null))
  // Indicadores abaixo da referência primeiro (é onde a atenção deve ir), depois por peso oficial.
  indicators.sort((a, b) => Number(b.withinTarget === false) - Number(a.withinTarget === false) || (b.weightPercent ?? -1) - (a.weightPercent ?? -1) || a.name.localeCompare(b.name, "pt-BR"))

  return {
    mode: "EMPLOYEE",
    subject: resolved.descriptor,
    breadcrumb: buildBreadcrumb(scope, subject),
    period,
    periodLabel: longPeriodLabel(period),
    employmentStatus,
    prv,
    prvHistory: historyOf(dataset, (historyPeriod) => prvRowOf(dataset, personId, historyPeriod)?.achievementPercent ?? null),
    // Sem PRV oficial na competência não há valor a explicar — o peso continua visível em cada indicador.
    prvComposition: prv ? buildPrvComposition(dataset, personId) : [],
    prvPositives: prvInsights.positives,
    prvAttentionPoints: prvInsights.attentionPoints,
    indicators,
  }
}

function buildPrvSummary(dataset: PerformanceDataset, personId: string): PrvSummary | null {
  const current = prvRowOf(dataset, personId, dataset.period)
  if (!current) return null
  const previous = prvRowOf(dataset, personId, dataset.previousPeriod)
  const { deltaPp, trend } = comparison(current.achievementPercent, previous?.achievementPercent ?? null)
  return {
    period: current.referencePeriod,
    achievementPercent: current.achievementPercent,
    quartile: current.quartile,
    target: PRV_TARGET_PERCENT,
    previousAchievementPercent: previous?.achievementPercent ?? null,
    deltaPp,
    trend,
    source: current.source,
  }
}

/** Composição = os indicadores que têm `weight_percent` oficial na competência. Só explica o valor
 * oficial; a soma dos pesos NÃO é validada nem usada pra recompor o PRV. */
function buildPrvComposition(dataset: PerformanceDataset, personId: string): PrvCompositionEntry[] {
  return indicatorRowsOf(dataset, personId, dataset.period)
    .filter((row) => row.weightPercent !== null)
    .map((row) => ({
      indicatorCode: row.indicatorCode,
      indicatorName: dataset.definitions.get(row.indicatorCode)?.name ?? row.indicatorCode,
      achievementPercent: row.achievementPercent,
      weightPercent: row.weightPercent,
    }))
    .sort((a, b) => (b.weightPercent ?? 0) - (a.weightPercent ?? 0))
}

function buildIndicatorSummary(dataset: PerformanceDataset, personId: string, code: string, persistedInsights: EmployeeIndicatorSummary["persistedInsights"], operationalTrend: OperationalTrendView | null): EmployeeIndicatorSummary {
  const definition = dataset.definitions.get(code)!
  const current = indicatorRowOf(dataset, personId, dataset.period, code)
  const previous = indicatorRowOf(dataset, personId, dataset.previousPeriod, code)
  const historyValues = dataset.historyPeriods.map((historyPeriod) => indicatorRowOf(dataset, personId, historyPeriod, code)?.achievementPercent ?? null)
  const { deltaPp, trend } = comparison(current?.achievementPercent ?? null, previous?.achievementPercent ?? null)
  const withinTarget = current ? isWithinReference(current, definition.direction) : null
  const insights = buildAchievementInsights({ label: definition.name, achievementPercent: current?.achievementPercent ?? null, quartile: current?.quartile ?? null, deltaPp, history: historyValues, withinTarget })
  return {
    code,
    name: definition.name,
    unit: definition.unit,
    direction: definition.direction,
    capabilities: definition.capabilities,
    value: current?.value ?? null,
    targetValue: current?.targetValue ?? null,
    achievementPercent: current?.achievementPercent ?? null,
    weightPercent: current?.weightPercent ?? null,
    quartile: current?.quartile ?? null,
    withinTarget,
    previousAchievementPercent: previous?.achievementPercent ?? null,
    deltaPp,
    trend,
    history: historyOf(dataset, (historyPeriod) => indicatorRowOf(dataset, personId, historyPeriod, code)?.achievementPercent ?? null),
    positives: insights.positives,
    attentionPoints: insights.attentionPoints,
    persistedInsights,
    operationalTrend,
  }
}
