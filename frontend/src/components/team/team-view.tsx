"use client"

import { useState } from "react"
import { UsersRound } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState, CardsSkeleton, HeroSkeleton } from "@/components/analytics/analytics-states"
import { HierarchyBreadcrumb } from "@/components/analytics/hierarchy-breadcrumb"
import { PeriodSelector } from "@/components/analytics/period-selector"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import { useTeamMembersQuery, useTeamOverviewQuery } from "@/queries/analytics/use-analytics-queries"
import { GROUPING_LABELS, type AnalyticsContext, type MemberSituation } from "@/schemas/analytics/analytics.schema"
import type { TeamMembersParams } from "@/services/analytics/analytics-service"

import { StructureUnitCard } from "./structure-unit-card"
import { EMPTY_TEAM_FILTERS, hasActiveTeamFilters, TeamFilters, type TeamFilterState } from "./team-filters"
import { TeamMemberTable } from "./team-member-table"
import { TeamSummary } from "./team-summary"

export type TeamViewState = { subject: SubjectRef | null; period: string | null; situation?: MemberSituation | null; attention?: string | null }

/** Filtros vindos da URL (link de um cartão da INIA: "pessoas sem dado", "fora em TMA"). */
function filtersFromUrl(state: TeamViewState): TeamFilterState {
  return { ...EMPTY_TEAM_FILTERS, situation: state.situation ?? null, attentionIndicatorCode: state.attention ?? null }
}

type Sort = NonNullable<TeamMembersParams["sort"]>

/**
 * Aba Equipe / Estrutura — "quem compõe minha estrutura e onde preciso atuar". Supervisor vê
 * membros direto; Gerente+ vê as unidades subordinadas e desce nível a nível (mesma árvore de
 * autorização da API). Acompanhamento continua sendo a Surface — aqui só contadores e atalhos.
 */
