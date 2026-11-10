"use client"

import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FlaskConical } from "lucide-react"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCivilDate, formatShortDateTime } from "@/lib/format/date"
import { bestPracticeKeys, useAnalysesQuery, useAnalysisQuery } from "@/queries/best-practices/use-best-practices"
import type { AnalysisReport, BestPracticesMeta } from "@/schemas/best-practices/best-practices.schema"

import { ANALYSIS_OUTCOME_LABELS, ANALYSIS_STATUS_LABELS, DECISION_LABELS, DISCOVERY_REJECTION_LABELS, OBLIGATION_LABELS, OUTCOME_LABELS } from "./best-practice-labels"
import { NewAnalysisDialog } from "./new-analysis-dialog"

/** Análises pedidas (as mais recentes primeiro): estado da fila, resultado e o relatório que explica cada candidato. */
export function AnalysesPanel({ meta }: { meta: BestPracticesMeta | undefined }) {
  const analyses = useAnalysesQuery()
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  // Análise que terminou agora: a base muda — recarrega a lista de padrões.
  const completed = analyses.data?.filter((item) => item.status === "COMPLETED").length ?? 0
  const lastCompleted = useRef(completed)
  useEffect(() => {
    if (completed > lastCompleted.current) void queryClient.invalidateQueries({ queryKey: [...bestPracticeKeys.all, "patterns"] })
    lastCompleted.current = completed
  }, [completed, queryClient])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cada análise compara, por contexto, quem está no 1º quartil oficial do indicador com o grupo de referência da mesma população (Grupo ou Subgrupo) e período.</p>
        {meta?.capabilities.canManage ? <NewAnalysisDialog meta={meta} /> : null}
      </div>
      {analyses.isError ? <AnalyticsErrorState error={analyses.error} onRetry={() => void analyses.refetch()} /> : null}
      {analyses.isPending ? <TableSkeleton rows={4} /> : null}
      {analyses.data && analyses.data.length === 0 ? <AnalyticsEmptyState icon={FlaskConical} title="Nenhuma análise ainda" description="Peça uma análise para levantar boas práticas de um indicador." /> : null}
      {analyses.data && analyses.data.length > 0 ? (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedida em</TableHead>
                <TableHead>Indicador</TableHead>
                <TableHead>População</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Resumo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analyses.data.map((item) => (
                <TableRow key={item.id} className="cursor-pointer" onClick={() => setOpenId(item.id)}>
                  <TableCell className="text-sm">
                    {/* A linha abre pelo clique; este botão é o mesmo acesso pelo teclado. */}
                    <button type="button" className="text-left hover:underline" aria-label={`Abrir a análise de ${item.indicatorName} de ${formatShortDateTime(item.createdAt)}`} onClick={(event) => { event.stopPropagation(); setOpenId(item.id) }}>
                      {formatShortDateTime(item.createdAt)}
                    </button>
                    <span className="block text-xs text-muted-foreground">{item.requestedBy ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{item.indicatorName}{item.channelFlagId ? <span className="text-xs text-muted-foreground"> · sinal da chamada</span> : null}<span className="block text-xs text-muted-foreground">{item.referencePeriods.join(", ")}</span></TableCell>
                  <TableCell className="text-sm">{item.dataOrigin === "SYNTHETIC" ? <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">{item.datasetLabel ?? "Sintético"}</Badge> : <>{item.teamName}{item.subteamName ? <span className="block text-xs text-muted-foreground">Subgrupo {item.subteamName}</span> : null}</>}{item.modelMode === "SIMULATED_ANSWER_KEY" ? <span className="block text-xs text-muted-foreground">modelo simulado</span> : null}</TableCell>
                  <TableCell className="text-sm"><Badge variant={item.status === "FAILED" ? "destructive" : item.status === "COMPLETED" ? "default" : "secondary"}>{ANALYSIS_STATUS_LABELS[item.status]}</Badge>{item.outcome ? <span className="block text-xs text-muted-foreground">{ANALYSIS_OUTCOME_LABELS[item.outcome] ?? item.outcome}</span> : null}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{item.summary ?? item.errorMessage ?? "—"}{item.modelCalls !== null ? <span className="block">IA: {item.modelCalls} chamada(s){item.costUsd ? ` · US$ ${item.costUsd.toFixed(4)}` : ""}</span> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <AnalysisReportDialog analysisId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}

function AnalysisReportDialog({ analysisId, onClose }: { analysisId: string | null; onClose: () => void }) {
  const query = useAnalysisQuery(analysisId)
  const report = query.data?.report ?? null
  return (
    <Dialog open={analysisId !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-5xl overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Relatório da análise</DialogTitle>
          <DialogDescription>{report?.summary ?? query.data?.errorMessage ?? (query.data ? ANALYSIS_STATUS_LABELS[query.data.status] : "Carregando…")}</DialogDescription>
        </DialogHeader>
        {query.isPending ? <Skeleton className="h-64 w-full" /> : report ? <AnalysisReportBody report={report} /> : null}
      </DialogContent>
    </Dialog>
  )
}

export function AnalysisReportBody({ report }: { report: AnalysisReport }) {
  return (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">{report.population.label} · {formatCivilDate(report.period.start)} a {formatCivilDate(report.period.end)} · {report.comparison.top} ({report.groups.top}) × {report.comparison.reference} ({report.groups.reference}){report.groups.excluded.length > 0 ? ` · fora da comparação: ${report.groups.excluded.map((item) => `${item.count} (${item.reason === "NO_OFFICIAL_QUARTILE" ? "sem quartil oficial" : item.reason === "TIE" ? "empate" : "meio"})`).join(", ")}` : ""}</p>
      <section className="space-y-1">
        <h3 className="font-semibold">Contextos</h3>
        <ul className="space-y-1">{report.cells.map((cell) => <li key={cell.cellKey}><span className="font-medium">{cell.label}</span> — {cell.status === "ELIGIBLE" ? `analisado: ${cell.groups.TOP.sampled} × ${cell.groups.REFERENCE.sampled} chamadas (${cell.groups.TOP.evaluable} × ${cell.groups.REFERENCE.evaluable} operadores${cell.groups.TOP.fewCalls + cell.groups.REFERENCE.fewCalls > 0 ? `; ${cell.groups.TOP.fewCalls + cell.groups.REFERENCE.fewCalls} com poucas chamadas ficaram fora` : ""})` : cell.note}</li>)}</ul>
      </section>
      {report.candidates.length > 0 ? (
        <section className="space-y-1">
          <h3 className="font-semibold">Comportamentos avaliados</h3>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader><TableRow><TableHead>Comportamento</TableHead><TableHead>Por contexto</TableHead><TableHead>Obrigação</TableHead><TableHead>Decisão</TableHead></TableRow></TableHeader>
              <TableBody>
                {report.candidates.map((candidate) => (
                  <TableRow key={candidate.key}>
                    <TableCell className="max-w-xs whitespace-normal">{candidate.name}{candidate.origin === "KNOWN_PATTERN" ? <span className="block text-xs text-muted-foreground">padrão já existente, medido de novo</span> : null}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{candidate.contexts.map((context) => <span key={context.cellKey} className="block">{context.label}: {OUTCOME_LABELS[context.assessment.outcome] ?? context.assessment.outcome}</span>)}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{candidate.obligation?.status ? OBLIGATION_LABELS[candidate.obligation.status] : "—"}</TableCell>
                    <TableCell className="text-xs"><span className="font-medium">{DECISION_LABELS[candidate.decision] ?? candidate.decision}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
      {report.discovery.rejected.length > 0 || report.discovery.recognizedKnown.length > 0 ? (
        <section className="space-y-1 text-xs text-muted-foreground">
          {report.discovery.rejected.map((item, index) => <p key={`${item.name}-${index}`}>Recusado na descoberta: {item.name ?? "sem nome"} ({DISCOVERY_REJECTION_LABELS[item.reason] ?? item.reason})</p>)}
          {report.discovery.recognizedKnown.map((line) => <p key={line}>Reconhecido como padrão existente: {line}</p>)}
        </section>
      ) : null}
      <section className="space-y-1">
        <h3 className="font-semibold">Codificação das chamadas</h3>
        <p className="text-xs text-muted-foreground">{report.codings.total} leituras ({report.codings.reused} reaproveitadas de análises anteriores) · {report.codings.unclear} sem decisão · {report.codings.unverifiedQuotes} trecho(s) que não conferiram com a transcrição · {report.codings.fromCustomer} fala(s) de cliente recusada(s) como evidência · IA: {report.usage.calls} chamada(s){report.usage.models.length > 0 ? ` (${report.usage.models.join(", ")})` : ""}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-semibold">Limitações</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section className="space-y-1">
        <h3 className="font-semibold">Como calculamos</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground"><li>{report.comparison.method}</li>{report.method.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  )
}
