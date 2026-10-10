"use client"

import { Activity, Info, Minus, TrendingDown, TrendingUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount, formatIndicatorValue, formatPercent, NO_DATA_LABEL, QUARTILE_LABELS } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import { employmentStatusLabel, scheduleExceptionLabel } from "@/schemas/people/employment-status.schema"
import type { EmployeeIndicatorSummary, OperationalComparisonView, OperationalStructureSummary, OperationalTrend, PerformanceTrend } from "@/schemas/analytics/analytics.schema"

import { AnalyticsCard } from "./analytics-states"

/**
 * Acompanhamento OPERACIONAL (camada 1 — medição diária calculada pela INIA) lado a lado com o
 * FECHAMENTO OFICIAL (camada 2 — lido da fonte corporativa). Duas colunas, dois rótulos
 * inequívocos ("Quartil oficial" × "Quartil operacional — últimos 7 dias" / "— mês corrente");
 * nunca um número de uma camada aparece com o rótulo da outra. Zero IA: tudo vem pronto do
 * backend — inclusive os rótulos das janelas da comparação escolhida (`trend.comparison`), a
 * tela nunca monta "últimos N dias" por conta própria.
 */
export const INSUFFICIENT_LABEL = "Sem dados operacionais suficientes"

/**
 * Evolução, queda ou estabilidade da PERFORMANCE operacional lida de relance: selo com fundo,
 * ícone e a palavra ("Melhorou", "Piorou", "Estável") — nunca só a cor, nunca só o número.
 */
const PERFORMANCE_STYLES: Record<NonNullable<PerformanceTrend>, { icon: typeof TrendingUp; text: string; badge: string; label: string }> = {
  IMPROVED: { icon: TrendingUp, text: "text-emerald-700 dark:text-emerald-300", badge: "border-emerald-500/30 bg-emerald-500/10", label: "Melhorou" },
  DECLINED: { icon: TrendingDown, text: "text-amber-700 dark:text-amber-300", badge: "border-amber-500/30 bg-amber-500/10", label: "Piorou" },
  STABLE: { icon: Minus, text: "text-muted-foreground", badge: "border-border bg-muted/60", label: "Estável" },
}

/** "17 de 61 dias — o bimestre ainda está em curso" quando a janela atual é um período civil parcial; null nos últimos 7 dias. */
function partialPeriodNote(comparison: OperationalComparisonView, windowCalendarDays: number, currentPeriodCalendarDays: number | null): string | null {
  if (!comparison.currentIsPartial || currentPeriodCalendarDays === null) return null
  const noun = comparison.shortLabel
  return `${windowCalendarDays} de ${currentPeriodCalendarDays} dias — ${noun === "semana" ? "a" : "o"} ${noun} ainda está em curso`
}

/**
 * As duas janelas da comparação, cada uma com rótulo, datas reais e tamanho em dias — a
 * comparação nunca fica implícita numa linha só ("01/09 → 17/09 vs. 01/07 → 31/08").
 */
function ComparisonWindows({ comparison, currentLabel, previousLabel, windowCalendarDays, previousWindowCalendarDays, currentPeriodCalendarDays }: { comparison: OperationalComparisonView; currentLabel: string; previousLabel: string; windowCalendarDays: number; previousWindowCalendarDays: number; currentPeriodCalendarDays: number | null }) {
  const note = partialPeriodNote(comparison, windowCalendarDays, currentPeriodCalendarDays)
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="comparison-windows">
      <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
        <dt className="text-xs font-medium text-foreground">{comparison.currentLabel}</dt>
        <dd className="text-sm tabular-nums">{currentLabel}</dd>
        <dd className="text-xs text-muted-foreground">{note ?? formatCount(windowCalendarDays, "dia de calendário", "dias de calendário")}</dd>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
        <dt className="text-xs font-medium text-foreground">{comparison.previousLabel}</dt>
        <dd className="text-sm tabular-nums">{previousLabel}</dd>
        <dd className="text-xs text-muted-foreground">{formatCount(previousWindowCalendarDays, "dia de calendário", "dias de calendário")}</dd>
      </div>
    </dl>
  )
}

