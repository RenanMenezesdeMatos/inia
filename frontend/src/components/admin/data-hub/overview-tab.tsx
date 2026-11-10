"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock, Database, DatabaseZap, Inbox, Plus, UserCheck, XCircle, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState } from "@/components/admin/shared/list/list-states"
import { useDataHubOverviewQuery } from "@/queries/admin/use-data-hub-queries"
import { REMOTE_SOURCE_KINDS, SOURCE_KIND_LABELS, type CalendarQuality, type DataMapEntry, type EmploymentStatusFreshness, type Overview } from "@/schemas/admin/data-hub.schema"
import type { WorkScheduleHorizon } from "@/schemas/admin/operational-calendar.schema"
import { formatCivilDate } from "@/lib/format/date"
import { cn } from "@/lib/utils"

import { formatCount, formatRelative, formatTime } from "./data-hub-format"
import { ConnectionHealthBadge, FreshnessBadge, RunStatusBadge, SourceStatusBadge } from "./status-badges"

function KpiCard({ label, value, icon: Icon, tone, hint }: { label: string; value: string; icon: LucideIcon; tone: "ok" | "warn" | "error" | "neutral"; hint: string }) {
  const toneClass = { ok: "text-emerald-600 dark:text-emerald-300", warn: "text-amber-600 dark:text-amber-300", error: "text-red-600 dark:text-red-300", neutral: "text-primary" }[tone]
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2 text-xs">
          <Icon className={cn("size-4", toneClass)} aria-hidden />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  )
}

function DataMapCard({ entry }: { entry: DataMapEntry }) {
  const primary = entry.feeds.find((feed) => feed.authoritative) ?? entry.feeds[0]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{entry.label}</p>
          <p className="truncate text-xs text-muted-foreground">{primary ? `Fonte: ${primary.sourceName} (${SOURCE_KIND_LABELS[primary.sourceKind]})` : "Nenhuma fonte configurada"}</p>
        </div>
        <FreshnessBadge freshness={entry.freshness} lastSuccessAt={primary?.lastSuccessAt ?? null} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Atualizado</dt>
        <dd className="text-right tabular-nums">{formatRelative(primary?.lastSuccessAt ?? null)}</dd>
        <dt className="text-muted-foreground">Último dado</dt>
        <dd className="text-right tabular-nums">{primary?.lastDataAt ? formatRelative(primary.lastDataAt) : "—"}</dd>
        <dt className="text-muted-foreground">Registros na INIA</dt>
        <dd className="text-right tabular-nums">{formatCount(entry.recordCount)}</dd>
        <dt className="text-muted-foreground">Feeds</dt>
        <dd className="text-right tabular-nums">{entry.feeds.length}</dd>
      </dl>
      {entry.relation ? (
        <p className="text-xs text-muted-foreground" data-testid={`data-map-relation-${entry.contractKey}`}>
          {entry.relation.note}
        </p>
      ) : null}
    </div>
  )
}

/**
 * "A situação funcional que a INIA conhece está atualizada?" — derivado dos feeds EMPLOYEES /
 * EMPLOYEE_ABSENCES. Não é saúde de conexão nem um terceiro painel: só mostra quando há feed
 * de situação configurado, e aponta o feed que decidiu o estado.
 */