export function TeamView({ context, state, onStateChange, employeeHref }: { context: AnalyticsContext; state: TeamViewState; onStateChange: (patch: Partial<TeamViewState>) => void; employeeHref: (personId: string) => string }) {
  const period = state.period ?? context.currentPeriod
  const overview = useTeamOverviewQuery(state.subject, period, context.defaultSubject !== null)
  const [filters, setFilters] = useState<TeamFilterState>(() => filtersFromUrl(state))
  const [sort, setSort] = useState<Sort>("situation")
  const [order, setOrder] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  // Um link novo (outra situação/indicador na URL) reaplica os filtros; mexer nos filtros na tela não toca na URL.
  const urlFiltersKey = `${state.situation ?? ""}|${state.attention ?? ""}`
  const [appliedUrlFilters, setAppliedUrlFilters] = useState(urlFiltersKey)
  if (urlFiltersKey !== appliedUrlFilters) {
    setAppliedUrlFilters(urlFiltersKey)
    setFilters(filtersFromUrl(state))
    setPage(1)
  }
  const [pageSize, setPageSize] = useState(10)
  const debouncedSearch = useDebouncedValue(filters.search.trim(), 300)

  // Membros listados quando o sujeito já é uma equipe, ou quando há operadores ligados
  // diretamente à âncora além das unidades (`directOnly`).
  const showsAllMembers = overview.data?.showsMembersDirectly === true && overview.data.summary.memberCount > 0
  const showsDirectMembers = overview.data?.showsMembersDirectly === false && (overview.data.directMemberCount ?? 0) > 0
  const membersEnabled = showsAllMembers || showsDirectMembers
  const members = useTeamMembersQuery(
    state.subject,
    period,
    {
      search: debouncedSearch || undefined,
      teamId: filters.teamId ?? undefined,
      subteamId: filters.subteamId ?? undefined,
      situation: filters.situation ?? undefined,
      attentionIndicatorCode: filters.attentionIndicatorCode ?? undefined,
      pendingOnly: filters.pendingOnly || undefined,
      directOnly: showsDirectMembers || undefined,
      sort,
      order,
      page,
      pageSize,
    },
    membersEnabled,
  )

  function patchFilters(patch: Partial<TeamFilterState>) {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  function navigate(subject: SubjectRef | null) {
    setFilters(EMPTY_TEAM_FILTERS)
    setPage(1)
    // Os filtros que vieram por link ficam para trás ao descer/subir de estrutura.
    onStateChange({ subject, ...(state.situation || state.attention ? { situation: null, attention: null } : {}) })
  }

  const peopleLabel = context.capabilities.peopleTabLabel ?? "Equipe"
  const isOwnStructure = state.subject === null
  const title = overview.data ? (isOwnStructure ? (peopleLabel === "Equipe" ? "Minha equipe" : "Minha estrutura") : overview.data.subject.label) : peopleLabel

  return (
    <section className="min-h-[calc(100dvh-12rem)] w-full space-y-4">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-heading text-sm text-muted-foreground">{peopleLabel}</p>
          <h2 className="text-2xl font-semibold tracking-tight">Quem está na estrutura e onde atuar</h2>
          {overview.data ? <HierarchyBreadcrumb entries={overview.data.breadcrumb} onNavigate={navigate} /> : null}
        </div>
        <PeriodSelector periods={context.availablePeriods} value={period} onChange={(next) => onStateChange({ period: next })} />
      </div>

      {overview.isPending ? (
        <div className="space-y-4">
          <HeroSkeleton />
          <CardsSkeleton />
        </div>
      ) : null}
      {overview.isError ? <AnalyticsErrorState error={overview.error} onRetry={() => void overview.refetch()} /> : null}

      {overview.data ? (
        <div className="space-y-4" aria-busy={overview.isFetching}>
          <TeamSummary
            title={title}
            subtitle={overview.data.subject.description ?? peopleLabel}
            summary={overview.data.summary}
            activeSituation={membersEnabled ? filters.situation : null}
            pendingActive={membersEnabled ? filters.pendingOnly : false}
            onFilterSituation={membersEnabled ? (situation) => patchFilters({ situation }) : undefined}
            onFilterPending={membersEnabled ? (pendingOnly) => patchFilters({ pendingOnly }) : undefined}
            pendingActionsHref="/supervisor?tab=pending"
          />

          {overview.data.units.length > 0 ? (
            <section className="space-y-3" aria-labelledby="units-heading">
              <div className="px-1">
                <h3 id="units-heading" className="text-base font-semibold">
                  {overview.data.unitsGroupBy ? `Unidades por ${GROUPING_LABELS[overview.data.unitsGroupBy].toLowerCase()}` : "Unidades"}
                </h3>
                <p className="text-sm text-muted-foreground">Abra uma unidade para descer na hierarquia até os colaboradores.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {overview.data.units.map((unit) => (
                  <StructureUnitCard key={`${unit.subject.kind}-${unit.label}`} unit={unit} onOpen={navigate} />
                ))}
              </div>
            </section>
          ) : null}

          {overview.data.showsMembersDirectly && overview.data.summary.memberCount === 0 ? <AnalyticsEmptyState icon={UsersRound} title="Esta estrutura não possui colaboradores" description="Nenhum operador ativo reporta a esta estrutura." /> : null}

          {membersEnabled ? (
            <div className="space-y-3">
              {showsDirectMembers ? (
                <div className="px-1">
                  <h3 className="text-base font-semibold">Ligados diretamente à estrutura</h3>
                  <p className="text-sm text-muted-foreground">Colaboradores sem gestor intermediário entre eles e esta estrutura.</p>
                </div>
              ) : null}
              <TeamFilters filters={filters} options={overview.data.filterOptions} onChange={patchFilters} onClear={() => { setFilters(EMPTY_TEAM_FILTERS); setPage(1) }} />
              <TeamMemberTable
                query={members}
                sort={sort}
                order={order}
                onSortChange={(next) => { setSort(next); setPage(1) }}
                onOrderToggle={() => setOrder((current) => (current === "asc" ? "desc" : "asc"))}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
                hasActiveFilters={hasActiveTeamFilters(filters)}
                onClearFilters={() => { setFilters(EMPTY_TEAM_FILTERS); setPage(1) }}
                employeeHref={employeeHref}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
