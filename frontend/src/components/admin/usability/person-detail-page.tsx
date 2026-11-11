"use client"

import { useCallback, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { CursorPagination } from "@/components/admin/shared/list/list-pagination"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useUsabilityContextQuery, useUsabilityPersonQuery, useUsabilityTimelineQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityPersonDetail } from "@/schemas/admin/usability.schema"

import { ACCOUNT_BADGE, DEVICE_LABELS, formatCount, formatDecimal, formatDuration, formatInstant, formatLocalDate } from "./usability-format"
import { UsabilityFilters } from "./usability-filters"
import { USABILITY_PATH } from "./usability-route"
import { BarList, DataTable, EmptyNote, Section, StatTile, UsabilityPanelProvider, type UsabilityPanelContext } from "./usability-shared"
import { TabError, TabSkeleton } from "./usability-tab-frame"
import { queryForTab, readUsabilityUrl, toHref, withFilters, withoutFilters, withoutPaging, type FilterKey } from "./usability-url-state"

type Person = { name: string; matricula: string | null; jobTitle: string | null; teamName: string | null; subteamName: string | null; personActive: boolean; employmentStatus: string; accountStatus: string; roles: string[]; lastLoginAt: string | null }
type Milestones = { firstObservedAt: string | null; firstObservedSource: string | null; lastObservedAt: string | null; lastObservedSource: string | null; legacyLastLoginAt: string | null }
type Eligibility = { from: string; until: string | null; openedBasis: string; closedBasis: string | null }
type Totals = { activeDays: number; sessionsStarted: number; sessionsPerActiveDay: number | null; activeSeconds: number; sessionDuration: { median: number | null; p95: number | null }; devices: string[] }
type Session = { startedAt: string; endedAt: string; endReason: string; activeSeconds: number; device: string | null; activityCount: number; admin: boolean }
type ScreenRow = { screenKey: string; label: string; views: number; activeSeconds: number; days: number }
type ActionRow = { action: string; label: string; count: number }

const SOURCE_LABELS: Record<string, string> = { LOGIN: "login", ACTIVITY: "uso medido", DOMAIN_ACTION: "ação no produto", LEGACY_LOGIN: "login anterior à coleta" }
const END_LABELS: Record<string, string> = { OPEN: "Em andamento", INACTIVITY_INFERRED: "Encerrada por inatividade", LOGOUT: "Saiu" }
const BASIS_LABELS: Record<string, string> = { COLLECTION_START: "início da coleta", ACCOUNT_CREATED: "conta criada", STATE_CHANGE_OBSERVED: "mudança observada", ACCOUNT_DISABLED: "conta desativada", PERSON_INACTIVE: "pessoa desligada", ACCOUNT_REMOVED: "conta removida" }