function EmploymentStatusCard({ freshness, kind = "status", horizon }: { freshness: EmploymentStatusFreshness; kind?: "status" | "schedule"; horizon?: WorkScheduleHorizon }) {
  // Escala: o calendário pode existir sem feed na Central (carga anterior, massa demo) — o horizonte ainda vale.
  const calendarOnly = kind === "schedule" && !freshness.configured && Boolean(horizon?.configured)
  if (!freshness.configured && !calendarOnly) return null
  const copy = kind === "status"
    ? { title: "Situação funcional", testId: "employment-status-card", stale: "Colaboradores sem retorno confirmado ficam como presumidos (não elegíveis com certeza) até a próxima carga — a conexão pode estar saudável e ainda assim a situação estar atrasada." }
    : { title: "Escalas de trabalho", testId: "work-schedule-card", stale: "As folgas depois da última carga são só presumidas: ausência de produção nesses dias não vira feedback negativo — a conexão pode estar saudável e ainda assim a escala estar atrasada." }
  const considered = freshness.feeds.filter((feed) => freshness.consideredFeedIds.includes(feed.feedId))
  const lagging = considered.filter((feed) => feed.freshness === "STALE")
  const stale = freshness.state === "STALE"
  const unknown = freshness.state === "UNKNOWN"
  const tone = stale ? "warn" : unknown ? "neutral" : "ok"
  const toneClass = { ok: "text-emerald-600 dark:text-emerald-300", warn: "text-amber-600 dark:text-amber-300", neutral: "text-muted-foreground" }[tone]
  return (
    <Card className="gap-2 py-4 sm:flex-row sm:items-start sm:gap-6" data-testid={copy.testId} data-state={freshness.state}>
      <CardHeader className="px-4 sm:w-64 sm:shrink-0">
        <CardDescription className="flex items-center gap-2 text-xs">
          {stale ? <AlertTriangle className={cn("size-4", toneClass)} aria-hidden /> : kind === "status" ? <UserCheck className={cn("size-4", toneClass)} aria-hidden /> : <CalendarDays className={cn("size-4", toneClass)} aria-hidden />}
          {copy.title}
        </CardDescription>
        <CardTitle className={cn("text-lg", stale && toneClass)}>{calendarOnly ? "Sem feed na Central" : stale ? "Fonte atrasada" : unknown ? "Nunca recebida" : "Atualizada"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-4 text-xs text-muted-foreground sm:pt-1">
        {calendarOnly ? (
          <p>Há calendário de escala no banco, mas nenhum feed de Escalas de trabalho ativo na Central — a atualidade não pode ser avaliada; o horizonte abaixo vale.</p>
        ) : (
          <>
            <p>
              Última carga {formatRelative(freshness.lastSuccessAt)}
              {considered.length > 0 ? ` · cadência ${considered.map((feed) => feed.cadenceLabel).filter((label, index, all) => all.indexOf(label) === index).join(" / ")}` : ""}
            </p>
            {stale ? (
              <p>
                {lagging.map((feed) => `${feed.sourceName} › ${feed.feedName}`).join(", ")} fora da cadência. {copy.stale}
              </p>
            ) : (
              <p>{considered.map((feed) => `${feed.sourceName} › ${feed.feedName}`).join(", ")} dentro da cadência.</p>
            )}
          </>
        )}
        {kind === "schedule" && horizon ? <ScheduleHorizonLine horizon={horizon} /> : null}
      </CardContent>
    </Card>
  )
}

/**
 * HORIZONTE do calendário ≠ freshness ≠ conexão: a carga pode ter chegado há 10 minutos e o
 * calendário terminar amanhã. "Calendário disponível: de → até" + aviso quando resta ≤ N dias.
 */
function ScheduleHorizonLine({ horizon }: { horizon: WorkScheduleHorizon }) {
  if (!horizon.configured || !horizon.coverageUntil) return <p data-testid="schedule-horizon">Calendário disponível: nenhum dia conhecido.</p>
  const remaining = horizon.daysRemaining ?? 0
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="schedule-horizon" data-ending-soon={horizon.endingSoon}>
      <span>
        Calendário disponível: {horizon.coverageFrom ? formatCivilDate(horizon.coverageFrom) : "—"} → {formatCivilDate(horizon.coverageUntil)}
        {` · ${formatCount(horizon.peopleWithCalendarAhead)} colaborador(es) com escala à frente`}
      </span>
      {horizon.endingSoon ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="schedule-horizon-warning">
          <AlertTriangle className="size-3" aria-hidden /> {remaining <= 0 ? "Calendário já terminou" : remaining === 1 ? "Calendário termina amanhã" : `Calendário termina em ${remaining} dias`} (limite de aviso: {horizon.warningDays} dias)
        </span>
      ) : null}
    </p>
  )
}

