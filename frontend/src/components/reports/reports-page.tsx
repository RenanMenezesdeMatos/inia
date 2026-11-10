"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CalendarClock, FileBarChart2, Plus, Trash2 } from "lucide-react"

import { ListBooleanFilter, ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/format/date"
import { reportKeys, useReceivedDeliveriesQuery, useReportsQuery } from "@/queries/reports/use-reports"
import type { ReportSummary } from "@/schemas/reports/reports.schema"
import { deleteReport, setReportStatus } from "@/services/reports/reports-service"
import { DeletedReportsList } from "./deleted-reports-list"
import { NOT_FORWARDED_TEXT, RUN_STATUS_LABELS } from "./report-labels"
import { PageHeader } from "@/components/ui/surface"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"

const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()

/** Tela de Reports: os que a pessoa criou (gestão), os que ela recebeu (entregas e avisos) e os que ela excluiu, que voltam daqui. */
export function ReportsPage() {
  const query = useReportsQuery()
  const received = useReceivedDeliveriesQuery()
  const client = useQueryClient()
  const [search, setSearch] = useState("")
  const [active, setActive] = useState<boolean | undefined>(undefined)
  const statusMutation = useMutation({
    mutationFn: (report: ReportSummary) => setReportStatus(report.id, { revision: report.revision, status: report.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSettled: () => client.invalidateQueries({ queryKey: reportKeys.all }),
  })
  const deleteMutation = useMutation({ mutationFn: (id: string) => deleteReport(id), onSettled: () => client.invalidateQueries({ queryKey: reportKeys.all }) })
  const items = useMemo(() => {
    const term = normalizeSearch(search)
    return (query.data?.items ?? []).filter((item) => (active === undefined || (item.status === "ACTIVE") === active) && (!term || normalizeSearch(`${item.name} ${item.description ?? ""} ${item.structure}`).includes(term)))
  }, [query.data, search, active])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <PageHeader
        icon={FileBarChart2}
        title="Reports"
        description="Consultas que rodam sozinhas, com os dados atualizados, e chegam ao seu Acompanhamento com gráfico e análise da INIA."
        aside={
          <Button asChild>
            <Link href="/reports/novo"><Plus aria-hidden />Novo report</Link>
          </Button>
        }
      />
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">Meus reports</TabsTrigger>
          <TabsTrigger value="received">Recebidos</TabsTrigger>
          <TabsTrigger value="deleted">Excluídos</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="space-y-3">
          <ListToolbar
            search={<ListSearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, objetivo ou estrutura" ariaLabel="Buscar reports" />}
            hasActiveFilters={active !== undefined || search !== ""}
            onClearFilters={() => {
              setSearch("")
              setActive(undefined)
            }}
          >
            <ListBooleanFilter value={active} onChange={setActive} allLabel="Todos" trueLabel="Ativos" falseLabel="Inativos" ariaLabel="Situação do report" />
          </ListToolbar>
          {query.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-24 w-full" />)}</div>
          ) : query.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os reports.</p>
          ) : items.length === 0 ? (
            (query.data?.items.length ?? 0) === 0 ? (
              <AnalyticsEmptyState icon={FileBarChart2} title="Você ainda não tem reports" description="Crie um aqui ou peça à INIA no chat e aceite a oferta de transformar a consulta em report." />
            ) : (
              <AnalyticsEmptyState icon={FileBarChart2} title="Nenhum report com esses filtros" />
            )
          ) : (
            <ul className="space-y-2">
              {items.map((report) => (
                <li key={report.id}>
                  <Card>
                    <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/reports/${report.id}`} className="font-medium hover:underline">{report.name}</Link>
                          <Badge variant={report.status === "ACTIVE" ? "default" : "secondary"}>{report.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>
                          {report.audienceMode === "DISTRIBUTION" ? <Badge variant="outline">Distribuído</Badge> : null}
                          {report.origin === "CHAT" ? <Badge variant="outline">Criado no chat</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{report.structure} · {report.period}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="size-3" aria-hidden />{report.schedule}</p>
                        <p className="text-xs text-muted-foreground">
                          {report.nextRunAt ? `Próxima execução: ${formatDateTime(report.nextRunAt)}` : "Sem próxima execução"}
                          {report.lastRunAt ? ` · Última: ${formatDateTime(report.lastRunAt)} (${RUN_STATUS_LABELS[report.lastRunStatus ?? ""] ?? report.lastRunStatus})` : ""}
                          {report.lastValidDeliveryAt ? ` · Última entrega válida: ${formatDateTime(report.lastValidDeliveryAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch checked={report.status === "ACTIVE"} disabled={statusMutation.isPending} onCheckedChange={() => statusMutation.mutate(report)} aria-label={report.status === "ACTIVE" ? "Desativar report" : "Ativar report"} />
                          {report.status === "ACTIVE" ? "Ativo" : "Inativo"}
                        </label>
                        <Button asChild variant="outline" size="sm"><Link href={`/reports/${report.id}/editar`}>Editar</Link></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label={`Excluir ${report.name}`}><Trash2 aria-hidden /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir o report “{report.name}”?</AlertDialogTitle>
                              <AlertDialogDescription>As próximas execuções são canceladas. As entregas já feitas continuam no histórico de quem recebeu. Dá para restaurar na aba Excluídos.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(report.id)}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="deleted">
          <DeletedReportsList />
        </TabsContent>
        <TabsContent value="received" className="space-y-2">
          {received.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (received.data ?? []).length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma entrega recebida ainda.</CardContent></Card>
          ) : (
            <ul className="space-y-2">
              {(received.data ?? []).map((delivery) => (
                <li key={delivery.id}>
                  <Link href={`/reports/entregas/${delivery.id}`} className="block rounded-lg border px-4 py-3 hover:bg-muted/40">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{delivery.reportName}</span>
                      {delivery.kind === "DELIVERY" ? <Badge>{delivery.empty ? "Entregue (vazio)" : "Entregue"}</Badge> : <Badge variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300"><AlertTriangle className="size-3" aria-hidden />Não encaminhado</Badge>}
                      {!delivery.readAt ? <Badge variant="secondary">Novo</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{[delivery.structureLabel, delivery.periodLabel].filter(Boolean).join(" · ")} · {formatDateTime(delivery.createdAt)}</p>
                    {delivery.kind === "NOT_FORWARDED" ? <p className="text-xs text-amber-800 dark:text-amber-300">{NOT_FORWARDED_TEXT[delivery.reason ?? ""]}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
