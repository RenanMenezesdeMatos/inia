"use client"

import { useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquareQuote, X } from "lucide-react"

import { AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { useAssessmentDetailQuery, useAssessmentsQuery, useMemorySummaryQuery, usePeopleAggregatesQuery, useProcessAggregatesQuery } from "@/queries/diagnostics/use-diagnostics-memory"
import type { AssessmentRow, MemoryFilters } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { ExportLink, plural, rateOf, type Drill, type DrillKind } from "./diagnostics-shared"
import { CallAssessmentDetail } from "./call-assessment-detail"
import { SPEAKER_LABELS, STATUS_LABELS, STATUS_TONE, percent, shortDate } from "./memory-labels"
import { OUTCOME_CHART_CONFIG } from "./outcome-charts"

/**
 * REVISÃO DAS CHAMADAS de um recorte (ponto do processo, documento, pessoa, grupo, assunto) — a tela de "Ver chamadas".
 *   - cabeçalho: o que é o recorte e os números dele (desvios, acertos, avaliações, pessoas, chamadas), com a proporção desvio × acerto;
 *   - esquerda: QUEM mais erra (ou, no recorte de uma pessoa, ONDE ela mais erra) — clicar filtra as chamadas —, as situações com a
 *     contagem de cada uma e a lista de chamadas: pessoa, data, assunto, o que aconteceu e a fala;
 *   - direita: a chamada escolhida, com o ponto em destaque, o cenário, os outros pontos e a transcrição — sem empilhar outro painel.
 * No celular: uma coluna; escolher uma chamada abre o detalhe com "voltar".
 */
type StatusTab = "DEVIATION" | "MET" | "INCONCLUSIVE" | "ALL"
const PAGE_SIZE = 20
const KIND_LABELS: Record<DrillKind, string> = { POINT: "Ponto do processo", DOCUMENT: "Documento da base", PERSON: "Pessoa", GROUP: "Equipe", SUBJECT: "Assunto" }

export function CallsReviewDialog({ drill, onClose }: { drill: Drill | null; onClose: () => void }) {
  return (
    <Dialog open={drill !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[960px] w-[96vw] max-w-[1320px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1320px] max-sm:h-[100svh] max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      >
        {drill ? <CallsReview key={JSON.stringify([drill.title, drill.filters, drill.status])} drill={drill} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function CallsReview({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const isMobile = useIsMobile()
  const kind = drill.kind ?? "POINT"
  const [status, setStatus] = useState<StatusTab>(drill.status ?? "DEVIATION")
  // Filtro extra vindo do painel lateral: uma pessoa (recortes que não são de pessoa) ou um ponto (recorte de uma pessoa).
  const [focus, setFocus] = useState<{ personId?: string; practiceKey?: string; label: string } | null>(null)
  const [page, setPage] = useState(1)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const base: MemoryFilters = { ...drill.filters, status: null }
  const scoped: MemoryFilters = { ...base, ...(focus?.personId ? { personId: focus.personId } : {}), ...(focus?.practiceKey ? { practiceKey: focus.practiceKey } : {}) }
  const summary = useMemorySummaryQuery(base)
  const scopedSummary = useMemorySummaryQuery(scoped)
  const list = useAssessmentsQuery({ ...scoped, status: status === "ALL" ? null : status }, page, PAGE_SIZE)
  const items = list.data?.items ?? []
  const chosen = items.find((item) => item.id === chosenId) ?? (isMobile ? null : items[0] ?? null)
  const reset = () => { setPage(1); setChosenId(null) }

  const counts = scopedSummary.data?.stats
  const tabs: { value: StatusTab; label: string; count: number | null }[] = [
    { value: "DEVIATION", label: "Desvios", count: counts ? counts.notMet + counts.partial : null },
    { value: "MET", label: "Acertos", count: counts?.met ?? null },
    { value: "INCONCLUSIVE", label: "Sem conclusão", count: counts?.inconclusive ?? null },
    { value: "ALL", label: "Todas", count: counts ? counts.assessed + counts.inconclusive + counts.notApplicable : null },
  ]
  const showList = !isMobile || chosen === null
  const showDetail = !isMobile || chosen !== null

  return (
    <>
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{KIND_LABELS[kind]}{drill.context ? ` · ${drill.context}` : ""}</p>
          <DialogTitle className="text-lg leading-snug font-semibold">{drill.title}</DialogTitle>
          <DialogDescription className={cn("text-sm", !drill.description && "sr-only")}>{drill.description ?? `As chamadas avaliadas em ${drill.title}.`}</DialogDescription>
          <ReviewStats summary={summary.data?.stats ?? null} people={summary.data?.people ?? null} />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar"><X /></Button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(320px,420px)_1fr]">
        {showList ? (
          <aside className="flex min-h-0 flex-col border-r max-md:border-r-0">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {kind === "PERSON"
                ? <PointsBreakdown filters={base} focus={focus?.practiceKey ?? null} onFocus={(next) => { setFocus(next ? { practiceKey: next.key, label: next.label } : null); reset() }} />
                : <PeopleBreakdown filters={base} focus={focus?.personId ?? null} onFocus={(next) => { setFocus(next ? { personId: next.key, label: next.label } : null); reset() }} />}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Chamadas</h3>
                  <ExportLink filters={{ ...scoped, status: status === "ALL" ? null : status }} view="assessments" />
                </div>
                {focus ? (
                  <Badge variant="secondary" className="gap-1">
                    {focus.label}
                    <button type="button" className="rounded-sm opacity-70 hover:opacity-100" onClick={() => { setFocus(null); reset() }} aria-label={`Tirar o filtro ${focus.label}`}><X className="size-3" /></button>
                  </Badge>
                ) : null}
                <ToggleGroup type="single" value={status} onValueChange={(value) => { if (value) { setStatus(value as StatusTab); reset() } }} aria-label="Situação das chamadas" className="grid w-full grid-cols-4">
                  {tabs.map((tab) => (
                    <ToggleGroupItem key={tab.value} value={tab.value} className="h-auto flex-col gap-0 px-1 py-1.5 text-xs whitespace-nowrap">
                      <span>{tab.label}</span>
                      <span className="text-sm font-semibold tabular-nums">{tab.count ?? "—"}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {list.isError ? <AnalyticsErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
              {list.isPending ? <TableSkeleton rows={4} /> : null}
              {list.data && items.length === 0 ? <p className="rounded-lg bg-muted/60 px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma chamada nesta situação.</p> : null}
              <ul className={cn("space-y-2", list.isFetching && !list.isPending && "opacity-60")}>
                {items.map((item) => <CallItem key={item.id} item={item} kind={kind} selected={chosen?.id === item.id} onSelect={() => setChosenId(item.id)} />)}
              </ul>
            </div>
            {list.data && list.data.total > PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
                <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, list.data.total)} de {list.data.total}</span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" disabled={page === 1} onClick={() => { setPage(page - 1); setChosenId(null) }} aria-label="Página anterior"><ChevronLeft /></Button>
                  <Button variant="ghost" size="icon-sm" disabled={page * PAGE_SIZE >= list.data.total} onClick={() => { setPage(page + 1); setChosenId(null) }} aria-label="Próxima página"><ChevronRight /></Button>
                </span>
              </div>
            ) : null}
          </aside>
        ) : null}

        {showDetail ? (
          <section className="min-h-0 overflow-y-auto p-5" aria-label="Chamada escolhida">
            {isMobile ? <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => setChosenId(null)}><ArrowLeft data-icon="inline-start" /> Voltar para a lista</Button> : null}
            {chosen ? <ChosenCall row={chosen} /> : list.data ? <p className="pt-10 text-center text-sm text-muted-foreground">Escolha uma chamada na lista para ver o que aconteceu.</p> : null}
          </section>
        ) : null}
      </div>
    </>
  )
}

/** Os números do recorte numa linha, com a proporção desvio × acerto (as cores dos gráficos; o número sempre escrito ao lado). */
function ReviewStats({ summary, people }: { summary: { assessed: number; met: number; notMet: number; partial: number; calls: number; inconclusive: number } | null; people: number | null }) {
  if (!summary) return <div className="h-10" />
  const deviations = summary.notMet + summary.partial
  const share = summary.assessed > 0 ? (deviations / summary.assessed) * 100 : 0
  const item = (label: string, value: string, hint?: string) => (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{value}{hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span> : null}</p>
    </div>
  )
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {item("Desvios", String(deviations), summary.assessed > 0 ? percent(rateOf(deviations, summary.assessed)) : undefined)}
        {item("Acertos", String(summary.met))}
        {item("Avaliações", String(summary.assessed), summary.inconclusive > 0 ? `+${summary.inconclusive} sem conclusão` : undefined)}
        {item("Chamadas", String(summary.calls))}
        {people !== null ? item("Pessoas", String(people)) : null}
      </div>
      {summary.assessed > 0 ? (
        <div className="flex h-2 w-full max-w-md overflow-hidden rounded-full bg-muted" role="img" aria-label={`${deviations} desvios e ${summary.met} acertos em ${summary.assessed} avaliações`}>
          <span className="h-full" style={{ width: `${share}%`, background: OUTCOME_CHART_CONFIG.deviations.color }} />
          <span className="h-full border-l-2 border-card" style={{ width: `${100 - share}%`, background: OUTCOME_CHART_CONFIG.met.color }} />
        </div>
      ) : null}
    </div>
  )
}

type Breakdown = { key: string; label: string; deviations: number; met: number; assessed: number }

/** Linhas de "quem/onde mais erra": barra desvio × acerto proporcional à maior linha, números escritos; clicar filtra (de novo, tira). */
function BreakdownList({ title, rows, focus, onFocus, empty }: { title: string; rows: Breakdown[]; focus: string | null; onFocus: (row: Breakdown | null) => void; empty: string }) {
  const [expanded, setExpanded] = useState(false)
  const max = Math.max(...rows.map((row) => row.assessed), 1)
  const shown = expanded ? rows : rows.slice(0, 5)
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : null}
      <ul className="space-y-1">
        {shown.map((row) => (
          <li key={row.key}>
            <button type="button" aria-pressed={focus === row.key} onClick={() => onFocus(focus === row.key ? null : row)}
              className={cn("w-full space-y-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", focus === row.key && "bg-muted ring-1 ring-primary/30")}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium" title={row.label}>{row.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.deviations} de {row.assessed}</span>
              </span>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" style={{ width: `${(row.assessed / max) * 100}%` }} aria-hidden>
                <span style={{ width: `${(row.deviations / Math.max(row.assessed, 1)) * 100}%`, background: OUTCOME_CHART_CONFIG.deviations.color }} />
                <span style={{ width: `${(row.met / Math.max(row.assessed, 1)) * 100}%`, background: OUTCOME_CHART_CONFIG.met.color }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 5 ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExpanded((value) => !value)}>{expanded ? "Mostrar menos" : `Ver todas (${rows.length})`}</Button> : null}
    </div>
  )
}

const byDeviations = (a: Breakdown, b: Breakdown) => b.deviations - a.deviations || (rateOf(b.deviations, b.assessed) ?? 0) - (rateOf(a.deviations, a.assessed) ?? 0) || a.label.localeCompare(b.label, "pt-BR")

function PeopleBreakdown({ filters, focus, onFocus }: { filters: MemoryFilters; focus: string | null; onFocus: (row: Breakdown | null) => void }) {
  const query = usePeopleAggregatesQuery(filters, "PERSON", 1, 200)
  if (query.isPending) return <TableSkeleton rows={3} />
  const rows = (query.data?.items ?? []).filter((row) => row.key && row.assessed > 0).map((row) => ({ key: row.key!, label: row.label, deviations: row.notMet + row.partial, met: row.met, assessed: row.assessed })).sort(byDeviations)
  const withDeviation = rows.filter((row) => row.deviations > 0).length
  return <BreakdownList title={`Quem mais erra · ${withDeviation} de ${plural(rows.length, "pessoa", "pessoas")} com desvio`} rows={rows} focus={focus} onFocus={onFocus} empty="Ninguém avaliado neste recorte." />
}

function PointsBreakdown({ filters, focus, onFocus }: { filters: MemoryFilters; focus: string | null; onFocus: (row: Breakdown | null) => void }) {
  const query = useProcessAggregatesQuery(filters, "ALL")
  if (query.isPending) return <TableSkeleton rows={3} />
  const rows = (query.data?.themes ?? []).flatMap((theme) => theme.items).map((row) => ({ key: row.practiceKey, label: row.title, deviations: row.notMet + row.partial, met: row.met, assessed: row.assessed })).sort(byDeviations)
  return <BreakdownList title="Onde mais erra" rows={rows} focus={focus} onFocus={onFocus} empty="Nenhum ponto avaliado neste recorte." />
}

/** Uma chamada na lista: pessoa, data, assunto, situação, o que aconteceu (duas linhas) e a primeira fala. */
function CallItem({ item, kind, selected, onSelect }: { item: AssessmentRow; kind: DrillKind; selected: boolean; onSelect: () => void }) {
  const quote = item.evidence[0]
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}
        className={cn("w-full space-y-1.5 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/60", selected && "border-primary/40 bg-primary/5 ring-1 ring-primary/20")}>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{item.personName}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortDate(item.date)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_TONE[item.status] ?? "outline"} className="text-[11px]">{STATUS_LABELS[item.status] ?? item.status}</Badge>
          {item.subject ? <span className="text-xs text-muted-foreground">{item.subject}</span> : null}
          {kind !== "POINT" && item.practiceTitle ? <span className="text-xs text-muted-foreground">· {item.practiceTitle}</span> : null}
        </span>
        {item.rationale ? <span className="line-clamp-2 block text-muted-foreground">{item.rationale}</span> : null}
        {quote ? (
          <span className="flex gap-1.5 text-xs">
            <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="line-clamp-2"><span className="text-muted-foreground">{SPEAKER_LABELS[quote.speaker ?? ""] ?? quote.speaker ?? "Fala"}:</span> “{quote.quote}”</span>
          </span>
        ) : null}
      </button>
    </li>
  )
}

function ChosenCall({ row }: { row: AssessmentRow }) {
  const query = useAssessmentDetailQuery(row.callAssessmentId)
  if (query.isPending) return <TableSkeleton rows={6} />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  return query.data ? <CallAssessmentDetail detail={query.data} focusId={row.id} /> : null
}
