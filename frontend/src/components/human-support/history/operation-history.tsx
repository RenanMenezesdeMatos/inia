"use client"

import { useState, type ReactNode } from "react"
import { HeartHandshake, Info, X } from "lucide-react"

import { ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListNoResultsState } from "@/components/admin/shared/list/list-states"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import type { CardWidth, GridSection } from "@/components/ui/customizable-grid/layout"
import { SectionLabel, SURFACE_CARD } from "@/components/ui/surface"
import { PersistedCustomizableView } from "@/components/view-layouts/persisted-customizable-view"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useOperationHistoryQuery, useSupportFunnelQuery } from "@/queries/human-support/use-human-support-admin"
import { hoursMinutesText, pctText, type AnjoHistory, type AnjoStructure, type AttendanceIndicators, type JourneyDay, type JourneySummary, type OperationHistory } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { ANJO_WORK_MEASURES, MeasureCard } from "../monitoring/funnel-tab"
import { PanelError } from "../monitoring/panel-error"
import { AttendanceBlock, attendanceMetricCards, averageText, ratioText } from "./attendance-block"
import { JourneyDays, JourneyEmpty, JourneyPauses, JourneySummaryTiles, journeyTileCards } from "./journey-block"
import { PresenceTimeline } from "./presence-timeline"
import { TermLabel } from "./term-hint"

/**
 * JORNADA E ATENDIMENTOS (aba do Painel dos Anjos) — a visão das PESSOAS: o tempo online de cada Anjo e de todos juntos (gráfico por
 * dia), os estados, as pausas e os números de atendimento POR ANJO. O que é da operação inteira — demanda por horário, espera,
 * quem mais aciona, produtivos, motivos, sem Anjo logado, abandonos — fica na aba Indicadores e não se repete aqui. Clicar num Anjo
 * abre a jornada dia a dia e os indicadores de atendimento dele. O próprio Anjo vê só o próprio histórico (`AnjoHistoryDetail`).
 */
export function CoverageNote({ coverage }: { coverage: OperationHistory["coverage"] }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="history-coverage">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Atendimentos, pausas e disponibilidade registrados desde {coverage.baseSince ? formatDateTime(coverage.baseSince) : "a ativação do apoio"}. Sessão encerrada, interrupções por causa e pertinência: desde{" "}
        {coverage.connectionSince ? formatDateTime(coverage.connectionSince) : "a próxima atualização"}.
      </span>
    </p>
  )
}

/** Soma os dias de vários Anjos (o gráfico de tempo online de todos juntos). */
function sumDays(anjos: readonly AnjoHistory[], days: readonly string[]): JourneyDay[] {
  return days.map((day) => {
    const own = anjos.flatMap((anjo) => anjo.journey.days.filter((item) => item.day === day))
    const sum = (pick: (item: JourneyDay) => number) => own.reduce((total, item) => total + pick(item), 0)
    return {
      day,
      availableMs: sum((item) => item.availableMs),
      attendanceMs: sum((item) => item.attendanceMs),
      pausedMs: { LUNCH: sum((item) => item.pausedMs.LUNCH), PERSONAL: sum((item) => item.pausedMs.PERSONAL), PROCESS_ACTIVITY: sum((item) => item.pausedMs.PROCESS_ACTIVITY), MEETING: sum((item) => item.pausedMs.MEETING) },
      unavailableMs: sum((item) => item.unavailableMs),
      baseMs: sum((item) => item.baseMs),
    }
  })
}



/** Título de um grupo dentro do bloco (Atendimentos, Motivos, Tempo online), com uma linha que o separa do grupo anterior. */
function SubHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <SectionLabel as="h3" className="shrink-0">
        {children}
      </SectionLabel>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  )
}

export function AnjoHistoryDetail({ anjo, multiDay, period }: { anjo: AnjoHistory; multiDay: boolean; period?: { from: string; to: string } }) {
  return (
    <div className="space-y-8" data-testid={`anjo-history-${anjo.personId}`}>
      <section className="space-y-3" aria-label="Atendimentos">
        <SubHeading>Atendimentos</SubHeading>
        <AttendanceBlock indicators={anjo.attendance} />
      </section>
      <section className="space-y-3" aria-label="Jornada">
        <SubHeading>Tempo online</SubHeading>
        <JourneySummaryTiles summary={anjo.journey.summary} multiDay={multiDay} />
        {anjo.journey.days.length > 0 ? <JourneyDays days={anjo.journey.days} /> : null}
      </section>
      {period ? (
        <section className="space-y-3" aria-label="Presença">
          <SubHeading>Linha do tempo da presença</SubHeading>
          <div className={cn(SURFACE_CARD, "p-4")}>
            <PresenceTimeline personId={anjo.personId} name={anjo.name} period={period} />
          </div>
        </section>
      ) : null}
    </div>
  )
}

