"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { aggregationOptionLabel, IndicatorSelect } from "../indicator-select"
import { QUARTILE_VALUES } from "@/schemas/admin/employee-performance.schema"
import { allowedAggregationsFor, defaultAggregationFor, type Comparator, type FlowNode, type HistoricalAggregation, type HistoricalPeriod, type HistoricalQuery, type EmployeeRankingAggregation } from "@/schemas/admin/workflow-graph.schema"
import { HistoricalConditionForm } from "./historical-condition-form"
import { type IndicatorAnalysisKind, buildIndicatorAnalysisConfig, indicatorAnalysisKindOf, indicatorAnalysisLabel } from "./indicator-analysis"
import { HistoricalPeriodPicker, MinimumCoverageField } from "./indicator-query-fields"
import { PerformanceConditionForm } from "./performance-condition-form"

/**
 * Quartil OPERACIONAL (Parte 32–38): "este colaborador está no Q4 de TMA nos últimos 7 dias
 * dentro da população do Workflow?". Mesmo cálculo do Ranking por quartil (direção oficial do
 * indicador, empates na mesma posição, mínimo de 4 com dados); população = Abrangência ∩ Filtro
 * populacional ou a coleção anterior. Nunca o quartil oficial do fechamento.
 */
function OperationalQuartileConditionForm({ node, onChange }: { node: Extract<FlowNode, { type: "condition" }>; onChange: (next: FlowNode) => void }) {
  const indicatorsQuery = useIndicatorsWithRulesQuery()
  const query = node.config.historicalQuery!
  const selectedIndicator = indicatorsQuery.data?.find((indicator) => indicator.code === query.indicatorCode)
  const availableAggregations = allowedAggregationsFor(selectedIndicator?.operationalAggregation).filter((item): item is EmployeeRankingAggregation => item !== "COUNT")
  const aggregation: HistoricalAggregation = query.aggregation ?? "WEIGHTED_AVERAGE"
  const aggregationUnsupported = aggregation === "COUNT" || !availableAggregations.includes(aggregation)
  const period: HistoricalPeriod = query.period ?? { kind: "ROLLING_DAYS", days: 7 }

  function updateQuery(patch: Partial<HistoricalQuery>) {
    onChange({ ...node, config: { ...node.config, historicalQuery: { ...query, ...patch } } })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label>Indicador</Label>
        <IndicatorSelect
          value={query.indicatorCode}
          requirement="OPERATIONAL"
          onValueChange={(indicatorCode, indicator) => {
            const kind = indicator?.operationalAggregation
            const allowed = allowedAggregationsFor(kind).filter((item): item is EmployeeRankingAggregation => item !== "COUNT")
            updateQuery({ indicatorCode, aggregation: aggregation !== "COUNT" && allowed.includes(aggregation) ? aggregation : defaultAggregationFor(kind), minimumCoverage: indicator?.minimumCoverage ?? query.minimumCoverage })
          }}
        />
        {selectedIndicator ? (
          <p className="text-xs text-muted-foreground">
            {selectedIndicator.desiredDirection === "TARGET"
              ? "Este indicador não tem direção de desempenho (meta por faixa) — sem regra de classificação em quartis; a publicação vai rejeitar."
              : `Direção oficial: ${selectedIndicator.desiredDirection === "LOWER" ? "menor é melhor" : "maior é melhor"} — Q1 = melhor 25% da população, Q4 = pior 25%.`}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label>Valor de cada colaborador na janela</Label>
        <Select value={aggregation} onValueChange={(value) => updateQuery({ aggregation: value as HistoricalAggregation })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(aggregationUnsupported ? [aggregation, ...availableAggregations] : availableAggregations).map((value) => (
              <SelectItem key={value} value={value}>
                {aggregationOptionLabel(value, selectedIndicator)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {aggregationUnsupported ? <p className="text-xs text-destructive">Esta agregação não faz sentido para este indicador — a publicação vai rejeitar.</p> : null}
      </div>
      <HistoricalPeriodPicker period={period} allowClosures={false} closuresSource="MEASUREMENT" onChange={(next) => updateQuery({ period: next, windowDays: undefined })} />
      <MinimumCoverageField value={query.minimumCoverage} onChange={(minimumCoverage) => updateQuery({ minimumCoverage })} />
      <div className="grid grid-cols-2 gap-2 border-t pt-3">
        <div className="space-y-1.5">
          <Label>Quartil operacional</Label>
          <Select value={node.config.comparator === "NOT_EQUALS" ? "NOT_EQUALS" : "EQUALS"} onValueChange={(comparator) => onChange({ ...node, config: { ...node.config, comparator: comparator as Comparator } })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EQUALS">É igual a</SelectItem>
              <SelectItem value="NOT_EQUALS">É diferente de</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Quartil</Label>
          <Select value={node.config.thresholdText ?? "Q4"} onValueChange={(thresholdText) => onChange({ ...node, config: { ...node.config, thresholdText, thresholdNumeric: null, thresholdBoolean: null } })}>
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
      <p className="text-xs text-muted-foreground">
        Posição relativa dentro da população do Workflow (Abrangência ∩ Filtro populacional, ou a coleção anterior) — mesmo cálculo do Ranking por quartil. Com menos de 4 colaboradores com dados, o resultado é &quot;Sem dados&quot;. Não é o quartil oficial do fechamento.
      </p>
    </div>
  )
}

export function IndicatorConditionForm({
  node,
  evaluationMode,
  onChange,
}: {
  node: Extract<FlowNode, { type: "condition" }>
  evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"
  onChange: (next: FlowNode) => void
}) {
  const kind = indicatorAnalysisKindOf(node.config)
  // Quartil (recorrente ou não) é performanceQuery, individual-only — nunca oferecido como
  // destino em modo Consolidado (mesma regra já aplicada em Performance do colaborador antes
  // desta reorganização, ver workflow-router.ts/workflow-validation.ts).
  // Quartil operacional idem: é a posição de UM colaborador na população — individual-only
  // (em Consolidado, use-o como critério de "Selecionar colaboradores", que roda como Individual).
  const options: IndicatorAnalysisKind[] = (["VALUE", "ACHIEVEMENT", "PRV_ACHIEVEMENT", "QUARTILE", "OPERATIONAL_QUARTILE", "PRV_QUARTILE"] as IndicatorAnalysisKind[])
    .filter((option) => evaluationMode !== "CONSOLIDATED" || (option !== "QUARTILE" && option !== "PRV_QUARTILE" && option !== "OPERATIONAL_QUARTILE"))
    .concat(kind === "LEGACY_PERFORMANCE" ? (["LEGACY_PERFORMANCE"] as IndicatorAnalysisKind[]) : [])

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>O que deseja analisar?</Label>
        <Select value={kind} onValueChange={(value) => onChange({ ...node, config: buildIndicatorAnalysisConfig(value as IndicatorAnalysisKind, node.config) })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {indicatorAnalysisLabel(option, evaluationMode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {kind === "QUARTILE" || kind === "PRV_QUARTILE" ? (
        <PerformanceConditionForm node={node} onChange={onChange} hideMetricSelector />
      ) : kind === "OPERATIONAL_QUARTILE" ? (
        <OperationalQuartileConditionForm node={node} onChange={onChange} />
      ) : kind === "LEGACY_PERFORMANCE" ? (
        <PerformanceConditionForm node={node} onChange={onChange} />
      ) : (
        <HistoricalConditionForm node={node} onChange={onChange} />
      )}
    </div>
  )
}
