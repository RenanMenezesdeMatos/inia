"use client"

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Activity, Info, Lock } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { useUsabilityContextQuery } from "@/queries/admin/use-usability-queries"
import { USABILITY_TABS, type UsabilityTab } from "@/services/admin/usability-service"

import { ConversationsTab } from "./conversations-tab"
import { FeedbacksTab } from "./feedbacks-tab"
import { JourneysTab } from "./journeys-tab"
import { OverviewTab } from "./overview-tab"
import { PeopleTab } from "./people-tab"
import { QualityTab } from "./quality-tab"
import { ScreensTab } from "./screens-tab"
import { UsabilityFilters } from "./usability-filters"
import { USABILITY_PATH } from "./usability-route"
import { UsabilityPanelProvider, type UsabilityPanelContext } from "./usability-shared"
import { TabError, TabSkeleton } from "./usability-tab-frame"
import { queryForTab, readUsabilityUrl, toHref, USABILITY_TAB_LABELS, withFilters, withoutFilters, withTab, type FilterKey } from "./usability-url-state"
import { WorkflowsTab } from "./workflows-tab"

/** Parâmetros do recorte que acompanham o link para o detalhe de uma pessoa (o resto é da lista). */
const PERSON_CARRY: readonly FilterKey[] = ["period", "from", "to", "compare", "includeAdmin", "includeQa"]

/**
 * Monitoria de usabilidade — Administração › Monitoramento. Tudo vem da API (`/api/v1/admin/usability`), que aplica permissão
 * e escopo; a URL guarda aba e filtros (link copiado = mesmo recorte). Sem dados de exemplo em nenhum estado.
 */
export function UsabilityPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const user = useCurrentUserQuery().data
  const contextQuery = useUsabilityContextQuery()
  const search = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const state = useMemo(() => readUsabilityUrl(search), [search])
  const capabilities = user?.access.capabilities
  const tabsRef = useRef<HTMLDivElement>(null)
  // Celular: a faixa de abas rola; a aba ativa (vinda da URL ou de um "Ver lista") fica sempre à vista.
  useEffect(() => {
    tabsRef.current?.querySelector('[role="tab"][data-state="active"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [state.tab, contextQuery.isSuccess])

  const navigate = useCallback((next: URLSearchParams) => router.replace(toHref(pathname, next), { scroll: false }), [router, pathname])
  const setFilters = useCallback((changes: Partial<Record<FilterKey, string | undefined>>) => navigate(withFilters(search, changes)), [navigate, search])
  const openTab = useCallback((tab: UsabilityTab, changes: Partial<Record<FilterKey, string | undefined>> = {}) => navigate(withFilters(withTab(search, tab), changes)), [navigate, search])

  if (user && !(capabilities?.canViewUsability && user.features.usabilityPanel)) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-12 text-center" role="alert">
          <Lock className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">{user.features.usabilityPanel ? "Você não tem acesso à monitoria de usabilidade." : "A monitoria de usabilidade está desligada neste ambiente."}</p>
        </div>
      </Shell>
    )
  }
  if (contextQuery.isPending) {
    return (
      <Shell>
        <TabSkeleton />
      </Shell>
    )
  }
  if (contextQuery.isError || !contextQuery.data) {
    return (
      <Shell>
        <TabError error={contextQuery.error} onRetry={() => void contextQuery.refetch()} />
      </Shell>
    )
  }

  const context = contextQuery.data
  const supported = context.tabs[state.tab] ?? []
  const { query, inapplicable } = queryForTab(state.values, supported)
  const meta = context.meta
  const dictionary = new Map(context.dictionary.map((definition) => [definition.id, definition]))
  const personHref = (personId: string) => {
    const carry = new URLSearchParams()
    for (const key of PERSON_CARRY) {
      const value = state.values[key]
      if (value) carry.set(key, value)
    }
    return toHref(`${USABILITY_PATH}/people/${personId}`, carry)
  }
  const panel: UsabilityPanelContext = { tab: state.tab, query, timezone: meta.timezone, dictionary, can: meta.can, setFilters, openTab, personHref }

  return (
    <Shell>
      <UsabilityPanelProvider value={panel}>
        <div className="space-y-4" data-usage-correlation="usability">
          <UsabilityFilters tab={state.tab} context={context} values={state.values} inapplicable={inapplicable} canViewPeople={meta.can.people} onChange={setFilters} onClear={() => navigate(withoutFilters(search))} />
          {state.unknownKeys.length ? (
            <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground" role="note">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Parâmetros desconhecidos no endereço foram ignorados: {state.unknownKeys.join(", ")}.
            </p>
          ) : null}
          {!meta.can.people ? (
            <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground" role="note">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Você vê totais agregados. Nomes, listas por pessoa e o detalhe individual exigem a permissão de ver pessoas identificadas.
            </p>
          ) : null}

          <Tabs value={state.tab} onValueChange={(next) => navigate(withTab(search, next as UsabilityTab))}>
            <div className="overflow-x-auto" ref={tabsRef}>
              <TabsList>
                {USABILITY_TABS.map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="whitespace-nowrap">
                    {USABILITY_TAB_LABELS[tab]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value="overview" className="mt-4">
              <OverviewTab query={query} />
            </TabsContent>
            <TabsContent value="people" className="mt-4">
              <PeopleTab query={query} segmentLabels={context.segments.people} />
            </TabsContent>
            <TabsContent value="screens" className="mt-4">
              <ScreensTab query={query} />
            </TabsContent>
            <TabsContent value="feedbacks" className="mt-4">
              <FeedbacksTab query={query} segmentLabels={context.segments.feedbacks} />
            </TabsContent>
            <TabsContent value="conversations" className="mt-4">
              <ConversationsTab query={query} />
            </TabsContent>
            <TabsContent value="workflows" className="mt-4">
              <WorkflowsTab query={query} />
            </TabsContent>
            <TabsContent value="journeys" className="mt-4">
              <JourneysTab query={query} />
            </TabsContent>
            <TabsContent value="quality" className="mt-4">
              <QualityTab query={query} />
            </TabsContent>
          </Tabs>
        </div>
      </UsabilityPanelProvider>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Activity className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Monitoria de usabilidade</h1>
          <p className="text-sm text-muted-foreground">Quem usa a INIA, onde, com que frequência e onde encontra dificuldade — medido de verdade, com a base e a cobertura de cada número.</p>
        </div>
      </div>
      {children}
    </div>
  )
}