/**
 * FILTROS DA TABELA "POR ANJO" (pedido do responsável em 2026-11-12): nome, Grupo, Subgrupo e a linha de chefia ATUAL do Anjo
 * (supervisor, coordenador, gerente, gerente sênior — o líder mais próximo de cada cargo; a própria pessoa, se ela tem o cargo).
 * Filtram só a lista de Anjos; a visão geral continua sendo de todos os Anjos do alcance.
 */
type AnjoFilters = { search: string; team?: string | undefined; subteam?: string | undefined; SUPERVISOR?: string | undefined; COORDINATOR?: string | undefined; MANAGER?: string | undefined; SENIOR_MANAGER?: string | undefined }
const LEADER_FILTERS = [
  { key: "SUPERVISOR", all: "Todos os supervisores", aria: "Supervisor" },
  { key: "COORDINATOR", all: "Todos os coordenadores", aria: "Coordenador" },
  { key: "MANAGER", all: "Todos os gerentes", aria: "Gerente" },
  { key: "SENIOR_MANAGER", all: "Todos os gerentes sêniores", aria: "Gerente sênior" },
] as const
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()

function optionsOf(anjos: readonly AnjoHistory[], pick: (structure: AnjoStructure) => { id: string; name: string } | null) {
  const map = new Map<string, string>()
  for (const anjo of anjos) {
    const ref = anjo.structure ? pick(anjo.structure) : null
    if (ref) map.set(ref.id, ref.name)
  }
  return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
}

function matches(anjo: AnjoHistory, filters: AnjoFilters): boolean {
  if (filters.search && !normalize(anjo.name).includes(normalize(filters.search))) return false
  const structure = anjo.structure
  if (filters.team && structure?.team?.id !== filters.team) return false
  if (filters.subteam && structure?.subteam?.id !== filters.subteam) return false
  for (const { key } of LEADER_FILTERS) if (filters[key] && structure?.leaders[key]?.id !== filters[key]) return false
  return true
}

function AnjoFiltersBar({ anjos, value, onChange }: { anjos: readonly AnjoHistory[]; value: AnjoFilters; onChange: (next: AnjoFilters) => void }) {
  const set = (patch: Partial<AnjoFilters>) => onChange({ ...value, ...patch })
  const active = Boolean(value.search || value.team || value.subteam || LEADER_FILTERS.some(({ key }) => value[key]))
  return (
    <ListToolbar
      search={<ListSearchInput value={value.search} onChange={(search) => set({ search })} placeholder="Buscar Anjo pelo nome" ariaLabel="Buscar Anjo" />}
      hasActiveFilters={active}
      onClearFilters={() => onChange({ search: "" })}
    >
      <ListSelectFilter value={value.team} onChange={(team) => set({ team })} options={optionsOf(anjos, (structure) => structure.team)} allLabel="Todos os grupos" ariaLabel="Grupo" />
      <ListSelectFilter value={value.subteam} onChange={(subteam) => set({ subteam })} options={optionsOf(anjos, (structure) => structure.subteam)} allLabel="Todos os subgrupos" ariaLabel="Subgrupo" />
      {LEADER_FILTERS.map(({ key, all, aria }) => (
        <ListSelectFilter key={key} value={value[key]} onChange={(next) => set({ [key]: next })} options={optionsOf(anjos, (structure) => structure.leaders[key])} allLabel={all} ariaLabel={aria} />
      ))}
    </ListToolbar>
  )
}

/** Zeros só para declarar os cards antes de os dados chegarem (ids e títulos estáveis); o card mostra o carregando no lugar. */
const ZERO_AVERAGE = { averageSeconds: null, count: 0 }
const ZERO_RATIO = { numerator: 0, denominator: 0, value: null, status: "NO_DATA" as const }
const ZERO_ATTENDANCE: AttendanceIndicators = {
  acolhimentos: 0,
  operatorWait: ZERO_AVERAGE,
  firstResponse: ZERO_AVERAGE,
  handling: { ...ZERO_AVERAGE, normal: ZERO_AVERAGE, other: ZERO_AVERAGE, otherByCause: {} },
  reasons: { total: 0, items: [] },
  pertinence: { pertinent: 0, notPertinent: 0, notEvaluated: 0, rate: ZERO_RATIO },
  noReply: { rate: ZERO_RATIO, anjoSide: 0, operatorSide: 0 },
  abandonedAfterAcolhimento: 0,
  interruptedBySystem: { connection: 0, session: 0, roleRevoked: 0, unknown: 0 },
  stars: { average: null, count: 0 },
}
const ZERO_PAUSES = { LUNCH: 0, PERSONAL: 0, PROCESS_ACTIVITY: 0, MEETING: 0 }
const ZERO_SUMMARY: JourneySummary = {
  total: { availableMs: 0, attendanceMs: 0, pausedMs: ZERO_PAUSES, unavailableMs: 0 },
  baseMs: 0,
  shares: { available: null, attendance: null, pausedTotal: null, paused: { LUNCH: null, PERSONAL: null, PROCESS_ACTIVITY: null, MEETING: null }, productive: null },
  daysWithOnline: 0,
  dailyAverage: null,
}
const TILE_WIDTHS: Record<string, CardWidth> = { online: 4, disponivel: 4, "em-atendimento": 4, "em-pausa": 6, "dia-produtivo": 6 }