/** Motivo, vindo do backend, de a variação não existir mesmo com valor nas duas janelas. */
const CHANGE_UNAVAILABLE_TEXT: Record<"PARTIAL_PERIOD_SUM", string> = {
  PARTIAL_PERIOD_SUM: "Soma em período parcial — não comparável com o período anterior completo",
}

/** Selo "Melhorou +18,3%" / "Piorou −1,4%" / "Estável +0,8%" (sinal pela direção oficial) — nunca a variação bruta sem contexto. `previousPhrase` = janela anterior da comparação ("os 7 dias anteriores", "o mês anterior"). */
export function PerformanceChange({ trend, percent, previousPhrase, unavailableReason = null, className, size = "sm" }: { trend: PerformanceTrend; percent: number | null; previousPhrase: string; unavailableReason?: "PARTIAL_PERIOD_SUM" | null; className?: string; size?: "sm" | "md" }) {
  const previous = previousPhrase
  if (!trend || percent === null) {
    return <span className={cn("text-muted-foreground", size === "md" ? "text-sm" : "text-xs", className)}>{unavailableReason ? CHANGE_UNAVAILABLE_TEXT[unavailableReason] : `Sem comparação com ${previous}`}</span>
  }
  const style = PERFORMANCE_STYLES[trend]
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : ""
  const text = `${sign}${formatPercent(Math.abs(percent))} de performance (${style.label.toLowerCase()})`
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", size === "md" ? "text-sm" : "text-xs", className)} aria-label={`Variação de performance vs. ${previous}: ${text}`}>
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold tabular-nums", style.text, style.badge)} data-performance-trend={trend}>
        <style.icon className={size === "md" ? "size-4" : "size-3.5"} aria-hidden />
        <span>{style.label}</span>
        <span>
          {sign}
          {formatPercent(Math.abs(percent))}
        </span>
      </span>
      <span className="text-muted-foreground">vs. {previous}</span>
    </span>
  )
}

/** Rótulo real da situação ("INSS", "FÉRIAS", "MATERNIDADE") — vem do backend; código só como fallback. */
function statusLabel(entry: { status: string; label?: string }): string {
  return entry.label ?? employmentStatusLabel(entry.status)
}

/** "5 de 5 dias elegíveis · 100%" (+ "· 3 dias em férias excluídos" quando houve). */
function coverageText(window: OperationalTrend["current"]): string {
  if (window.expectedDays === null || window.coverage === null) return `${formatCount(window.daysWithData, "dia com medição", "dias com medição")}`
  return `${window.daysWithData} de ${window.expectedDays} dias elegíveis · ${formatPercent(Math.round(window.coverage * 100))}`
}

/**
 * Breakdown das exclusões, só quando relevante: "1 folga agendada · 2 dias em INSS excluídos de 6 programados".
 * Folga e feriado são calendário; situação usa o rótulo real; incerteza (situação/escala) nunca vira certeza.
 */
