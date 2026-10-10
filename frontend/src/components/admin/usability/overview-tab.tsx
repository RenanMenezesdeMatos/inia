"use client"

import { useId } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { DifficultySignal, UsabilityOverview } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery, UsabilityTab } from "@/services/admin/usability-service"

import { formatCount, formatDecimal, formatDuration, formatLocalDate, formatPercent, formatShortDate, ISO_WEEKDAY_LABELS, NO_DATA } from "./usability-format"
import { BarList, DataTable, EmptyNote, ExportButton, HeuristicBadge, MetricCard, Section, StatTile, usePanel } from "./usability-shared"
import { DeferredMount, TabFrame } from "./usability-tab-frame"

/** Métrica → segmento da lista de pessoas que a explica (drill-down). */
const PEOPLE_DRILL: Record<string, string> = {
  "activity.active_people": "ACTIVE",
  "activity.adoption_rate": "ACTIVE",
  "activity.eligible_inactive": "ELIGIBLE_INACTIVE",
  "activity.engaged_people": "ENGAGED",
  "population.eligible_period": "ELIGIBLE",
}

export function OverviewTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("overview", query)
  return <TabFrame result={result}>{(data) => <OverviewContent data={data} />}</TabFrame>
}

function OverviewContent({ data }: { data: UsabilityOverview }) {
  const { openTab } = usePanel()
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton table="kpis" label="Exportar indicadores" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((metric) => (
          <MetricCard key={metric.metric} metric={metric} onDrill={PEOPLE_DRILL[metric.metric] ? () => openTab("people", { segment: PEOPLE_DRILL[metric.metric] }) : undefined} drillLabel="Ver pessoas" />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ReferenceCard data={data} />
        <Section title="Duração e frequência" description="Mediana e p95 das sessões encerradas no período; tempo ativo por pessoa com atividade." metricId="sessions.duration" className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sessão (mediana)" value={formatDuration(data.distributions.sessionDurationSeconds.median)} hint={`p95 ${formatDuration(data.distributions.sessionDurationSeconds.p95)} · ${formatCount(data.distributions.sessionDurationSeconds.count)} sessões`} />
            <StatTile label="Tempo ativo por pessoa (mediana)" value={formatDuration(data.distributions.activeSecondsPerPerson.median)} hint={`p95 ${formatDuration(data.distributions.activeSecondsPerPerson.p95)}`} metricId="activity.active_time" />
            <StatTile label="Dias ativos por pessoa (mediana)" value={formatDecimal(data.distributions.activeDaysPerPerson.median)} hint={`p95 ${formatDecimal(data.distributions.activeDaysPerPerson.p95)}`} />
            <StatTile label="Sessões por pessoa-dia" value={formatDecimal(data.distributions.sessionsPerActivePersonDay)} metricId="sessions.per_active_person" />
          </div>
        </Section>
      </div>

      <SeriesCard data={data} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Telas mais vistas" description="Visualizações canônicas (remontagem técnica não conta)." metricId="screens.views" actions={<ExportButton table="screens" />}>
          <BarList items={data.topScreens.map((screen) => ({ key: screen.screenKey, label: screen.label, value: screen.views, display: `${formatCount(screen.views)} · ${formatCount(screen.people)} pessoa(s)${screen.sharePercent !== null ? ` · ${formatPercent(screen.sharePercent)}` : ""}`, onClick: () => openTab("screens", { screenKey: screen.screenKey }) }))} />
        </Section>
        <Section title="Funcionalidades mais usadas">
          <BarList items={data.topFeatures.map((feature) => ({ key: feature.featureKey, label: feature.label, value: feature.views, onClick: () => openTab("screens", { featureKey: feature.featureKey }) }))} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <HeatmapCard heatmap={data.heatmap} />
        <Section title="Resumo do recorte" description="Mesmos números das abas específicas.">
          <div className="grid gap-2">
            <StatTile label="Feedbacks disponibilizados" value={formatCount(data.summary.feedbackAvailable)} hint={`${formatCount(data.summary.feedbackAcked)} com ciência`} onDrill={() => openTab("feedbacks")} />
            <StatTile label="Pessoas que conversaram com a INIA" value={formatCount(data.summary.chatPeople)} onDrill={() => openTab("conversations")} />
            <StatTile label="Disparos de workflow (raiz)" value={formatCount(data.summary.workflowRoots)} onDrill={() => openTab("workflows")} />
          </div>
        </Section>
      </div>

      <PopulationCard data={data} />
      <SignalsCard signals={data.signals} />
    </div>
  )
}

function ReferenceCard({ data }: { data: UsabilityOverview }) {
  const reference = data.reference
  return (
    <Section title="DAU, WAU e MAU" description={reference ? `Janelas que terminam em ${formatLocalDate(reference.date)}.` : "Sem data de referência no período."} metricId="activity.dau">
      {reference ? (
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="DAU" value={formatCount(reference.dau)} metricId="activity.dau" />
          <StatTile label="WAU" value={formatCount(reference.wau)} hint={reference.wauFullCoverage ? undefined : "Janela de 7 dias com cobertura parcial"} metricId="activity.wau" />
          <StatTile label="MAU" value={formatCount(reference.mau)} hint={reference.mauFullCoverage ? undefined : "Janela de 30 dias com cobertura parcial"} metricId="activity.mau" />
          <StatTile label="DAU/MAU" value={formatPercent(reference.dauMau)} metricId="activity.dau_mau" />
        </div>
      ) : (
        <EmptyNote>{NO_DATA}</EmptyNote>
      )}
    </Section>
  )
}

const SERIES_CONFIG = {
  dau: { label: "DAU", color: "var(--chart-1)" },
  wau: { label: "WAU (7 dias)", color: "var(--chart-2)" },
  mau: { label: "MAU (30 dias)", color: "var(--chart-4)" },
  sessions: { label: "Sessões iniciadas", color: "var(--primary)" },
} satisfies ChartConfig

function SeriesCard({ data }: { data: UsabilityOverview }) {
  const captionId = useId()
  const measured = data.series.filter((point) => point.measured)
  const points = data.series.map((point) => ({ label: formatShortDate(point.date), dau: point.dau, wau: point.wau, mau: point.mau, sessions: point.sessions }))
  return (
    <Section title="Uso por dia" description="Dias sem medição ficam em branco (nunca zero). WAU/MAU são janelas móveis terminando em cada dia." actions={<ExportButton table="series" />}>
      {measured.length === 0 ? (
        <EmptyNote>Nenhum dia do período tem medição.</EmptyNote>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <figure aria-describedby={captionId}>
            <DeferredMount>
              <ChartContainer config={SERIES_CONFIG} className="aspect-auto h-56 w-full">
                <LineChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Line dataKey="dau" type="monotone" stroke="var(--color-dau)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="wau" type="monotone" stroke="var(--color-wau)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="mau" type="monotone" stroke="var(--color-mau)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            </DeferredMount>
          </figure>
          <figure>
            <DeferredMount>
              <ChartContainer config={SERIES_CONFIG} className="aspect-auto h-56 w-full">
                <BarChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="sessions" fill="var(--color-sessions)" radius={3} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </DeferredMount>
          </figure>
          <figcaption id={captionId} className="sr-only">
            {data.series.map((point) => `${formatLocalDate(point.date)}: ${point.measured ? `DAU ${point.dau ?? 0}, sessões ${point.sessions ?? 0}` : "sem medição"}`).join("; ")}
          </figcaption>
        </div>
      )}
    </Section>
  )
}

function HeatmapCard({ heatmap }: { heatmap: UsabilityOverview["heatmap"] }) {
  const max = Math.max(1, ...heatmap.map((cell) => cell.sessions))
  const value = (weekday: number, hour: number) => heatmap.find((cell) => cell.weekday === weekday && cell.hour === hour)?.sessions ?? 0
  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  return (
    <Section title="Início das sessões por dia e hora" description="No fuso da organização." className="xl:col-span-2" actions={<ExportButton table="heatmap" />}>
      {heatmap.length === 0 ? (
        <EmptyNote>Nenhuma sessão no período.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-[10px]">
            <caption className="sr-only">Sessões iniciadas por dia da semana e hora</caption>
            <thead>
              <tr>
                <th scope="col" className="w-10" />
                {hours.map((hour) => (
                  <th key={hour} scope="col" className="font-normal text-muted-foreground">
                    {hour % 3 === 0 ? `${hour}h` : <span className="sr-only">{hour}h</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                <tr key={weekday}>
                  <th scope="row" className="pr-1 text-left font-normal text-muted-foreground">
                    {ISO_WEEKDAY_LABELS[weekday]}
                  </th>
                  {hours.map((hour) => {
                    const sessions = value(weekday, hour)
                    return (
                      <td key={hour} className="h-5 rounded-sm" style={{ background: sessions ? `color-mix(in oklab, var(--primary) ${Math.round(15 + (sessions / max) * 85)}%, transparent)` : "var(--muted)" }} title={`${ISO_WEEKDAY_LABELS[weekday]} ${hour}h: ${sessions} sessão(ões)`}>
                        <span className="sr-only">{sessions}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function PopulationCard({ data }: { data: UsabilityOverview }) {
  const { openTab } = usePanel()
  const population = data.population
  return (
    <Section title="População (estado atual)" description="Cadastro e contas de hoje; o histórico de elegibilidade só existe desde o início do registro." metricId="population.registered">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Cadastradas ativas" value={formatCount(population.registered)} metricId="population.registered" />
        <StatTile label="Com conta" value={formatCount(population.withAccount)} />
        <StatTile label="Elegíveis agora" value={formatCount(population.eligibleNow)} metricId="population.eligible_current" onDrill={() => openTab("people", { segment: "ELIGIBLE" })} />
        <StatTile label="Sem conta" value={formatCount(population.noAccount)} metricId="population.no_account" onDrill={() => openTab("people", { segment: "NO_ACCOUNT" })} />
        <StatTile label="Conta desativada" value={formatCount(population.accountDisabled)} metricId="population.account_disabled" onDrill={() => openTab("people", { segment: "ACCOUNT_DISABLED" })} />
        <StatTile label="Afastadas" value={formatCount(population.away)} metricId="population.away" onDrill={() => openTab("people", { segment: "AWAY" })} />
      </div>
    </Section>
  )
}

/** Sinais de dificuldade: heurísticas com evidência e caminho para os dados — nunca diagnóstico. */
export function SignalsCard({ signals }: { signals: DifficultySignal[] }) {
  const { openTab } = usePanel()
  return (
    <Section title="Sinais de dificuldade" description="Heurísticas determinísticas para investigar; não são conclusões sobre pessoas.">
      <DataTable
        rows={signals}
        rowKey={(signal) => signal.key}
        empty="Nenhum sinal no período."
        caption="Sinais de dificuldade"
        columns={[
          {
            key: "label",
            header: "Sinal",
            cell: (signal) => (
              <div className="space-y-1">
                <p className="font-medium">{signal.label}</p>
                <HeuristicBadge />
              </div>
            ),
          },
          { key: "value", header: "Ocorrências", align: "right", cell: (signal) => `${formatCount(signal.value)}${signal.base !== null ? ` de ${formatCount(signal.base)}` : ""}${signal.rate !== null ? ` (${formatPercent(signal.rate)})` : ""}` },
          { key: "previous", header: "Período anterior", align: "right", cell: (signal) => (signal.previous === null ? "—" : formatCount(signal.previous)) },
          { key: "evidence", header: "Regra", cell: (signal) => <span className="text-xs text-muted-foreground">{signal.evidence}</span> },
          { key: "detail", header: "Onde", cell: (signal) => <span className="text-xs">{signal.detail.slice(0, 3).map((item) => `${item.label} (${item.count})`).join(", ") || "—"}</span> },
          {
            key: "drill",
            header: <span className="sr-only">Investigar</span>,
            cell: (signal) => (
              <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => openTab(signal.drill.tab as UsabilityTab, signal.drill.params)} data-usage-element="usability.drilldown">
                Investigar
              </button>
            ),
          },
        ]}
      />
    </Section>
  )
}
