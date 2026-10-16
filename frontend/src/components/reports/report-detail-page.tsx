"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Play, Trash2 } from "lucide-react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { reportKeys, useReceivedDeliveriesQuery, useReportQuery } from "@/queries/reports/use-reports"
import type { ReportRun } from "@/schemas/reports/reports.schema"
import { deleteReport, runReportNow, setReportStatus } from "@/services/reports/reports-service"
import { BLOCKED_REASON_LABELS, DENIED_REASON_LABELS, LEVEL_LABELS, NOT_FORWARDED_TEXT, RUN_STATUS_LABELS, TOOL_LABELS, VISUALIZATION_LABELS } from "./report-labels"

function runOutcome(run: ReportRun): string {
  const outcome = run.outcome ?? {}
  const parts: string[] = []
  if (typeof outcome.delivered === "number" && outcome.delivered > 0) parts.push(`${outcome.delivered} pessoa(s) receberam`)
  const notForwarded = Array.isArray(outcome.notForwarded) ? (outcome.notForwarded as { reason: string; structure: string }[]) : []
  for (const item of notForwarded.slice(0, 3)) parts.push(`${item.structure}: ${NOT_FORWARDED_TEXT[item.reason]?.replace("Report não encaminhado: ", "") ?? item.reason}`)
  if (typeof outcome.deniedCount === "number" && outcome.deniedCount > 0) {
    const denied = (outcome.denied as { name: string; reason: string }[] | undefined) ?? []
    parts.push(`${outcome.deniedCount} sem acesso (${denied.slice(0, 3).map((item) => `${item.name}: ${DENIED_REASON_LABELS[item.reason] ?? item.reason}`).join("; ")}${outcome.deniedCount > 3 ? "…" : ""})`)
  }
  const failed = Array.isArray(outcome.failed) ? (outcome.failed as { message: string }[]) : []
  if (failed.length > 0) parts.push(`Consulta inválida: ${failed[0]!.message}`)
  if (typeof outcome.reason === "string" && BLOCKED_REASON_LABELS[outcome.reason]) parts.push(BLOCKED_REASON_LABELS[outcome.reason]!)
  if (run.errorMessage) parts.push(`Erro: ${run.errorMessage}`)
  return parts.join(" · ") || "—"
}

export function ReportDetailPage({ reportId }: { reportId: string }) {
  const router = useRouter()
  const client = useQueryClient()
  const query = useReportQuery(reportId)
  const received = useReceivedDeliveriesQuery(reportId)
  const [message, setMessage] = useState<string | null>(null)
  if (query.isLoading) return <div className="mx-auto max-w-4xl space-y-3 px-4 py-6"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-48 w-full" /></div>
  if (query.isError || !query.data) return <p className="px-4 py-6 text-sm text-destructive">Report não encontrado.</p>
  const { report, runs } = query.data
  const refresh = () => client.invalidateQueries({ queryKey: reportKeys.all })
  const act = async (action: () => Promise<unknown>, success?: string) => {
    setMessage(null)
    try {
      await action()
      if (success) setMessage(success)
      await refresh()
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Não foi possível concluir.")
    }
  }
  const audience = report.config.audience
  const lastValid = (received.data ?? []).find((item) => item.kind === "DELIVERY")

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-2">
        <Link href="/reports" className="text-xs text-muted-foreground hover:underline">← Reports</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{report.name}</h1>
          <Badge variant={report.status === "ACTIVE" ? "default" : "secondary"}>{report.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>
          <Badge variant="outline">Versão {report.configVersion}</Badge>
        </div>
        {report.description ? <p className="text-sm text-muted-foreground">{report.description}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={report.status === "ACTIVE"} onCheckedChange={() => act(() => setReportStatus(report.id, { revision: report.revision, status: report.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }))} aria-label="Ativar ou desativar" />
            {report.status === "ACTIVE" ? "Ativo" : "Inativo"}
          </label>
          <Button asChild variant="outline" size="sm"><Link href={`/reports/${report.id}/editar`}>Editar</Link></Button>
          <Button variant="outline" size="sm" onClick={() => act(() => runReportNow(report.id), "Execução colocada na fila — o resultado aparece no histórico em instantes.")}><Play aria-hidden />Executar agora</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" size="sm"><Trash2 aria-hidden />Excluir</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir este report?</AlertDialogTitle>
                <AlertDialogDescription>As próximas execuções são canceladas. Entregas já feitas continuam no histórico de quem recebeu, para auditoria.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => act(async () => { await deleteReport(report.id); router.push("/reports") })}>Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Configuração</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Consulta</dt><dd>{TOOL_LABELS[report.tool]}{report.config.definition.indicators.length > 0 ? ` — ${report.config.definition.indicators.join(", ")}` : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Estrutura</dt><dd>{report.structure}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Período analisado</dt><dd>{report.period}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Visualização</dt><dd>{VISUALIZATION_LABELS[report.visualization]}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Periodicidade</dt><dd>{report.schedule}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Próximas execuções</dt><dd>{report.upcomingRuns.length > 0 ? report.upcomingRuns.map(formatDateTime).join(" · ") : "Nenhuma (report inativo)"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Destinatários</dt><dd>{audience.mode === "SELF" ? "Você" : [audience.everyone ? "Todos do escopo" : null, ...audience.levels.map((level) => LEVEL_LABELS[level]), ...audience.jobTitles, audience.teamIds.length ? `${audience.teamIds.length} Grupo(s)` : null, audience.subteamIds.length ? `${audience.subteamIds.length} Subgrupo(s)` : null, audience.personIds.length ? `${audience.personIds.length} pessoa(s)` : null].filter(Boolean).join(", ")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Análise da INIA</dt><dd>{report.config.analysis.enabled ? `Ligada${report.config.analysis.comparison ? ", com comparação" : ""}` : "Desligada"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Última entrega válida</dt><dd>{report.lastValidDeliveryAt ? formatDateTime(report.lastValidDeliveryAt) : "Ainda não houve"}{lastValid ? <> · <Link href={`/reports/entregas/${lastValid.id}`} className="text-primary hover:underline">abrir</Link></> : null}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico de execuções</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horário</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(run.scheduledFor)}{run.triggerKind === "MANUAL" ? " · manual" : ""}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{RUN_STATUS_LABELS[run.status] ?? run.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{runOutcome(run)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