function exclusionsText(window: OperationalTrend["current"]): string | null {
  const parts: string[] = []
  // Folga só é "agendada" quando veio de escala explícita; no fallback seg–sex o fim de semana não é notícia.
  if (window.excludedByScheduledDayOff > 0 && window.schedule?.basis !== "LEGACY_WEEKDAY_FALLBACK") parts.push(`${formatCount(window.excludedByScheduledDayOff, "folga agendada", "folgas agendadas")}`)
  if (window.excludedByHoliday > 0) parts.push(`${formatCount(window.excludedByHoliday, "feriado aplicável", "feriados aplicáveis")}`)
  // Exceções individuais (day off, banco de horas, folga extraordinária): a escala dizia "trabalha"; a exceção venceu.
  for (const entry of window.excludedByScheduleException) parts.push(`${entry.days} ${entry.label ?? scheduleExceptionLabel(entry.code)}`)
  if (window.excludedByStatus.length > 0) {
    parts.push(window.excludedByStatus.map((entry) => `${formatCount(entry.days, "dia", "dias")} em ${statusLabel(entry)}`).join(", ") + (window.calendarDays !== null ? ` excluídos de ${window.calendarDays} no calendário` : " excluídos"))
  }
  if (window.excludedByUnknownSchedule > 0) parts.push(`${formatCount(window.excludedByUnknownSchedule, "dia com escala desconhecida", "dias com escala desconhecida")} (6x1 sem folga informada)`)
  // Dias que a INIA só PRESUME elegíveis (fonte de situação funcional/escala atrasada): nunca vira certeza.
  if (window.unconfirmedDays > 0) parts.push(`${formatCount(window.unconfirmedDays, "dia presumido", "dias presumidos")} — fonte de situação funcional atrasada`)
  if (window.schedule?.freshness === "STALE" && window.schedule.unconfirmedScheduleDays > 0) parts.push(`${formatCount(window.schedule.unconfirmedScheduleDays, "dia com escala presumida", "dias com escala presumida")} — fonte de escala atrasada`)
  // Medição em data não elegível: fica no banco, fora do valor e da cobertura — dito, nunca escondido.
  if (window.ignoredMeasurements > 0) parts.push(`${formatCount(window.ignoredMeasurements, "medição em dia não elegível ignorada", "medições em dias não elegíveis ignoradas")}`)
  // OBSERVADO: produção real que superou o plano (fica registrado), produção ausente pós-turno, produção com situação não produtiva.
  const observed = window.observed
  if (observed && observed.evidenceSources.enabled) {
    if (observed.workedObservedDays > 0) parts.push(`${formatCount(observed.workedObservedDays, "dia com produção observada", "dias com produção observada")}`)
    for (const entry of observed.workedDespitePlan.exception) parts.push(`${formatCount(entry.days, "dia trabalhado", "dias trabalhados")} em ${entry.label ?? scheduleExceptionLabel(entry.code)} previsto(a)`)
    if (observed.workedDespitePlan.scheduledDayOff > 0 && window.schedule?.basis !== "LEGACY_WEEKDAY_FALLBACK") parts.push(`${formatCount(observed.workedDespitePlan.scheduledDayOff, "dia trabalhado em folga prevista", "dias trabalhados em folga prevista")}`)
    if (observed.workedDespitePlan.holiday > 0) parts.push(`${formatCount(observed.workedDespitePlan.holiday, "dia trabalhado em feriado", "dias trabalhados em feriado")}`)
    if (observed.workedDespitePlan.unknownSchedule > 0) parts.push(`${formatCount(observed.workedDespitePlan.unknownSchedule, "dia trabalhado com escala desconhecida", "dias trabalhados com escala desconhecida")}`)
    if (observed.missingExpectedProductionDays > 0) parts.push(`${formatCount(observed.missingExpectedProductionDays, "dia programado sem produção identificada", "dias programados sem produção identificada")} (pendência do Supervisor)`)
    if (observed.waitingForSourcesDays > 0) parts.push(`${formatCount(observed.waitingForSourcesDays, "dia aguardando dados", "dias aguardando dados")} (D-1/D-2 ou RH ainda no prazo)`)
    if (observed.dataSourceDelayDays > 0) parts.push(`${formatCount(observed.dataSourceDelayDays, "dia com fonte de dados atrasada", "dias com fonte de dados atrasada")} (não é ausência)`)
    if (observed.unjustifiedAbsenceDays > 0) parts.push(`${formatCount(observed.unjustifiedAbsenceDays, "dia de falta injustificada", "dias de falta injustificada")} — ${observed.unjustifiedAbsence?.policy === "ZERO_CONTRIBUTION" ? `contribuição zero neste indicador (${formatCount(observed.unjustifiedAbsence.zeroContributionDays, "dia", "dias")}, nenhuma medição criada)` : "sem amostra neste indicador (nenhum zero falso)"}`)
    if (observed.workedDataMissingDays > 0) parts.push(`${formatCount(observed.workedDataMissingDays, "dia confirmado como trabalhado sem dados", "dias confirmados como trabalhados sem dados")} (nada inventado)`)
    if (observed.justifiedAbsenceDays > 0) parts.push(`${formatCount(observed.justifiedAbsenceDays, "dia de ausência justificada", "dias de ausência justificada")} (classificação — fora do cálculo)`)
  }
  if (observed && observed.productionWithNonEligibleStatusDays > 0) parts.push(`${formatCount(observed.productionWithNonEligibleStatusDays, "dia com produção em situação não produtiva", "dias com produção em situação não produtiva")} — inconsistência de dados`)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** "Mínimo do indicador: 60% de cobertura" / "3 medições" — sempre o padrão do INDICADOR (catálogo), nunca um número da tela. */
function minimumText(trend: OperationalTrend): string | null {
  if (trend.sufficiencyRule === "COVERAGE" && trend.minimumCoverage !== null) return `Mínimo do indicador: ${formatPercent(Math.round(trend.minimumCoverage * 100))} de cobertura`
  if (trend.sufficiencyRule === "SAMPLE" && trend.minimumSampleSize !== null) return `Mínimo do indicador: ${formatCount(trend.minimumSampleSize, "medição", "medições")}`
  return null
}

const POPULATION_PREFIX: Record<OperationalTrend["quartile"]["populationType"], string> = { SUBGROUP_PEERS: "Pares", GROUP_PEERS: "Pares", WORKFLOW_POPULATION: "População", NONE: "Pares" }

/** "Q4 operacional · 95º de 108" + "Pares: Subgrupo Voz (106 elegíveis)" — quartil nunca sem a população comparada. */
function operationalQuartileText(trend: OperationalTrend): { value: string; hint: string } {
  const { quartile } = trend
  const peers = `${POPULATION_PREFIX[quartile.populationType]}: ${quartile.populationLabel}${quartile.eligiblePopulationCount !== quartile.populationCount ? ` (${quartile.eligiblePopulationCount} de ${quartile.populationCount} elegíveis)` : ` (${quartile.populationCount})`}`
  if (quartile.quartile) return { value: `${quartile.quartile} operacional · ${quartile.rank ?? quartile.position}º de ${quartile.rankedCount}`, hint: peers }
  switch (quartile.reason) {
    case "INSUFFICIENT_POPULATION":
      return { value: "Sem quartil", hint: `só ${quartile.rankedCount} de ${quartile.populationCount} pares com dados (mínimo 4) · ${peers}` }
    case "DIRECTION_UNSUPPORTED":
      return { value: "Sem quartil", hint: "indicador sem direção de desempenho (meta por faixa)" }
    case "BELOW_MINIMUM_COVERAGE":
      return { value: "Sem quartil", hint: `cobertura abaixo do mínimo do indicador · ${peers}` }
    case "NO_ELIGIBLE_DAYS":
      return { value: "Sem quartil", hint: `nenhum dia elegível na janela (situação não produtiva ou folga programada) · ${peers}` }
    case "EMPLOYMENT_STATUS_STALE":
      return { value: "Sem quartil", hint: `sem medição e a fonte de situação funcional está atrasada — não dá para afirmar que deveria ter produzido · ${peers}` }
    case "WORK_SCHEDULE_STALE":
      return { value: "Sem quartil", hint: `sem medição e a fonte de escala está atrasada — a folga pode ter mudado · ${peers}` }
    case "WORK_SCHEDULE_UNKNOWN":
      return { value: "Sem quartil", hint: `sem medição e a escala (6x1) não informa a folga — a INIA não presume · ${peers}` }
    default:
      return { value: "Sem quartil", hint: `sem medição na janela · ${peers}` }
  }
}

function Fact({ label, value, hint, muted = false }: { label: string; value: React.ReactNode; hint?: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", muted && "text-muted-foreground")}>{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  )
}

/** Painel "Fechamento oficial × Acompanhamento operacional" do detalhe do indicador de um colaborador. */
export function OfficialVsOperationalPanel({ indicator, periodLabel }: { indicator: EmployeeIndicatorSummary; periodLabel: string }) {
  const trend = indicator.operationalTrend
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Fechamento oficial e acompanhamento operacional">
      <div className="rounded-xl border border-border/60 p-4">
        <h3 className="text-sm font-semibold">Fechamento oficial</h3>
        <p className="mb-3 text-xs text-muted-foreground">{periodLabel} · lido da fonte oficial, nunca recalculado</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Resultado oficial" value={formatIndicatorValue(indicator.value, indicator.unit)} />
          <Fact label="Meta" value={indicator.targetValue === null ? "Sem meta vigente" : formatIndicatorValue(indicator.targetValue, indicator.unit)} />
          <Fact label="Atingimento oficial" value={formatPercent(indicator.achievementPercent)} />
          <Fact label="Quartil oficial" value={indicator.quartile ? QUARTILE_LABELS[indicator.quartile] : NO_DATA_LABEL} />
          <Fact label="Peso no PRV" value={formatPercent(indicator.weightPercent)} />
          <Fact label="Período anterior" value={formatPercent(indicator.previousAchievementPercent)} />
        </dl>
      </div>
      {trend ? (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4" data-testid="operational-trend">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold">Acompanhamento operacional</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Como o acompanhamento operacional é calculado">
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-80 leading-5">
                Medição operacional diária ({trend.aggregationLabel.toLowerCase()}), calculada pela INIA {trend.comparison.currentPhrase} ({trend.current.label}) e comparada com {trend.comparison.previousPhrase} ({trend.previous.label}), só sobre dias elegíveis (úteis desde a
                admissão, sem férias/afastamento).{trend.comparison.currentIsPartial ? " O período corrente ainda está em curso — a janela atual é parcial até hoje." : ""} &quot;Dado suficiente&quot; segue o mínimo do indicador no catálogo. Quartil operacional = posição entre os pares ({trend.quartile.populationLabel}) pela direção oficial, mínimo de 4 com
                dados. Não é o fechamento oficial.{trend.method ? ` Método: ${trend.method}.` : ""}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {trend.comparison.currentLabel} · {trend.current.label}
            {partialPeriodNote(trend.comparison, trend.windowCalendarDays, trend.currentPeriodCalendarDays) ? ` · ${partialPeriodNote(trend.comparison, trend.windowCalendarDays, trend.currentPeriodCalendarDays)}` : ""} · calculado pela INIA
          </p>
          {trend.sufficient ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={trend.comparison.currentLabel} value={formatIndicatorValue(trend.current.value, trend.unit)} hint={trend.current.label} />
              <Fact label={trend.comparison.previousLabel} value={trend.previous.value === null ? NO_DATA_LABEL : formatIndicatorValue(trend.previous.value, trend.unit)} hint={trend.previous.label} muted={trend.previous.value === null} />
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Variação de performance</dt>
                <dd className="mt-0.5">
                  <PerformanceChange trend={trend.performanceTrend} percent={trend.performanceChangePercent} previousPhrase={trend.comparison.previousPhrase} unavailableReason={trend.changeUnavailableReason} size="md" />
                </dd>
              </div>
              <Fact label={`Quartil operacional — ${trend.comparison.currentLabel.toLowerCase()}`} value={operationalQuartileText(trend).value} hint={operationalQuartileText(trend).hint} muted={!trend.quartile.quartile} />
              <Fact label="Cobertura" value={coverageText(trend.current)} hint={[exclusionsText(trend.current), minimumText(trend)].filter(Boolean).join(" · ") || undefined} />
            </dl>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card/60 p-3 text-sm" data-testid="operational-insufficient">
              <p className="font-medium">{INSUFFICIENT_LABEL}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {trend.current.noEligibleDays
                  ? `Nenhum dia elegível ${trend.comparison.currentPhrase} (${trend.current.label})${exclusionsText(trend.current) ? ` (${exclusionsText(trend.current)})` : ""} — o colaborador não deveria ter produzido neste período.`
                  : trend.current.sampleCount === 0
                    ? `Nenhuma medição diária ${trend.comparison.currentPhrase} (${trend.current.label}).`
                    : trend.sufficiencyRule === "SAMPLE"
                      ? `${formatCount(trend.current.sampleCount, "medição", "medições")} — ${minimumText(trend) ?? ""}.`
                      : `Cobertura: ${coverageText(trend.current)}${exclusionsText(trend.current) ? ` (${exclusionsText(trend.current)})` : ""}. ${minimumText(trend) ?? ""}.`}
                {" "}Nunca vira 0 nem quartil.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

/** Linha compacta do card do indicador — só aparece com medição diária. Rótulo sempre "operacional" + a janela ("7d", "mês"). */
export function OperationalTrendChip({ trend }: { trend: OperationalTrend }) {
  if (!trend.sufficient) return <span className="text-muted-foreground">Operacional {trend.comparison.shortLabel}: {INSUFFICIENT_LABEL.toLowerCase()}</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="operational-chip">
      <span>
        Operacional {trend.comparison.shortLabel}: <strong className="font-medium text-foreground">{formatIndicatorValue(trend.current.value, trend.unit)}</strong>
      </span>
      <PerformanceChange trend={trend.performanceTrend} percent={trend.performanceChangePercent} previousPhrase={trend.comparison.previousPhrase} unavailableReason={trend.changeUnavailableReason} />
      {trend.quartile.quartile ? (
        <span>
          {trend.quartile.quartile} operacional · {trend.quartile.rank ?? trend.quartile.position}º de {trend.quartile.rankedCount} · {trend.quartile.populationLabel}
        </span>
      ) : null}
    </span>
  )
}

/** "130 colaboradores, todos com ao menos um dia elegível no período." / "21 de 25 colaboradores com ao menos um dia elegível — 4 em férias/afastamento a janela inteira." */
function eligibleMembersText(summary: OperationalStructureSummary): string {
  const excluded = summary.memberCount - summary.eligibleMemberCount
  if (excluded === 0) return `${formatCount(summary.memberCount, "colaborador", "colaboradores")}, ${summary.memberCount === 1 ? "com" : "todos com"} ao menos um dia elegível no período.`
  return `${summary.eligibleMemberCount} de ${summary.memberCount} colaboradores com ao menos um dia elegível no período — ${formatCount(excluded, "em férias/afastamento", "em férias/afastamento")} a janela inteira.`
}

/** Resumo operacional pequeno de uma estrutura — abaixo do consolidado oficial, nunca dentro dele. */
export function OperationalStructureSummaryCard({ summary }: { summary: OperationalStructureSummary }) {
  if (summary.indicators.length === 0) return null
  return (
    <AnalyticsCard>
      <div>
        <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Activity className="size-3.5" aria-hidden /> Acompanhamento operacional · {summary.comparison.label.toLowerCase()}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Como o acompanhamento operacional da estrutura é calculado">
                <Info />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 leading-5 normal-case tracking-normal">{summary.method}</TooltipContent>
          </Tooltip>
        </p>
        <ComparisonWindows comparison={summary.comparison} currentLabel={summary.windowLabel} previousLabel={summary.previousWindowLabel} windowCalendarDays={summary.windowCalendarDays} previousWindowCalendarDays={summary.previousWindowCalendarDays} currentPeriodCalendarDays={summary.currentPeriodCalendarDays} />
        <p className="mt-2 text-sm text-muted-foreground">
          {eligibleMembersText(summary)} Medição diária agregada dos elegíveis (Σ numerador ÷ Σ denominador), calculada pela INIA. Não é o fechamento oficial.
          {summary.comparison.currentIsPartial ? " Como a janela atual ainda está em curso, somas (ex.: volume) não são comparadas com o período anterior; médias e taxas são." : ""}
        </p>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {summary.indicators.map((indicator) => (
          <li key={indicator.code} className="rounded-lg bg-muted/40 p-3">
            <p className="truncate text-sm font-medium">{indicator.name}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <strong className="text-lg leading-tight">{indicator.currentValue === null ? INSUFFICIENT_LABEL : formatIndicatorValue(indicator.currentValue, indicator.unit)}</strong>
              {indicator.previousValue !== null ? <span className="text-xs text-muted-foreground">antes {formatIndicatorValue(indicator.previousValue, indicator.unit)}</span> : null}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <PerformanceChange trend={indicator.performanceTrend} percent={indicator.performanceChangePercent} previousPhrase={summary.comparison.previousPhrase} unavailableReason={indicator.changeUnavailableReason} />
              <span>
                {indicator.membersWithSufficientData} de {indicator.eligibleMemberCount} elegíveis com dados suficientes
                {indicator.eligibleMemberCount !== indicator.memberCount ? ` · ${indicator.memberCount - indicator.eligibleMemberCount} em férias/afastamento` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </AnalyticsCard>
  )
}
