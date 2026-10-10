"use client"

import { BarChart3, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount, formatPercent } from "@/lib/analytics/format"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import type { GroupingDimension, StructureIndicatorDashboard } from "@/schemas/analytics/analytics.schema"

import { AnalyticsEmptyState } from "./analytics-states"
import { StructureIndicatorDetailSheet } from "./indicator-detail-sheet"
import { IndicatorHistoryChart } from "./indicator-history-chart"
import { StructureIndicatorCard } from "./indicator-summary-card"
import { InsightPanel } from "./insight-panel"
import { MetricHero } from "./metric-hero"
import { OperationalStructureSummaryCard } from "./operational-trend"
import { QuartileDistributionBar } from "./quartile-distribution"
import { GroupBySelect, StructureGroupTable } from "./structure-breakdown"
import { TrendIndicator } from "./trend-indicator"

/**
 * Visão STRUCTURE (Supervisor e acima): atingimento consolidado (nunca "PRV"), histórico,
 * distribuição, insights, "Agrupar por" com drill-down e os indicadores consolidados.
 */
export function StructureIndicatorsDashboard({
  dashboard,
  subject,
  openIndicator,
  onOpenIndicator,
  groupBy,
  onGroupByChange,
  onDrillDown,
  employeeHref,
}: {
  dashboard: StructureIndicatorDashboard
  subject: SubjectRef | null
  openIndicator: string | null
  onOpenIndicator: (code: string | null) => void
  groupBy: GroupingDimension | null
  onGroupByChange: (groupBy: GroupingDimension) => void
  onDrillDown: (subject: SubjectRef) => void
  employeeHref: (personId: string) => string
}) {
  const selected = dashboard.indicators.find((indicator) => indicator.code === openIndicator) ?? null
  const effectiveGroupBy = groupBy && dashboard.groupingOptions.includes(groupBy) ? groupBy : null

  return (
    <div className="space-y-4">
      <MetricHero
        eyebrow={dashboard.subject.description ?? "Estrutura"}
        title="Atingimento consolidado"
        value={formatPercent(dashboard.consolidatedAchievementPercent)}
        valueLabel="Meta 100%"
        trend={<TrendIndicator trend={dashboard.trend} deltaPp={dashboard.deltaPp} size="md" />}
        meta={
          <>
            <span>{formatCount(dashboard.memberCount, "colaborador", "colaboradores")}</span>
            <span>{dashboard.membersWithData} com dado oficial</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Como o consolidado é calculado">
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-80 leading-5">{dashboard.consolidationMethod}</TooltipContent>
            </Tooltip>
          </>
        }
        aside={
          <div className="rounded-xl bg-muted/50 p-4">
            <QuartileDistributionBar distribution={dashboard.prvDistribution} title="PRV da equipe por quartil" />
          </div>
        }
      >
        <IndicatorHistoryChart points={dashboard.history} title="Histórico do atingimento consolidado" />
        <div className="mt-5">
          <InsightPanel positives={dashboard.positives} attentionPoints={dashboard.attentionPoints} />
        </div>
      </MetricHero>

      {dashboard.operationalSummary ? <OperationalStructureSummaryCard summary={dashboard.operationalSummary} /> : null}

      {dashboard.groupingOptions.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <h3 className="text-base font-semibold">Visão por estrutura</h3>
            <p className="text-sm text-muted-foreground">Compare as unidades da sua estrutura e aprofunde onde precisar.</p>
          </div>
          <GroupBySelect options={dashboard.groupingOptions} value={effectiveGroupBy} onChange={onGroupByChange} />
        </div>
      ) : null}
      {effectiveGroupBy ? <StructureGroupTable subject={subject} period={dashboard.period} groupBy={effectiveGroupBy} onDrillDown={onDrillDown} /> : null}

      <section className="space-y-3" aria-labelledby="structure-indicators-heading">
        <div className="px-1">
          <h3 id="structure-indicators-heading" className="text-base font-semibold">
            Indicadores do período
          </h3>
          <p className="text-sm text-muted-foreground">Média dos atingimentos oficiais dos colaboradores por indicador. Abra um indicador para ver quem precisa de atenção.</p>
        </div>
        {dashboard.indicators.length === 0 ? (
          <AnalyticsEmptyState icon={BarChart3} title="Nenhum indicador disponível no período" description="Nenhum colaborador desta estrutura tem dado oficial neste período." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {dashboard.indicators.map((indicator) => (
              <StructureIndicatorCard key={indicator.code} indicator={indicator} onOpen={() => onOpenIndicator(indicator.code)} />
            ))}
          </div>
        )}
      </section>

      <StructureIndicatorDetailSheet indicator={selected} open={selected !== null} onOpenChange={(open) => (open ? undefined : onOpenIndicator(null))} periodLabel={dashboard.periodLabel} subject={subject} period={dashboard.period} employeeHref={employeeHref} />
    </div>
  )
}
