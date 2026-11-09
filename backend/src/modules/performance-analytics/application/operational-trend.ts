import { EMPLOYMENT_STATUS_LABELS, type EmploymentStatus } from "../../people/domain/employment-status.js"
import { SCHEDULE_EXCEPTION_LABELS, type ScheduleExceptionCode } from "../../people/domain/schedule-exception.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { absenceDaysWithDataOf, finishWindow, finishWindowBySubject, ignoredOf, OPERATIONAL_DEFINITION_COLUMNS, resolveEligibleDaysBySubject, resolveOperationalWindow, resolveOperationalWindowBySubject, toOperationalDefinition, toRaw, type IndicatorOperationalDefinition, type OperationalDefinitionRow, type OperationalWindowResult, type WorkdayResolutionCache } from "../../indicators/application/operational-measurement-resolver.js"
import { defaultMeasurementAggregation, MEASUREMENT_AGGREGATION_LABELS, type MeasurementAggregation } from "../../indicators/domain/operational-aggregation.js"
import { percentageChange } from "../../workflows/application/condition-evaluator.js"
import { resolveOperationalQuartiles } from "../../workflows/application/operational-quartile-resolver.js"
import { businessDaysInWindow, describeTimeWindow, localDatesInWindow, resolveFullCurrentCalendarPeriod, resolvePreviousTimeWindow, resolveTimeWindow, type TimeWindow } from "../../workflows/application/time-window.js"
import { DEFAULT_OPERATIONAL_COMPARISON, describeOperationalComparison, operationalComparisonPeriod, type OperationalComparison, type OperationalComparisonView } from "../domain/operational-comparison.js"
import { readStructureWindows, type StructureReadModelWindows } from "../infrastructure/operational-read-model.js"
import type { OperationalQuartileView, OperationalStructureIndicatorSummary, OperationalStructureSummary, OperationalTrendView, OperationalWindowView, PerformanceTrend } from "../domain/view-models.js"

/**
 * ACOMPANHAMENTO OPERACIONAL na área de Indicadores (camada 1 — `indicator_measurements` diária),
 * lado a lado com o FECHAMENTO OFICIAL (camada 2 — `employee_indicator_performance`), nunca
 * misturados: o card operacional mostra a janela atual × a anterior (comparação escolhida na tela —
 * "últimos 7 dias × 7 anteriores" por padrão; semana, mês, bimestre ou trimestre corrente × o
 * anterior; ver operational-comparison.ts), variação de performance, quartil OPERACIONAL entre os
 * pares e cobertura. Tudo determinístico, pelo MESMO resolvedor de medições que Condition/Ranking
 * usam (operational-measurement-resolver.ts) — abrir a tela nunca chama LLM e nunca recalcula
 * atingimento/quartil/PRV oficiais.
 */
export function operationalTrendMethod(comparison: OperationalComparison): string {
  const view = describeOperationalComparison(comparison)
  return `Medição operacional diária agregada pela semântica do indicador (média ponderada Σ numerador ÷ Σ denominador para TMA/taxas, soma, último valor…), ${view.currentLabel.toLowerCase()} × ${view.previousLabel.toLowerCase()}. Cobertura = dias com medição ÷ dias elegíveis (dias úteis desde a admissão, excluídos os dias em férias/afastamento). 'Dado suficiente' segue a cobertura mínima do indicador no catálogo (ou o mínimo de medições, quando só ele existe) — nunca um limiar fixo da tela. Quartil operacional = posição entre os pares do mesmo Subgrupo (ou Grupo) com dado suficiente, pela direção oficial, mínimo de 4. Nunca é o atingimento, o quartil ou o PRV do fechamento oficial.`
}