/**
 * ABA JORNADA E ATENDIMENTOS — visão personalizável (padrão do app, `anjos.jornada`): Atendimentos (todos os Anjos), Principais motivos
 * de acionamento, Tempo online e Por Anjo. Cada cartão é um card; a pessoa reposiciona, redimensiona em blocos e esconde, e fica salvo.
 */
export function OperationHistoryTab({ filter }: { filter: PanelFilter }) {
  const query = useOperationHistoryQuery(filter)
  const funnel = useSupportFunnelQuery(filter)
  const data = query.data
  const multiDay = (data?.days.length ?? 0) > 1
  const state = (render: () => ReactNode, height = "h-20") =>
    query.isPending ? <Skeleton className={cn(height, "w-full rounded-xl")} aria-label="Carregando o histórico" /> : query.isError ? <PanelError error={query.error} onRetry={() => void query.refetch()} /> : render()
  const funnelState = (id: string) =>
    funnel.isPending ? <Skeleton className="h-40 w-full rounded-2xl" aria-label="Carregando os motivos" /> : funnel.isError ? <PanelError error={funnel.error} onRetry={() => void funnel.refetch()} /> : (() => {
      const measure = funnel.data.measures.find((item) => item.id === id)
      return measure ? <MeasureCard measure={measure} /> : <p className="text-sm text-muted-foreground">Sem dados no período.</p>
    })()
  const attendance = data?.consolidated?.attendance ?? ZERO_ATTENDANCE
  const summary = data?.consolidated?.journey ?? ZERO_SUMMARY
  const catalog: GridSection[] = [
    {
      id: "atendimentos",
      title: "Atendimentos — todos os Anjos",
      description: "Somando os Anjos do seu alcance no período. A demanda, a fila e a avaliação do operador estão na aba Indicadores.",
      cards: attendanceMetricCards(attendance, "all").map((card) => ({ id: card.id, title: card.title, defaultWidth: 3, widths: [3, 4, 6, 12] as const, render: () => state(card.render) })),
    },
    {
      id: "motivos",
      title: "Principais motivos de acionamento",
      description: "Por que o operador precisou do Anjo e como o atendimento terminou, segundo a classificação do Anjo.",
      cards: ANJO_WORK_MEASURES.map((id) => ({ id: id.toLowerCase(), title: id === "M14" ? "Por que o operador precisou do Anjo" : "Resultado do atendimento", defaultWidth: 6, widths: [4, 6, 8, 12] as const, render: () => funnelState(id) })),
    },
    {
      id: "tempo-online",
      title: "Tempo online — todos os Anjos",
      description: "Disponível, em atendimento e em pausa de todos os Anjos do alcance. Indisponível (o mesmo que offline) fica fora.",
      cards: [
        ...journeyTileCards(summary).map((card) => ({ id: card.id, title: card.title, defaultWidth: TILE_WIDTHS[card.id] ?? 4, widths: [3, 4, 6, 12] as const, render: () => state(() => (summary.baseMs === 0 && card.id === "online" ? <JourneyEmpty /> : card.render())) })),
        { id: "pausas", title: "Pausas por tipo", defaultWidth: 12, widths: [6, 8, 12] as const, render: () => state(() => <JourneyPauses summary={summary} multiDay={multiDay} />) },
        { id: "por-dia", title: "Tempo online por dia", defaultWidth: 12, widths: [6, 8, 12] as const, defaultRows: 4, render: ({ rows }) => state(() => (data && data.days.length > 0 ? <JourneyDays days={sumDays(data.anjos, data.days)} showUnavailable={false} rows={rows} /> : <JourneyEmpty />), "h-56") },
      ],
    },
    {
      id: "por-anjo",
      title: "Por Anjo",
      description: "Cada Anjo no período. Clique num Anjo para ver os atendimentos, os motivos e o tempo online dele.",
      cards: [{ id: "tabela", title: "Jornada e atendimentos por Anjo", defaultWidth: 12, widths: [12] as const, render: () => state(() => <ByAnjoCard data={data!} />, "h-40") }],
    },
  ]
  // Falha da leitura principal: um aviso só, em vez de um por card.
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  return (
    <div className="space-y-4">
      {data ? <CoverageNote coverage={data.coverage} /> : null}
      <PersistedCustomizableView viewKey="anjos.jornada" label="Jornada e atendimentos" catalog={catalog} />
    </div>
  )
}

