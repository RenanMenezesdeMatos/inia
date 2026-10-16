"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Eye, Info, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { reportKeys, useReportOptionsQuery, useReportProposalQuery, useReportQuery } from "@/queries/reports/use-reports"
import type { ReportConfig, ReportOptions, ReportPreview } from "@/schemas/reports/reports.schema"
import { createReport, previewReport, updateReport } from "@/services/reports/reports-service"
import { AudienceFields } from "./report-form/audience-fields"
import { Field, OptionSelect } from "./report-form/form-controls"
import { cleanDefinition, defaultConfig, staticCompatibility } from "./report-form/form-helpers"
import { QueryFields } from "./report-form/query-fields"
import { ScheduleFields } from "./report-form/schedule-fields"
import { VISUALIZATION_LABELS } from "./report-labels"
import { ReportVisualization } from "./report-visualization"

/** Criar (do zero ou a partir de uma proposta do chat) ou editar um report — formulário guiado, prévia e salvar. */
export function ReportFormPage({ reportId, proposalId }: { reportId?: string; proposalId?: string | null }) {
  const options = useReportOptionsQuery()
  const report = useReportQuery(reportId ?? "")
  const proposal = useReportProposalQuery(reportId ? null : (proposalId ?? null))
  const loading = options.isLoading || (reportId ? report.isLoading : false) || (proposalId && !reportId ? proposal.isLoading : false)
  if (loading) return <div className="mx-auto max-w-4xl space-y-3 px-4 py-6"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-64 w-full" /></div>
  if (options.isError || !options.data) return <p className="px-4 py-6 text-sm text-destructive">Reports são para quem lidera uma estrutura ou tem o papel Report.</p>
  if (reportId && (report.isError || !report.data)) return <p className="px-4 py-6 text-sm text-destructive">Report não encontrado.</p>
  const catalog = options.data
  const initial: ReportConfig = reportId && report.data
    ? report.data.report.config
    : proposal.data
      ? { ...defaultConfig(catalog.capabilities), name: proposal.data.draft.name, description: proposal.data.draft.description, definition: proposal.data.draft.definition, visualization: proposal.data.draft.visualization }
      : defaultConfig(catalog.capabilities)
  return <ReportForm key={reportId ?? proposal.data?.id ?? "new"} catalog={catalog} initial={initial} reportId={reportId} revision={report.data?.report.revision} proposalId={proposal.data?.id ?? null} fromChat={Boolean(proposal.data)} />
}

