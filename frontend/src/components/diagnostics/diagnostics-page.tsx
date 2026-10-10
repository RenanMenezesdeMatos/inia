"use client"

import { useMemo, useState } from "react"
import { Activity, BookOpen, ChevronRight, Gauge, Info, ListChecks, Users } from "lucide-react"

import { ListDateRangeFilter, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatIndicatorValue } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import type { DateRangeFilter } from "@/lib/admin/list-query"
import {
  useConcentrationQuery,
  useIndicatorInvestigationsQuery,
  useMemoryFilterOptionsQuery,
  useMemorySummaryQuery,
  usePeopleAggregatesQuery,
} from "@/queries/diagnostics/use-diagnostics-memory"
import type { MemoryFilters, MemoryStats } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { CallsReviewDialog } from "./calls-review"
import { ExportLink, type Drill } from "./diagnostics-shared"
import { IndicatorInvestigationDialog } from "./indicator-investigation-dialog"
import { MaterialsTab } from "./materials-tab"
import { CONCLUSION_LABELS, percent, shortDate } from "./memory-labels"
import { ProcessesTab } from "./processes-tab"

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const defaultPeriod = (): DateRangeFilter => {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { from: isoDay(from), to: isoDay(to) }
}


/**
 * DIAGNÓSTICO DA LIDERANÇA — o que a memória operacional do motor de feedback registrou no escopo de quem olha: onde os
 * processos concentram desvios e acertos, quem (pessoa/equipe) com volume, taxa e cobertura, quando/em que assunto, quais
 * materiais sustentaram orientações e o que as investigações de indicador concluíram. Nenhuma tela chama IA: são contagens da
 * projeção vigente, com o denominador sempre visível e o caminho até a chamada e a regra que sustentam cada número.
 */
