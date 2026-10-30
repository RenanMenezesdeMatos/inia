"use client"

import { useId } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { BarChart3 } from "lucide-react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { ListDateRangeFilter, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid, ListEmptyState, ListErrorState, ListNoResultsState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { useAdminListState, useClampListPage } from "@/hooks/use-admin-list-state"
import type { DateRangeFilter } from "@/lib/admin/list-query"
import { formatAiDateTime, formatCount } from "@/lib/admin/ai-format"
import { cn } from "@/lib/utils"
import { useAiModelsQuery, useAiProvidersQuery, useAiUseCasesQuery } from "@/queries/admin/use-ai-management-queries"
import { useAiUsageRankingContextQuery, useAiUsageRankingQuery } from "@/queries/admin/use-ai-usage-ranking-queries"
import type { AiUsageRankingParams } from "@/services/admin/ai-usage-ranking-service"
import { AI_USAGE_PERIOD_LABELS, AI_USAGE_PERIODS, type AiUsagePeriod } from "@/schemas/admin/ai-management.schema"
import {
  AI_USAGE_RANKING_LEVEL_LABELS,
  AI_USAGE_RANKING_LEVELS,
  AI_USAGE_RANKING_SORT_LABELS,
  AI_USAGE_RANKING_SORTS,
  AI_USAGE_SOURCE_LABELS,
  AI_USAGE_SOURCES,
  type AiUsageRankingContext,
  type AiUsageRankingLevel,
  type AiUsageRankingSort,
  type AiUsageSource,
} from "@/schemas/admin/ai-usage-ranking.schema"

import { InfoCallout } from "./ai-shared"
import { RankingCard, RankingTable, UnlinkedCard } from "./usage-ranking/ranking-views"

/**
 * "Quem mais usa" a IA — ranking por Diretoria, Gerência Sênior, Gerência, Grupo, Subgrupo ou Supervisor. A visão escolhida
 * fica na URL (`level`, só o código), os filtros na tela. O backend decide quem aparece (escopo da conta) e valida tudo;
 * aqui nada é recortado nem somado.
 */

type RankingFilters = {
  search: string
  period: AiUsagePeriod
  range: DateRangeFilter
  source?: AiUsageSource
  org: { teamId?: string; subteamId?: string }
  providerKey?: string
  modelId?: string
  useCase?: string
}

const DEFAULT_FILTERS: RankingFilters = { search: "", period: "30D", range: {}, org: {} }
const DEFAULT_LEVEL: AiUsageRankingLevel = "DIRECTOR"

/** Datas do período personalizado (dia local, inclusivo) → instantes ISO que o backend espera. */
function customRange(range: DateRangeFilter): { from: string; to: string } | null {
  if (!range.from || !range.to || range.from > range.to) return null
  return { from: new Date(`${range.from}T00:00:00`).toISOString(), to: new Date(`${range.to}T23:59:59.999`).toISOString() }
}

function isLevel(value: string | null): value is AiUsageRankingLevel {
  return (AI_USAGE_RANKING_LEVELS as readonly string[]).includes(value ?? "")
}