export function UsabilityPersonPage({ personId }: { personId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const state = useMemo(() => readUsabilityUrl(search), [search])
  const contextQuery = useUsabilityContextQuery()
  const supported = contextQuery.data?.tabs.person ?? ["period", "from", "to", "compare", "includeAdmin", "includeQa"]
  const { query, inapplicable } = queryForTab(state.values, supported)
  const detailQuery = withoutPaging(query)
  const detail = useUsabilityPersonQuery(personId, detailQuery)
  const [timelinePage, setTimelinePage] = useState(1)
  const [timelinePageSize, setTimelinePageSize] = useState(50)
  const timeline = useUsabilityTimelineQuery(personId, { ...detailQuery, page: String(timelinePage), pageSize: String(timelinePageSize) }, detail.isSuccess)
  const navigate = useCallback((next: URLSearchParams) => {
    setTimelinePage(1)
    router.replace(toHref(pathname, next), { scroll: false })
  }, [router, pathname])
  const back = new URLSearchParams([["tab", "people"]])
  for (const key of ["period", "from", "to", "compare"] as const) {
    const value = search.get(key)
    if (value) back.set(key, value)
  }
  const backHref = toHref(USABILITY_PATH, back)

  const header = (
    <BackLink href={backHref} label="Pessoas e acessos" />
  )

  if (contextQuery.isPending || detail.isPending) {
    return (
      <div className="space-y-4">
        {header}
        <TabSkeleton />
      </div>
    )
  }
  if (detail.isError || !detail.data || !contextQuery.data) {
    const notFound = detail.error instanceof AdminApiError && detail.error.code === "USABILITY_PERSON_NOT_FOUND"
    return (
      <div className="space-y-4">
        {header}
        {notFound ? <EmptyNote>Pessoa não encontrada no seu alcance.</EmptyNote> : <TabError error={detail.error ?? contextQuery.error} onRetry={() => void detail.refetch()} />}
      </div>
    )
  }

  const data = detail.data
  const context = contextQuery.data
  const timezone = data.meta.timezone
  const panel: UsabilityPanelContext = {
    tab: "people",
    query: detailQuery,
    timezone,
    dictionary: new Map(context.dictionary.map((definition) => [definition.id, definition])),
    can: data.meta.can,
    setFilters: (changes: Partial<Record<FilterKey, string | undefined>>) => navigate(withFilters(search, changes)),
    openTab: () => undefined,
    personHref: (id) => toHref(`${USABILITY_PATH}/people/${id}`, search),
  }
  const person = data.person as unknown as Person
  const milestones = data.milestones as unknown as Milestones
  const totals = data.totals as unknown as Totals

  return (
    <UsabilityPanelProvider value={panel}>
      <div className="space-y-4">
        {header}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{person.name}</h1>
            <p className="text-sm text-muted-foreground">{[person.matricula, person.jobTitle, [person.teamName, person.subteamName].filter(Boolean).join(" › ")].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant={person.accountStatus === "ENABLED" ? "secondary" : "outline"} className="font-normal">
                Conta: {ACCOUNT_BADGE[person.accountStatus] ?? person.accountStatus}
              </Badge>
              {!person.personActive ? <Badge variant="outline" className="font-normal">Desligada</Badge> : null}
              {person.roles.map((role) => (
                <Badge key={role} variant="outline" className="font-normal">
                  {context.options.accessRoles.find((item) => item.code === role)?.name ?? role}
                </Badge>
              ))}
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden /> Esta consulta individual fica registrada na auditoria. Nenhum conteúdo de conversa ou feedback aparece aqui.
          </p>
        </div>

        <UsabilityFilters tab="person" context={context} values={state.values} inapplicable={inapplicable} canViewPeople={false} onChange={(changes) => navigate(withFilters(search, changes))} onClear={() => navigate(withoutFilters(search))} />
        <p className="text-xs text-muted-foreground">
          {data.meta.period.label} · fuso {timezone}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Primeiro uso comprovado" value={milestones.firstObservedAt ? formatInstant(milestones.firstObservedAt, timezone) : "Nenhum"} hint={milestones.firstObservedSource ? `por ${SOURCE_LABELS[milestones.firstObservedSource] ?? milestones.firstObservedSource}` : milestones.legacyLastLoginAt ? `Login anterior à coleta: ${formatInstant(milestones.legacyLastLoginAt, timezone)}` : undefined} />
          <StatTile label="Último uso comprovado" value={milestones.lastObservedAt ? formatInstant(milestones.lastObservedAt, timezone) : "Nenhum"} hint={milestones.lastObservedSource ? `por ${SOURCE_LABELS[milestones.lastObservedSource] ?? milestones.lastObservedSource}` : undefined} />
          <StatTile label="Dias ativos no período" value={formatCount(totals.activeDays)} hint={`${formatCount(totals.sessionsStarted)} acesso(s) · ${formatDecimal(totals.sessionsPerActiveDay)} por dia ativo`} metricId="activity.active_people" />
          <StatTile label="Tempo ativo" value={formatDuration(totals.activeSeconds)} hint={`sessão mediana ${formatDuration(totals.sessionDuration.median)} · ${totals.devices.map((device) => DEVICE_LABELS[device] ?? device).join(", ") || "sem dispositivo"}`} metricId="activity.active_time" />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <CalendarCard calendar={data.calendar} />
          <Section title="Horários de uso" description="Em quantos dias a pessoa esteve ativa em cada hora.">
            <BarList items={data.hours.map((hour) => ({ key: String(hour.hour), label: `${String(hour.hour).padStart(2, "0")}h`, value: hour.activeDays, display: `${hour.activeDays} dia(s)` }))} empty="Sem uso medido no período." />
          </Section>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Telas mais usadas">
            <DataTable
              rows={data.screens as unknown as ScreenRow[]}
              rowKey={(row) => row.screenKey}
              caption="Telas da pessoa"
              columns={[
                { key: "label", header: "Tela", cell: (row) => row.label },
                { key: "views", header: "Visualizações", align: "right", cell: (row) => formatCount(row.views) },
                { key: "days", header: "Dias", align: "right", cell: (row) => formatCount(row.days) },
                { key: "time", header: "Tempo ativo", align: "right", cell: (row) => formatDuration(row.activeSeconds) },
              ]}
            />
          </Section>
          <Section title="Ações no produto" description="Ações gravadas pelo próprio produto (fonte oficial).">
            <div className="space-y-3">
              <BarList items={(data.actions as unknown as ActionRow[]).map((row) => ({ key: row.action, label: row.label, value: row.count }))} empty="Nenhuma ação no período." />
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Feedbacks abertos" value={formatCount(data.feedback.opened ?? 0)} hint={`${formatCount(data.feedback.ratings ?? 0)} avaliações · ${formatCount(data.feedback.acks ?? 0)} ciências · ${formatCount(data.feedback.ack_failures ?? 0)} erros de confirmação`} />
                <StatTile label="Conversa com a INIA" value={formatCount((data.chat.text ?? 0) + (data.chat.voice ?? 0))} hint={`${formatCount(data.chat.text ?? 0)} digitadas · ${formatCount(data.chat.voice ?? 0)} de voz · ${formatCount(data.chat.conversations ?? 0)} conversa(s)`} />
              </div>
            </div>
          </Section>
        </div>

        <Section title="Acessos (sessões)" description="Nova sessão depois de 30 min sem atividade. A mesma sessão vale para várias abas do navegador.">
          <DataTable
            rows={data.sessions as unknown as Session[]}
            rowKey={(row) => row.startedAt}
            caption="Sessões"
            columns={[
              { key: "start", header: "Início", cell: (row) => <span className="text-xs">{formatInstant(row.startedAt, timezone)}</span> },
              { key: "end", header: "Fim", cell: (row) => <span className="text-xs">{`${formatInstant(row.endedAt, timezone)} · ${END_LABELS[row.endReason] ?? row.endReason}`}</span> },
              { key: "active", header: "Tempo ativo", align: "right", cell: (row) => formatDuration(row.activeSeconds) },
              { key: "device", header: "Dispositivo", cell: (row) => (row.device ? (DEVICE_LABELS[row.device] ?? row.device) : "—") },
              { key: "count", header: "Eventos", align: "right", cell: (row) => formatCount(row.activityCount) },
              { key: "admin", header: "", cell: (row) => (row.admin ? <Badge variant="outline" className="font-normal">Administração</Badge> : null) },
            ]}
          />
        </Section>

        <Section title="Elegibilidade" description="Períodos em que a pessoa podia usar a INIA (registrados desde o início da coleta).">
          <DataTable
            rows={data.eligibility as unknown as Eligibility[]}
            rowKey={(row) => row.from}
            empty="Sem período de elegibilidade registrado."
            caption="Elegibilidade"
            columns={[
              { key: "from", header: "Desde", cell: (row) => <span className="text-xs">{`${formatInstant(row.from, timezone)} (${BASIS_LABELS[row.openedBasis] ?? row.openedBasis})`}</span> },
              { key: "until", header: "Até", cell: (row) => <span className="text-xs">{row.until ? `${formatInstant(row.until, timezone)} (${row.closedBasis ? (BASIS_LABELS[row.closedBasis] ?? row.closedBasis) : ""})` : "Em vigor"}</span> },
            ]}
          />
        </Section>

        <Section title="Linha do tempo" description="Eventos medidos e ações oficiais, do mais recente para o mais antigo. Nada do que foi digitado ou falado aparece aqui.">
          {timeline.isError ? (
            <TabError error={timeline.error} onRetry={() => void timeline.refetch()} />
          ) : !timeline.data ? (
            <TabSkeleton />
          ) : timeline.data.items.length === 0 ? (
            <EmptyNote>Nada registrado no período.</EmptyNote>
          ) : (
            <div className="space-y-3" aria-busy={timeline.isFetching}>
              <ol className="divide-y">
                {timeline.data.items.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
                    <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">{formatInstant(item.at, timezone)}</span>
                    <span className="min-w-0 flex-1">
                      {item.label}
                      {item.elementLabel ? <span className="text-muted-foreground"> · {item.elementLabel}</span> : null}
                      {item.screenLabel ? <span className="text-muted-foreground"> · {item.screenLabel}</span> : null}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {item.source === "OFFICIAL" ? "Oficial" : item.source === "SERVER" ? "Servidor" : "Navegador"}
                    </Badge>
                    {item.href ? (
                      <a href={item.href} className="text-xs text-primary underline-offset-2 hover:underline">
                        Ler conversa
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
              {/* Paginação única do app, na forma "por posição": a linha do tempo não tem total, só "há mais antigos". */}
              <CursorPagination
                page={timelinePage}
                pageSize={timelinePageSize}
                shownCount={timeline.data.items.length}
                hasNext={timeline.data.hasMore}
                isFetching={timeline.isFetching}
                onPrevious={() => setTimelinePage((page) => Math.max(1, page - 1))}
                onNext={() => setTimelinePage((page) => page + 1)}
                onPageSizeChange={(size) => {
                  setTimelinePageSize(size)
                  setTimelinePage(1)
                }}
                itemLabel={["evento", "eventos"]}
              />
            </div>
          )}
        </Section>
      </div>
    </UsabilityPanelProvider>
  )
}

function CalendarCard({ calendar }: { calendar: UsabilityPersonDetail["calendar"] }) {
  const max = Math.max(1, ...calendar.map((day) => day.activeSeconds))
  return (
    <Section title="Dias de uso" description="Cada quadrado é um dia do período; mais escuro = mais tempo ativo." className="xl:col-span-2">
      {calendar.length === 0 ? (
        <EmptyNote>Sem dias no período.</EmptyNote>
      ) : (
        <ul className="flex flex-wrap gap-1" aria-label="Dias de uso">
          {calendar.map((day) => (
            <li
              key={day.date}
              className="flex size-9 flex-col items-center justify-center rounded-md border text-[10px] tabular-nums"
              style={{ background: day.active ? `color-mix(in oklab, var(--primary) ${Math.round(20 + (day.activeSeconds / max) * 70)}%, transparent)` : undefined }}
              title={`${formatLocalDate(day.date)}: ${day.active ? `${formatDuration(day.activeSeconds)} ativo, ${day.sessionsStarted} acesso(s), ${day.screenViews} tela(s), ${day.activations} acionamento(s)` : "sem uso"}`}
            >
              <span className={day.active ? "font-medium text-primary-foreground" : "text-muted-foreground"}>{day.date.slice(8, 10)}</span>
              <span className="sr-only">{day.active ? `${formatDuration(day.activeSeconds)} ativo` : "sem uso"}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
