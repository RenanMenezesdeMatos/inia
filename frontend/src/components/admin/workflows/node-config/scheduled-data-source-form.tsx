"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IndicatorSelect } from "../indicator-select"
import { PERIOD_WINDOW_LABELS, periodWindowSchema, type PeriodWindow, type ScheduledDataSource } from "@/schemas/admin/workflow-graph.schema"

type UiScheduleSourceKind = "INDICATOR_SPECIFIC" | "INDICATOR_SUMMARY" | "MONITORING" | "PERFORMANCE"

function uiScheduleSourceKind(source: ScheduledDataSource | undefined): UiScheduleSourceKind | "" {
  if (!source) return ""
  if (source.kind === "MONITORING") return "MONITORING"
  if (source.kind === "PERFORMANCE") return "PERFORMANCE"
  // null = "resumo geral" de propósito; "" é só "ainda não escolhi o indicador" — não pode
  // cair no mesmo braço, senão a seleção volta pra resumo geral antes do admin escolher.
  return source.indicatorCode === null ? "INDICATOR_SUMMARY" : "INDICATOR_SPECIFIC"
}

export function ScheduledDataSourceForm({
  source,
  onChange,
}: {
  source: ScheduledDataSource | undefined
  onChange: (next: ScheduledDataSource) => void
}) {
  const uiKind = uiScheduleSourceKind(source)
  const fieldId = useId()

  function setUiKind(next: UiScheduleSourceKind) {
    if (next === "MONITORING") onChange({ kind: "MONITORING", sampleSize: 2, period: "D1" })
    else if (next === "PERFORMANCE") onChange({ kind: "PERFORMANCE", closures: 1 })
    else if (next === "INDICATOR_SUMMARY") onChange({ kind: "INDICATOR", indicatorCode: null, period: "D1" })
    else onChange({ kind: "INDICATOR", indicatorCode: "", period: "D1" })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Fonte de dados</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-kind`}>O que avaliar</Label>
        <Select value={uiKind} onValueChange={(value) => setUiKind(value as UiScheduleSourceKind)}>
          <SelectTrigger id={`${fieldId}-kind`} className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="INDICATOR_SPECIFIC">Indicador específico</SelectItem>
            <SelectItem value="INDICATOR_SUMMARY">Todos os indicadores (resumo geral)</SelectItem>
            <SelectItem value="MONITORING">Amostra de chamadas (monitoria)</SelectItem>
            <SelectItem value="PERFORMANCE">Fechamentos oficiais (PRV + indicadores)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {uiKind === "INDICATOR_SPECIFIC" && source?.kind === "INDICATOR" ? (
        <div className="space-y-1.5">
          <Label>Indicador</Label>
          <IndicatorSelect value={source.indicatorCode ?? ""} requirement="ANY" onValueChange={(indicatorCode) => onChange({ kind: "INDICATOR", indicatorCode, period: source.period })} />
        </div>
      ) : null}

      {uiKind === "MONITORING" && source?.kind === "MONITORING" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-sample-size`}>Quantas chamadas amostrar</Label>
          <Input
            id={`${fieldId}-sample-size`}
            type="number"
            min={1}
            max={10}
            value={source.sampleSize}
            onChange={(event) => onChange({ kind: "MONITORING", sampleSize: Math.min(10, Math.max(1, Number(event.target.value) || 1)), period: source.period })}
          />
        </div>
      ) : null}

      {uiKind === "PERFORMANCE" && source?.kind === "PERFORMANCE" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-closures`}>Quantos fechamentos (competências)</Label>
          <Input
            id={`${fieldId}-closures`}
            type="number"
            min={1}
            max={3}
            value={source.closures}
            onChange={(event) => onChange({ kind: "PERFORMANCE", closures: Math.min(3, Math.max(1, Number(event.target.value) || 1)) })}
          />
          <p className="text-xs text-muted-foreground">
            PRV oficial, indicadores com meta, atingimento, peso e quartil dos últimos fechamentos mensais — lidos prontos da fonte oficial, nunca
            recalculados. Fonte certa para especialistas de PRV e Performance.
          </p>
        </div>
      ) : null}

      {source && source.kind !== "PERFORMANCE" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-period`}>Período avaliado</Label>
          <Select
            value={source.period}
            onValueChange={(period) => onChange({ ...source, period: periodWindowSchema.parse(period) as PeriodWindow })}
          >
            <SelectTrigger id={`${fieldId}-period`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIOD_WINDOW_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
