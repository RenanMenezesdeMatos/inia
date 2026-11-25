"use client"

import { useState, type ReactNode } from "react"
import { ChartNoAxesColumn, Filter, FilterX, Inbox, RadioTower, UserX } from "lucide-react"

import { ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { TeamSubteamFilters } from "@/components/admin/shared/list/team-subteam-filters"
import type { OrgUnitIds } from "@/lib/admin/unit-selection"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useSupportRequestsInfiniteQuery } from "@/queries/human-support/use-human-support-admin"
import { REQUEST_ORIGIN_LABELS, REQUEST_STATUS_LABELS, type RequestOrigin, type RequestStatus } from "@/schemas/human-support/catalogs.schema"
import type { PanelFilter, RequestListFilter } from "@/services/human-support/human-support-service"
import { hasOrgUnits } from "@/lib/admin/unit-selection"

import { OperationHistoryTab } from "../history/operation-history"
import { FunnelTab } from "./funnel-tab"
import { OnlineMonitoringTab } from "./online-monitoring-tab"
import { defaultPanelPeriod, PeriodPicker, type PanelPeriod } from "./period-picker"
import { RequestsTab } from "./requests-tab"
import { UnavailableAttemptsTab } from "./unavailable-attempts-tab"

type PanelTab = "requests" | "funnel" | "attempts" | "online" | "history"
type RequestFilters = { search: string; status: RequestStatus | undefined; origin: RequestOrigin | undefined }
const NO_REQUEST_FILTERS: RequestFilters = { search: "", status: undefined, origin: undefined }

/**
 * Administração › Monitoramento › Apoio com Anjo — o painel do apoio (Coordenador de Anjos e Administrador geral; D7), no formato de
 * "Conversas com a INIA": título, barra de filtros e os pedidos como caixa de entrada (lista à esquerda, conversa à direita). Pedidos ·
 * Indicadores · Sem Anjo em serviço · Monitoria Online · Jornada e atendimentos. Regra do responsável (12/11/2026): tudo o que é
 * ONLINE (agora) fica na Monitoria Online, sem período; tudo o que é HISTÓRICO, nas abas com período. O Grupo/Subgrupo vale para
 * todas; busca, estado e origem, só para os pedidos. Tudo no alcance de quem lê, decidido pelo servidor.
 *
 * Filtro por Grupo/Subgrupo: só para quem configura o apoio (`canFilterByScope`), com a árvore da configuração. O Coordenador de Anjos
 * não tem rota que liste a estrutura, e a tela nunca chama por ele uma rota que só o Administrador geral pode chamar.
 */
export function HumanSupportMonitoringPage({ canFilterByScope = false }: { canFilterByScope?: boolean }) {
  const [tab, setTab] = useState<PanelTab>("requests")
  const [period, setPeriod] = useState<PanelPeriod>(() => defaultPanelPeriod())
  const [scope, setScope] = useState<OrgUnitIds>({})
  const [requestFilters, setRequestFilters] = useState<RequestFilters>(NO_REQUEST_FILTERS)
  const search = useDebouncedValue(requestFilters.search.trim(), 300)

  const filter: PanelFilter = { from: period.from, to: period.to, teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }
  const listFilter: RequestListFilter = { ...filter, search: search || null, status: requestFilters.status ?? null, origin: requestFilters.origin ?? null }
  // A lista só consulta (e se atualiza) com a aba Pedidos aberta; o que já veio fica guardado ao trocar de aba.
  const requests = useSupportRequestsInfiniteQuery(listFilter, { enabled: tab === "requests" })
  const total = requests.data?.pages[0]?.total ?? null

  const initialPeriod = defaultPanelPeriod()
  const scopeActive = hasOrgUnits(scope)
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
          <h1 className="text-2xl font-semibold tracking-tight">Painel dos Anjos</h1>
          <p className="text-sm text-muted-foreground">Leia os pedidos de apoio dos operadores do seu alcance e a conversa de cada um com o Anjo. A conversa é só leitura; um atendimento em andamento pode ser transferido para outro Anjo.</p>
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
          <TabsTrigger value="online" className="gap-1"><RadioTower className="size-4" aria-hidden />Monitoria Online</TabsTrigger>
          <TabsTrigger value="history" className="gap-1"><ChartNoAxesColumn className="size-4" aria-hidden />Jornada e atendimentos</TabsTrigger>
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
        <TabsContent value="online" className="space-y-4">
          {canFilterByScope ? (
            <PanelFilters active={scopeActive} onClear={() => setScope({})}>
              <AdminScopeFilters value={scope} onChange={setScope} />
            </PanelFilters>
          ) : null}
          <OnlineMonitoringTab scope={{ teamId: scope.teamId ?? null, subteamId: scope.subteamId ?? null }} />
        </TabsContent>
        <TabsContent value="history" className="space-y-4">{panelFilters}<OperationHistoryTab filter={filter} /></TabsContent>
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
 * Só montado para quem configura o apoio: Grupos e Subgrupos, como nas outras listas, em lotes e no escopo de `human_support.manage`.
 */
function AdminScopeFilters({ value, onChange }: { value: OrgUnitIds; onChange: (value: OrgUnitIds) => void }) {
  return <TeamSubteamFilters source="human_support.manage" value={value} onChange={onChange} teamLabel="Todos os grupos" subteamLabel="Todos os subgrupos" />
}