/** Tamanho das janelas em dias de calendário + o período civil corrente inteiro (só quando a janela atual é parcial). */
function windowSizes(comparison: OperationalComparisonView, window: TimeWindow, previousWindow: TimeWindow, now: Date, timeZone: string) {
  return {
    windowCalendarDays: localDatesInWindow(window, timeZone).length,
    previousWindowCalendarDays: localDatesInWindow(previousWindow, timeZone).length,
    currentPeriodCalendarDays: comparison.kind === "ROLLING_7_DAYS" ? null : localDatesInWindow(resolveFullCurrentCalendarPeriod(comparison.kind, now, timeZone), timeZone).length,
  }
}

export type OperationalTrendInput = {
  organizationId: string
  personIds: string[]
  now: Date
  timeZone: string
  /** Comparação escolhida na tela; ausente = "últimos 7 dias × 7 anteriores" (comportamento original). */
  comparison?: OperationalComparison | undefined
}

/** Definição diária + os PADRÕES de suficiência do catálogo (IndicatorDefinition.minimumCoverage / minimumSampleSize). */
type DailyDefinition = IndicatorOperationalDefinition & { name: string; minimumCoverage: number | null; minimumSampleSize: number | null }

/**
 * Indicadores ativos com medição operacional diária (`daily_supported`) — só esses ganham card. Uma consulta só, já na
 * organização de quem abre a tela: antes, cada código era relido por `loadIndicatorOperationalDefinition` (1 + N consultas,
 * e sem organização — com o mesmo código em duas organizações, valeria a definição da mais antiga).
 */
async function loadDailyDefinitions(db: Database, organizationId: string): Promise<DailyDefinition[]> {
  const result = await db.query<OperationalDefinitionRow & { name: string; minimum_coverage: string | null; minimum_sample_size: number | null }>(
    `select ${OPERATIONAL_DEFINITION_COLUMNS}, name, minimum_coverage, minimum_sample_size from indicator_definitions where organization_id = $1 and active and daily_supported order by name`,
    [organizationId],
  )
  return result.rows.map((row) => ({ ...toOperationalDefinition(row), name: row.name, minimumCoverage: row.minimum_coverage === null ? null : Number(row.minimum_coverage), minimumSampleSize: row.minimum_sample_size ?? null }))
}

/**
 * "Dado suficiente" na TELA (Analytics/Profile, que não tem configuração própria de Workflow):
 * a cobertura mínima do INDICADOR no catálogo; sem ela, só o mínimo de medições do catálogo, se
 * houver; sem nenhum dos dois, qualquer valor é suficiente. Nunca um limiar fixo inventado
 * (o antigo 40% não existe mais). Workflows continuam sobrescrevendo com o próprio minimumCoverage.
 */
export type SufficiencyRule = "COVERAGE" | "SAMPLE" | "NONE"
export function sufficiencyRuleOf(definition: Pick<DailyDefinition, "minimumCoverage" | "minimumSampleSize">): SufficiencyRule {
  if (definition.minimumCoverage !== null) return "COVERAGE"
  if (definition.minimumSampleSize !== null) return "SAMPLE"
  return "NONE"
}
export function isSufficient(view: Pick<OperationalWindowView, "value" | "coverage" | "sampleCount">, definition: Pick<DailyDefinition, "minimumCoverage" | "minimumSampleSize">): boolean {
  if (view.value === null) return false
  switch (sufficiencyRuleOf(definition)) {
    case "COVERAGE":
      return view.coverage === null || view.coverage >= definition.minimumCoverage!
    case "SAMPLE":
      return view.sampleCount >= definition.minimumSampleSize!
    default:
      return true
  }
}

