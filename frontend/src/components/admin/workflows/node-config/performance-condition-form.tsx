"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TypedComparatorSelect, TypedValueInput, type TypedFieldKind } from "../typed-value-field"
import { IndicatorSelect } from "../indicator-select"
import { QUARTILE_VALUES } from "@/schemas/admin/employee-performance.schema"
import { PERFORMANCE_METRIC_LABELS, type Comparator, type FlowNode, type PerformanceMetric, type PerformanceRecurrence } from "@/schemas/admin/workflow-graph.schema"
import { applyTypedValue, currentTypedValue } from "./typed-threshold"

/** Métrica de performance (Parte 8) — indicador direto ou consolidado do PRV. */
// Quartil não é uma STRING comum — "contém"/"começa com" não têm sentido nenhum pra um enum de 4
// valores. Só "está em"/"não está em" (EQUALS/NOT_EQUALS) são operadores válidos (Parte 15/27).
const QUARTILE_COMPARATORS: Comparator[] = ["EQUALS", "NOT_EQUALS"]

const QUARTILE_COMPARATOR_LABELS: Record<"EQUALS" | "NOT_EQUALS", string> = { EQUALS: "Está em", NOT_EQUALS: "Não está em" }

export function PerformanceConditionForm({
  node,
  onChange,
  hideMetricSelector,
}: {
  node: Extract<FlowNode, { type: "condition" }>
  onChange: (next: FlowNode) => void
  // true quando a métrica já foi decidida por "O que deseja analisar?" (IndicatorConditionForm) —
  // reperguntar aqui dentro seria redundante. Só false pra Conditions salvas no formato anterior
  // (Valor/Atingimento/Peso via performanceQuery, sem período), onde a métrica ainda é editável.
  hideMetricSelector?: boolean
}) {
  const query = node.config.performanceQuery!
  const isPrv = query.metric === "PRV_ACHIEVEMENT" || query.metric === "PRV_QUARTILE"
  const isQuartile = query.metric === "INDICATOR_QUARTILE" || query.metric === "PRV_QUARTILE"
  const fieldType: TypedFieldKind = isQuartile ? "STRING" : "NUMBER"
  const recurrence = query.recurrence

  function setMetric(metric: PerformanceMetric) {
    const nextIsPrv = metric === "PRV_ACHIEVEMENT" || metric === "PRV_QUARTILE"
    const nextIsQuartile = metric === "INDICATOR_QUARTILE" || metric === "PRV_QUARTILE"
    onChange({
      ...node,
      config: {
        comparator: nextIsQuartile ? "EQUALS" : "LT",
        thresholdNumeric: nextIsQuartile ? null : 0,
        thresholdText: nextIsQuartile ? "Q4" : undefined,
        performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric, indicatorCode: nextIsPrv ? undefined : (query.indicatorCode ?? "") },
      },
    })
  }

  function setRecurrenceEnabled(enabled: boolean) {
    if (!enabled) {
      onChange({
        ...node,
        config: { comparator: "EQUALS", thresholdNumeric: null, thresholdText: "Q4", performanceQuery: { ...query, recurrence: undefined } },
      })
      return
    }
    // Recorrência compara uma CONTAGEM de fechamentos (mesmo padrão de Quantidade de ocorrências
    // do Histórico) — nunca reaproveita o comparator/threshold de "está em Qx". Preserva o
    // quartil-alvo já escolhido no modo "mais recente", quando houver um válido.
    const matchQuartile = (QUARTILE_VALUES as string[]).includes(node.config.thresholdText ?? "") ? (node.config.thresholdText as PerformanceRecurrence["matchQuartile"]) : "Q4"
    onChange({
      ...node,
      config: {
        comparator: "GTE",
        thresholdNumeric: 3,
        thresholdText: undefined,
        performanceQuery: { ...query, recurrence: { periods: 3, matchQuartile } },
      },
    })
  }

  function updateRecurrence(patch: Partial<PerformanceRecurrence>) {
    if (!recurrence) return
    onChange({ ...node, config: { ...node.config, performanceQuery: { ...query, recurrence: { ...recurrence, ...patch } } } })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {!hideMetricSelector ? (
        <>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Mais recente (formato anterior)</p>
          <div className="space-y-1.5">
            <Label>Métrica</Label>
            <Select value={query.metric} onValueChange={(value) => setMetric(value as PerformanceMetric)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PERFORMANCE_METRIC_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
      {!isPrv ? (
        <div className="space-y-1.5">
          <Label>Indicador</Label>
          <IndicatorSelect
            value={query.indicatorCode ?? ""}
            requirement="OFFICIAL"
            onValueChange={(indicatorCode) => onChange({ ...node, config: { ...node.config, performanceQuery: { ...query, indicatorCode } } })}
          />
        </div>
      ) : null}

      {isQuartile ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Quando?</Label>
          <Select value={recurrence ? "RECURRENCE" : "LATEST"} onValueChange={(value) => setRecurrenceEnabled(value === "RECURRENCE")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LATEST">Fechamento mais recente</SelectItem>
              <SelectItem value="RECURRENCE">Recorrência (últimos N fechamentos)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {isQuartile && recurrence ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Quantos fechamentos</Label>
              <Input
                type="number"
                min={2}
                max={24}
                value={recurrence.periods}
                onChange={(event) => updateRecurrence({ periods: Math.min(24, Math.max(2, Number(event.target.value) || 2)) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quartil-alvo</Label>
              <Select value={recurrence.matchQuartile} onValueChange={(value) => updateRecurrence({ matchQuartile: value as PerformanceRecurrence["matchQuartile"] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUARTILE_VALUES.map((quartile) => (
                    <SelectItem key={quartile} value={quartile}>
                      {quartile}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <div className="space-y-1.5">
              <Label>Quantidade de fechamentos em {recurrence.matchQuartile}</Label>
              <TypedComparatorSelect kind="NUMBER" value={node.config.comparator} onChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator } })} />
            </div>
            <div className="space-y-1.5">
              <Label>Número</Label>
              <Input
                type="number"
                min={0}
                value={node.config.thresholdNumeric ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...node.config, thresholdNumeric: Number(event.target.value), thresholdBoolean: null } })}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Operador</Label>
            {isQuartile ? (
              <TypedComparatorSelect
                kind={fieldType}
                value={node.config.comparator}
                onChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator } })}
                options={QUARTILE_COMPARATORS}
                labels={QUARTILE_COMPARATOR_LABELS}
              />
            ) : (
              <TypedComparatorSelect kind={fieldType} value={node.config.comparator} onChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator } })} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Valor</Label>
            <TypedValueInput
              kind={fieldType}
              comparator={node.config.comparator}
              enumValues={isQuartile ? QUARTILE_VALUES : undefined}
              value={currentTypedValue(node.config)}
              onChange={(value) => onChange({ ...node, config: applyTypedValue(node.config, fieldType, value) })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