/** A tabela "Por Anjo" com os filtros (nome, Grupo, Subgrupo, linha de chefia) e o detalhe do Anjo escolhido. */
function ByAnjoCard({ data }: { data: OperationHistory }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [anjoFilters, setAnjoFilters] = useState<AnjoFilters>({ search: "" })
  const multiDay = data.days.length > 1
  const shownAnjos = data.anjos.filter((anjo) => matches(anjo, anjoFilters))
  // O detalhe aberto some se o Anjo sair do filtro.
  const chosen = shownAnjos.find((anjo) => anjo.personId === selected) ?? null
  return (
    <div className="space-y-4">
        {data.anjos.length > 0 ? <AnjoFiltersBar anjos={data.anjos} value={anjoFilters} onChange={setAnjoFilters} /> : null}
        {data.anjos.length === 0 ? (
          <AnalyticsEmptyState icon={HeartHandshake} title="Nenhum Anjo no seu alcance" description="Aparecem aqui as pessoas com o papel de Anjo nos escopos que o seu papel cobre." />
        ) : shownAnjos.length === 0 ? (
          <ListNoResultsState title="Nenhum Anjo com esses filtros" onClear={() => setAnjoFilters({ search: "" })} />
        ) : (
          <div className={TABLE_FRAME}>
            <Table aria-label="Jornada e atendimentos por Anjo">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Anjo</TableHead>
                  <TableHead className="text-right"><TermLabel term="online">Online</TermLabel></TableHead>
                  <TableHead className="text-right"><TermLabel term="available">Disponível</TermLabel></TableHead>
                  <TableHead className="text-right"><TermLabel term="attendance">Em atendimento</TermLabel></TableHead>
                  <TableHead className="text-right">Em pausa</TableHead>
                  <TableHead className="text-right"><TermLabel term="productive">Dia produtivo</TermLabel></TableHead>
                  <TableHead className="text-right">Acolhidos</TableHead>
                  <TableHead className="text-right"><TermLabel term="welcome">Tempo médio de acolhimento</TermLabel></TableHead>
                  <TableHead className="text-right"><TermLabel term="handling">Tempo médio de atendimento</TermLabel></TableHead>
                  <TableHead className="text-right">Falta de retorno</TableHead>
                  <TableHead className="text-right" title="Média das notas do operador; aparece com 5 notas ou mais.">Estrelas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownAnjos.map((anjo) => {
                  const { summary } = anjo.journey
                  const open = anjo.personId === selected
                  return (
                    <TableRow key={anjo.personId} data-state={open ? "selected" : undefined} className={cn("cursor-pointer", open && "bg-primary/5")} onClick={() => setSelected(open ? null : anjo.personId)}>
                      <TableCell>
                        <button
                          type="button"
                          aria-expanded={open}
                          className="flex items-center gap-2 text-left font-medium outline-none focus-visible:underline"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelected(open ? null : anjo.personId)
                          }}
                        >
                          <PersonAvatar name={anjo.name} avatarUrl={anjo.avatarUrl} className="size-7" />
                          {anjo.name}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{summary.baseMs === 0 ? <span className="text-muted-foreground">Sem tempo online</span> : hoursMinutesText(summary.baseMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pctText(summary.shares.available)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pctText(summary.shares.attendance)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pctText(summary.shares.pausedTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pctText(summary.shares.productive)}</TableCell>
                      <TableCell className="text-right tabular-nums">{anjo.attendance.acolhimentos}</TableCell>
                      <TableCell className="text-right tabular-nums">{averageText(anjo.attendance.firstResponse)}</TableCell>
                      <TableCell className="text-right tabular-nums">{averageText(anjo.attendance.handling)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ratioText(anjo.attendance.noReply.rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{anjo.attendance.stars.average === null ? "—" : anjo.attendance.stars.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {chosen ? (
          // O Anjo escolhido: cabeçalho com foto, nome e "Fechar"; a faixa roxa à esquerda liga o detalhe à linha marcada — sem fundo cinza.
          <section className="space-y-6 border-l-4 border-primary pt-2 pl-4 sm:pl-6" aria-labelledby="history-chosen-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <PersonAvatar name={chosen.name} avatarUrl={chosen.avatarUrl} className="size-10" />
                <div className="leading-tight">
                  <h3 id="history-chosen-title" className="text-base font-semibold">
                    {chosen.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">Atendimentos, motivos e tempo online no período</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <X aria-hidden />
                Fechar
              </Button>
            </div>
            <AnjoHistoryDetail anjo={chosen} multiDay={multiDay} period={{ from: data.period.from, to: data.period.to }} />
          </section>
        ) : null}
    </div>
  )
}