export function DiagnosticsPage() {
  const [period, setPeriod] = useState<DateRangeFilter>(defaultPeriod)
  const [teamId, setTeamId] = useState<string | undefined>()
  const [subteamId, setSubteamId] = useState<string | undefined>()
  const [personId, setPersonId] = useState<string | undefined>()
  const [subject, setSubject] = useState<string | undefined>()
  const [documentId, setDocumentId] = useState<string | undefined>()
  const [drill, setDrill] = useState<Drill | null>(null)
  const [investigationId, setInvestigationId] = useState<string | null>(null)

  const [fallback] = useState(defaultPeriod)
  const filters: MemoryFilters = useMemo(
    () => ({ from: period.from ?? fallback.from!, to: period.to ?? period.from ?? fallback.to!, teamId: teamId ?? null, subteamId: subteamId ?? null, personId: personId ?? null, subject: subject ?? null, documentId: documentId ?? null }),
    [period, fallback, teamId, subteamId, personId, subject, documentId],
  )
  const options = useMemoryFilterOptionsQuery()
  const summary = useMemorySummaryQuery(filters)
  const hasActiveFilters = Boolean(teamId || subteamId || personId || subject || documentId || period.from !== fallback.from || period.to !== fallback.to)
  const clearFilters = () => {
    setPeriod(defaultPeriod())
    setTeamId(undefined)
    setSubteamId(undefined)
    setPersonId(undefined)
    setSubject(undefined)
    setDocumentId(undefined)
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Diagnóstico</h1>
        <p className="text-sm text-muted-foreground">O que as análises de chamadas e de indicadores registraram na sua estrutura: onde estão os desvios e os acertos, com as evidências que os sustentam.</p>
      </header>

      <ListToolbar
        search={<p className="text-xs text-muted-foreground">Mostra só pessoas no seu escopo. Período pela data da chamada.</p>}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      >
        <ListDateRangeFilter label="Período" value={period} onChange={setPeriod} />
        <ListSelectFilter ariaLabel="Grupo" allLabel="Todos os grupos" value={teamId} onChange={setTeamId} options={(options.data?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))} />
        <ListSelectFilter ariaLabel="Subgrupo" allLabel="Todos os subgrupos" value={subteamId} onChange={setSubteamId} options={(options.data?.subteams ?? []).map((subteam) => ({ value: subteam.id, label: subteam.name }))} />
        <ListSelectFilter ariaLabel="Pessoa" allLabel="Todas as pessoas" value={personId} onChange={setPersonId} options={(options.data?.people ?? []).map((person) => ({ value: person.id, label: person.name }))} />
        <ListSelectFilter ariaLabel="Assunto" allLabel="Todos os assuntos" value={subject} onChange={setSubject} options={(options.data?.subjects ?? []).map((name) => ({ value: name, label: name }))} />
        <ListSelectFilter ariaLabel="Procedimento" allLabel="Todos os procedimentos" value={documentId} onChange={setDocumentId} options={(options.data?.documents ?? []).map((document) => ({ value: document.id, label: document.title }))} />
      </ListToolbar>

      {summary.isError ? <AnalyticsErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {summary.data ? (
        <section className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Chamadas analisadas" value={String(summary.data.stats.calls)} hint={`${summary.data.people} pessoa(s) · ${summary.data.callOutcomes.partial} parcial(is) · ${summary.data.callOutcomes.insufficient} sem evidência suficiente`} />
            <Tile label="Taxa de desvio por regra" value={percent(summary.data.stats.deviationRate)} hint={`${summary.data.stats.notMet + summary.data.stats.partial} de ${summary.data.stats.assessed} regras avaliadas (cada regra numa chamada conta uma vez)`} />
            <OccurrenceTile stats={summary.data.stats} />
            <Tile label="Cobertura" value={percent(summary.data.stats.coverageRate)} hint={`${summary.data.stats.inconclusive} etapa(s) sem conclusão (não observáveis ou não avaliadas)`} />
            <Tile label="Caminho inadequado" value={String(summary.data.callOutcomes.path_incorrect)} hint={`de ${summary.data.callOutcomes.path_assessed} chamadas com caminho avaliado`} />
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />{summary.data.method}{summary.data.lastAnalysisAt ? ` Última análise: ${shortDate(summary.data.lastAnalysisAt)}.` : ""}</p>
        </section>
      ) : summary.isPending ? <TableSkeleton rows={2} /> : null}

      {summary.data && summary.data.stats.calls === 0 ? (
        <AnalyticsEmptyState icon={ListChecks} title="Nenhuma chamada analisada neste recorte" description="As análises aparecem aqui quando um Workflow gera feedback ou investiga um indicador de alguém da sua estrutura. Ajuste o período ou os filtros." />
      ) : null}

      <Tabs defaultValue="processes">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="processes"><ListChecks /> Processos</TabsTrigger>
          <TabsTrigger value="people"><Users /> Pessoas e equipes</TabsTrigger>
          <TabsTrigger value="concentration"><Activity /> Concentração</TabsTrigger>
          <TabsTrigger value="materials"><BookOpen /> Materiais</TabsTrigger>
          <TabsTrigger value="indicators"><Gauge /> Indicadores</TabsTrigger>
        </TabsList>
        <TabsContent value="processes" className="mt-4"><ProcessesTab filters={filters} onDrill={setDrill} /></TabsContent>
        <TabsContent value="people" className="mt-4"><PeopleTab filters={filters} onDrill={setDrill} /></TabsContent>
        <TabsContent value="concentration" className="mt-4"><ConcentrationTab filters={filters} onDrill={setDrill} /></TabsContent>
        <TabsContent value="materials" className="mt-4"><MaterialsTab filters={filters} onDrill={setDrill} /></TabsContent>
        <TabsContent value="indicators" className="mt-4"><IndicatorsTab filters={filters} onOpen={setInvestigationId} /></TabsContent>
      </Tabs>

      <CallsReviewDialog drill={drill} onClose={() => setDrill(null)} />
      <IndicatorInvestigationDialog investigationId={investigationId} onClose={() => setInvestigationId(null)} />
    </main>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent><p className="text-xs text-muted-foreground">{hint}</p></CardContent>
    </Card>
  )
}

/**
 * Condutas distintas: duas regras que a revisão ligou à MESMA conduta, no mesmo momento da mesma chamada, contam uma vez. Denominador
 * próprio, só com regras de ligação determinável; análises antigas ficam fora e são ditas como tal — nunca viram condutas únicas.
 */
function OccurrenceTile({ stats }: { stats: MemoryStats }) {
  const occurrences = stats.occurrences
  if (occurrences.basis === "EMPTY") return <Tile label="Desvio por conduta" value="—" hint="Nenhuma regra avaliada neste recorte." />
  if (occurrences.basis === "NONE") return <Tile label="Desvio por conduta" value="—" hint={`As ${occurrences.undeterminedAssessedRules} regra(s) avaliada(s) vêm de análises sem ligação entre regras: não dá para contar condutas distintas.`} />
  const shared = occurrences.sharedDeviationRules > 0 ? ` · ${occurrences.deviationRules} desvio(s) por regra` : ""
  const partial = occurrences.basis === "PARTIAL" ? ` · ${occurrences.undeterminedAssessedRules} regra(s) de análises antigas fora desta taxa` : ""
  return <Tile label="Desvio por conduta" value={percent(occurrences.deviationRate)} hint={`${occurrences.deviations} conduta(s) em desvio de ${occurrences.assessed} avaliada(s)${shared}${partial}`} />
}