function toWindowView(result: OperationalWindowResult | undefined, label: string): OperationalWindowView {
  const eligibility = result?.eligibility
  return {
    label,
    value: result?.value ?? null,
    daysWithData: result?.daysWithData ?? 0,
    expectedDays: result?.expectedDays ?? null,
    coverage: result?.coverage ?? null,
    sampleCount: result?.sampleCount ?? 0,
    businessDays: eligibility?.scheduledWorkDays ?? null,
    calendarDays: eligibility?.calendarDays ?? null,
    excludedByStatus: eligibility ? Object.entries(eligibility.excludedByStatus).map(([status, days]) => ({ status, label: EMPLOYMENT_STATUS_LABELS[status as EmploymentStatus] ?? status, days: days ?? 0 })) : [],
    excludedByScheduleException: eligibility ? Object.entries(eligibility.excludedByScheduleException).map(([code, days]) => ({ code, label: SCHEDULE_EXCEPTION_LABELS[code as ScheduleExceptionCode] ?? code, days: days ?? 0 })) : [],
    excludedByScheduledDayOff: eligibility?.excludedByScheduledDayOff ?? 0,
    excludedByHoliday: eligibility?.excludedByHoliday ?? 0,
    ignoredMeasurements: result?.ignoredMeasurements ?? 0,
    excludedByUnknownSchedule: eligibility?.excludedByUnknownSchedule ?? 0,
    noEligibleDays: result?.noDataReason === "NO_ELIGIBLE_DAYS",
    unconfirmedDays: eligibility?.statusConfidence.freshness === "STALE" ? eligibility.statusConfidence.unconfirmedDays : 0,
    schedule: eligibility ? { basis: eligibility.scheduleConfidence.basis, freshness: eligibility.scheduleConfidence.freshness, scheduleType: eligibility.scheduleConfidence.scheduleType, unconfirmedScheduleDays: eligibility.scheduleConfidence.unconfirmedScheduleDays } : null,
    holidays: eligibility ? { policy: eligibility.holidayConfidence.policy, confidence: eligibility.holidayConfidence.confidence, applicableHolidayDays: eligibility.holidayConfidence.applicableHolidayDays } : null,
    observed: eligibility
      ? {
          workedObservedDays: eligibility.observed.workedObservedDays,
          workedDespitePlan: {
            exception: Object.entries(eligibility.observed.workedDespitePlan.exception).map(([code, days]) => ({ code, label: SCHEDULE_EXCEPTION_LABELS[code as ScheduleExceptionCode] ?? code, days: days ?? 0 })),
            scheduledDayOff: eligibility.observed.workedDespitePlan.scheduledDayOff,
            holiday: eligibility.observed.workedDespitePlan.holiday,
            unknownSchedule: eligibility.observed.workedDespitePlan.unknownSchedule,
          },
          missingExpectedProductionDays: eligibility.observed.missingExpectedProductionDays,
          productionWithNonEligibleStatusDays: eligibility.observed.productionWithNonEligibleStatusDays,
          evidenceSources: { ...eligibility.observed.evidenceSources, enabled: eligibility.observed.evidenceSources.interactions || eligibility.observed.evidenceSources.indicatorCodes.length > 0 },
          waitingForSourcesDays: eligibility.observed.waitingForSourcesDays,
          dataSourceDelayDays: eligibility.observed.dataSourceDelayDays,
          unjustifiedAbsenceDays: eligibility.observed.unjustifiedAbsenceDays,
          justifiedAbsenceDays: eligibility.observed.justifiedAbsenceDays,
          workedDataMissingDays: eligibility.observed.workedDataMissingDays,
          unjustifiedAbsence: result?.unjustifiedAbsence ? { policy: result.unjustifiedAbsence.policy, zeroContributionDays: result.unjustifiedAbsence.zeroContributionDays } : null,
        }
      : null,
  }
}

/** Variação de PERFORMANCE: sinal pela direção oficial — positivo = melhorou (TMA caiu, Qualidade subiu). TARGET não tem "melhor". */
function performanceChange(changePercent: number | null, direction: IndicatorOperationalDefinition["direction"]): { performanceChangePercent: number | null; performanceTrend: PerformanceTrend } {
  if (changePercent === null || direction === "TARGET") return { performanceChangePercent: null, performanceTrend: null }
  const signed = direction === "LOWER" ? -changePercent : changePercent
  const rounded = Math.round(signed * 10) / 10
  return { performanceChangePercent: rounded, performanceTrend: Math.abs(rounded) < 1 ? "STABLE" : rounded > 0 ? "IMPROVED" : "DECLINED" }
}

