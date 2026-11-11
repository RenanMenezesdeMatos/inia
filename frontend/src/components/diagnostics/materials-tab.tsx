"use client"

import { useId, useState } from "react"
import { BarChart3, BookOpen, ExternalLink, FileText } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis } from "recharts"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMaterialAggregatesQuery } from "@/queries/diagnostics/use-diagnostics-memory"
import type { MaterialRow, MaterialSection, MemoryFilters } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { ExportLink, plural, type Drill } from "./diagnostics-shared"
import { CategoryTick, NEUTRAL_SERIES_THEME, OutcomeBarChart } from "./outcome-charts"
import { ChartPanel } from "./processes-tab"

/**
 * MATERIAIS por DOCUMENTO (o processo), no mesmo desenho dos Pontos do processo: o documento fecha numa linha com o resumo (avaliações
 * que sustentou, desvios, acertos, chamadas, indicações no feedback) e abre nos ITENS que mais aparecem dele — as seções, cada uma com
 * os pontos avaliados nela. A visão "Gráficos" mostra os documentos, as indicações no feedback e as seções mais avaliadas.
 */
type View = "DOCUMENTS" | "CHARTS"
const SECTIONS_SHOWN = 8

/** As duas visões se combinam (clicar soma ou tira; sempre fica uma): gráficos em cima, documentos embaixo. */
export function MaterialsTab({ filters, onDrill }: { filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const [views, setViews] = useState<View[]>(["DOCUMENTS"])
  const query = useMaterialAggregatesQuery(filters)
  const showCharts = views.includes("CHARTS")
  const showDocuments = views.includes("DOCUMENTS")
  const description = showDocuments
    ? `Documentos da base que sustentaram avaliações. Abra um documento para ver as seções que mais aparecem e os pontos avaliados nelas${showCharts ? "; os gráficos ficam acima" : ""}.`
    : "Os documentos da base e as seções que mais sustentaram avaliações, e o que foi indicado no feedback."
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Materiais</CardTitle>
          <CardDescription>{description} Clique nas duas visões para ver juntas.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="multiple" value={views} onValueChange={(values) => { if (values.length > 0) setViews((["CHARTS", "DOCUMENTS"] as View[]).filter((view) => values.includes(view))) }} aria-label="Visões dos materiais (combináveis)">
            <ToggleGroupItem value="DOCUMENTS" className="gap-1.5 px-3"><FileText className="size-4" aria-hidden />Por documento</ToggleGroupItem>
            <ToggleGroupItem value="CHARTS" className="gap-1.5 px-3"><BarChart3 className="size-4" aria-hidden />Gráficos</ToggleGroupItem>
          </ToggleGroup>
          <ExportLink filters={filters} view="materials" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <TableSkeleton /> : null}
        {query.data && query.data.items.length === 0 ? <AnalyticsEmptyState icon={BookOpen} title="Nenhum material usado neste recorte" /> : null}
        {query.data && query.data.items.length > 0 ? (
          <>
            {showCharts ? <MaterialCharts documents={query.data.items} filters={filters} onDrill={onDrill} /> : null}
            {showDocuments ? <DocumentList documents={query.data.items} filters={filters} onDrill={onDrill} /> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

const deviationsOf = (row: { notMet: number; partial: number }) => row.notMet + row.partial

function DocumentSummary({ document }: { document: MaterialRow }) {
  const strong = (value: number) => <span className="font-medium text-foreground">{value.toLocaleString("pt-BR")}</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground tabular-nums">
      <span>{strong(document.assessed)} {document.assessed === 1 ? "avaliação" : "avaliações"} em {plural(document.groundedCalls, "chamada", "chamadas")}</span>
      <span>{strong(deviationsOf(document))} {deviationsOf(document) === 1 ? "desvio" : "desvios"}</span>
      <span>{strong(document.met)} {document.met === 1 ? "acerto" : "acertos"}</span>
      <span>{document.recommended > 0 ? <>indicado {strong(document.recommended)}× no feedback ({document.delivered} entregue{document.delivered === 1 ? "" : "s"})</> : "sem indicação no feedback"}</span>
    </span>
  )
}

function DocumentList({ documents, filters, onDrill }: { documents: MaterialRow[]; filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{plural(documents.length, "documento", "documentos")} · do que mais sustentou avaliações para o que menos</p>
      <Accordion type="multiple" className="rounded-lg border">
        {documents.map((document) => (
          <AccordionItem key={document.documentId} value={document.documentId} className="px-4">
            <AccordionTrigger headingLevel={3} className="py-3 hover:no-underline">
              <span className="flex flex-1 flex-col gap-1 pr-2">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{document.title}</span>
                  <Badge variant="outline">{plural(document.sections.length, "seção", "seções")}</Badge>
                </span>
                <DocumentSummary document={document} />
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto space-y-3 pb-4 [&_a]:no-underline [&_p:not(:last-child)]:mb-0">
              <div className="flex flex-wrap items-center gap-2">
                {document.href ? (
                  <Button asChild variant="outline" size="sm"><a href={document.href} target="_blank" rel="noopener noreferrer"><ExternalLink data-icon="inline-start" /> Abrir documento</a></Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => onDrill({ title: document.title, filters: { ...filters, documentId: document.documentId }, kind: "DOCUMENT" })}>Ver chamadas</Button>
              </div>
              <SectionsTable sections={document.sections} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

/** Os itens que mais aparecem do documento: as seções, das mais avaliadas para as menos; as oito primeiras e "mostrar todas". */
function SectionsTable({ sections }: { sections: MaterialSection[] }) {
  const [expanded, setExpanded] = useState(false)
  if (sections.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma seção deste documento foi avaliada neste recorte.</p>
  const shown = expanded ? sections : sections.slice(0, SECTIONS_SHOWN)
  return (
    <div className="space-y-2">
      <div className={TABLE_FRAME}>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Seção</TableHead><TableHead>Avaliações</TableHead><TableHead>Desvios</TableHead><TableHead>Acertos</TableHead><TableHead>Indicações no feedback</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((section) => (
              <TableRow key={section.section ?? "sem-secao"}>
                <TableCell className="max-w-md space-y-0.5 whitespace-normal">
                  <p className="font-medium">{section.section ?? "Documento inteiro (sem seção)"}</p>
                  {section.points.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {section.points.slice(0, 3).map((point) => `${point.title} (${point.assessed})`).join(" · ")}{section.points.length > 3 ? ` · +${section.points.length - 3}` : ""}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">{section.assessed}</TableCell>
                <TableCell className="tabular-nums">{section.deviations}</TableCell>
                <TableCell className="tabular-nums">{section.met}</TableCell>
                <TableCell className="tabular-nums">{section.recommended}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {sections.length > SECTIONS_SHOWN ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "Mostrar só as mais avaliadas" : `Mostrar todas as ${sections.length} seções`}</Button>
      ) : null}
    </div>
  )
}

const TOP_SECTIONS = 12
function MaterialCharts({ documents, filters, onDrill }: { documents: MaterialRow[]; filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const documentRows = documents.filter((document) => document.assessed > 0).map((document) => ({ key: document.documentId, label: document.title, context: plural(document.groundedCalls, "chamada", "chamadas"), deviations: deviationsOf(document), met: document.met, assessed: document.assessed }))
  const sections = documents
    .flatMap((document) => document.sections.filter((section) => section.assessed > 0).map((section) => ({ key: `${document.documentId}|${section.section ?? ""}`, label: section.section ?? "Documento inteiro (sem seção)", context: document.title, deviations: section.deviations, met: section.met, assessed: section.assessed })))
    .sort((a, b) => b.assessed - a.assessed || b.deviations - a.deviations || a.label.localeCompare(b.label, "pt-BR"))
  const top = sections.slice(0, TOP_SECTIONS)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartPanel title="Avaliações sustentadas por documento" description="Quantas regras avaliadas vieram de cada documento, com desvios e acertos. Clique numa barra para ver as chamadas.">
        {documentRows.length > 0
          ? <OutcomeBarChart rows={documentRows} caption="Avaliações sustentadas por documento" onSelect={(row) => onDrill({ title: row.label, filters: { ...filters, documentId: row.key }, kind: "DOCUMENT" })} />
          : <p className="text-sm text-muted-foreground">Nenhum documento sustentou avaliações neste recorte.</p>}
      </ChartPanel>
      <ChartPanel title="Indicações no feedback" description="Quantas mensagens indicaram cada documento como material de apoio, e quantas foram entregues.">
        <IndicationsChart documents={documents} />
      </ChartPanel>
      <ChartPanel className="lg:col-span-2" title={`Seções mais avaliadas${sections.length > TOP_SECTIONS ? ` (${TOP_SECTIONS} de ${sections.length})` : ""}`} description="Os itens da base que mais aparecem nas avaliações, de todos os documentos. O documento de cada seção aparece ao passar o mouse.">
        {top.length > 0 ? <OutcomeBarChart rows={top} caption="Seções mais avaliadas" /> : <p className="text-sm text-muted-foreground">Nenhuma seção avaliada neste recorte.</p>}
      </ChartPanel>
    </div>
  )
}

const INDICATIONS_CONFIG = { recommended: { label: "Indicações", theme: NEUTRAL_SERIES_THEME } } satisfies ChartConfig

/** Uma série só (indicações por documento): uma cor, sem legenda — o título diz o que é. Entregues ficam na dica e na legenda acessível. */
function IndicationsChart({ documents }: { documents: MaterialRow[] }) {
  const captionId = useId()
  const isMobile = useIsMobile()
  const rows = documents.filter((document) => document.recommended > 0).sort((a, b) => b.recommended - a.recommended).map((document) => ({ key: document.documentId, label: document.title, recommended: document.recommended, delivered: document.delivered }))
  if (rows.length === 0) return <p className="rounded-lg bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">Nenhum documento foi indicado como material de apoio em feedback neste recorte.</p>
  const height = rows.length * 40 + 40
  const labels = new Map(rows.map((row) => [row.key, row.label]))
  return (
    <figure aria-describedby={captionId}>
      <ChartContainer config={INDICATIONS_CONFIG} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barSize={16} accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tickMargin={6} />
          <YAxis type="category" dataKey="key" width={isMobile ? 132 : 236} tickLine={false} axisLine={false} interval={0} tick={<CategoryTick labels={labels} maxChars={isMobile ? 18 : 36} />} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={({ active, payload }) => {
            const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined
            if (!row) return null
            return <div className="grid min-w-48 gap-1 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl"><p className="font-medium">{row.label}</p><p className="text-muted-foreground">{plural(row.recommended, "indicação", "indicações")} · {row.delivered} entregue{row.delivered === 1 ? "" : "s"}</p></div>
          }} />
          <Bar dataKey="recommended" fill="var(--color-recommended)" isAnimationActive={false}
            shape={(props: unknown) => { const { x = 0, y = 0, width = 0, height: barHeight = 0, fill } = props as { x?: number; y?: number; width?: number; height?: number; fill?: string }; return width > 0 ? <Rectangle x={x} y={y} width={width} height={barHeight} fill={fill} radius={[0, 4, 4, 0]} /> : <g /> }} />
        </BarChart>
      </ChartContainer>
      <figcaption id={captionId} className="sr-only">Indicações no feedback por documento: {rows.map((row) => `${row.label} — ${row.recommended} indicação(ões), ${row.delivered} entregue(s)`).join("; ")}.</figcaption>
    </figure>
  )
}
