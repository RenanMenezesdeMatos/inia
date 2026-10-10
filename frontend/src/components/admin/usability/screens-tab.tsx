"use client"

import { useUsabilityTabQuery } from "@/queries/admin/use-usability-queries"
import type { UsabilityScreens } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { formatCount, formatDuration, formatPercent, NOT_APPLICABLE } from "./usability-format"
import { BarList, DataTable, EmptyNote, ExportButton, Section, StatTile, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"

type ScreenRow = { screenKey: string; label: string; area: string; views: number; people: number; sessions: number; medianActiveSeconds: number | null; p95ActiveSeconds: number | null; sharePercent: number | null }
type FeatureRow = { featureKey: string; label: string; people: number; events: number; recurrentPeople: number; succeeded: number; failed: number }
type ActionRow = { actionKey: string; label: string; feature: string; started: number; succeeded: number; failed: number; cancelled: number }
type ElementRow = { elementKey: string; label: string; screenKey: string; screenLabel: string; activations: number; people: number; interactions: Record<string, number>; exposureMeasured: boolean; exposedPeople: number | null; activationRate: number | null; activatedAmongExposed: number | null }
type TransitionRow = { from: string; fromLabel: string; to: string; toLabel: string; count: number }
type EntryRow = { screenKey: string; label: string; count: number }
type ExitRow = { screenKey: string; label: string; observed: number; inferred: number }
type HeatRow = { screenKey: string; screenLabel: string; elementKey: string; elementLabel: string; count: number }
type ScrollRow = { contentKey: string; label: string; views: number; reached: Record<string, number>; fitsViewport: number }
type SearchRow = { surface: string; label: string; searches: number; empty: number; resultOpened: number; people: number }
type FilterRow = { surface: string; filterKey: string; uses: number; people: number }

const rows = <T,>(value: unknown) => (value ?? []) as T[]

export function ScreensTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("screens", query)
  return <TabFrame result={result}>{(data) => <ScreensContent data={data} />}</TabFrame>
}

