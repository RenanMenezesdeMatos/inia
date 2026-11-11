"use client"

import Link from "next/link"
import { useState } from "react"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Database, RotateCcw, Sparkles } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import type { QueryTableCard } from "@/schemas/leadership/leadership.schema"
import type { ReportComparison, SourceState, VisualizationData } from "@/schemas/reports/reports.schema"
import { retryDeliveryAnalysis } from "@/services/reports/reports-service"
import { NOT_FORWARDED_TEXT } from "./report-labels"
import { formatUnitValue, ReportVisualization } from "./report-visualization"

/** O que a visão de uma entrega precisa — igual no Acompanhamento e na página da entrega. */
export type DeliveryViewModel = {
  deliveryId: string
  kind: "DELIVERY" | "NOT_FORWARDED"
  reason: string | null
  periodLabel: string | null
  structureLabel: string | null
  sources: SourceState[]
  visualization: VisualizationData | null
  dataset: QueryTableCard | null
  comparison: ReportComparison | null
  analysisStatus: string
  analysisText: string | null
  empty: boolean
  occurrences: number
  lastCheckedAt: string
  createdAt: string
}

function SourcesLine({ sources }: { sources: SourceState[] }) {
  if (sources.length === 0) return null
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {sources.map((source) => (
        <li key={source.source} className="flex items-start gap-1.5">
          <Database className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground/80">{source.label}</span>
            {source.lastUpdatedAt ? ` — atualizada em ${formatDateTime(source.lastUpdatedAt)}` : " — sem data de atualização conhecida"}
            {source.stale ? " (atrasada)" : ""}
          </span>
        </li>
      ))}
    </ul>
  )
}

const ASSESSMENT_STYLE = { IMPROVED: "text-emerald-700 dark:text-emerald-400", WORSENED: "text-red-700 dark:text-red-400", STABLE: "text-muted-foreground", NEUTRAL: "text-muted-foreground" } as const
const ASSESSMENT_TEXT = { IMPROVED: "melhora", WORSENED: "piora", STABLE: "estável", NEUTRAL: "neutro" } as const

function ComparisonBlock({ comparison }: { comparison: ReportComparison }) {
  if (comparison.status === "DISABLED") return null
  if (comparison.status !== "COMPARED") return <p className="text-xs text-muted-foreground">Comparação: {comparison.reason ?? "não disponível."}</p>
  const top = [...comparison.changes].filter((change) => change.assessment === "IMPROVED" || change.assessment === "WORSENED").sort((a, b) => Math.abs(b.deltaPercent ?? b.delta) - Math.abs(a.deltaPercent ?? a.delta)).slice(0, 4)
  return (
    <div className="space-y-1.5 rounded-md bg-muted/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">Comparação:</span> {comparison.basis}. {comparison.summary.improved} melhora(s), {comparison.summary.worsened} piora(s).
        {comparison.rowsAdded.length + comparison.rowsRemoved.length > 0 ? ` Composição mudou: ${comparison.rowsAdded.length} entrou(aram), ${comparison.rowsRemoved.length} saiu(íram).` : ""}
        {comparison.configurationChanged ? " A configuração mudou desde a referência." : ""}
      </p>
      {top.length > 0 ? (
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {top.map((change) => (
            <li key={`${change.row}-${change.column}`} className={cn("flex items-center gap-1", ASSESSMENT_STYLE[change.assessment])}>
              {change.delta > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
              <span className="truncate">
                {change.row} · {change.columnLabel}: {formatUnitValue(change.previous, change.unit)} → {formatUnitValue(change.current, change.unit)} ({ASSESSMENT_TEXT[change.assessment]})
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AnalysisBlock({ model }: { model: DeliveryViewModel }) {
  const [status, setStatus] = useState(model.analysisStatus)
  const [retrying, setRetrying] = useState(false)
  if (status === "DISABLED" || status === "NOT_APPLICABLE") return null
  if (status === "READY" && model.analysisText) {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Sparkles className="size-3" aria-hidden />Análise da INIA</p>
        <RichContent text={model.analysisText} density="compact" />
      </div>
    )
  }
  if (status === "PENDING") return <p className="text-xs text-muted-foreground">Análise da INIA em preparação — os dados acima já são os da entrega.</p>
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Análise da INIA indisponível no momento (os dados acima continuam válidos).</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true)
          try {
            setStatus((await retryDeliveryAnalysis(model.deliveryId)).analysisStatus)
          } finally {
            setRetrying(false)
          }
        }}
      >
        <RotateCcw className="size-3" aria-hidden />
        Tentar novamente
      </Button>
    </div>
  )
}

export function ReportDeliveryView({ model, showDetailsLink = true }: { model: DeliveryViewModel; showDetailsLink?: boolean }) {
  if (model.kind === "NOT_FORWARDED") {
    const pending = model.sources.filter((source) => source.stale || model.reason === "STALE_SOURCES")
    return (
      <div className="space-y-2 rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2.5 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
        <p className="flex items-start gap-2 font-medium text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {NOT_FORWARDED_TEXT[model.reason ?? ""] ?? "Report não encaminhado nesta execução."}
        </p>
        {pending.length > 0 ? (
          <div className="pl-6">
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">Bases pendentes:</p>
            <SourcesLine sources={pending} />
          </div>
        ) : null}
        <p className="pl-6 text-xs text-muted-foreground">
          {model.periodLabel ? `Período configurado: ${model.periodLabel}. ` : ""}
          Verificado {model.occurrences > 1 ? `${model.occurrences} vezes, a última em ${formatDateTime(model.lastCheckedAt)}` : `em ${formatDateTime(model.createdAt)}`}. A última entrega válida continua disponível com a data original.
        </p>
        {showDetailsLink ? <Link href={`/reports/entregas/${model.deliveryId}`} className="pl-6 text-xs font-medium text-primary hover:underline">Ver detalhes e histórico</Link> : null}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {model.structureLabel ? <span className="font-medium text-foreground/80">{model.structureLabel}</span> : null}
          {model.periodLabel ? ` · ${model.periodLabel}` : ""}
        </span>
        <span>Gerado em {formatDateTime(model.createdAt)}</span>
      </div>
      {model.visualization ? <ReportVisualization data={model.visualization} card={model.dataset} /> : null}
      {model.comparison ? <ComparisonBlock comparison={model.comparison} /> : null}
      <AnalysisBlock model={model} />
      <SourcesLine sources={model.sources} />
      {model.dataset?.limitations && model.dataset.limitations.length > 0 ? <p className="text-xs text-muted-foreground">Limitações: {model.dataset.limitations.join(" ")}</p> : null}
      {showDetailsLink ? <Link href={`/reports/entregas/${model.deliveryId}`} className="text-xs font-medium text-primary hover:underline">Ver detalhes e histórico</Link> : null}
    </div>
  )
}
