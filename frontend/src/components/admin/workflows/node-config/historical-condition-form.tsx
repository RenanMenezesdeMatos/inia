"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TypedComparatorSelect } from "../typed-value-field"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { aggregationOptionLabel, IndicatorSelect } from "../indicator-select"
import { CHANGE_MODE_LABELS, COMPARATOR_LABELS, HISTORICAL_AGGREGATION_LABELS, HISTORICAL_COMPARE_TO_LABELS, MEASUREMENT_AGGREGATION_OPTION_LABELS, OPERATIONAL_AGGREGATION_LABELS, defaultAggregationFor, type Comparator, type FlowNode, type HistoricalAggregation, type HistoricalCompareTo, type HistoricalPeriod, type HistoricalQuery } from "@/schemas/admin/workflow-graph.schema"
import { HistoricalPeriodPicker, MinimumCoverageField, aggregationsFor } from "./indicator-query-fields"

export function HistoricalConditionForm({ node, onChange }: { node: Extract<FlowNode, { type: "condition" }>; onChange: (next: FlowNode) => void }) {
  const indicatorsQuery = useIndicatorsWithRulesQuery()
  const query = node.config.historicalQuery!
  const aggregation: HistoricalAggregation = query.aggregation ?? "COUNT"
  const period: HistoricalPeriod = query.period ?? { kind: "ROLLING_DAYS", days: query.windowDays ?? 7 }
  const isPrv = query.source === "PRV_ACHIEVEMENT"
  const selectedIndicator = indicatorsQuery.data?.find((indicator) => indicator.code === query.indicatorCode)
  const availableAggregations = aggregationsFor(query.source, selectedIndicator?.operationalAggregation)
  const aggregationUnsupported = !availableAggregations.includes(aggregation)
  const changeMode = query.compareTo?.kind === "PREVIOUS_PERIOD" ? (query.compareTo.changeMode ?? "VALUE") : undefined
  const fieldId = useId()

  function updateQuery(patch: Partial<HistoricalQuery>) {
    onChange({ ...node, config: { ...node.config, historicalQuery: { ...query, ...patch } } })
  }

  function setAggregation(next: HistoricalAggregation) {
    // Trocar a análise reseta os campos que só fazem sentido no modo anterior — nunca deixa
    // "Cada medição" sobrevivendo escondido quando o admin muda pra Média, por exemplo (Parte 13).
    if (next === "COUNT") {
      onChange({
        ...node,
        config: {
          ...node.config,
          comparator: "GTE",
          thresholdNumeric: 1,
          historicalQuery: { ...query, aggregation: next, comparator: "LT", indicatorThreshold: 0, minimumSampleSize: undefined },
        },
      })
    } else {
      onChange({
        ...node,
        config: {
          ...node.config,
          comparator: "LT",
          thresholdNumeric: null,
          historicalQuery: { ...query, aggregation: next, comparator: undefined, indicatorThreshold: undefined },
        },
      })
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {isPrv ? (
        <p className="text-xs text-muted-foreground">O PRV é consolidado — não depende de um indicador específico.</p>
      ) : (
        <div className="space-y-1.5">
          <Label>Indicador</Label>
          <IndicatorSelect
            value={query.indicatorCode}
            requirement={query.source === "MEASUREMENT" || query.source === undefined ? "ANY" : "OFFICIAL"}
            onValueChange={(indicatorCode, indicator) => {
              // Trocar o indicador pode invalidar a agregação (ex.: de um snapshot pra um tempo
              // ponderado) — cai na agregação natural do novo indicador em vez de deixar uma
              // combinação sem sentido. Amostra/cobertura mínimas PADRÃO do catálogo pré-preenchem
              // a Condition (ficam explícitas e editáveis aqui — nunca regra silenciosa).
              const kind = indicator?.operationalAggregation
              const allowed = aggregationsFor(query.source, kind)
              const nextAggregation = aggregation !== "COUNT" && !allowed.includes(aggregation) ? defaultAggregationFor(kind) : aggregation
              const defaults = nextAggregation === "COUNT" ? {} : { minimumSampleSize: indicator?.minimumSampleSize ?? query.minimumSampleSize, minimumCoverage: indicator?.minimumCoverage ?? query.minimumCoverage }
              onChange({ ...node, config: { ...node.config, historicalQuery: { ...query, indicatorCode, aggregation: nextAggregation, ...defaults } } })
            }}
          />
          {selectedIndicator && (query.source === "MEASUREMENT" || query.source === undefined) ? (
            <p className="text-xs text-muted-foreground">
              {selectedIndicator.dailySupported ? "Medição operacional diária" : "Sem medição operacional (só períodos mensais e fechamentos)"}
              {selectedIndicator.calculation ? ` — cálculo no período: ${selectedIndicator.calculation.label} (${selectedIndicator.calculation.description})` : ""}
            </p>
          ) : null}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-aggregation`}>Analisar</Label>
        <Select value={aggregation} onValueChange={(value) => setAggregation(value as HistoricalAggregation)}>
          <SelectTrigger id={`${fieldId}-aggregation`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(aggregationUnsupported ? [aggregation, ...availableAggregations] : availableAggregations).map((value) => (
              <SelectItem key={value} value={value}>
                {query.source === "MEASUREMENT" || query.source === undefined ? aggregationOptionLabel(value, selectedIndicator) : MEASUREMENT_AGGREGATION_OPTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {aggregationUnsupported ? (
          <p className="text-xs text-destructive">
            &quot;{HISTORICAL_AGGREGATION_LABELS[aggregation]}&quot; não faz sentido para este indicador ({selectedIndicator ? OPERATIONAL_AGGREGATION_LABELS[selectedIndicator.operationalAggregation] : "fonte oficial"}) — a publicação vai rejeitar. Escolha uma das opções válidas.
          </p>
        ) : null}
      </div>

      <HistoricalPeriodPicker
        period={period}
        allowClosures={aggregation !== "COUNT"}
        closuresSource={query.source === "MEASUREMENT" || query.source === undefined ? "MEASUREMENT" : "ACHIEVEMENT"}
        operationalEnabled={selectedIndicator ? selectedIndicator.dailySupported : undefined}
        onChange={(next) => updateQuery({ period: next, windowDays: undefined })}
      />

      {aggregation === "COUNT" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-measurement-comparator`}>Considerar medições onde valor</Label>
              <Select value={query.comparator ?? "LT"} onValueChange={(comparator) => updateQuery({ comparator: comparator as Comparator })}>
                <SelectTrigger id={`${fieldId}-measurement-comparator`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COMPARATOR_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-indicator-threshold`}>Valor de referência</Label>
              <Input id={`${fieldId}-indicator-threshold`} type="number" value={query.indicatorThreshold ?? 0} onChange={(event) => updateQuery({ indicatorThreshold: Number(event.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-count-comparator`}>Quantidade</Label>
              <TypedComparatorSelect id={`${fieldId}-count-comparator`} kind="NUMBER" value={node.config.comparator} onChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-count-threshold`}>Número</Label>
              <Input
                id={`${fieldId}-count-threshold`}
                type="number"
                value={node.config.thresholdNumeric ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...node.config, thresholdNumeric: Number(event.target.value), thresholdBoolean: null } })}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-minimum-sample`} className="text-xs text-muted-foreground">Mínimo de medições (opcional)</Label>
            <Input
              id={`${fieldId}-minimum-sample`}
              type="number"
              min={1}
              value={query.minimumSampleSize ?? ""}
              placeholder="ex.: 3"
              onChange={(event) => {
                const raw = event.target.value.trim()
                updateQuery({ minimumSampleSize: raw ? Math.max(1, Number(raw) || 1) : undefined })
              }}
            />
            <p className="text-xs text-muted-foreground">Com menos medições que isso no período, o resultado é &quot;Sem dados&quot;, nunca Sim/Não.</p>
          </div>
          {query.source === "MEASUREMENT" || query.source === undefined ? (
            <MinimumCoverageField value={query.minimumCoverage} onChange={(minimumCoverage) => updateQuery({ minimumCoverage })} />
          ) : null}
          <div className="space-y-1.5 border-t pt-3">
            <Label htmlFor={`${fieldId}-compare-to`}>Referência da comparação</Label>
            <Select
              value={query.compareTo?.kind ?? "FIXED"}
              onValueChange={(value) => {
                // Um único onChange (nunca updateQuery + onChange em sequência): os dois fecham
                // sobre o `node` da mesma renderização, então o segundo apagaria a mudança do
                // primeiro (confirmado ao vivo — o Select voltava pra "Valor fixo" sozinho).
                const compareTo = value === "FIXED" ? undefined : ({ kind: value as HistoricalCompareTo["kind"] } as HistoricalCompareTo)
                onChange({ ...node, config: { ...node.config, thresholdNumeric: null, historicalQuery: { ...query, compareTo } } })
              }}
            >
              <SelectTrigger id={`${fieldId}-compare-to`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
                {Object.entries(HISTORICAL_COMPARE_TO_LABELS)
                  // Últimos N fechamentos nunca combina com Período anterior (fechamentos
                  // anteriores aos últimos N não foi pedido — evita uma combinação mal definida).
                  .filter(([value]) => query.period?.kind !== "CLOSURES" || value !== "PREVIOUS_PERIOD")
                  // Meta vigente é referência do VALOR DO INDICADOR — Atingimento (indicador ou
                  // PRV) já representa a relação do resultado com a meta, nunca oferecida de
                  // novo como referência (misturaria grandezas diferentes, ex.: 80% x 25).
                  .filter(([value]) => value !== "GOAL" || query.source === "MEASUREMENT" || query.source === undefined)
                  .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {query.compareTo?.kind === "GOAL" ? (
              <p className="text-xs text-muted-foreground">Meta vigente do indicador para o grupo analisado, consultada em tempo de execução.</p>
            ) : null}
          </div>
          {query.compareTo?.kind === "PREVIOUS_PERIOD" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-change-mode`} className="text-xs text-muted-foreground">Como comparar</Label>
              <Select
                value={changeMode}
                onValueChange={(value) => {
                  const nextChangeMode = value === "VALUE" ? undefined : (value as "PERCENT")
                  onChange({
                    ...node,
                    config: { ...node.config, thresholdNumeric: null, historicalQuery: { ...query, compareTo: { kind: "PREVIOUS_PERIOD", changeMode: nextChangeMode } } },
                  })
                }}
              >
                <SelectTrigger id={`${fieldId}-change-mode`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANGE_MODE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {changeMode === "PERCENT"
                  ? 'Compara a VARIAÇÃO percentual entre os dois períodos — ex.: "aumentou pelo menos 10%".'
                  : "Compara o valor atual diretamente contra o valor do período anterior — maior/menor já respondem aumentou/diminuiu."}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-result-comparator`}>{changeMode === "PERCENT" ? "Variação" : HISTORICAL_AGGREGATION_LABELS[aggregation]}</Label>
              <TypedComparatorSelect id={`${fieldId}-result-comparator`} kind="NUMBER" value={node.config.comparator} onChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator } })} />
            </div>
            {!query.compareTo || changeMode === "PERCENT" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-result-threshold`}>{changeMode === "PERCENT" ? "Percentual mínimo de variação (%)" : "Valor de referência"}</Label>
                <Input
                  id={`${fieldId}-result-threshold`}
                  type="number"
                  value={node.config.thresholdNumeric ?? ""}
                  onChange={(event) => onChange({ ...node, config: { ...node.config, thresholdNumeric: Number(event.target.value), thresholdBoolean: null } })}
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