function ScreensContent({ data }: { data: UsabilityScreens }) {
  const { setFilters } = usePanel()
  const screens = rows<ScreenRow>(data.screens)
  const features = rows<FeatureRow>(data.features)
  const actions = rows<ActionRow>(data.actions)
  const elements = rows<ElementRow>(data.elements)
  const transitions = rows<TransitionRow>(data.transitions)
  const entries = rows<EntryRow>(data.entries)
  const exits = rows<ExitRow>(data.exits)
  const heat = rows<HeatRow>(data.heatmap)
  const scroll = rows<ScrollRow>(data.scroll)
  const search = rows<SearchRow>(data.search)
  const filters = rows<FilterRow>(data.filters)
  const exports = Object.entries(data.exports)

  return (
    <div className="space-y-4">
      <Section title="Telas" description={`${formatCount(data.totalViews)} visualização(ões) canônica(s). Abas, painéis e diálogos contam como telas próprias.`} metricId="screens.views" actions={<ExportButton table="screens" />}>
        <DataTable
          rows={screens}
          rowKey={(row) => row.screenKey}
          caption="Telas"
          columns={[
            {
              key: "label",
              header: "Tela",
              cell: (row) => (
                <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => setFilters({ screenKey: row.screenKey })} data-usage-element="usability.drilldown">
                  {row.label}
                </button>
              ),
            },
            { key: "views", header: "Visualizações", align: "right", cell: (row) => formatCount(row.views) },
            { key: "share", header: "Participação", align: "right", cell: (row) => formatPercent(row.sharePercent) },
            { key: "people", header: "Pessoas", align: "right", cell: (row) => formatCount(row.people) },
            { key: "sessions", header: "Acessos", align: "right", cell: (row) => formatCount(row.sessions) },
            { key: "median", header: "Tempo ativo (mediana)", align: "right", cell: (row) => formatDuration(row.medianActiveSeconds) },
            { key: "p95", header: "p95", align: "right", cell: (row) => formatDuration(row.p95ActiveSeconds) },
          ]}
        />
      </Section>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Funcionalidades" description="Pessoas que usaram e quantas voltaram a usar em outro dia." actions={<ExportButton table="features" />}>
          <DataTable
            rows={features}
            rowKey={(row) => row.featureKey}
            caption="Funcionalidades"
            columns={[
              { key: "label", header: "Funcionalidade", cell: (row) => row.label },
              { key: "people", header: "Pessoas", align: "right", cell: (row) => formatCount(row.people) },
              { key: "recurrent", header: "Recorrentes", align: "right", cell: (row) => formatCount(row.recurrentPeople) },
              { key: "events", header: "Eventos", align: "right", cell: (row) => formatCount(row.events) },
            ]}
          />
        </Section>
        <Section title="Ações com resultado" description="Ação iniciada × confirmada pelo servidor × falha × cancelada (mesma correlação).">
          <DataTable
            rows={actions}
            rowKey={(row) => row.actionKey}
            caption="Ações"
            columns={[
              { key: "label", header: "Ação", cell: (row) => row.label },
              { key: "started", header: "Iniciadas", align: "right", cell: (row) => formatCount(row.started) },
              { key: "succeeded", header: "Concluídas", align: "right", cell: (row) => formatCount(row.succeeded) },
              { key: "failed", header: "Falhas", align: "right", cell: (row) => formatCount(row.failed) },
              { key: "cancelled", header: "Canceladas", align: "right", cell: (row) => formatCount(row.cancelled) },
              { key: "rate", header: "Sucesso", align: "right", cell: (row) => (row.started ? formatPercent(Math.round((row.succeeded / row.started) * 1000) / 10) : NOT_APPLICABLE) },
            ]}
          />
        </Section>
      </div>

      <Section title="Elementos: exposição × acionamento" description="Exposição = pelo menos 50% visível por 1 segundo. Sem medição de exposição, a taxa não é calculada." metricId="elements.activation_rate" actions={<ExportButton table="elements" />}>
        <DataTable
          rows={elements}
          rowKey={(row) => `${row.screenKey}|${row.elementKey}`}
          caption="Elementos"
          columns={[
            {
              key: "label",
              header: "Elemento",
              cell: (row) => (
                <div className="space-y-0.5">
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.screenLabel}</p>
                </div>
              ),
            },
            { key: "activations", header: "Acionamentos", align: "right", cell: (row) => formatCount(row.activations) },
            { key: "people", header: "Pessoas", align: "right", cell: (row) => formatCount(row.people) },
            { key: "exposed", header: "Pessoas expostas", align: "right", cell: (row) => (row.exposureMeasured ? formatCount(row.exposedPeople) : "Não medido") },
            { key: "rate", header: "Acionaram entre expostas", align: "right", cell: (row) => (row.exposureMeasured ? formatPercent(row.activationRate) : NOT_APPLICABLE) },
            { key: "how", header: "Como", cell: (row) => <span className="text-xs text-muted-foreground">{Object.entries(row.interactions).map(([kind, count]) => `${kind === "CLICK" ? "clique" : kind === "KEYBOARD" ? "teclado" : kind === "TAP" ? "toque" : kind.toLowerCase()} ${count}`).join(" · ")}</span> },
          ]}
        />
      </Section>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Onde mais se clica" description="Acionamentos por elemento e tela.">
          <BarList items={heat.slice(0, 15).map((row) => ({ key: `${row.screenKey}|${row.elementKey}`, label: `${row.elementLabel} · ${row.screenLabel}`, value: row.count }))} />
        </Section>
        <Section title="Caminhos entre telas" description="De qual tela para qual tela as pessoas seguiram." actions={<ExportButton table="transitions" />}>
          <BarList items={transitions.slice(0, 15).map((row) => ({ key: `${row.from}|${row.to}`, label: `${row.fromLabel} → ${row.toLabel}`, value: row.count }))} />
        </Section>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Entradas" description="Primeira tela de cada acesso.">
          <BarList items={entries.map((row) => ({ key: row.screenKey, label: row.label, value: row.count }))} />
        </Section>
        <Section title="Saídas" description="Saída observada (fechou/trocou) × inferida (sem sinal até o fim do acesso).">
          <DataTable
            rows={exits}
            rowKey={(row) => row.screenKey}
            caption="Saídas"
            columns={[
              { key: "label", header: "Tela", cell: (row) => row.label },
              { key: "observed", header: "Observadas", align: "right", cell: (row) => formatCount(row.observed) },
              { key: "inferred", header: "Inferidas", align: "right", cell: (row) => formatCount(row.inferred) },
            ]}
          />
        </Section>
      </div>

      <Section title="Leitura do conteúdo" description="Quantas aberturas chegaram a 25/50/75/100% do conteúdo. Conteúdo que cabe inteiro na tela conta à parte." actions={<ExportButton table="scroll" />}>
        <DataTable
          rows={scroll}
          rowKey={(row) => row.contentKey}
          caption="Rolagem"
          columns={[
            { key: "label", header: "Conteúdo", cell: (row) => row.label },
            { key: "views", header: "Aberturas", align: "right", cell: (row) => formatCount(row.views) },
            ...(["25", "50", "75", "100"] as const).map((milestone) => ({ key: milestone, header: `${milestone}%`, align: "right" as const, cell: (row: ScrollRow) => formatCount(row.reached[milestone] ?? 0) })),
            { key: "fits", header: "Coube na tela", align: "right", cell: (row) => formatCount(row.fitsViewport) },
          ]}
        />
      </Section>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Buscas" description="Só faixas de tamanho — o texto buscado nunca é guardado." actions={<ExportButton table="search" />}>
          <DataTable
            rows={search}
            rowKey={(row) => row.surface}
            caption="Buscas"
            columns={[
              { key: "label", header: "Onde", cell: (row) => row.label },
              { key: "searches", header: "Buscas", align: "right", cell: (row) => formatCount(row.searches) },
              { key: "empty", header: "Sem resultado", align: "right", cell: (row) => formatCount(row.empty) },
              { key: "opened", header: "Abriram resultado", align: "right", cell: (row) => formatCount(row.resultOpened) },
              { key: "people", header: "Pessoas", align: "right", cell: (row) => formatCount(row.people) },
            ]}
          />
        </Section>
        <Section title="Filtros e exportações" description="Nome do filtro usado (nunca o valor)." actions={<ExportButton table="filters" />}>
          <div className="space-y-3">
            {filters.length === 0 ? <EmptyNote>Nenhum filtro usado no período.</EmptyNote> : <BarList items={filters.map((row) => ({ key: `${row.surface}|${row.filterKey}`, label: `${row.filterKey} · ${row.surface}`, value: row.uses, display: `${formatCount(row.uses)} · ${formatCount(row.people)} pessoa(s)` }))} />}
            {exports.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {exports.map(([key, count]) => (
                  <StatTile key={key} label={key === "COMPLETED" ? "Exportações concluídas" : key === "FAILED" ? "Exportações que falharam" : `Exportações · ${key}`} value={formatCount(count)} />
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      </div>
    </div>
  )
}
