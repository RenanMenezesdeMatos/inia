"use client"

import type { SubjectRef } from "@/lib/analytics/subject-params"
import { useIndicatorDashboardQuery } from "@/queries/analytics/use-analytics-queries"
import type { AnalyticsContext, GroupingDimension, OperationalComparison } from "@/schemas/analytics/analytics.schema"

import { AnalyticsErrorState, CardsSkeleton, HeroSkeleton } from "./analytics-states"
import { ComparisonSelector } from "./comparison-selector"
import { EmployeeIndicatorsDashboard } from "./employee-indicators-dashboard"
import { HierarchyBreadcrumb } from "./hierarchy-breadcrumb"
import { PeriodSelector } from "./period-selector"
import { StructureIndicatorsDashboard } from "./structure-indicators-dashboard"

export type IndicatorsViewState = { subject: SubjectRef | null; period: string | null; comparison?: OperationalComparison | null; indicator: string | null; groupBy: GroupingDimension | null }

/**
 * Entrada única da área de Indicadores para TODOS os papéis: o backend decide o modo
 * (EMPLOYEE/STRUCTURE) e as capabilities; aqui só escolhemos qual dashboard apresentar. A URL
 * carrega competência (fechamento oficial), comparação operacional, estrutura, indicador aberto
 * e agrupamento.
 */
export function IndicatorsView({ context, state, onStateChange, employeeHref, title, canSeeLineage = false }: { context: AnalyticsContext; state: IndicatorsViewState; onStateChange: (patch: Partial<IndicatorsViewState>) => void; employeeHref: (personId: string) => string; title?: string; /** "Origem do dado" — capability de acesso (Central de Dados), nunca o nível hierárquico. */ canSeeLineage?: boolean }) {
  const period = state.period ?? context.currentPeriod
  const comparison = state.comparison ?? null
  // Sem sujeito explícito o backend usa o sujeito padrão do viewer, e quem não tem nenhum recebe NO_STRUCTURE — só então
  // a consulta fica desligada. Sujeito explícito (ficha do colaborador) sempre consulta: o Administrador geral, fora da
  // hierarquia, não tem sujeito padrão e mesmo assim vê quem o escopo de acesso dele alcança.
  const query = useIndicatorDashboardQuery(state.subject, period, comparison, state.subject !== null || context.defaultSubject !== null)
  const viewerIsSubject = query.data?.mode === "EMPLOYEE" && (state.subject === null || state.subject.id === context.viewer.personId)
  // A trilha começa na estrutura de quem vê e subir volta para ela. Sem sujeito padrão, o primeiro item já é a cadeia de
  // quem é visitado e o perfil próprio não tem Indicadores de estrutura para onde voltar: a trilha só informa.
  const navigateBreadcrumb = context.defaultSubject !== null ? (subject: SubjectRef | null) => onStateChange({ subject, indicator: null, groupBy: null }) : undefined

  return (
    <section className="min-h-[calc(100dvh-12rem)] w-full space-y-4">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-heading text-sm text-muted-foreground">Performance</p>
          <h2 className="text-2xl font-semibold tracking-tight">{title ?? (query.data?.mode === "STRUCTURE" ? "Indicadores da estrutura" : "Meus indicadores")}</h2>
          {query.data ? <HierarchyBreadcrumb entries={query.data.breadcrumb} onNavigate={navigateBreadcrumb} /> : null}
        </div>
        {/* Período (competência oficial, mês fechado) = fechamento oficial; Comparação = janelas do acompanhamento
            operacional (a partir de hoje). Trocar uma nunca altera a outra. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <PeriodSelector periods={context.availablePeriods} value={period} onChange={(next) => onStateChange({ period: next, indicator: null })} />
          <ComparisonSelector value={comparison} onChange={(next) => onStateChange({ comparison: next })} />
        </div>
      </div>

      <div aria-busy={query.isFetching && !query.isPending} className={query.isFetching && !query.isPending ? "opacity-80 transition-opacity" : "transition-opacity"}>
        {query.isPending ? (
          <div className="space-y-4">
            <HeroSkeleton />
            <CardsSkeleton />
          </div>
        ) : null}
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data?.mode === "EMPLOYEE" ? <EmployeeIndicatorsDashboard dashboard={query.data} openIndicator={state.indicator} onOpenIndicator={(indicator) => onStateChange({ indicator })} isOwnProfile={viewerIsSubject} canSeeLineage={canSeeLineage} /> : null}
        {query.data?.mode === "STRUCTURE" ? (
          <StructureIndicatorsDashboard
            dashboard={query.data}
            subject={state.subject}
            openIndicator={state.indicator}
            onOpenIndicator={(indicator) => onStateChange({ indicator })}
            groupBy={state.groupBy}
            onGroupByChange={(groupBy) => onStateChange({ groupBy })}
            onDrillDown={(subject) => onStateChange({ subject, indicator: null, groupBy: null })}
            employeeHref={employeeHref}
          />
        ) : null}
      </div>
    </section>
  )
}
