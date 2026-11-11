"use client"

import { useState, type ReactNode } from "react"
import { BarChart3, ListChecks, ThumbsUp, TriangleAlert } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMemorySummaryQuery, useProcessAggregatesQuery } from "@/queries/diagnostics/use-diagnostics-memory"
import type { MemoryFilters, PracticeSource, ProcessOrder, ProcessRow, ProcessTheme } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { ExportLink, plural, rateOf, type Drill } from "./diagnostics-shared"
import { percent } from "./memory-labels"
import { OutcomeBarChart, PriorityScatter, type OutcomeRow } from "./outcome-charts"

/**
 * PONTOS DO PROCESSO em visões que se COMBINAM (clicar soma ou tira; sempre fica pelo menos uma):
 *   - Onde mais se erra: só os pontos com desvio (temas e pontos pelos desvios);
 *   - Onde mais se acerta: só os pontos com acerto (pelos acertos, depois a menor taxa de desvio);
 *   - as duas juntas: uma lista só, com todos os pontos avaliados e desvios e acertos lado a lado (todo ponto avaliado tem um ou outro);
 *   - Gráficos: por tema, onde agir primeiro e por ponto — dos pontos das visões escolhidas (sozinho, de todos), acima da lista.
 * As contagens de um tema são do tema INTEIRO; a lista mostra só os pontos da visão ("2 de 5 pontos com desvio").
 */
type Facet = "DEVIATIONS" | "MET" | "CHARTS"
export type ListView = "DEVIATIONS" | "MET" | "BOTH"
const FACETS: { value: Facet; label: string; icon: typeof ListChecks }[] = [
  { value: "DEVIATIONS", label: "Onde mais se erra", icon: TriangleAlert },
  { value: "MET", label: "Onde mais se acerta", icon: ThumbsUp },
  { value: "CHARTS", label: "Gráficos", icon: BarChart3 },
]

