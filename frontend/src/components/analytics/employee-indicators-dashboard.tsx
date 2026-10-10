"use client"

import { AlertTriangle, BarChart3, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatPercent, QUARTILE_LABELS } from "@/lib/analytics/format"
import { formatCivilDate } from "@/lib/format/date"
import type { EmployeeIndicatorDashboard, EmploymentStatusView } from "@/schemas/analytics/analytics.schema"
import { isOperationallyEligibleStatus } from "@/schemas/people/employment-status.schema"
import { LineageButton } from "@/components/admin/data-hub/lineage-sheet"

import { AnalyticsCard, AnalyticsEmptyState } from "./analytics-states"
import { EmployeeIndicatorDetailSheet } from "./indicator-detail-sheet"
import { IndicatorHistoryChart } from "./indicator-history-chart"
import { EmployeeIndicatorCard } from "./indicator-summary-card"
import { InsightPanel } from "./insight-panel"
import { MetricHero } from "./metric-hero"
import { PrvComposition } from "./prv-composition"
import { TrendIndicator } from "./trend-indicator"

/**
 * Visão EMPLOYEE: "Meu PRV" oficial no topo (valor exatamente como persistido), composição,
 * histórico, insights e os indicadores individuais com drill-down em painel lateral.
 */
export function EmployeeIndicatorsDashboard({ dashboard, openIndicator, onOpenIndicator, isOwnProfile, canSeeLineage = false }: { dashboard: EmployeeIndicatorDashboard; openIndicator: string | null; onOpenIndicator: (code: string | null) => void; isOwnProfile: boolean; canSeeLineage?: boolean }) {
  const selected = dashboard.indicators.find((indicator) => indicator.code === openIndicator) ?? null
  const prvTitle = isOwnProfile ? "Meu PRV" : `PRV de ${dashboard.subject.label.split(" ")[0]}`

  return (
    <div className="space-y-4">
      {dashboard.prv ? (
        <MetricHero
          eyebrow="Programa de Remuneração Variável"
          title={prvTitle}
          value={formatPercent(dashboard.prv.achievementPercent)}
          valueLabel={`Meta ${formatPercent(dashboard.prv.target)}`}
          trend={<TrendIndicator trend={dashboard.prv.trend} deltaPp={dashboard.prv.deltaPp} size="md" />}
          meta={
            <>
              <span>{QUARTILE_LABELS[dashboard.prv.quartile]}</span>
              <span>Período anterior: {formatPercent(dashboard.prv.previousAchievementPercent)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Sobre a fonte do PRV">
                    <Info />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-72 leading-5">Valor oficial do programa, lido da fonte de PRV ({dashboard.prv.source}). A INIA nunca recalcula o PRV.</TooltipContent>
              </Tooltip>
            </>
          }
          aside={
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Composição do PRV</p>
              <p className="mb-3 text-xs text-muted-foreground">Peso oficial de cada indicador neste período.</p>
              <PrvComposition entries={dashboard.prvComposition} />
            </div>
          }
        >
          <IndicatorHistoryChart points={dashboard.prvHistory} title="Histórico do PRV" />
          <div className="mt-5">
            <InsightPanel positives={dashboard.prvPositives} attentionPoints={dashboard.prvAttentionPoints} />
          </div>
        </MetricHero>
      ) : (
        <AnalyticsCard>
          <AnalyticsEmptyState icon={BarChart3} title={`Não há dados de PRV para ${dashboard.periodLabel.toLowerCase()}.`} description="O PRV é lido da fonte oficial do programa. Quando o período for fechado, o valor aparece aqui — a INIA não estima nem recalcula." />
          {dashboard.prvHistory.some((point) => point.value !== null) ? (
            <div className="mt-5">
              <p className="mb-2 text-sm font-medium">Histórico do PRV</p>
              <IndicatorHistoryChart points={dashboard.prvHistory} title="Histórico do PRV" />
            </div>
          ) : null}
        </AnalyticsCard>
      )}

      {dashboard.employmentStatus ? <EmploymentStatusBlock status={dashboard.employmentStatus} canSeeLineage={canSeeLineage} /> : null}

      <section className="space-y-3" aria-labelledby="indicators-heading">
        <div className="px-1">
          <h3 id="indicators-heading" className="text-base font-semibold">
            Indicadores do período
          </h3>
          <p className="text-sm text-muted-foreground">
            {dashboard.indicators.length === 0 ? "Nenhum indicador oficial disponível no período." : `${dashboard.indicators.filter((indicator) => indicator.withinTarget === false).length} de ${dashboard.indicators.length} abaixo da referência`}
          </p>
        </div>
        {dashboard.indicators.length === 0 ? (
          <AnalyticsEmptyState icon={BarChart3} title="Nenhum indicador disponível no período" description="Os indicadores aparecem quando a fonte oficial publica o fechamento do período." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {dashboard.indicators.map((indicator) => (
              <EmployeeIndicatorCard key={indicator.code} indicator={indicator} onOpen={() => onOpenIndicator(indicator.code)} />
            ))}
          </div>
        )}
      </section>

      <EmployeeIndicatorDetailSheet indicator={selected} open={selected !== null} onOpenChange={(open) => (open ? undefined : onOpenIndicator(null))} periodLabel={dashboard.periodLabel} />
    </div>
  )
}

/**
 * Situação funcional + escala no perfil. O "normal" (EM PRODUÇÃO confiável, escala explícita ou
 * fallback conhecido) não vira aviso: o bloco só aparece quando há algo a saber — situação não
 * produtiva, retorno presumido, fonte atrasada, escala 6x1 sem folga informada ou próxima folga
 * programada. Origem (fonte › feed) sempre que a Central souber; "Origem do dado" (linhagem) só
 * para quem pode abrir a Central (admin).
 */
function EmploymentStatusBlock({ status, canSeeLineage }: { status: EmploymentStatusView; canSeeLineage: boolean }) {
  const productive = isOperationallyEligibleStatus(status.status)
  const statusStale = status.freshness.state === "STALE" && status.basis !== "EXPLICIT_PERIOD"
  const schedule = status.schedule
  const scheduleRelevant = Boolean(schedule && (schedule.scheduleType || schedule.basis === "UNKNOWN_SCHEDULE" || schedule.nextDayOff || schedule.freshness.state === "STALE" || schedule.todayException || schedule.upcomingExceptions.length > 0))
  const relevant = !productive || status.basis === "PRESUMED_AFTER_PERIOD" || statusStale || scheduleRelevant
  if (!relevant) return null
  // Capital operacional = jurisdição de feriados (nada de endereço/lotação): discreta, só quando informada e quando o bloco já está visível.
  const capital = status.operationalCapital
  return (
    <div className="space-y-1 px-1 text-sm text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="employment-status">
        <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">Situação: {status.label}</span>
        {status.since ? (
          <span>
            desde {formatCivilDate(status.since)}
            {status.until ? ` até ${formatCivilDate(status.until)}` : ""}
            {status.sinceInferred ? " (situação conhecida a partir da carga)" : ""}
          </span>
        ) : null}
        {status.basis === "PRESUMED_AFTER_PERIOD" ? <span>· retorno não confirmado pela fonte (em produção presumido após o fim do período)</span> : null}
        {status.origin ? <span>· Origem: {status.origin.sourceName} › {status.origin.feedName}</span> : null}
        {!productive ? <span>· Os dias nessa situação não contam como elegíveis; o fechamento oficial não muda.</span> : null}
        {/* Fonte atrasada só é alarme quando a situação NÃO está respaldada por período explícito (férias 04–20 não dependem de snapshot diário). */}
        {statusStale ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="employment-status-stale">
            <AlertTriangle className="size-3" aria-hidden /> Fonte atrasada — situação funcional atualizada pela última vez em {status.freshness.lastSuccessAt ? formatCivilDate(status.freshness.lastSuccessAt) : "—"}
            {status.freshness.cadenceLabel ? ` (cadência esperada: ${status.freshness.cadenceLabel.toLowerCase()})` : ""}
          </span>
        ) : null}
        {canSeeLineage && status.periodId ? <LineageButton entityType="employee_status_periods" entityId={status.periodId} title="Origem da situação funcional" size="xs" label="Origem" /> : null}
      </p>
      {status.history.length > 1 ? (
        <p className="text-xs" data-testid="employment-status-history">
          Histórico: {status.history.slice(0, 4).map((entry) => `${entry.label} ${entry.to ? `${formatCivilDate(entry.from)}–${formatCivilDate(entry.to)}` : `desde ${formatCivilDate(entry.from)}`}`).join(" · ")}
        </p>
      ) : null}
      {schedule && scheduleRelevant ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="work-schedule">
          <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground">Escala: {schedule.scheduleTypeLabel ?? "não informada"}</span>
          {schedule.basis === "UNKNOWN_SCHEDULE" ? <span>· folgas não informadas pela fonte — a INIA não presume a folga nem cobra produção nesses dias</span> : null}
          {schedule.nextDayOff ? <span>· próxima folga programada: {formatCivilDate(schedule.nextDayOff)}</span> : null}
          {schedule.knownUntil ? <span>· calendário conhecido até {formatCivilDate(schedule.knownUntil)}</span> : null}
          {schedule.todayException ? (
            <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground" data-testid="work-schedule-today-exception">
              Hoje: {schedule.todayException.label}
            </span>
          ) : null}
          {schedule.upcomingExceptions.filter((entry) => entry.id !== schedule.todayException?.id).length > 0 ? (
            <span data-testid="work-schedule-exceptions">
              · exceções: {schedule.upcomingExceptions.filter((entry) => entry.id !== schedule.todayException?.id).slice(0, 3).map((entry) => `${entry.label} em ${formatCivilDate(entry.date)}`).join(", ")}
            </span>
          ) : null}
          {schedule.origin ? <span>· Origem: {schedule.origin.sourceName} › {schedule.origin.feedName}</span> : null}
          {schedule.freshness.state === "STALE" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="work-schedule-stale">
              <AlertTriangle className="size-3" aria-hidden /> Fonte de escala atrasada — última carga em {schedule.freshness.lastSuccessAt ? formatCivilDate(schedule.freshness.lastSuccessAt) : "—"}
            </span>
          ) : null}
          {canSeeLineage && schedule.todayScheduleId ? <LineageButton entityType="employee_schedule_days" entityId={schedule.todayScheduleId} title="Origem da escala de hoje" size="xs" label="Origem" /> : null}
          {canSeeLineage && schedule.todayException ? <LineageButton entityType="employee_schedule_exceptions" entityId={schedule.todayException.id} title="Origem da exceção de hoje" size="xs" label="Origem da exceção" /> : null}
        </p>
      ) : null}
      {capital ? (
        <p className="text-xs" data-testid="operational-capital">
          Capital operacional: {capital.label} <span className="text-muted-foreground/80">(jurisdição de feriados)</span>
        </p>
      ) : null}
    </div>
  )
}
