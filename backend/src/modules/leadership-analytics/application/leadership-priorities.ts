import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import type { AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { LOW_COVERAGE_THRESHOLD } from "../domain/analytic-rules.js"
import type { IndicatorAnalysisCard, PrioritiesCard, PriorityItem, StructureOverviewCard } from "../domain/view-models.js"
import { buildIndicatorAnalysis } from "./indicator-analysis.js"
import type { ResolvedStructure } from "./references.js"
import { buildStructureOverview } from "./structure-overview.js"

export const PRIORITY_ORDER_METHOD =
  "Ordem: decisões atrasadas que aguardam você → demais decisões pendentes → indicadores com mais pessoas fora da referência → unidades que concentram as pessoas fora no indicador mais crítico → ciências pendentes → dados incompletos. Cada item traz a evidência numérica; nada é decidido sozinho."

/** Indicadores e unidades em destaque (os demais ficam no Acompanhamento/Equipe). */
const TOP_INDICATORS = 2
const TOP_UNITS = 2
/** Pendências detalhadas uma a uma; acima disso, um resumo. */
const DETAILED_PENDINGS = 3

export type PendingActionsLoader = (viewer: { personId: string; organizationId: string }) => Promise<PendingActionsSummary>

const pct = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("pt-BR")}%`)

/**
 * "Onde preciso atuar hoje?" — determinístico, sem IA: as decisões que aguardam o líder (Pendências, por destinatário) e os
 * desvios da estrutura (mesmos números da visão geral). Serve ao cartão do Acompanhamento e à ferramenta do chat.
 */
export async function buildLeadershipPriorities(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  input: { structure: ResolvedStructure | null; period: string | null; loadPendingActions: PendingActionsLoader; now?: Date },
): Promise<PrioritiesCard> {
  const now = input.now ?? new Date()
  const [pending, overview] = await Promise.all([
    input.loadPendingActions({ personId: scope.viewer.id, organizationId: scope.organizationId }),
    input.structure && input.period ? buildStructureOverview(repository, scope, { structure: input.structure, period: input.period, now }) : Promise.resolve(null),
  ])
  const focus = overview && overview.units.length > 0 ? await focusIndicatorAnalysis(repository, scope, input.structure!, overview, now) : null
  const items: PriorityItem[] = [...pendingItems(pending), ...(overview ? deviationItems(overview, focus) : [])]
  return {
    type: "PRIORITIES",
    generatedAt: now.toISOString(),
    structure: overview?.structure ?? null,
    period: overview?.period ?? null,
    periodLabel: overview?.periodLabel ?? null,
    items,
    method: PRIORITY_ORDER_METHOD,
    limitations: overview?.limitations ?? [],
  }
}

/** Análise do indicador com mais pessoas fora — base da concentração por unidade. */
async function focusIndicatorAnalysis(repository: AnalyticsReadRepository, scope: ViewerScope, structure: ResolvedStructure, overview: StructureOverviewCard, now: Date): Promise<IndicatorAnalysisCard | null> {
  const top = overview.indicators.find((entry) => entry.below > 0)
  if (!top) return null
  const definition = (await repository.loadIndicatorDefinitions(scope.organizationId)).find((entry) => entry.code === top.code)
  return definition ? buildIndicatorAnalysis(repository, scope, { structure, indicator: definition, period: overview.period, now }) : null
}

function pendingItems(summary: PendingActionsSummary): PriorityItem[] {
  const pending = [...summary.pending]
  const overdue = (item: (typeof pending)[number]) => item.kind === "INTERVENTION" && item.overdue
  pending.sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || a.requestedAt.localeCompare(b.requestedAt))
  const items = pending.slice(0, DETAILED_PENDINGS).map((item): PriorityItem => {
    const who = item.operator?.name ?? "colaborador"
    const caseId = item.kind === "INTERVENTION" ? item.caseId : item.kind === "HUMAN_REVIEW" ? item.caseId : null
    const title =
      item.kind === "HUMAN_REVIEW" ? `Revisão pendente — ${who}` : item.kind === "WORKDAY_RECONCILIATION" ? `Produção não identificada — ${who}` : `${item.pendingLabel} — ${who}`
    const evidence =
      item.kind === "HUMAN_REVIEW"
        ? `${item.workflowName} · ${item.nodeLabel}${item.reason ? ` · ${item.reason}` : ""}`
        : item.kind === "WORKDAY_RECONCILIATION"
          ? item.reason
          : `${item.typeName} · prazo ${new Date(item.dueAt).toLocaleDateString("pt-BR")}${item.overdue ? " (atrasada)" : ""}`
    return { kind: "PENDING_DECISION", severity: overdue(item) ? "HIGH" : "MEDIUM", title, evidence, target: { kind: "PENDING", operatorId: item.operator?.personId ?? null, caseId }, question: null }
  })
  const rest = pending.length - items.length
  if (rest > 0) {
    const restOverdue = pending.slice(DETAILED_PENDINGS).filter(overdue).length
    items.push({ kind: "PENDING_DECISION", severity: restOverdue > 0 ? "HIGH" : "MEDIUM", title: `Mais ${rest} ${rest === 1 ? "decisão pendente" : "decisões pendentes"}`, evidence: restOverdue > 0 ? `${restOverdue} ${restOverdue === 1 ? "atrasada" : "atrasadas"}.` : "Aguardando sua decisão em Pendências.", target: { kind: "PENDING", operatorId: null, caseId: null }, question: null })
  }
  return items
}

function deviationItems(overview: StructureOverviewCard, focus: IndicatorAnalysisCard | null): PriorityItem[] {
  const items: PriorityItem[] = []
  const subject = overview.structure.subject
  const hasUnits = overview.units.length > 0
  for (const indicator of overview.indicators.filter((entry) => entry.below > 0).slice(0, TOP_INDICATORS)) {
    const previous = indicator.previousBelowPercent === null ? "" : ` (era ${pct(indicator.previousBelowPercent)} no mês anterior)`
    items.push({
      kind: "INDICATOR_DEVIATION",
      severity: (indicator.belowPercent ?? 0) >= 50 ? "HIGH" : "MEDIUM",
      title: `${indicator.name}: ${indicator.below} de ${indicator.withReference} fora da referência`,
      evidence: `${pct(indicator.belowPercent)} da estrutura em ${overview.periodLabel}${previous}.`,
      target: { kind: "INDICATOR", subject, indicatorCode: indicator.code, indicatorName: indicator.name, period: overview.period },
      question: hasUnits ? `Onde está concentrado o desvio de ${indicator.name}?` : `Quem está fora da referência em ${indicator.name}?`,
    })
  }
  // Concentração do indicador mais crítico (mesma regra de `leadership_indicator_analysis`): as unidades que reúnem a maior parte
  // das pessoas fora, só quando o padrão é concentrado ou misto — desvio disseminado não tem "onde" para destacar.
  if (focus?.concentration && (focus.concentration.pattern === "CONCENTRATED" || focus.concentration.pattern === "MIXED")) {
    const units = focus.units.filter((unit) => unit.subject !== null && focus.concentration!.focusKeys.includes(unit.key)).slice(0, TOP_UNITS)
    for (const unit of units) {
      items.push({
        kind: "UNIT_CONCENTRATION",
        severity: focus.concentration.pattern === "CONCENTRATED" ? "HIGH" : "MEDIUM",
        title: `${unit.label}${unit.description ? ` (${unit.description})` : ""} reúne ${pct(unit.shareOfDeviationsPercent)} das pessoas fora em ${focus.indicator.name}`,
        evidence: `${unit.below} de ${unit.withReference} fora (${pct(unit.belowPercent)}) contra ${pct(focus.reference.belowPercent)} na estrutura${unit.comparable ? "" : ` · comparação com cautela: ${unit.comparabilityReasons.join("; ")}`}.`,
        target: { kind: "TEAM", subject: unit.subject!, period: focus.period, situation: null, indicatorCode: focus.indicator.code },
        question: `Quem está fora da referência em ${focus.indicator.name} na estrutura de ${unit.label}?`,
      })
    }
  }
  if (overview.awaitingAcknowledgement > 0) {
    items.push({ kind: "AWAITING_ACKNOWLEDGEMENT", severity: "LOW", title: `${overview.awaitingAcknowledgement} ${overview.awaitingAcknowledgement === 1 ? "feedback aguardando" : "feedbacks aguardando"} ciência`, evidence: "Publicados para a estrutura e ainda sem a confirmação do colaborador.", target: { kind: "FOLLOW_UP_PENDING_ACK" }, question: null })
  }
  const coverage = overview.members.total > 0 ? overview.members.withData / overview.members.total : 1
  if (coverage < LOW_COVERAGE_THRESHOLD) {
    items.push({ kind: "DATA_GAP", severity: "LOW", title: "Dados incompletos na competência", evidence: `${overview.members.withData} de ${overview.members.total} pessoas com dado oficial em ${overview.periodLabel} — as leituras acima valem só para quem tem dado.`, target: { kind: "TEAM", subject, period: overview.period, situation: "NO_DATA", indicatorCode: null }, question: null })
  }
  return items
}