/**
 * SOMA em período CORRENTE (parcial) × anterior COMPLETO não é comparável: 17 dias de
 * Atendimentos contra 62 dias sempre "cairiam" — seria um número falso apresentado como queda.
 * Médias, taxas e "último valor" são normalizados por construção e continuam comparáveis. A
 * regra vale por código (nunca só por rótulo): a variação fica nula com o motivo explícito.
 */
export type ChangeUnavailableReason = "PARTIAL_PERIOD_SUM" | null
function changeUnavailableReason(aggregation: string, currentIsPartial: boolean): ChangeUnavailableReason {
  return aggregation === "SUM" && currentIsPartial ? "PARTIAL_PERIOD_SUM" : null
}

/**
 * Pares do colaborador pro quartil operacional: operadores ativos do MESMO Subgrupo (ou do Grupo,
 * quando não há Subgrupo) — a mesma população em que a fonte oficial calcula o quartil do
 * fechamento (`employee_indicator_performance.subteam_id`), pra que "Quartil oficial" e
 * "Quartil operacional" sejam comparáveis por construção. A tela SEMPRE diz quem são os pares.
 */
async function loadPeerPopulation(db: Database, organizationId: string, personId: string): Promise<{ ids: string[]; label: string; type: OperationalQuartileView["populationType"] }> {
  const person = await db.query<{ team_id: string | null; subteam_id: string | null; team_name: string | null; subteam_name: string | null }>(
    `select p.team_id, p.subteam_id, t.name team_name, st.name subteam_name from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id where p.id = $1 and p.organization_id = $2`,
    [personId, organizationId],
  )
  const row = person.rows[0]
  if (!row || (!row.subteam_id && !row.team_id)) return { ids: [personId], label: "sem Grupo/Subgrupo", type: "NONE" }
  const bySubteam = row.subteam_id !== null
  const peers = await db.query<{ id: string }>(
    bySubteam
      ? `select id from people where organization_id = $1 and role = 'OPERATOR' and active and subteam_id = $2`
      : `select id from people where organization_id = $1 and role = 'OPERATOR' and active and team_id = $2`,
    [organizationId, bySubteam ? row.subteam_id : row.team_id],
  )
  const ids = new Set(peers.rows.map((peer) => peer.id))
  ids.add(personId)
  return { ids: [...ids], label: bySubteam ? `Subgrupo ${row.subteam_name ?? ""}`.trim() : `Grupo ${row.team_name ?? ""}`.trim(), type: bySubteam ? "SUBGROUP_PEERS" : "GROUP_PEERS" }
}

