"use client"

import { useState, type ReactNode } from "react"
import { Filter, FilterX, HeartHandshake, Inbox, UserX } from "lucide-react"

import { ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import type { ScopeFilterValue } from "@/components/human-support/admin/scope-filter"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSupportRequestsInfiniteQuery, useSupportScopesQuery } from "@/queries/human-support/use-human-support-admin"
import { REQUEST_ORIGIN_LABELS, REQUEST_STATUS_LABELS, type RequestOrigin, type RequestStatus } from "@/schemas/human-support/catalogs.schema"
import type { PanelFilter, RequestListFilter } from "@/services/human-support/human-support-service"

import { AnjosActivityTab } from "./anjos-activity-tab"
import { FunnelTab } from "./funnel-tab"
import { defaultPanelPeriod, PeriodPicker, type PanelPeriod } from "./period-picker"
import { RequestsTab } from "./requests-tab"
import { UnavailableAttemptsTab } from "./unavailable-attempts-tab"

type PanelTab = "requests" | "funnel" | "attempts" | "anjos"
type RequestFilters = { search: string; status: RequestStatus | undefined; origin: RequestOrigin | undefined }
const NO_REQUEST_FILTERS: RequestFilters = { search: "", status: undefined, origin: undefined }

/**
 * Administração › Monitoramento › Apoio com Anjo — o painel do apoio (Coordenador de Anjos e Administrador geral; D7), no formato de
 * "Conversas com a INIA": título, barra de filtros e os pedidos como caixa de entrada (lista à esquerda, conversa à direita). Pedidos ·
 * Indicadores · Sem Anjo em serviço · Anjos (situação agora + atividade no período). O período e o Grupo/Subgrupo valem para as quatro
 * abas; busca, estado e origem, só para os pedidos. Tudo no alcance de quem lê, decidido pelo servidor.
 *
 * Filtro por Grupo/Subgrupo: só para quem configura o apoio (`canFilterByScope`), com a árvore da configuração. O Coordenador de Anjos
 * não tem rota que liste a estrutura, e a tela nunca chama por ele uma rota que só o Administrador geral pode chamar.
 */