function StatsCells({ stats }: { stats: MemoryStats }) {
  return (
    <>
      <TableCell className="tabular-nums">{stats.assessed}</TableCell>
      <TableCell className="tabular-nums">{stats.notMet + stats.partial}</TableCell>
      <TableCell className="tabular-nums" title={stats.occurrences.basis === "PARTIAL" ? `${stats.occurrences.undeterminedAssessedRules} regra(s) de análises antigas, sem ligação entre regras, não entram nesta contagem` : undefined}>
        {stats.occurrences.basis === "NONE" || stats.occurrences.basis === "EMPTY" ? "—" : `${stats.occurrences.deviations}${stats.occurrences.basis === "PARTIAL" ? "*" : ""}`}
      </TableCell>
      <TableCell className="tabular-nums">{stats.met}</TableCell>
      <TableCell className="tabular-nums">{percent(stats.deviationRate)}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{stats.inconclusive}</TableCell>
    </>
  )
}
/** Contagens POR REGRA (uma regra numa chamada = 1) e, à parte, condutas distintas em desvio (* = parte das regras sem ligação). */
const STATS_HEAD = ["Regras avaliadas", "Desvios por regra", "Condutas em desvio", "Acertos", "Taxa por regra", "Sem conclusão"]

function usePaging() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  return { page, pageSize, setPage, setPageSize: (size: number) => { setPageSize(size); setPage(1) } }
}

const GROUP_LABELS = { PERSON: "Pessoa", TEAM: "Grupo", SUBTEAM: "Subgrupo" } as const