/** Tendência operacional de UM colaborador, por indicador diário. Indicador sem medição diária não entra no mapa (a tela não mostra card). */
export async function buildEmployeeOperationalTrends(db: Database, input: OperationalTrendInput & { personId: string; relevantCodes?: string[] | undefined }): Promise<Map<string, OperationalTrendView>> {
  const definitions = await loadDailyDefinitions(db, input.organizationId)
  if (definitions.length === 0) return new Map()
  const comparison = describeOperationalComparison(input.comparison ?? DEFAULT_OPERATIONAL_COMPARISON)
  const period = operationalComparisonPeriod(comparison.kind)
  const window = resolveTimeWindow(period, input.now, input.timeZone)
  const previousWindow = resolvePreviousTimeWindow(period, input.now, input.timeZone)
  const expectedDays = businessDaysInWindow(window, input.timeZone)
  const previousExpectedDays = businessDaysInWindow(previousWindow, input.timeZone)
  const sizes = windowSizes(comparison, window, previousWindow, input.now, input.timeZone)
  const peers = await loadPeerPopulation(db, input.organizationId, input.personId)
  const quartileCache = new Map()
  // Dias de trabalho (situação, escala, exceções, feriados, evidência) dependem de pessoa × janela,
  // não de indicador: um memo por request evita resolver os pares N vezes (1 por indicador) — em
  // janelas longas (trimestre) isso é a diferença entre segundos e dezenas de segundos.
  const workdayCache: WorkdayResolutionCache = new Map()
  const trends = new Map<string, OperationalTrendView>()
  for (const definition of definitions) {
    const aggregation = defaultMeasurementAggregation(definition.kind)
    const [current, previous, quartiles] = await Promise.all([
      resolveOperationalWindow(db, { indicatorCode: definition.code, subjectIds: [input.personId], window, aggregation, expectedDays, timeZone: input.timeZone, workdayCache }, definition),
      resolveOperationalWindow(db, { indicatorCode: definition.code, subjectIds: [input.personId], window: previousWindow, aggregation, expectedDays: previousExpectedDays, timeZone: input.timeZone, workdayCache }, definition),
      // A população do quartil usa a MESMA regra de suficiência do catálogo (cobertura mínima do indicador).
      resolveOperationalQuartiles(db, { indicatorCode: definition.code, aggregation, period, minimumCoverage: definition.minimumCoverage ?? undefined, populationIds: peers.ids, now: input.now, timeZone: input.timeZone, workdayCache, definition }, quartileCache),
    ])
    const currentView = toWindowView(current, describeTimeWindow(window, input.timeZone))
    const previousView = toWindowView(previous, describeTimeWindow(previousWindow, input.timeZone))
    const sufficient = isSufficient(currentView, definition)
    const changeUnavailable = changeUnavailableReason(aggregation, comparison.currentIsPartial)
    const changePercent = changeUnavailable === null && sufficient && isSufficient(previousView, definition) && currentView.value !== null && previousView.value !== null ? percentageChange(currentView.value, previousView.value) : null
    const member = quartiles.members.get(input.personId)
    // Sem medição elegível nas duas janelas: o indicador só ganha card se for RELEVANTE pro
    // colaborador (tem fechamento oficial dele — ex.: de férias a janela inteira); um indicador de
    // outro Grupo nunca aparece só porque existe no catálogo.
    if (currentView.sampleCount === 0 && previousView.sampleCount === 0 && !(input.relevantCodes ?? []).includes(definition.code)) continue
    trends.set(definition.code, {
      indicatorCode: definition.code,
      comparison,
      ...sizes,
      aggregation,
      aggregationLabel: MEASUREMENT_AGGREGATION_LABELS[aggregation],
      method: current.value !== null ? current.method : null,
      unit: definition.unit,
      direction: definition.direction,
      current: currentView,
      previous: previousView,
      changePercent: changePercent === null ? null : Math.round(changePercent * 10) / 10,
      ...performanceChange(changePercent, definition.direction),
      changeUnavailableReason: changeUnavailable,
      minimumCoverage: definition.minimumCoverage,
      minimumSampleSize: definition.minimumSampleSize,
      sufficiencyRule: sufficiencyRuleOf(definition),
      sufficient,
      quartile: {
        quartile: member?.quartile ?? null,
        position: member?.position ?? null,
        rank: member?.position ?? null,
        rankedCount: quartiles.rankedCount,
        populationCount: quartiles.evaluatedCount,
        eligiblePopulationCount: quartiles.eligibleCount,
        populationLabel: peers.label,
        populationType: peers.type,
        windowLabel: currentView.label,
        reason:
          quartiles.reason === "DIRECTION_UNSUPPORTED"
            ? "DIRECTION_UNSUPPORTED"
            : !member
              ? quartiles.ineligibleIds.has(input.personId)
                ? "NO_ELIGIBLE_DAYS"
                : quartiles.staleStatusIds.has(input.personId)
                  ? "EMPLOYMENT_STATUS_STALE"
                  : quartiles.staleScheduleIds.has(input.personId)
                    ? "WORK_SCHEDULE_STALE"
                    : quartiles.unknownScheduleIds.has(input.personId)
                      ? "WORK_SCHEDULE_UNKNOWN"
                  : quartiles.belowCoverageIds.has(input.personId)
                    ? "BELOW_MINIMUM_COVERAGE"
                    : "NO_VALUE"
              : quartiles.reason,
      },
    })
  }
  return trends
}