export function UsageRankingTab() {
  const sortFieldId = useId()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedLevel = searchParams.get("level")
  const level: AiUsageRankingLevel = isLevel(requestedLevel) ? requestedLevel : DEFAULT_LEVEL
  const sortParam = searchParams.get("sort")
  const sort: AiUsageRankingSort = (AI_USAGE_RANKING_SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as AiUsageRankingSort) : "REQUESTS"

  const list = useAdminListState({ storageKey: "ai-usage-ranking", defaultFilters: DEFAULT_FILTERS, defaultPageSize: 20 })
  const contextQuery = useAiUsageRankingContextQuery()
  const providersQuery = useAiProvidersQuery()
  const modelsQuery = useAiModelsQuery()
  const useCasesQuery = useAiUseCasesQuery()

  const filters = list.filters
  const range = filters.period === "CUSTOM" ? customRange(filters.range) : null
  const params: AiUsageRankingParams = {
    level,
    sort,
    period: filters.period,
    ...(range ?? {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.org.subteamId ? { subteamId: filters.org.subteamId } : filters.org.teamId ? { teamId: filters.org.teamId } : {}),
    ...(filters.providerKey ? { providerKey: filters.providerKey } : {}),
    ...(filters.modelId ? { modelId: filters.modelId } : {}),
    ...(filters.useCase ? { useCase: filters.useCase } : {}),
    page: list.page,
    pageSize: list.pageSize,
  }
  const waitingRange = filters.period === "CUSTOM" && !range
  const rankingQuery = useAiUsageRankingQuery(params, !waitingRange)
  useClampListPage(rankingQuery.data, list.page, list.pageSize, list.setPage)

  // Visão e ordenação na URL (códigos do catálogo — nunca dado pessoal): trocar volta para a primeira página.
  function setUrlParam(key: "level" | "sort", value: string, fallback: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    list.setPage(1)
  }

  const data = rankingQuery.data
  const scope = contextQuery.data?.scope

  return (
    <div className="space-y-4" data-testid="ai-usage-ranking">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Quem mais usa a IA</h2>
        <p className="text-sm text-muted-foreground">
          Cada linha soma o uso da pessoa e de toda a estrutura abaixo dela (ou das pessoas do Grupo/Subgrupo). Uso de Workflow conta para o colaborador da execução; o resto, para quem fez o pedido.
        </p>
      </div>

      {scope && !scope.organizationWide ? (
        <InfoCallout>
          <p>
            Você vê só o uso das pessoas do seu escopo ({scope.labels.join(", ")}). Cada linha soma apenas essas pessoas; uso sem pessoa identificada aparece só para quem vê a organização inteira.
          </p>
        </InfoCallout>
      ) : null}

      <ListToolbar
        search={<LevelSelector value={level} onChange={(next) => setUrlParam("level", next, DEFAULT_LEVEL)} />}
        viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <Select value={filters.period} onValueChange={(value) => list.patchFilters({ period: value as AiUsagePeriod, range: {} })}>
          <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-36", filters.period !== DEFAULT_FILTERS.period && "border-primary/50")} aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_USAGE_PERIODS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "CUSTOM" ? "Período personalizado" : AI_USAGE_PERIOD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.period === "CUSTOM" ? <ListDateRangeFilter label="Escolha as datas" value={filters.range} onChange={(value) => list.setFilter("range", value)} /> : null}
        <RankingOrgFilter value={filters.org} onChange={(value) => list.setFilter("org", value)} context={contextQuery.data} />
        <ListSelectFilter value={filters.source} onChange={(value) => list.setFilter("source", value)} options={AI_USAGE_SOURCES.map((value) => ({ value, label: AI_USAGE_SOURCE_LABELS[value] }))} allLabel="Qualquer origem" ariaLabel="Filtrar por origem do uso" />
        <ListSelectFilter value={filters.providerKey} onChange={(value) => list.setFilter("providerKey", value)} options={(providersQuery.data ?? []).map((provider) => ({ value: provider.key, label: provider.name }))} allLabel="Qualquer provider" ariaLabel="Filtrar por provider" />
        <ListSelectFilter value={filters.modelId} onChange={(value) => list.setFilter("modelId", value)} options={(modelsQuery.data ?? []).map((model) => ({ value: model.id, label: `${model.displayName} · ${model.connectionName}` }))} allLabel="Qualquer modelo" ariaLabel="Filtrar por modelo" />
        <ListSelectFilter value={filters.useCase} onChange={(value) => list.setFilter("useCase", value)} options={(useCasesQuery.data ?? []).map((item) => ({ value: item.key, label: item.label }))} allLabel="Qualquer uso" ariaLabel="Filtrar por uso da INIA (Use Case)" />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Label htmlFor={sortFieldId} className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground">Ordenar por</Label>
          <Select value={sort} onValueChange={(value) => setUrlParam("sort", value, "REQUESTS")}>
            <SelectTrigger id={sortFieldId} className="w-full sm:w-auto sm:min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_USAGE_RANKING_SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {AI_USAGE_RANKING_SORT_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ListToolbar>

      {waitingRange ? (
        <p className="text-sm text-muted-foreground">Escolha o início e o fim do período personalizado.</p>
      ) : rankingQuery.isLoading ? (
        <ListSkeleton view={list.view} />
      ) : rankingQuery.isError || !data ? (
        <ListErrorState message={(rankingQuery.error as Error | null)?.message || "Não foi possível carregar quem mais usa a IA."} onRetry={() => rankingQuery.refetch()} />
      ) : data.totals.requests === 0 ? (
        list.hasActiveFilters ? (
          <ListNoResultsState title="Nenhum uso de IA para os filtros escolhidos" onClear={list.resetFilters} />
        ) : (
          <ListEmptyState icon={BarChart3} title="Nenhum uso de IA no período" description={scope && !scope.organizationWide ? "Nenhuma pessoa do seu escopo usou a IA neste período." : "Quando a INIA usar IA no período, quem mais usa aparece aqui."} />
        )
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="ai-usage-ranking-summary">
            {data.period.label}: {formatAiDateTime(data.period.from)} a {formatAiDateTime(data.period.to)} · fuso {data.period.timezone} · {formatCount(data.totals.requests)} chamada(s) · {formatCount(data.totals.people)} pessoa(s) com uso
          </p>
          <div aria-busy={rankingQuery.isFetching} className={cn("transition-opacity", rankingQuery.isPlaceholderData && "opacity-60")}>
            {list.view === "cards" ? (
              <ListCardGrid>
                {data.items.map((item) => (
                  <RankingCard key={item.key} item={item} level={data.level} />
                ))}
                <UnlinkedCard unlinked={data.unlinked} level={data.level} />
              </ListCardGrid>
            ) : (
              <RankingTable data={data} />
            )}
          </div>
          {data.total > 0 ? (
            <ListPagination
              page={list.page}
              pageSize={list.pageSize}
              total={data.total}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              itemLabel={RANKING_ITEM_LABELS[data.level]}
              isFetching={rankingQuery.isFetching}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

const RANKING_ITEM_LABELS: Record<AiUsageRankingLevel, [string, string]> = {
  DIRECTOR: ["diretoria", "diretorias"],
  SENIOR_MANAGER: ["gerência sênior", "gerências sênior"],
  MANAGER: ["gerência", "gerências"],
  TEAM: ["grupo", "grupos"],
  SUBTEAM: ["subgrupo", "subgrupos"],
  SUPERVISOR: ["supervisor", "supervisores"],
}

/** Seletor da visão — os seis níveis lado a lado (quebra linha no celular); um clique troca o ranking. */
function LevelSelector({ value, onChange }: { value: AiUsageRankingLevel; onChange: (value: AiUsageRankingLevel) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label="Visão do ranking"
      className="flex w-full flex-wrap justify-start sm:w-auto"
      onValueChange={(next) => {
        // Radix devolve "" ao clicar no item já ativo — a visão atual continua.
        if (isLevel(next)) onChange(next)
      }}
    >
      {AI_USAGE_RANKING_LEVELS.map((key) => (
        <ToggleGroupItem key={key} value={key} aria-label={`${AI_USAGE_RANKING_LEVEL_LABELS[key]} que mais usa`} className="px-3">
          {AI_USAGE_RANKING_LEVEL_LABELS[key]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const ANY_TEAM = "__any__"

/** Grupo/Subgrupo — só os onde a conta pode ver uso (vêm do backend). Estreita o recorte; nunca o amplia. */
function RankingOrgFilter({ value, onChange, context }: { value: { teamId?: string; subteamId?: string }; onChange: (value: { teamId?: string; subteamId?: string }) => void; context: AiUsageRankingContext | undefined }) {
  const encoded = value.subteamId ? `subteam:${value.subteamId}` : value.teamId ? `team:${value.teamId}` : ANY_TEAM
  function decode(next: string) {
    if (next.startsWith("team:")) return onChange({ teamId: next.slice(5) })
    if (next.startsWith("subteam:")) {
      const subteamId = next.slice(8)
      const team = context?.teams.find((entry) => entry.subteams.some((subteam) => subteam.id === subteamId))
      return onChange({ teamId: team?.id, subteamId })
    }
    onChange({})
  }
  return (
    <Select value={encoded} onValueChange={decode} disabled={!context}>
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-40", encoded !== ANY_TEAM && "border-primary/50")} aria-label="Filtrar por grupo">
        <SelectValue placeholder="Qualquer grupo" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_TEAM}>Qualquer grupo</SelectItem>
        {context?.teams.map((team) => (
          <SelectGroup key={team.id}>
            <SelectLabel>{team.name}</SelectLabel>
            <SelectItem value={`team:${team.id}`}>{team.name} (grupo inteiro)</SelectItem>
            {team.subteams.map((subteam) => (
              <SelectItem key={subteam.id} value={`subteam:${subteam.id}`}>
                {team.name} › {subteam.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