function ReportForm({ catalog, initial, reportId, revision, proposalId, fromChat }: { catalog: ReportOptions; initial: ReportConfig; reportId: string | undefined; revision: number | undefined; proposalId: string | null; fromChat: boolean }) {
  const router = useRouter()
  const client = useQueryClient()
  const [config, setConfig] = useState<ReportConfig>(initial)
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [previewStale, setPreviewStale] = useState(false)
  const [busy, setBusy] = useState<"preview" | "save" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const compatible = (preview && !previewStale ? preview.compatible : staticCompatibility(config.definition)).filter((type) => staticCompatibility(config.definition).includes(type))
  const metricOptions = preview && !previewStale ? preview.card.columns.filter((column) => column.numeric) : []
  const update = (patch: Partial<ReportConfig>) => {
    setConfig((current) => ({ ...current, ...patch }))
    // A prévia foi montada para a visualização anterior: trocar o tipo/métrica pede uma prévia nova.
    if (patch.visualization && preview) setPreviewStale(true)
  }
  const changeDefinition = (definition: ReportConfig["definition"]) => {
    const allowed = staticCompatibility(definition)
    setConfig((current) => ({ ...current, definition, visualization: allowed.includes(current.visualization.type) ? current.visualization : { type: "TABLE" } }))
    if (preview) setPreviewStale(true)
  }
  const fail = (cause: unknown) => setError(cause instanceof ApiError ? cause.message : "Não foi possível concluir. Tente de novo.")

  const runPreview = async () => {
    setBusy("preview")
    setError(null)
    try {
      const result = await previewReport({ definition: cleanDefinition(config.definition), visualization: config.visualization })
      setPreview(result)
      setPreviewStale(false)
      if (!config.visualization.metric && result.suggested.metric && result.compatible.includes(config.visualization.type)) setConfig((current) => ({ ...current, visualization: { ...current.visualization, metric: result.suggested.metric } }))
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(null)
    }
  }
  const save = async (activate: boolean) => {
    setBusy("save")
    setError(null)
    try {
      const payload = { ...config, definition: cleanDefinition(config.definition) }
      const saved = reportId ? await updateReport(reportId, { revision: revision ?? 0, config: payload }) : await createReport({ config: payload, activate, proposalId })
      await client.invalidateQueries({ queryKey: reportKeys.all })
      router.push(`/reports/${saved.id}`)
    } catch (cause) {
      fail(cause)
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <Link href="/reports" className="text-xs text-muted-foreground hover:underline">← Reports</Link>
        <h1 className="text-xl font-semibold">{reportId ? "Editar report" : "Novo report"}</h1>
        {fromChat ? (
          <p className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />Rascunho preenchido a partir da sua consulta no chat. Revise a consulta, o período, a visualização e a periodicidade — o report só passa a rodar depois que você salvar e ativar.</p>
        ) : null}
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Nome"><Input value={config.name} onChange={(event) => update({ name: event.target.value })} maxLength={120} aria-label="Nome do report" placeholder="Ex.: TOP 3 em Reincidência da equipe" /></Field>
          <Field label="Objetivo" hint="Para que serve este report — a INIA usa isso para orientar a análise."><Textarea value={config.description ?? ""} onChange={(event) => update({ description: event.target.value || null })} maxLength={1000} rows={2} aria-label="Objetivo do report" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Consulta</CardTitle><CardDescription>Que dados entram — a mesma consulta que a INIA faz no chat, refeita com os dados atualizados a cada execução.</CardDescription></CardHeader>
        <CardContent><QueryFields definition={config.definition} onChange={changeDefinition} catalog={catalog} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Visualização</CardTitle><CardDescription>Só aparecem as opções compatíveis com a consulta (ex.: evolução exige várias competências mês a mês). A tabela com os valores exatos fica sempre disponível.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <OptionSelect ariaLabel="Tipo de visualização" value={config.visualization.type} onChange={(type) => update({ visualization: { type, ...(config.visualization.metric ? { metric: config.visualization.metric } : {}) } })} options={compatible.map((type) => ({ value: type, label: VISUALIZATION_LABELS[type] }))} />
          </Field>
          {config.visualization.type === "BAR" && metricOptions.length > 0 ? (
            <Field label="Métrica do gráfico">
              <OptionSelect ariaLabel="Métrica do gráfico" value={config.visualization.metric ?? metricOptions[0]!.key} onChange={(metric) => update({ visualization: { ...config.visualization, metric } })} options={metricOptions.map((column) => ({ value: column.key, label: column.label }))} />
            </Field>
          ) : config.visualization.type === "BAR" ? <p className="self-end text-xs text-muted-foreground">Veja a prévia para escolher a métrica do gráfico.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Periodicidade</CardTitle><CardDescription>Quando o report roda. Cada execução só entrega se as bases tiverem sido atualizadas — senão registra “não encaminhado” e mantém a última entrega válida.</CardDescription></CardHeader>
        <CardContent><ScheduleFields schedule={config.schedule} onChange={(schedule) => update({ schedule })} timeZone={catalog.timeZone} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Destinatários</CardTitle></CardHeader>
        <CardContent><AudienceFields audience={config.audience} onChange={(audience) => update({ audience })} catalog={catalog} canCreateForSelf={catalog.capabilities.canCreateForSelf} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Análise da INIA</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><Switch checked={config.analysis.enabled} onCheckedChange={(enabled) => update({ analysis: { ...config.analysis, enabled } })} />Resumo da INIA em cada entrega (interpreta os números calculados pelo sistema)</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={config.analysis.comparison} onCheckedChange={(comparison) => update({ analysis: { ...config.analysis, comparison } })} />Comparar com o período equivalente anterior (mesma definição e escopo)</label>
        </CardContent>
      </Card>

      {preview ? (
        <Card className={previewStale ? "opacity-60" : undefined}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">Prévia <Badge variant="outline">não é uma entrega</Badge></CardTitle>
              <CardDescription>{preview.structure} · {preview.period}{previewStale ? " · a configuração mudou: atualize a prévia" : ""}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReportVisualization key={`${preview.visualization.type}-${preview.visualization.metricKey ?? ""}-${preview.card.generatedAt}`} data={preview.visualization} card={preview.card} />
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {preview.sources.map((source) => <li key={source.source}>{source.label}: {source.lastUpdatedAt ? `atualizada em ${formatDateTime(source.lastUpdatedAt)}` : "sem data de atualização conhecida"}{source.stale ? " (atrasada)" : ""}</li>)}
              {preview.coverage !== null ? <li>Cobertura no período: {Math.round(preview.coverage * 100)}% das pessoas com dado{preview.coverage < 0.7 ? " — abaixo de 70%: a execução não encaminharia" : ""}.</li> : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={runPreview} disabled={busy !== null}>{busy === "preview" ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}{preview ? "Atualizar prévia" : "Ver prévia"}</Button>
        {reportId ? (
          <Button onClick={() => save(false)} disabled={busy !== null || !config.name.trim()}>Salvar alterações</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy !== null || !config.name.trim()}>Salvar desativado</Button>
            <Button onClick={() => save(true)} disabled={busy !== null || !config.name.trim()}>Salvar e ativar</Button>
          </>
        )}
      </div>
    </div>
  )
}