/** Janelas de uma estrutura por indicador: o caminho original (consultas por indicador) ou o read model. */
type StructureWindows = {
  eligibleMemberCount: number
  forIndicator(definition: DailyDefinition, aggregation: MeasurementAggregation): Promise<{ current: OperationalWindowResult; previous: OperationalWindowResult; byMember: Map<string, OperationalWindowResult> }>
}

/** Caminho ORIGINAL: elegibilidade da estrutura uma vez e três consultas por indicador — a referência da prova de igualdade. */
async function rawStructureWindows(db: Database, input: OperationalTrendInput, window: TimeWindow, previousWindow: TimeWindow, expectedDays: number): Promise<StructureWindows> {
  // Elegibilidade da estrutura na janela (uma vez, independente de indicador): quem tem ao menos
  // 1 dia elegível. Férias/afastamento a janela inteira saem da população operacional — nunca
  // entram como 0 de produção.
  const workdayCache: WorkdayResolutionCache = new Map()
  const eligibility = await resolveEligibleDaysBySubject(db, input.personIds, window, input.timeZone, { cache: workdayCache })
  return {
    eligibleMemberCount: input.personIds.filter((id) => (eligibility.get(id)?.eligibleDays ?? 0) > 0).length,
    async forIndicator(definition, aggregation) {
      const [current, previous, byMember] = await Promise.all([
        resolveOperationalWindow(db, { indicatorCode: definition.code, subjectIds: input.personIds, window, aggregation, timeZone: input.timeZone, workdayCache }, definition),
        resolveOperationalWindow(db, { indicatorCode: definition.code, subjectIds: input.personIds, window: previousWindow, aggregation, timeZone: input.timeZone, workdayCache }, definition),
        resolveOperationalWindowBySubject(db, { indicatorCode: definition.code, subjectIds: input.personIds, window, aggregation, expectedDays, timeZone: input.timeZone, workdayCache }, definition),
      ])
      return { current, previous, byMember }
    },
  }
}

/** READ MODEL (infrastructure/operational-read-model.ts): componentes já agregados por membro, aplicados pelas MESMAS funções finais. */
function readModelStructureWindows(model: StructureReadModelWindows, input: OperationalTrendInput, window: TimeWindow, previousWindow: TimeWindow, expectedDays: number): StructureWindows {
  return {
    eligibleMemberCount: input.personIds.filter((id) => (model.eligibility.get(id)?.eligibleDays ?? 0) > 0).length,
    async forIndicator(definition, aggregation) {
      const pooled = (phase: "CURRENT" | "PREVIOUS", phaseWindow: TimeWindow) => {
        const row = model.pooled[phase].get(definition.code)
        return finishWindow(toRaw(row), { aggregation, window: phaseWindow }, definition, undefined, ignoredOf(row), absenceDaysWithDataOf(row))
      }
      return {
        current: pooled("CURRENT", window),
        previous: pooled("PREVIOUS", previousWindow),
        byMember: finishWindowBySubject(model.currentByMember.get(definition.code) ?? [], { aggregation, window, expectedDays }, definition, model.eligibility),
      }
    },
  }
}

export type StructureSummarySource = "read-model" | "raw"

/**
 * Resumo operacional pequeno de uma ESTRUTURA: por indicador diário, o valor agregado dos membros
 * (pooled — Σ numerador ÷ Σ denominador, nunca média de médias) na janela atual × anterior da
 * comparação escolhida e quantos membros têm dado suficiente. Sem quartil aqui (a população seria a própria estrutura).
 * Fonte: o read model do analytics da liderança (padrão de quem pede `read-model`) ou o caminho original — o número é o
 * mesmo; o read model devolve `null` (organização inteira pendente, ou pendência demais) e aí vale o original.
 */