export function HumanSupportMonitoringPage({ canFilterByScope = false }: { canFilterByScope?: boolean }) {
  const [tab, setTab] = useState<PanelTab>("requests")
  const [period, setPeriod] = useState<PanelPeriod>(() => defaultPanelPeriod())
  const [scope, setScope] = useState<ScopeFilterValue>({})
  const [requestFilters, setRequestFilters] = useState<RequestFilters>(NO_REQUEST_FILTERS)
  const search = useDebouncedValue(requestFilters.search.trim(), 300)

  const filter: PanelFilter = { from: period.from, to: period.to, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }
  const listFilter: RequestListFilter = { ...filter, search: search || null, status: requestFilters.status ?? null, origin: requestFilters.origin ?? null }
  // A lista só consulta (e se atualiza) com a aba Pedidos aberta; o que já veio fica guardado ao trocar de aba.
  const requests = useSupportRequestsInfiniteQuery(listFilter, { enabled: tab === "requests" })
  const total = requests.data?.pages[0]?.total ?? null

  const initialPeriod = defaultPanelPeriod()
  const scopeActive = Boolean(scope.teamId || scope.subteamId)
  const panelActive = scopeActive || period.from !== initialPeriod.from || period.to !== initialPeriod.to
  const requestsFiltered = Boolean(search || requestFilters.status || requestFilters.origin)
  const clearPanel = () => {
    setScope({})
    setPeriod(defaultPanelPeriod())
  }
  const panelControls = (
    <>
      {canFilterByScope ? <AdminScopeFilters value={scope} onChange={setScope} /> : null}
      <PeriodPicker value={period} onChange={setPeriod} />
    </>
  )
  const panelFilters = (
    <PanelFilters active={panelActive} onClear={clearPanel}>
      {panelControls}
    </PanelFilters>
  )

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Apoio com Anjo</h1>
          <p className="text-sm text-muted-foreground">Leia os pedidos de apoio dos operadores do seu alcance e a conversa de cada um com o Anjo. Somente leitura.</p>
        </div>
        {tab === "requests" && total !== null ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {total.toLocaleString("pt-BR")} {total === 1 ? "pedido" : "pedidos"}
            {requestsFiltered || scopeActive ? " com esses filtros" : " no período"}
          </p>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={(next) => setTab(next as PanelTab)} className="space-y-4">
        {/* No celular as quatro abas não cabem: a barra rola de lado e cada aba fica numa linha só. */}
        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden [&>[data-slot=tabs-trigger]]:shrink-0 [&>[data-slot=tabs-trigger]]:whitespace-nowrap">
          <TabsTrigger value="requests" className="gap-1"><Inbox className="size-4" aria-hidden />Pedidos</TabsTrigger>
          <TabsTrigger value="funnel" className="gap-1"><Filter className="size-4" aria-hidden />Indicadores</TabsTrigger>
          <TabsTrigger value="attempts" className="gap-1"><UserX className="size-4" aria-hidden />Sem Anjo em serviço</TabsTrigger>
          <TabsTrigger value="anjos" className="gap-1"><HeartHandshake className="size-4" aria-hidden />Anjos</TabsTrigger>
        </TabsList>
        <TabsContent value="requests">
          <RequestsTab
            query={requests}
            filtered={requestsFiltered || scopeActive}
            toolbar={
              <ListToolbar
                search={
                  <ListSearchInput
                    value={requestFilters.search}
                    onChange={(value) => setRequestFilters((current) => ({ ...current, search: value }))}
                    placeholder="Buscar por operador ou protocolo"
                    ariaLabel="Buscar pedido por operador ou protocolo"
                    pending={requestFilters.search.trim() !== search}
                  />
                }
                hasActiveFilters={requestsFiltered || requestFilters.search.length > 0 || panelActive}
                onClearFilters={() => {
                  setRequestFilters(NO_REQUEST_FILTERS)
                  clearPanel()
                }}
              >
                <ListSelectFilter value={requestFilters.status} onChange={(status) => setRequestFilters((current) => ({ ...current, status }))} options={optionsFromLabels(REQUEST_STATUS_LABELS)} allLabel="Todos os estados" ariaLabel="Filtrar por estado" />
                <ListSelectFilter value={requestFilters.origin} onChange={(origin) => setRequestFilters((current) => ({ ...current, origin }))} options={optionsFromLabels(REQUEST_ORIGIN_LABELS)} allLabel="Todas as origens" ariaLabel="Filtrar por origem" />
                {panelControls}
              </ListToolbar>
            }
          />
        </TabsContent>
        <TabsContent value="funnel" className="space-y-4">{panelFilters}<FunnelTab filter={filter} /></TabsContent>
        <TabsContent value="attempts" className="space-y-4">{panelFilters}<UnavailableAttemptsTab filter={filter} /></TabsContent>
        <TabsContent value="anjos" className="space-y-4">{panelFilters}<AnjosActivityTab filter={filter} /></TabsContent>
      </Tabs>
    </section>
  )
}

/** A linha de filtros das outras abas (Grupo/Subgrupo e período), igual à de baixo da barra de filtros das listas. */
function PanelFilters({ active, onClear, children }: { active: boolean; onClear: () => void; children: ReactNode }) {
  return (
    <div role="group" aria-label="Filtros" className="flex flex-wrap items-center gap-2" data-usage-element="list.filter">
      {children}
      {active ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <FilterX data-icon="inline-start" /> Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Só montado para quem configura o apoio: Grupo e Subgrupo, como nas outras listas, a partir da árvore dos escopos (rota do Administrador
 * geral). Com Subgrupo, o Grupo dele vai junto.
 */
function AdminScopeFilters({ value, onChange }: { value: ScopeFilterValue; onChange: (value: ScopeFilterValue) => void }) {
  const scopes = useSupportScopesQuery()
  const groups = scopes.data ?? []
  if (groups.length === 0) return null
  const subgroups = groups
    .filter((group) => !value.teamId || group.id === value.teamId)
    .flatMap((group) => (group.children ?? []).map((child) => ({ value: child.id, label: value.teamId ? child.name : `${group.name} › ${child.name}`, teamId: group.id })))
  return (
    <>
      <ListSelectFilter value={value.teamId} onChange={(teamId) => onChange({ teamId })} options={groups.map((group) => ({ value: group.id, label: group.name }))} allLabel="Todos os grupos" ariaLabel="Filtrar por grupo" />
      {subgroups.length > 0 ? (
        <ListSelectFilter
          value={value.subteamId}
          onChange={(subteamId) => onChange(subteamId ? { teamId: subgroups.find((subgroup) => subgroup.value === subteamId)?.teamId ?? value.teamId, subteamId } : { teamId: value.teamId })}
          options={subgroups.map(({ value: id, label }) => ({ value: id, label }))}
          allLabel="Todos os subgrupos"
          ariaLabel="Filtrar por subgrupo"
        />
      ) : null}
    </>
  )
}