function PeopleTab({ filters, onDrill }: { filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const [groupBy, setGroupBy] = useState<keyof typeof GROUP_LABELS>("PERSON")
  const paging = usePaging()
  const query = usePeopleAggregatesQuery(filters, groupBy, paging.page, paging.pageSize)
  const drillFilters = (key: string | null): MemoryFilters => (groupBy === "PERSON" ? { ...filters, personId: key } : groupBy === "TEAM" ? { ...filters, teamId: key } : { ...filters, subteamId: key })
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div><CardTitle>Pessoas e equipes</CardTitle><CardDescription>Volume analisado, taxa de desvio e as etapas que mais concentram desvios. Equipe = posição atual na estrutura.</CardDescription></div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={groupBy} onValueChange={(value) => { if (value) { setGroupBy(value as keyof typeof GROUP_LABELS); paging.setPage(1) } }} aria-label="Agrupar por">
            {Object.entries(GROUP_LABELS).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
          <ExportLink filters={filters} view="people" extra={{ groupBy }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <TableSkeleton /> : null}
        {query.data && query.data.items.length === 0 ? <AnalyticsEmptyState icon={Users} title="Ninguém com chamadas analisadas neste recorte" /> : null}
        {query.data && query.data.items.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>{GROUP_LABELS[groupBy]}</TableHead><TableHead>Chamadas</TableHead>{STATS_HEAD.map((head) => <TableHead key={head}>{head}</TableHead>)}<TableHead>Mais desvios em</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {query.data.items.map((row) => (
                <TableRow key={row.key ?? row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="tabular-nums">{row.calls}</TableCell>
                  <StatsCells stats={row} />
                  <TableCell className="max-w-sm whitespace-normal text-xs">{row.topDeviations.length === 0 ? "—" : row.topDeviations.map((entry) => `${entry.title} (${entry.deviations} de ${entry.assessed})`).join(" · ")}</TableCell>
                  <TableCell>{row.key ? <Button variant="ghost" size="sm" onClick={() => onDrill({ title: row.label, filters: drillFilters(row.key), kind: groupBy === "PERSON" ? "PERSON" : "GROUP", context: groupBy === "PERSON" ? null : GROUP_LABELS[groupBy] })}>Ver chamadas</Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {query.data ? <ListPagination page={paging.page} pageSize={paging.pageSize} total={query.data.total} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemLabel={groupBy === "PERSON" ? ["pessoa", "pessoas"] : ["equipe", "equipes"]} isFetching={query.isFetching} /> : null}
      </CardContent>
    </Card>
  )
}

const DIMENSION_LABELS = { DAY: "Dia", WEEKDAY: "Dia da semana", SUBJECT: "Assunto", HOUR: "Hora" } as const

function ConcentrationTab({ filters, onDrill }: { filters: MemoryFilters; onDrill: (drill: Drill) => void }) {
  const [dimension, setDimension] = useState<keyof typeof DIMENSION_LABELS>("SUBJECT")
  const query = useConcentrationQuery(filters, dimension)
  const max = Math.max(1, ...(query.data?.buckets ?? []).map((bucket) => bucket.notMet + bucket.partial))
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div><CardTitle>Onde os desvios se concentram</CardTitle><CardDescription>Desvios por {DIMENSION_LABELS[dimension].toLocaleLowerCase("pt-BR")} da chamada, sempre com o total avaliado ao lado.</CardDescription></div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={dimension} onValueChange={(value) => { if (value) setDimension(value as keyof typeof DIMENSION_LABELS) }} aria-label="Dimensão">
            {Object.entries(DIMENSION_LABELS).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
          <ExportLink filters={filters} view="concentration" extra={{ dimension }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <TableSkeleton /> : null}
        {query.data && query.data.buckets.length === 0 ? <AnalyticsEmptyState icon={Activity} title="Nada avaliado neste recorte" /> : null}
        {query.data?.buckets.map((bucket) => (
          <div key={bucket.bucket} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate">{bucket.label}</span>
            <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-destructive/70" style={{ width: `${((bucket.notMet + bucket.partial) / max) * 100}%` }} /></div>
            <span className="text-xs tabular-nums text-muted-foreground">{bucket.notMet + bucket.partial} de {bucket.assessed} ({percent(bucket.deviationRate)}) · {bucket.calls} chamada(s){dimension === "SUBJECT" ? <Button variant="link" size="sm" className="h-auto px-1" onClick={() => onDrill({ title: bucket.label, filters: { ...filters, subject: bucket.bucket }, kind: "SUBJECT" })}>ver</Button> : null}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}


/** Resultado oficial × meta de uma linha (o fato como veio da fonte; sem meta = só o valor). */
function OfficialCell({ official }: { official: Record<string, unknown> }) {
  const value = typeof official.value === "number" ? official.value : null
  const target = typeof official.target === "number" ? official.target : null
  const unit = typeof official.unit === "string" ? official.unit : ""
  const within = typeof official.withinTarget === "boolean" ? official.withinTarget : null
  if (value === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex flex-col">
      <span className="font-medium tabular-nums">{formatIndicatorValue(value, unit)}</span>
      {target !== null ? <span className={cn("text-xs tabular-nums", within === false ? "text-destructive" : "text-muted-foreground")}>meta {formatIndicatorValue(target, unit)}{within === null ? "" : within ? " · dentro" : " · fora"}</span> : null}
    </span>
  )
}

const ADVERSE_CONCLUSIONS = new Set(["PATTERN_SUPPORTED", "CHANGE_LOCATED_NO_CAUSE", "CHANGE_LOCATED_NOT_EXAMINED"])
const POSITIVE_CONCLUSIONS = new Set(["STRENGTH_PATTERN", "RESULT_RECOGNITION"])

function IndicatorsTab({ filters, onOpen }: { filters: MemoryFilters; onOpen: (id: string) => void }) {
  const paging = usePaging()
  const query = useIndicatorInvestigationsQuery(filters, paging.page, paging.pageSize)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div><CardTitle>Investigações de indicador</CardTitle><CardDescription>Onde o resultado mudou, o que as chamadas mostram e o que faz o grupo de referência. Clique numa linha para abrir.</CardDescription></div>
        <ExportLink filters={filters} view="indicators" />
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isPending ? <TableSkeleton /> : null}
        {query.data && query.data.items.length === 0 ? <AnalyticsEmptyState icon={Gauge} title="Nenhuma investigação de indicador neste recorte" /> : null}
        {query.data && query.data.items.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>Pessoa</TableHead><TableHead>Indicador</TableHead><TableHead>Resultado</TableHead><TableHead>Conclusão</TableHead><TableHead>Onde mudou</TableHead><TableHead className="w-10"><span className="sr-only">Abrir</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {query.data.items.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
                  <TableCell className="font-medium">{row.personName}</TableCell>
                  <TableCell>
                    <span className="block">{row.indicatorName}</span>
                    <span className="text-xs text-muted-foreground">{row.periodLabel}</span>
                  </TableCell>
                  <TableCell><OfficialCell official={row.official} /></TableCell>
                  <TableCell>
                    <Badge variant={ADVERSE_CONCLUSIONS.has(row.conclusion) ? "destructive" : POSITIVE_CONCLUSIONS.has(row.conclusion) ? "secondary" : "outline"} className="h-auto whitespace-normal text-left">{CONCLUSION_LABELS[row.conclusion] ?? row.conclusion}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-sm">{row.focus.map((focus) => focus.label).join(" · ") || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" aria-label={`Abrir a investigação de ${row.indicatorName} de ${row.personName}`} onClick={(event) => { event.stopPropagation(); onOpen(row.id) }}><ChevronRight /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {query.data ? <ListPagination page={paging.page} pageSize={paging.pageSize} total={query.data.total} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemLabel={["investigação", "investigações"]} isFetching={query.isFetching} /> : null}
      </CardContent>
    </Card>
  )
}