export type StructureSummaryObservation = { source: StructureSummarySource; liveMembers: number; validUntilMs: number | null }

export async function buildStructureOperationalSummary(
  db: Database,
  input: OperationalTrendInput,
  options: { source?: StructureSummarySource; observe?: (observation: StructureSummaryObservation) => void } = {},
): Promise<OperationalStructureSummary | null> {
  const definitions = await loadDailyDefinitions(db, input.organizationId)
  if (definitions.length === 0 || input.personIds.length === 0) return null
  const comparison = describeOperationalComparison(input.comparison ?? DEFAULT_OPERATIONAL_COMPARISON)
  const period = operationalComparisonPeriod(comparison.kind)
  const window = resolveTimeWindow(period, input.now, input.timeZone)
  const previousWindow = resolvePreviousTimeWindow(period, input.now, input.timeZone)
  const expectedDays = businessDaysInWindow(window, input.timeZone)
  const model =
    options.source === "read-model"
      ? await readStructureWindows(db, { organizationId: input.organizationId, personIds: input.personIds, comparison: comparison.kind, window, previousWindow, now: input.now, timeZone: input.timeZone, indicatorCodes: definitions.map((definition) => definition.code) })
      : null
  options.observe?.(model ? { source: "read-model", liveMembers: model.liveMembers, validUntilMs: model.validUntilMs } : { source: "raw", liveMembers: input.personIds.length, validUntilMs: null })
  const windows = model ? readModelStructureWindows(model, input, window, previousWindow, expectedDays) : await rawStructureWindows(db, input, window, previousWindow, expectedDays)
  const eligibleMemberCount = windows.eligibleMemberCount
  const indicators: OperationalStructureIndicatorSummary[] = []
  for (const definition of definitions) {
    const aggregation = defaultMeasurementAggregation(definition.kind)
    const { current, previous, byMember } = await windows.forIndicator(definition, aggregation)
    const membersWithSufficientData = [...byMember.values()].filter((result) => isSufficient({ value: result.value, coverage: result.coverage, sampleCount: result.sampleCount }, definition)).length
    const changeUnavailable = changeUnavailableReason(aggregation, comparison.currentIsPartial)
    const changePercent = changeUnavailable === null && current.value !== null && previous.value !== null ? percentageChange(current.value, previous.value) : null
    if (byMember.size === 0 && previous.sampleCount === 0) continue // indicador sem medição nesta estrutura — fora do resumo
    indicators.push({
      code: definition.code,
      name: definition.name,
      unit: definition.unit,
      direction: definition.direction,
      aggregation,
      aggregationLabel: MEASUREMENT_AGGREGATION_LABELS[aggregation],
      method: current.value !== null ? current.method : null,
      currentValue: current.value,
      previousValue: previous.value,
      changePercent: changePercent === null ? null : Math.round(changePercent * 10) / 10,
      ...performanceChange(changePercent, definition.direction),
      changeUnavailableReason: changeUnavailable,
      membersWithData: byMember.size,
      membersWithSufficientData,
      memberCount: input.personIds.length,
      eligibleMemberCount,
      minimumCoverage: definition.minimumCoverage,
      minimumSampleSize: definition.minimumSampleSize,
      sufficiencyRule: sufficiencyRuleOf(definition),
    })
  }
  return {
    comparison,
    windowLabel: describeTimeWindow(window, input.timeZone),
    previousWindowLabel: describeTimeWindow(previousWindow, input.timeZone),
    ...windowSizes(comparison, window, previousWindow, input.now, input.timeZone),
    memberCount: input.personIds.length,
    eligibleMemberCount,
    method: operationalTrendMethod(comparison.kind),
    indicators,
  }
}