export function ProcessesTab({ filters, onDrill }: { filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const [selected, setSelected] = useState<Facet[]>(["DEVIATIONS"])
  const lists = selected.filter((facet): facet is "DEVIATIONS" | "MET" => facet !== "CHARTS")
  const listView: ListView | null = lists.length === 2 ? "BOTH" : lists[0] ?? null
  const showCharts = selected.includes("CHARTS")
  // Erra + acerta = todos os pontos avaliados (todo ponto avaliado tem desvio ou acerto); só gráficos = todos também.
  const order: ProcessOrder = listView === "DEVIATIONS" || listView === "MET" ? listView : "ALL"
  const query = useProcessAggregatesQuery(filters, order)
  const scope = listView === "DEVIATIONS" ? "Só os pontos com desvio" : listView === "MET" ? "Só os pontos com acerto" : "Todos os pontos avaliados"
  const description = `${scope}${listView === "BOTH" ? ", com desvios e acertos lado a lado" : ""}${listView ? ", agrupados por tema do atendimento" : ""}${showCharts ? (listView ? ", com os gráficos acima da lista" : ", em gráficos") : ""}. Clique em mais de uma visão para combinar.`
  const empty = order === "MET" ? "Nenhum ponto com acerto neste recorte" : order === "DEVIATIONS" ? "Nenhum ponto com desvio neste recorte" : "Nenhum ponto avaliado neste recorte"
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1"><CardTitle>Pontos do processo</CardTitle><CardDescription>{description}</CardDescription></div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="multiple" value={selected} onValueChange={(values) => { if (values.length > 0) setSelected(FACETS.map((facet) => facet.value).filter((facet) => values.includes(facet))) }} aria-label="Visões dos pontos do processo (combináveis)">
            {FACETS.map((entry) => <ToggleGroupItem key={entry.value} value={entry.value} className="gap-1.5 px-3"><entry.icon className="size-4" aria-hidden />{entry.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <ExportLink filters={filters} view="processes" extra={{ order }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <TableSkeleton /> : null}
        {query.data && query.data.themes.length === 0 ? <AnalyticsEmptyState icon={ListChecks} title={empty} /> : null}
        {query.data && query.data.themes.length > 0 ? (
          <>
            {showCharts ? <ProcessCharts themes={query.data.themes} scope={scope} filters={filters} onDrill={onDrill} /> : null}
            {listView ? <ThemeList view={listView} themes={query.data.themes} listed={query.data.listedPoints} total={query.data.totalPoints} filters={filters} onDrill={onDrill} /> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Fontes de um ponto: documento · seção (argumentário marcado), as duas primeiras e "+N"; quantas regras o ponto reúne. */
function SourcesLine({ sources, rules }: { sources: PracticeSource[]; rules: number }) {
  if (sources.length === 0) return null
  const label = (source: PracticeSource) => `${source.kind === "ARGUMENT_SCRIPT" ? "Argumentário: " : ""}${source.documentTitle}${source.section ? ` · ${source.section}` : ""}`
  return (
    <p className="text-xs text-muted-foreground" title={sources.map(label).join("\n")}>
      {sources.slice(0, 2).map(label).join("; ")}{sources.length > 2 ? `; +${sources.length - 2}` : ""}{rules > 1 ? ` · reúne ${rules} regras` : ""}
    </p>
  )
}

const deviationsOf = (row: { notMet: number; partial: number }) => row.notMet + row.partial

/** Resumo do tema na linha que abre — o número que a visão pede primeiro, depois o volume, a taxa e as pessoas. */
function ThemeSummary({ theme, view }: { theme: ProcessTheme; view: ListView }) {
  const strong = (value: string) => <span className="font-medium text-foreground">{value}</span>
  const deviations = deviationsOf(theme)
  return (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground tabular-nums">
      {view === "MET" ? (
        <>
          <span>{strong(String(theme.met))} {theme.met === 1 ? "acerto" : "acertos"} em {plural(theme.assessed, "avaliação", "avaliações")}</span>
          <span>taxa de acerto {strong(percent(rateOf(theme.met, theme.assessed)))}</span>
          <span>{theme.peopleWithMet} de {plural(theme.people, "pessoa acertou", "pessoas acertaram")}</span>
        </>
      ) : (
        <>
          <span>{strong(String(deviations))} {deviations === 1 ? "desvio" : "desvios"}{view === "BOTH" ? <> e {strong(String(theme.met))} {theme.met === 1 ? "acerto" : "acertos"}</> : null} em {plural(theme.assessed, "avaliação", "avaliações")}</span>
          <span>taxa de desvio {strong(percent(theme.deviationRate))}</span>
          <span>{theme.peopleWithDeviation} de {plural(theme.people, "pessoa", "pessoas")} com desvio</span>
        </>
      )}
    </span>
  )
}

function ThemeList({ view, themes, listed, total, filters, onDrill }: { view: ListView; themes: ProcessTheme[]; listed: number; total: number; filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const qualifier = view === "MET" ? " com acerto" : view === "DEVIATIONS" ? " com desvio" : ""
  const namedThemes = themes.filter((theme) => theme.themeKey !== null).length
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{plural(namedThemes, "tema", "temas")} · {view === "BOTH" ? plural(total, "ponto avaliado", "pontos avaliados") : `${listed} de ${plural(total, "ponto avaliado", "pontos avaliados")}${qualifier}`}</p>
      <Accordion type="multiple" className="rounded-lg border">
        {themes.map((theme) => (
          <AccordionItem key={theme.themeKey ?? "sem-tema"} value={theme.themeKey ?? "sem-tema"} className="px-4">
            <AccordionTrigger headingLevel={3} className="py-3 hover:no-underline">
              <span className="flex flex-1 flex-col gap-1 pr-2">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{theme.title ?? "Ainda sem tema"}</span>
                  <Badge variant="outline">{theme.items.length === theme.points ? plural(theme.points, `ponto${qualifier}`, `pontos${qualifier}`) : `${theme.items.length} de ${plural(theme.points, "ponto", "pontos")}${qualifier}`}</Badge>
                </span>
                <ThemeSummary theme={theme} view={view} />
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto pb-4 [&_p:not(:last-child)]:mb-0">
              {theme.themeKey === null ? <p className="mb-3 text-xs text-muted-foreground">Pontos que a INIA ainda não agrupou num tema. Eles ganham um tema na próxima análise.</p> : null}
              <PointsTable view={view} items={theme.items} theme={theme.title} filters={filters} onDrill={onDrill} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

function PointsTable({ view, items, theme, filters, onDrill }: { view: ListView; items: ProcessRow[]; theme: string | null; filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const met = view === "MET"
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ponto</TableHead>
            {view === "BOTH" ? <><TableHead>Desvios</TableHead><TableHead>Acertos</TableHead></> : <TableHead>{met ? "Acertos" : "Desvios"}</TableHead>}
            <TableHead>Avaliações</TableHead>
            <TableHead>{met ? "Taxa de acerto" : "Taxa de desvio"}</TableHead>
            <TableHead>{met ? "Pessoas que acertaram" : "Pessoas com desvio"}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.practiceKey}>
              <TableCell className="max-w-md space-y-0.5 whitespace-normal">
                <p className="font-medium">{row.title}</p>
                {row.description ? <p className="text-xs text-muted-foreground">{row.description}</p> : null}
                <SourcesLine sources={row.sources} rules={row.rules} />
              </TableCell>
              {view === "BOTH"
                ? <><TableCell className="font-medium tabular-nums">{deviationsOf(row)}</TableCell><TableCell className="font-medium tabular-nums">{row.met}</TableCell></>
                : <TableCell className="font-medium tabular-nums">{met ? row.met : deviationsOf(row)}</TableCell>}
              <TableCell className="tabular-nums">{row.assessed}</TableCell>
              <TableCell className="tabular-nums">{percent(met ? rateOf(row.met, row.assessed) : row.deviationRate)}</TableCell>
              <TableCell className="tabular-nums">{met ? row.peopleWithMet : row.peopleWithDeviation} de {row.people}</TableCell>
              <TableCell><Button variant="ghost" size="sm" onClick={() => onDrill({ title: row.title, filters: { ...filters, practiceKey: row.practiceKey }, status: met ? "MET" : "DEVIATION", kind: "POINT", context: theme ?? "Ainda sem tema", description: row.description })}>Ver chamadas</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Os pontos da visão em gráficos: por tema (visão geral), onde agir primeiro (volume × taxa) e por ponto (pelos desvios). */
function ProcessCharts({ themes, scope, filters, onDrill }: { themes: ProcessTheme[]; scope: string; filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const summary = useMemorySummaryQuery(filters)
  const byDeviations = <T extends OutcomeRow>(rows: T[]) => rows.sort((a, b) => b.deviations - a.deviations || b.met - a.met || a.label.localeCompare(b.label, "pt-BR"))
  const themeRows = byDeviations(themes.map((theme) => ({ key: theme.themeKey ?? "sem-tema", label: theme.title ?? "Ainda sem tema", context: plural(theme.points, "ponto", "pontos"), deviations: deviationsOf(theme), met: theme.met, assessed: theme.assessed })))
  const points = themes.flatMap((theme) => theme.items.map((row) => ({ key: row.practiceKey, label: row.title, context: theme.title ?? "Ainda sem tema", deviations: deviationsOf(row), met: row.met, assessed: row.assessed })))
  const descriptions = new Map(themes.flatMap((theme) => theme.items.map((row) => [row.practiceKey, row.description] as const)))
  const drillPoint = (row: { key: string; label: string; context?: string | null }) => onDrill({ title: row.label, filters: { ...filters, practiceKey: row.key }, kind: "POINT", context: row.context ?? null, description: descriptions.get(row.key) ?? null })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartPanel title="Acertos e desvios por tema" description="Cada barra soma os pontos do tema. Desvios começam no zero para comparar os temas.">
        <OutcomeBarChart rows={themeRows} caption="Acertos e desvios por tema" />
      </ChartPanel>
      <ChartPanel title="Onde agir primeiro" description="Mais à direita, mais avaliações; mais acima, maior taxa de desvio. O canto de cima à direita pede atenção primeiro. Marcadores maiores juntam pontos com os mesmos números.">
        <PriorityScatter points={points} reference={summary.data?.stats.deviationRate ?? null} caption="Pontos do processo por avaliações e taxa de desvio" onSelect={drillPoint} />
      </ChartPanel>
      <ChartPanel className="lg:col-span-2" title={`Acertos e desvios por ponto (${points.length})`} description={`${scope}, do que tem mais desvios para o que tem menos. Clique numa barra para ver as chamadas.`}>
        <OutcomeBarChart rows={byDeviations(points)} caption="Acertos e desvios por ponto do processo" onSelect={drillPoint} />
      </ChartPanel>
    </div>
  )
}

export function ChartPanel({ title, description, className, children }: { title: string; description: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-lg border p-4", className)}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}
