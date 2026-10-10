"use client"

import { ChevronRight, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount, formatIndicatorValue, formatPercent } from "@/lib/analytics/format"
import type { EmployeeIndicatorSummary, StructureIndicatorSummary } from "@/schemas/analytics/analytics.schema"

import { OperationalTrendChip } from "./operational-trend"
import { ReferenceStatusIcon, ReferenceStatusText, referenceStatusFrom, referenceStatusFromAchievement } from "./reference-status"
import { TrendIndicator } from "./trend-indicator"

/**
 * Card enxuto de indicador — um só componente para as duas visões; o que muda é o conjunto de
 * números (pessoal: valor/meta/peso/quartil; estrutura: consolidado/membros). Abre o detalhe.
 */
type CardShellProps = {
  name: string
  status: ReturnType<typeof referenceStatusFrom>
  primaryValue: string
  primaryLabel: string
  metaLine: React.ReactNode
  trend: React.ReactNode
  footer?: React.ReactNode
  description?: string | null
  onOpen: () => void
}

function IndicatorCardShell({ name, status, primaryValue, primaryLabel, metaLine, trend, footer, description, onOpen }: CardShellProps) {
  return (
    <Card className="border-0 bg-card shadow-none ring-0 transition-shadow focus-within:ring-2 focus-within:ring-ring/40 hover:shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <article>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ReferenceStatusIcon status={status} />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <h3 className="truncate font-medium">{name}</h3>
                  {description ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label={`Sobre ${name}`}>
                          <Info />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72 leading-5">{description}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{metaLine}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <strong className="block text-lg leading-tight">{primaryValue}</strong>
              <span className="text-[11px] text-muted-foreground">{primaryLabel}</span>
              {status !== "NO_DATA" ? (
                <div>
                  <ReferenceStatusText status={status} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {trend}
              {footer}
            </div>
            <Button type="button" variant="ghost" size="sm" className="-mr-2 text-primary" onClick={onOpen} aria-label={`Ver detalhes de ${name}`}>
              Detalhes <ChevronRight />
            </Button>
          </div>
        </article>
      </CardContent>
    </Card>
  )
}

export function EmployeeIndicatorCard({ indicator, onOpen }: { indicator: EmployeeIndicatorSummary; onOpen: () => void }) {
  const status = referenceStatusFrom(indicator.withinTarget)
  return (
    <IndicatorCardShell
      name={indicator.name}
      status={status}
      primaryValue={formatIndicatorValue(indicator.value, indicator.unit)}
      primaryLabel={indicator.achievementPercent === null ? "atingimento sem dado" : `${formatPercent(indicator.achievementPercent)} de atingimento`}
      metaLine={indicator.targetValue === null ? "Sem meta vigente" : `Meta ${formatIndicatorValue(indicator.targetValue, indicator.unit)}`}
      trend={<TrendIndicator trend={indicator.trend} deltaPp={indicator.deltaPp} comparisonLabel="vs. anterior" />}
      footer={
        <>
          {indicator.weightPercent !== null ? <span>Peso PRV {formatPercent(indicator.weightPercent)}</span> : null}
          {indicator.quartile ? <span>{indicator.quartile} oficial</span> : null}
          {indicator.operationalTrend ? <OperationalTrendChip trend={indicator.operationalTrend} /> : null}
        </>
      }
      onOpen={onOpen}
    />
  )
}

export function StructureIndicatorCard({ indicator, onOpen }: { indicator: StructureIndicatorSummary; onOpen: () => void }) {
  const status = referenceStatusFromAchievement(indicator.consolidatedAchievementPercent)
  return (
    <IndicatorCardShell
      name={indicator.name}
      status={status}
      primaryValue={formatPercent(indicator.consolidatedAchievementPercent)}
      primaryLabel="atingimento consolidado"
      metaLine={`${formatCount(indicator.membersWithData, "colaborador com dado", "colaboradores com dado")} · ${formatCount(indicator.membersBelowTarget, "abaixo da referência", "abaixo da referência")}`}
      trend={<TrendIndicator trend={indicator.trend} deltaPp={indicator.deltaPp} comparisonLabel="vs. anterior" />}
      footer={indicator.distribution.Q4 > 0 ? <span>{formatCount(indicator.distribution.Q4, "pessoa no Q4", "pessoas no Q4")}</span> : null}
      onOpen={onOpen}
    />
  )
}
