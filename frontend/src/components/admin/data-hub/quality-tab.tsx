"use client"

import Link from "next/link"
import { AlertTriangle, CalendarDays, Clock, Info, ShieldAlert, TableProperties } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { useDataHubQualityQuery } from "@/queries/admin/use-data-hub-queries"

import { formatCivilDate } from "@/lib/format/date"
import type { CalendarQuality, HolidayCatalogCoverage } from "@/schemas/admin/data-hub.schema"

import { formatCount, formatDateTime, formatPercent, formatRelative } from "./data-hub-format"

/** Catálogo de feriados: cobertura VERIFICADA por ano + pendências de verificação — nunca "100% completo". */
/**
 * FRESHNESS ≠ DISPONIBILIDADE: por fonte relevante (evidência de produção e situação funcional), o SLA
 * configurado (D-1 até 11:00), o dia de referência mais recente que já deveria estar disponível e se ele
 * chegou. "Dado de D-1 ainda não recebido" é problema de fonte — nunca "colaborador sem produção".
 */
export function DataAvailabilityItem({ availability }: { availability: NonNullable<CalendarQuality["dataAvailability"]> }) {
  return (
    <li className="rounded-lg border border-border p-3 sm:col-span-3" data-testid="quality-data-availability">
      <p className="text-xs text-muted-foreground">Disponibilidade esperada dos dados (SLA D-1/D-2) — distinta da atualidade do feed</p>
      <p className="font-medium">
        {formatCount(availability.withinSla)} fonte(s) dentro do SLA · {formatCount(availability.delayed)} atrasada(s) · {formatCount(availability.unknownPolicy)} sem SLA configurado
      </p>
      <p className="text-xs text-muted-foreground">
        Últimos 7 dias: {formatCount(availability.daysReady)} dia(s) com dados fechados · {formatCount(availability.daysWaitingForData)} aguardando dados · {formatCount(availability.daysWithSourceDelay)} com fonte atrasada. Antes do prazo ninguém é cobrado; fonte atrasada gera alerta administrativo, não pendência por pessoa.
      </p>
      {availability.sources.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {availability.sources.map((source) => (
            <li key={source.key} className="flex flex-wrap items-center gap-x-2" data-testid="quality-availability-source" data-state={source.state}>
              <span className="font-medium">{source.label}</span>
              <span className="text-muted-foreground">· {source.groupLabel}</span>
              <span className="text-muted-foreground">· Última carga: {source.lastSuccessAt ? formatDateTime(source.lastSuccessAt) : "nunca"}</span>
              <span className="text-muted-foreground">· Dados esperados: {source.policyLabel}</span>
              <span className={source.state === "DELAYED" ? "text-amber-700 dark:text-amber-300" : source.state === "UNKNOWN" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>
                · Estado: {source.state === "READY" ? `dentro do prazo (${source.referenceDate ? formatCivilDate(source.referenceDate) : "—"} recebido)` : source.state === "WAITING" ? "dentro do prazo" : source.state === "DELAYED" ? `dado de ${source.referenceDate ? formatCivilDate(source.referenceDate) : "D-N"} ainda não recebido` : "SLA não configurado — nenhuma ausência é concluída"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Nenhuma fonte relevante (medições, interações, colaboradores) configurada na Central.</p>
      )}
    </li>
  )
}

export function HolidayCatalogCoverageItem({ coverage }: { coverage: HolidayCatalogCoverage }) {
  return (
    <li className="rounded-lg border border-border p-3 sm:col-span-3" data-testid="quality-holiday-catalog">
      <p className="text-xs text-muted-foreground">Catálogo de feriados (reference data)</p>
      <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-3">
        {coverage.years.map((year) => (
          <li key={year.year}>
            <span className="font-medium">{year.year}</span>: {year.national} nacionais · estadual em {year.capitalsWithStateHoliday}/27 capitais · municipal em {year.capitalsWithMunicipalHoliday}/27
            <span className="block text-xs text-muted-foreground">
              Verificação: {year.byVerification.OFFICIAL} oficial · {year.byVerification.LEGAL_DATABASE} base legal · {year.byVerification.SECONDARY} secundária{year.unverifiedRows > 0 ? ` · ${year.unverifiedRows} sem registro` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        Pendências de verificação: {coverage.pendingVerifications} — {coverage.gaps.length} lacuna(s) registrada(s)
        {coverage.capitalsWithoutMunicipalHoliday.length > 0 ? ` · capitais sem feriado municipal no catálogo: ${coverage.capitalsWithoutMunicipalHoliday.join(", ")}` : ""}. Ponto facultativo nunca entra como feriado. Detalhe em Administração › Calendário operacional.
      </p>
    </li>
  )
}

export function QualityTab() {
  const query = useDataHubQualityQuery()
  if (query.isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2" aria-hidden>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-56 rounded-xl" />
        ))}
      </div>
    )
  }
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a qualidade dos dados." onRetry={() => query.refetch()} />
  const quality = query.data
  const nothing = quality.topErrors.length === 0 && quality.topWarnings.length === 0 && quality.staleFeeds.length === 0 && quality.schemaChanges.length === 0

  return (
    <div className="space-y-4">
      {nothing ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" role="status">
          Nenhuma rejeição nos últimos 7 dias, nenhum aviso, nenhum feed atrasado e nenhuma mudança de esquema detectada.
        </div>
      ) : (
        <div className="flex flex-wrap gap-3 text-sm" data-testid="quality-totals">
          <span className="rounded-full border border-border px-3 py-1">
            <span className="font-medium">{formatCount(quality.totals.errors)}</span> erro(s) — registros rejeitados
          </span>
          <span className="rounded-full border border-border px-3 py-1">
            <span className="font-medium">{formatCount(quality.totals.warnings)}</span> aviso(s) — registros aplicados com ressalva
          </span>
        </div>
      )}
      {quality.calendar ? (
        <Card data-testid="calendar-quality-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden /> Calendário operacional
            </CardTitle>
            <CardDescription>Capital operacional (jurisdição de feriados), 6x1 com calendário conhecido e horizonte da escala — horizonte não é freshness: a carga pode ser recente e o calendário terminar amanhã.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm sm:grid-cols-3">
              <li className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Capital operacional preenchida</p>
                <p className="font-medium">
                  {formatCount(quality.calendar.operationalCapital.filled)} de {formatCount(quality.calendar.operationalCapital.total)}
                </p>
                {quality.calendar.operationalCapital.filled < quality.calendar.operationalCapital.total ? <p className="text-xs text-muted-foreground">Sem capital, feriados estaduais/municipais não são determinados (só nacionais e datas da organização).</p> : null}
              </li>
              <li className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">6x1 com calendário válido</p>
                <p className="font-medium">
                  {formatCount(quality.calendar.sixByOne.withCalendar)} de {formatCount(quality.calendar.sixByOne.total)}
                </p>
                {quality.calendar.sixByOne.withoutCalendar > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">{formatCount(quality.calendar.sixByOne.withoutCalendar)} com calendário incompleto: escala desconhecida — a INIA não presume a folga.</p> : null}
              </li>
              <li className="rounded-lg border border-border p-3" data-testid="quality-schedule-horizon" data-ending-soon={quality.calendar.horizon.endingSoon}>
                <p className="text-xs text-muted-foreground">Horizonte da escala</p>
                <p className="font-medium">{quality.calendar.horizon.coverageUntil ? `conhecida até ${formatCivilDate(quality.calendar.horizon.coverageUntil)}` : "nenhum calendário recebido"}</p>
                {quality.calendar.horizon.endingSoon ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    ⚠ {quality.calendar.horizon.daysRemaining !== null && quality.calendar.horizon.daysRemaining <= 0 ? "calendário já terminou" : `calendário termina em ${quality.calendar.horizon.daysRemaining} dia(s)`} (limite: {quality.calendar.horizon.warningDays} dias) — alerta administrativo enviado aos administradores.
                  </p>
                ) : null}
              </li>
              {quality.calendar.exceptionsByOrigin ? (
                <li className="rounded-lg border border-border p-3" data-testid="quality-exceptions-origin">
                  <p className="text-xs text-muted-foreground">Exceções de calendário (30 dias + futuro)</p>
                  <p className="font-medium">
                    {formatCount(quality.calendar.exceptionsByOrigin.central)} da Central · {formatCount(quality.calendar.exceptionsByOrigin.supervisor)} do Supervisor
                  </p>
                  {quality.calendar.exceptionsByOrigin.conflicts > 0 || quality.calendar.exceptionsByOrigin.conflictWarnings30d > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {formatCount(quality.calendar.exceptionsByOrigin.conflicts)} alterada(s) pelo Supervisor sobre dado da Central · {formatCount(quality.calendar.exceptionsByOrigin.conflictWarnings30d)} aviso(s) de conflito nas cargas — nada sobrescrito em silêncio.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem conflito entre Central e Supervisor.</p>
                  )}
                </li>
              ) : null}
              {quality.calendar.reconciliation ? (
                <li className="rounded-lg border border-border p-3" data-testid="quality-reconciliation">
                  <p className="text-xs text-muted-foreground">Planejado × observado ({quality.calendar.reconciliation.windowDays} dias)</p>
                  {quality.calendar.reconciliation.evidenceSources.enabled ? (
                    <>
                      <p className="font-medium">
                        {formatCount(quality.calendar.reconciliation.openMissingProduction)} pendência(s) de produção aberta(s) · {formatCount(quality.calendar.reconciliation.resolvedMissingProduction)} resolvida(s)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCount(quality.calendar.reconciliation.divergences)} divergência(s) plano × realidade · {formatCount(quality.calendar.reconciliation.statusInconsistencies)} produção com situação não produtiva. Evidência: {[quality.calendar.reconciliation.evidenceSources.interactions ? "interações" : null, ...quality.calendar.reconciliation.evidenceSources.indicatorCodes].filter(Boolean).join(", ")}.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">Sem fonte de evidência de produção (nenhuma interação nem indicador marcado como evidência): a ausência de produção não gera pendência.</p>
                  )}
                </li>
              ) : null}
              {quality.calendar.dataAvailability ? <DataAvailabilityItem availability={quality.calendar.dataAvailability} /> : null}
              {quality.calendar.classifications ? (
                <li className="rounded-lg border border-border p-3" data-testid="quality-classifications">
                  <p className="text-xs text-muted-foreground">Classificações operacionais ({quality.calendar.classifications.windowDays} dias)</p>
                  <p className="font-medium">
                    {formatCount(quality.calendar.classifications.awaitingClassification)} dia(s) aguardando classificação · {formatCount(quality.calendar.classifications.unjustifiedAbsences)} falta(s) injustificada(s) confirmada(s)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCount(quality.calendar.classifications.justifiedAbsences)} ausência(s) justificada(s) · {formatCount(quality.calendar.classifications.workedDataMissing)} trabalhou sem dados · {formatCount(quality.calendar.classifications.revised)} revisada(s) pelo Supervisor · {formatCount(quality.calendar.classifications.contradictedByEvidence)} contrariada(s) por dado tardio · {formatCount(quality.calendar.classifications.supersededByStatus)} superada(s) por RH · {formatCount(quality.calendar.classifications.lateDataAutoResolved)} pendência(s) auto-resolvida(s) por dado tardio.
                  </p>
                </li>
              ) : null}
              {quality.calendar.holidayCatalog ? <HolidayCatalogCoverageItem coverage={quality.calendar.holidayCatalog} /> : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> Top erros (7 dias)
            </CardTitle>
            <CardDescription>Códigos estáveis agrupados — o que mais está indo para a quarentena.</CardDescription>
          </CardHeader>
          <CardContent>
            {quality.topErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum registro rejeitado.</p>
            ) : (
              <ul className="space-y-2">
                {quality.topErrors.map((entry) => (
                  <li key={entry.code} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{entry.code}</p>
                      <p className="truncate text-xs text-muted-foreground">{entry.label}</p>
                    </div>
                    <span className="shrink-0 tabular-nums">{formatCount(entry.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-4 text-sky-600 dark:text-sky-300" aria-hidden /> Avisos (7 dias)
            </CardTitle>
            <CardDescription>Registros aplicados com ressalva — não são erros nem rejeições (ex.: conflito de situação funcional decidido pela precedência).</CardDescription>
          </CardHeader>
          <CardContent>
            {quality.topWarnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum aviso.</p>
            ) : (
              <ul className="space-y-2" data-testid="quality-warnings">
                {quality.topWarnings.map((entry) => (
                  <li key={entry.code} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{entry.code}</p>
                      <p className="truncate text-xs text-muted-foreground">{entry.label}</p>
                    </div>
                    <span className="shrink-0 tabular-nums">{formatCount(entry.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> Feeds com rejeição
            </CardTitle>
            <CardDescription>Taxa de rejeição por feed nos últimos 7 dias.</CardDescription>
          </CardHeader>
          <CardContent>
            {quality.feedsWithRejections.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum feed com rejeições.</p>
            ) : (
              <ul className="space-y-2">
                {quality.feedsWithRejections.map((entry) => (
                  <li key={entry.feedId} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/data-hub/feeds/${entry.feedId}`} className="truncate font-medium hover:underline">
                        {entry.feedName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{entry.sourceName}</p>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {formatCount(entry.rejected)} / {formatCount(entry.received)} ({formatPercent(entry.rate)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> Dados atrasados
            </CardTitle>
            <CardDescription>Feeds ativos cuja última carga bem-sucedida passou de 2× a cadência esperada.</CardDescription>
          </CardHeader>
          <CardContent>
            {quality.staleFeeds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum feed atrasado.</p>
            ) : (
              <ul className="space-y-2">
                {quality.staleFeeds.map((entry) => (
                  <li key={entry.feedId} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/data-hub/feeds/${entry.feedId}`} className="truncate font-medium hover:underline">
                        {entry.feedName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{entry.sourceName}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      último sucesso {formatRelative(entry.lastSuccessAt)}
                      {` · esperado: ${entry.cadenceLabel.toLowerCase()}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TableProperties className="size-4 text-red-600 dark:text-red-300" aria-hidden /> Mudança de esquema
            </CardTitle>
            <CardDescription>A origem deixou de entregar uma coluna obrigatória — o feed fica degradado até o mapeamento ser ajustado.</CardDescription>
          </CardHeader>
          <CardContent>
            {quality.schemaChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma mudança de esquema detectada.</p>
            ) : (
              <ul className="space-y-2">
                {quality.schemaChanges.map((entry) => (
                  <li key={entry.feedId} className="text-sm">
                    <Link href={`/admin/data-hub/feeds/${entry.feedId}`} className="font-medium hover:underline">
                      {entry.feedName}
                    </Link>
                    <span className="text-xs text-muted-foreground"> · {entry.sourceName} · {formatDateTime(entry.schemaChangedAt)}</span>
                    {entry.lastErrorMessage ? <p className="text-xs text-muted-foreground">{entry.lastErrorMessage}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quarentena recente</CardTitle>
          <CardDescription>Últimos registros em quarentena com a severidade (erro = rejeitado; aviso = aplicado com ressalva) — linha, chave do registro, campo e mensagem. Nunca o payload inteiro.</CardDescription>
        </CardHeader>
        <CardContent>
          {quality.recentRejections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum erro recente.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Feed</TableHead>
                    <TableHead className="text-right">Linha</TableHead>
                    <TableHead>Chave</TableHead>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Campo</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quality.recentRejections.map((entry, index) => (
                    <TableRow key={`${entry.runId}-${entry.recordNumber}-${index}`}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        <Link href={`/admin/data-hub/runs/${entry.runId}`} className="hover:underline">
                          {formatDateTime(entry.createdAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{entry.feedName}</TableCell>
                      <TableCell className="text-right tabular-nums">{entry.recordNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.sourceRecordKey ?? "—"}</TableCell>
                      <TableCell className="text-xs">{entry.severity === "WARNING" ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800 dark:bg-sky-950 dark:text-sky-200">Aviso</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">Erro</span>}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.errorCode}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.field ?? "—"}</TableCell>
                      <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{entry.message}</TableCell>
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
