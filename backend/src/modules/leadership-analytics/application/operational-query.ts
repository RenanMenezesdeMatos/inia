import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import type { AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { QueryTableCard, QueryTableColumn } from "../domain/view-models.js"
import { buildCard as card, finish, groupCell, groupsFor, num, type IndicatorQueryInput, type SortableRow } from "./query-common.js"

/**
 * FONTE OPERACIONAL da consulta flexível: medição diária do período em curso (mês, semana, 7 dias…) × o anterior, por estrutura ou
 * unidade — o valor consolidado de cada recorte pela estratégia do indicador (Σ numerador ÷ Σ denominador,
 * `loadStructureOperationalSummary`, read model). Sem meta oficial: dentro/fora da meta é sempre do fechamento oficial.
 */
export const MAX_OPERATIONAL_GROUPS = 15

const TREND_LABELS = { IMPROVED: "melhorou", DECLINED: "piorou", STABLE: "estável" } as const

export async function operationalQuery(repository: AnalyticsReadRepository, scope: ViewerScope, input: IndicatorQueryInput): Promise<QueryTableCard> {
  const limitations: string[] = []
  if (input.groupBy === "PERSON" || input.groupBy === "PERIOD") limitations.push("A medição operacional é consultada por estrutura ou unidade; para pessoas ou meses use o fechamento oficial.")
  const { groups: allGroups, label } = groupsFor(scope, input, limitations)
  const groups = allGroups.filter((group) => group.members.length > 0).slice(0, MAX_OPERATIONAL_GROUPS)
  if (allGroups.length > groups.length) limitations.push(`Mostro as primeiras ${MAX_OPERATIONAL_GROUPS} unidades.`)
  const summaries = await Promise.all(groups.map((group) => repository.loadStructureOperationalSummary(scope.organizationId, group.members.map((member) => member.id), input.now, input.window)))
  const wanted = new Set(input.indicators.map((definition) => definition.code))
  const reference = summaries.find((summary) => summary !== null) ?? null
  const columns: QueryTableColumn[] = [
    { key: "group", label, numeric: false },
    { key: "indicator", label: "Indicador", numeric: false },
    { key: "current", label: reference?.comparison.currentLabel ?? "Atual", numeric: true },
    { key: "previous", label: reference?.comparison.previousLabel ?? "Anterior", numeric: true },
    { key: "change", label: "Variação", numeric: true },
    { key: "trend", label: "Desempenho", numeric: false },
    { key: "coverage", label: "Pessoas com dado", numeric: true },
  ]
  const tableRows: SortableRow[] = []
  groups.forEach((group, position) => {
    const summary = summaries[position]
    for (const indicator of summary?.indicators ?? []) {
      if (wanted.size > 0 && !wanted.has(indicator.code)) continue
      tableRows.push({
        cells: {
          group: groupCell(group, label),
          indicator: indicator.name,
          current: indicator.currentValue === null ? "—" : formatIndicatorValue(indicator.currentValue, indicator.unit),
          previous: indicator.previousValue === null ? "—" : formatIndicatorValue(indicator.previousValue, indicator.unit),
          change: indicator.changeUnavailableReason === "PARTIAL_PERIOD_SUM" ? "não comparável (soma parcial)" : num(indicator.changePercent, "%"),
          trend: indicator.performanceTrend ? TREND_LABELS[indicator.performanceTrend] : "—",
          coverage: `${indicator.membersWithData} de ${indicator.eligibleMemberCount}`,
        },
        subject: group.subject,
        personId: null,
        sortKeys: { NAME: group.label, CHANGE: indicator.performanceChangePercent, ACHIEVEMENT: indicator.performanceChangePercent },
      })
    }
  })
  if (wanted.size > 0 && tableRows.length === 0) limitations.push("Os indicadores pedidos não têm medição operacional diária (só fechamento oficial).")
  const withCurrent = summaries.some((summary) => summary?.indicators.some((indicator) => indicator.currentValue !== null && (wanted.size === 0 || wanted.has(indicator.code))))
  if (tableRows.length > 0 && !withCurrent) limitations.push(`Ainda não há medição diária ${reference?.comparison.currentPhrase ?? "no período corrente"} para esta estrutura — a coluna atual fica vazia; o último fechamento oficial continua valendo para dentro/fora da meta.`)
  if (!reference) limitations.push("Nenhuma medição operacional no período para esta estrutura.")
  const { rows, total } = finish(tableRows, { ...input, sort: input.sort ?? "CHANGE" }, "CHANGE", "asc")
  return card(input, {
    title: `Medição operacional — ${reference?.comparison.label ?? "período corrente"}`,
    scopeNote: reference ? `${reference.windowLabel} × ${reference.previousWindowLabel} (parcial, medição diária)` : "Medição diária",
    period: null,
    indicatorCode: input.indicators.length === 1 ? input.indicators[0]!.code : null,
    columns,
    rows,
    total,
    methods: [
      "Valor operacional = consolidado do recorte pela estratégia do indicador (taxa e média ponderada: Σ numerador ÷ Σ denominador; nunca média de médias), só com dias elegíveis (escala, situação funcional, feriados).",
      "Desempenho = a variação já ajustada à direção do indicador (melhorou/piorou). A medição operacional não tem meta oficial: para dentro/fora da meta use o fechamento oficial.",
      reference?.method ?? "",
    ].filter(Boolean),
    limitations,
  })
}