/** Qualidade de dado do calendário operacional: capital preenchida, 6x1 com/sem calendário, exceções à frente. */
function CalendarQualityLine({ quality, horizon }: { quality: CalendarQuality; horizon?: WorkScheduleHorizon }) {
  const capitalMissing = quality.operationalCapital.total - quality.operationalCapital.filled
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground" data-testid="calendar-quality">
      <span>
        Capital operacional preenchida: <strong className="text-foreground">{formatCount(quality.operationalCapital.filled)} de {formatCount(quality.operationalCapital.total)}</strong>
        {capitalMissing > 0 ? " (sem capital, só feriados nacionais são conhecidos)" : ""}
      </span>
      {quality.sixByOne.total > 0 ? (
        <span>
          6x1 com calendário válido: <strong className="text-foreground">{formatCount(quality.sixByOne.withCalendar)} de {formatCount(quality.sixByOne.total)}</strong>
          {quality.sixByOne.withoutCalendar > 0 ? ` · ${formatCount(quality.sixByOne.withoutCalendar)} sem calendário (escala desconhecida — a INIA não presume a folga)` : ""}
        </span>
      ) : null}
      {quality.activeExceptionsAhead > 0 ? <span>Exceções de calendário à frente: <strong className="text-foreground">{formatCount(quality.activeExceptionsAhead)}</strong></span> : null}
      {quality.exceptionsByOrigin ? (
        <span data-testid="calendar-quality-origins">
          Exceções: <strong className="text-foreground">{formatCount(quality.exceptionsByOrigin.central)} da Central · {formatCount(quality.exceptionsByOrigin.supervisor)} do Supervisor</strong>
          {quality.exceptionsByOrigin.conflicts + quality.exceptionsByOrigin.conflictWarnings30d > 0 ? ` · ${formatCount(quality.exceptionsByOrigin.conflicts + quality.exceptionsByOrigin.conflictWarnings30d)} conflito(s) auditável(is)` : ""}
        </span>
      ) : null}
      {quality.reconciliation ? (
        <span data-testid="calendar-quality-reconciliation">
          {quality.reconciliation.evidenceSources.enabled ? (
            <>
              Produção não identificada ({quality.reconciliation.windowDays} dias): <strong className="text-foreground">{formatCount(quality.reconciliation.openMissingProduction)} pendência(s)</strong>
              {quality.reconciliation.divergences > 0 ? ` · ${formatCount(quality.reconciliation.divergences)} divergência(s) plano × realidade` : ""}
              {quality.reconciliation.statusInconsistencies > 0 ? ` · ${formatCount(quality.reconciliation.statusInconsistencies)} produção com situação não produtiva` : ""}
            </>
          ) : (
            "Sem fonte de evidência de produção configurada — ausência de produção não gera pendência."
          )}
        </span>
      ) : null}
      {quality.dataAvailability ? (
        <span data-testid="calendar-quality-availability">
          Disponibilidade esperada (SLA): <strong className="text-foreground">{formatCount(quality.dataAvailability.withinSla)} fonte(s) dentro do prazo</strong>
          {quality.dataAvailability.delayed > 0 ? ` · ${formatCount(quality.dataAvailability.delayed)} atrasada(s) — dado de D-N ainda não recebido` : ""}
          {quality.dataAvailability.unknownPolicy > 0 ? ` · ${formatCount(quality.dataAvailability.unknownPolicy)} sem SLA (nenhuma ausência é concluída)` : ""}
          {quality.dataAvailability.daysWaitingForData > 0 ? ` · ${formatCount(quality.dataAvailability.daysWaitingForData)} dia(s) aguardando dados` : ""}
        </span>
      ) : null}
      {quality.classifications ? (
        <span data-testid="calendar-quality-classifications">
          Classificações (30 dias): <strong className="text-foreground">{formatCount(quality.classifications.unjustifiedAbsences)} falta(s) injustificada(s)</strong> · {formatCount(quality.classifications.revised)} revisada(s) · {formatCount(quality.classifications.lateDataAutoResolved)} resolvida(s) por dado tardio
        </span>
      ) : null}
      {quality.holidayCatalog ? (
        <span data-testid="calendar-quality-holidays">
          Catálogo de feriados: <strong className="text-foreground">{formatCount(quality.holidayCatalog.totalRows)} datas</strong> · {formatCount(quality.holidayCatalog.pendingVerifications)} pendência(s) de verificação (não é 100% completo)
        </span>
      ) : null}
      {horizon && !horizon.configured ? <span>Escalas de trabalho: nenhum calendário recebido (todos no fallback seg–sex ou escala desconhecida).</span> : null}
    </p>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

export function OverviewTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const query = useDataHubOverviewQuery()
  if (query.isLoading) return <OverviewSkeleton />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a visão geral da Central de Dados." onRetry={() => query.refetch()} />
  const overview: Overview = query.data
  const { cards } = overview
  const healthy = cards.sourcesWithError === 0 && cards.staleFeeds === 0

  if (overview.sources.length === 0) {
    return (
      <div className="space-y-4">
        <ListEmptyState
          icon={Database}
          title="Conecte sua primeira fonte"
          description="A Central de Dados é a porta única de entrada dos dados do cliente: colaboradores, estrutura, medições, fechamentos, interações e flags entram por aqui, por contratos genéricos — sem uma integração por indicador."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/admin/data-hub/sources/new?kind=DATABASE">
                  <DatabaseZap /> Conectar banco de dados
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/data-hub/sources/new">
                  <Plus /> Nova fonte
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/data-hub/import">Importar um arquivo</Link>
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className={cn("flex items-center gap-2 rounded-xl border px-4 py-3 text-sm", healthy ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200")} role="status">
        {healthy ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
        <span>
          {healthy
            ? "Tudo funcionando: nenhuma fonte com erro e nenhum feed atrasado."
            : `${cards.sourcesWithError ? `${cards.sourcesWithError} fonte(s) com erro` : ""}${cards.sourcesWithError && cards.staleFeeds ? " · " : ""}${cards.staleFeeds ? `${cards.staleFeeds} feed(s) atrasado(s)` : ""}. Veja Fontes e Qualidade dos dados.`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Fontes ativas" value={formatCount(cards.activeSources)} icon={Database} tone="neutral" hint={`${overview.sources.length} fonte(s) no total`} />
        <KpiCard label="Fontes com erro" value={formatCount(cards.sourcesWithError)} icon={XCircle} tone={cards.sourcesWithError ? "error" : "ok"} hint="Credencial recusada ou fonte inalcançável" />
        <KpiCard label="Dados recebidos hoje" value={formatCount(cards.receivedToday)} icon={Inbox} tone="neutral" hint={`${cards.runsToday} carga(s) hoje${cards.queuedRuns ? ` · ${cards.queuedRuns} na fila` : ""}`} />
        <KpiCard label="Registros rejeitados" value={formatCount(cards.rejectedToday)} icon={AlertTriangle} tone={cards.rejectedToday ? "warn" : "ok"} hint={`Hoje, em quarentena (rastreáveis por carga)${cards.warningsToday ? ` · ${formatCount(cards.warningsToday)} aviso(s) não bloqueante(s)` : ""}`} />
        <KpiCard label="Dados atrasados" value={formatCount(cards.staleFeeds)} icon={Clock} tone={cards.staleFeeds ? "warn" : "ok"} hint="Feeds ativos fora da cadência esperada" />
      </div>

      <EmploymentStatusCard freshness={overview.employmentStatus} />
      {overview.workSchedule ? <EmploymentStatusCard freshness={overview.workSchedule} kind="schedule" horizon={overview.workScheduleHorizon} /> : null}
      {overview.calendarQuality ? <CalendarQualityLine quality={overview.calendarQuality} horizon={overview.workScheduleHorizon} /> : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Dados da INIA</CardTitle>
              <CardDescription>Cada conjunto de dados que a INIA entende, por onde ele entra e quão atualizado está. Um indicador novo não exige uma integração nova.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenTab("contracts")}>
              Contratos <ArrowRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {overview.dataMap.map((entry) => (
              <DataMapCard key={entry.contractKey} entry={entry} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Fontes</CardTitle>
                <CardDescription>Status administrativo, saúde da conexão e atualidade — três coisas diferentes.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onOpenTab("sources")}>
                Ver todas <ArrowRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.sources.map((source) => (
              <Link key={source.id} href={`/admin/data-hub/sources/${source.id}`} className="flex flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {SOURCE_KIND_LABELS[source.kind]} · {source.feedCount} feed(s) · último sucesso {formatRelative(source.lastSuccessAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <SourceStatusBadge status={source.status} />
                  {REMOTE_SOURCE_KINDS.includes(source.kind) ? <ConnectionHealthBadge health={source.connectionHealth} error={source.connectionError} checkedAt={source.connectionCheckedAt} /> : null}
                  <FreshnessBadge freshness={source.feedCount ? source.freshness : null} lastSuccessAt={source.lastSuccessAt} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Últimas cargas</CardTitle>
                <CardDescription>O que aconteceu recentemente.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onOpenTab("runs")}>
                Histórico <ArrowRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {overview.recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma carga ainda.</p>
            ) : (
              <div className={TABLE_FRAME}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hora</TableHead>
                      <TableHead>Feed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Rec.</TableHead>
                      <TableHead className="text-right">Rej.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.recentRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="tabular-nums">
                          <Link href={`/admin/data-hub/runs/${run.id}`} className="hover:underline">
                            {formatTime(run.finishedAt ?? run.startedAt)}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-sm">{run.feedName}</TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCount(run.recordsReceived)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCount(run.recordsRejected)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
