"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { aggregationOptionLabel } from "@/components/admin/workflows/indicator-select"
import { HistoricalPeriodPicker, MinimumCoverageField, aggregationsFor } from "@/components/admin/workflows/node-config/indicator-query-fields"
import type { IndicatorCriterion, PolicyCondition } from "@/schemas/admin/intervention-policy.schema"
import {
  CHANGE_MODE_LABELS,
  HISTORICAL_AGGREGATION_LABELS,
  MEASUREMENT_AGGREGATION_OPTION_LABELS,
  PERFORMANCE_METRIC_LABELS,
  defaultAggregationFor,
  describeCalendarPeriod,
  performanceMetricSchema,
  type HistoricalAggregation,
  type PerformanceMetric,
} from "@/schemas/admin/workflow-graph.schema"

import { ComparatorSelect, DecimalField, Note, NumberField, OptionSelect, ToggleField } from "../shared/fields"
import { IndicatorCodeField } from "../shared/indicator-code-field"
import { POLICY_HISTORICAL_SOURCE_LABELS, POLICY_HISTORICAL_SOURCES, QUARTILE_LABELS, QUARTILES, type PolicyHistoricalSource } from "../shared/labels"
import { defaultHistoricalCriterion, defaultPerformanceCriterion } from "./defaults"
import { usePolicyEditor } from "./editor-context"

type IndicatorCondition = Extract<PolicyCondition, { kind: "INDICATOR" }>
type HistoricalQuery = NonNullable<IndicatorCriterion["historicalQuery"]>
type PerformanceQuery = NonNullable<IndicatorCriterion["performanceQuery"]>

/**
 * Condição de indicador — o MESMO critério das Conditions do Workflow (mesmo avaliador no backend), com duas fontes:
 * o histórico do indicador (medição diária ou atingimento oficial em uma janela) ou o resultado oficial do fechamento.
 * O quartil OPERACIONAL não é oferecido: ele depende da população de um Workflow e não existe numa política.
 */
export function IndicatorConditionEditor({ condition, onChange }: { condition: IndicatorCondition; onChange: (next: PolicyCondition) => void }) {
  const { policyIndicatorCode, indicatorByCode } = usePolicyEditor()
  const labelId = useId()
  const criterion = condition.criterion
  const mode = criterion.performanceQuery ? "PERFORMANCE" : "HISTORICAL"
  const currentCode = criterion.historicalQuery?.indicatorCode ?? criterion.performanceQuery?.indicatorCode ?? policyIndicatorCode
  const setCriterion = (next: IndicatorCriterion) => onChange({ ...condition, criterion: next })

  return (
    <div className="space-y-3">
      <RadioGroup
        value={mode}
        onValueChange={(value) => setCriterion(value === "PERFORMANCE" ? defaultPerformanceCriterion(currentCode ?? null) : defaultHistoricalCriterion(currentCode ?? null, currentCode ? indicatorByCode.get(currentCode) : undefined))}
        className="grid gap-2 sm:grid-cols-2"
        aria-label="Origem do dado"
      >
        <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <RadioGroupItem value="HISTORICAL" className="mt-0.5" />
          <span>
            Histórico do indicador
            <span className="block text-xs text-muted-foreground">Medições diárias ou atingimento oficial numa janela de tempo.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <RadioGroupItem value="PERFORMANCE" className="mt-0.5" />
          <span>
            Resultado oficial do fechamento
            <span className="block text-xs text-muted-foreground">Valor, atingimento, peso ou quartil recebidos da fonte oficial.</span>
          </span>
        </label>
      </RadioGroup>

      {mode === "HISTORICAL" ? <HistoricalFields criterion={criterion} onChange={setCriterion} /> : <PerformanceFields criterion={criterion} onChange={setCriterion} />}

      <div className="space-y-1">
        <Label htmlFor={labelId} className="text-xs">
          Rótulo da condição (opcional)
        </Label>
        <Input id={labelId} value={condition.label ?? ""} maxLength={120} placeholder="Ex.: Abaixo da meta nos últimos 30 dias" onChange={(event) => onChange({ ...condition, label: event.target.value })} />
      </div>
      <Note>Sem dados suficientes, a condição fica INCONCLUSIVA — nunca é tratada como desempenho ruim.</Note>
    </div>
  )
}

function HistoricalFields({ criterion, onChange }: { criterion: IndicatorCriterion; onChange: (next: IndicatorCriterion) => void }) {
  const { readOnly, indicatorByCode } = usePolicyEditor()
  const query = criterion.historicalQuery!
  const rawSource = query.source ?? "MEASUREMENT"
  const legacyOperationalQuartile = rawSource === "OPERATIONAL_QUARTILE"
  const source: PolicyHistoricalSource = legacyOperationalQuartile ? "MEASUREMENT" : rawSource
  const isMeasurement = source === "MEASUREMENT"
  const aggregation: HistoricalAggregation = query.aggregation ?? "COUNT"
  const period = query.period ?? { kind: "ROLLING_DAYS" as const, days: 30 }
  const indicator = query.indicatorCode ? indicatorByCode.get(query.indicatorCode) : undefined
  const available = aggregationsFor(source, indicator?.operationalAggregation)
  const unsupported = !available.includes(aggregation)
  const changeMode = query.compareTo?.kind === "PREVIOUS_PERIOD" ? (query.compareTo.changeMode ?? "VALUE") : undefined
  const compareKind = query.compareTo?.kind ?? "FIXED"
  const update = (patch: Partial<HistoricalQuery>, outer: Partial<IndicatorCriterion> = {}) => onChange({ ...criterion, ...outer, historicalQuery: { ...query, ...patch } })

  function setSource(next: PolicyHistoricalSource) {
    if (next === "MEASUREMENT") {
      onChange({ ...criterion, comparator: "LT", thresholdNumeric: null, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", ...(query.indicatorCode ? { indicatorCode: query.indicatorCode } : {}), source: next, aggregation: defaultAggregationFor(indicator?.operationalAggregation), period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } } })
      return
    }
    // Fonte oficial: só entre fechamentos (média/mínimo/máximo), comparada a um valor de atingimento.
    onChange({ ...criterion, comparator: "LT", thresholdNumeric: 100, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", ...(next === "INDICATOR_ACHIEVEMENT" && query.indicatorCode ? { indicatorCode: query.indicatorCode } : {}), source: next, aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } } })
  }

  function setAggregation(next: HistoricalAggregation) {
    if (next === "COUNT") {
      onChange({ ...criterion, comparator: "GTE", thresholdNumeric: 3, historicalQuery: { ...query, aggregation: next, comparator: "LT", indicatorThreshold: 0, minimumSampleSize: undefined, minimumCoverage: undefined, compareTo: undefined, period: period.kind === "CLOSURES" ? { kind: "ROLLING_DAYS", days: 30 } : period } })
    } else {
      onChange({ ...criterion, comparator: "LT", thresholdNumeric: query.compareTo ? null : (criterion.thresholdNumeric ?? 0), historicalQuery: { ...query, aggregation: next, comparator: undefined, indicatorThreshold: undefined } })
    }
  }

  function setCompareTo(value: string) {
    if (value === "FIXED") update({ compareTo: undefined }, { thresholdNumeric: criterion.thresholdNumeric ?? 0 })
    else if (value === "GOAL") update({ compareTo: { kind: "GOAL" } }, { thresholdNumeric: null })
    else update({ compareTo: { kind: "PREVIOUS_PERIOD" } }, { thresholdNumeric: null })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      {legacyOperationalQuartile ? <Note tone="warning">Quartil operacional não está disponível em políticas: escolha outra fonte (o quartil oficial fica em &quot;Resultado oficial do fechamento&quot;).</Note> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionSelect label="Fonte dos dados" value={legacyOperationalQuartile ? undefined : source} options={POLICY_HISTORICAL_SOURCES.map((value) => ({ value, label: POLICY_HISTORICAL_SOURCE_LABELS[value] }))} onChange={setSource} />
        {source === "PRV_ACHIEVEMENT" ? (
          <p className="self-end text-xs text-muted-foreground">O PRV é consolidado — não depende de um indicador.</p>
        ) : (
          <IndicatorCodeField
            label="Indicador"
            value={query.indicatorCode}
            requirement={isMeasurement ? "ANY" : "OFFICIAL"}
            readOnly={readOnly}
            onChange={(code, picked) => {
              const kind = picked?.operationalAggregation
              const allowed = aggregationsFor(source, kind)
              const nextAggregation = aggregation !== "COUNT" && !allowed.includes(aggregation) ? defaultAggregationFor(kind) : aggregation
              const defaults = nextAggregation === "COUNT" || !isMeasurement ? {} : { minimumSampleSize: picked?.minimumSampleSize ?? query.minimumSampleSize, minimumCoverage: picked?.minimumCoverage ?? query.minimumCoverage }
              update({ indicatorCode: code ?? undefined, aggregation: nextAggregation, ...defaults })
            }}
          />
        )}
      </div>

      <div className="space-y-1">
        <OptionSelect
          label="Analisar"
          value={aggregation}
          options={(unsupported ? [aggregation, ...available] : available).map((value) => ({ value, label: isMeasurement ? aggregationOptionLabel(value, indicator) : MEASUREMENT_AGGREGATION_OPTION_LABELS[value] }))}
          onChange={setAggregation}
        />
        {aggregation === "COUNT" ? <p className="text-xs text-muted-foreground">Recorrência: conta quantas medições da janela atendem ao filtro abaixo.</p> : null}
        {unsupported ? <p className="text-xs text-destructive">&quot;{HISTORICAL_AGGREGATION_LABELS[aggregation]}&quot; não combina com esta fonte ou indicador. Escolha uma das opções válidas.</p> : null}
      </div>

      {readOnly ? (
        <p className="text-sm text-muted-foreground">Período: {describePeriod(period)}</p>
      ) : (
        <HistoricalPeriodPicker period={period} allowClosures={aggregation !== "COUNT"} closuresSource={isMeasurement ? "MEASUREMENT" : "ACHIEVEMENT"} operationalEnabled={indicator ? indicator.dailySupported : undefined} onChange={(next) => update({ period: next })} />
      )}

      {aggregation === "COUNT" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComparatorSelect label="Contar as medições com valor" value={query.comparator ?? "LT"} onChange={(comparator) => update({ comparator })} />
          <DecimalField label="Valor de referência da medição" value={query.indicatorThreshold ?? 0} onChange={(indicatorThreshold) => update({ indicatorThreshold })} />
          <ComparatorSelect label="Quantidade de ocorrências" value={criterion.comparator} onChange={(comparator) => onChange({ ...criterion, comparator })} />
          <NumberField label="Número de ocorrências" value={criterion.thresholdNumeric ?? 0} min={0} max={186} onChange={(value) => onChange({ ...criterion, thresholdNumeric: value ?? 0 })} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Mínimo de medições (opcional)" allowEmpty emptyPlaceholder="ex.: 3" value={query.minimumSampleSize ?? null} min={1} max={1000} hint="Abaixo disso a condição fica inconclusiva." onChange={(value) => update({ minimumSampleSize: value ?? undefined })} />
            {isMeasurement ? (
              readOnly ? (
                <p className="text-xs text-muted-foreground">Cobertura mínima: {query.minimumCoverage ? `${Math.round(query.minimumCoverage * 100)}%` : "não definida"}</p>
              ) : (
                <MinimumCoverageField value={query.minimumCoverage} onChange={(minimumCoverage) => update({ minimumCoverage })} />
              )
            ) : null}
          </div>
          <OptionSelect
            label="Comparar com"
            value={compareKind}
            options={[
              { value: "FIXED", label: "Um valor fixo" },
              ...(isMeasurement ? [{ value: "GOAL", label: "Meta vigente" }] : []),
              ...(period.kind !== "CLOSURES" ? [{ value: "PREVIOUS_PERIOD", label: "Mesmo período anterior" }] : []),
            ]}
            onChange={setCompareTo}
          />
          {compareKind === "GOAL" ? <p className="text-xs text-muted-foreground">A meta vigente do indicador é consultada no momento de cada avaliação.</p> : null}
          {query.compareTo?.kind === "PREVIOUS_PERIOD" ? (
            <OptionSelect label="Como comparar com o período anterior" value={changeMode} options={(["VALUE", "PERCENT"] as const).map((value) => ({ value, label: CHANGE_MODE_LABELS[value] }))} onChange={(value) => update({ compareTo: { kind: "PREVIOUS_PERIOD", ...(value === "PERCENT" ? { changeMode: "PERCENT" as const } : {}) } }, { thresholdNumeric: value === "PERCENT" ? (criterion.thresholdNumeric ?? 10) : null })} />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <ComparatorSelect label={changeMode === "PERCENT" ? "Variação" : `${HISTORICAL_AGGREGATION_LABELS[aggregation]} do período`} value={criterion.comparator} onChange={(comparator) => onChange({ ...criterion, comparator })} />
            {compareKind === "FIXED" || changeMode === "PERCENT" ? (
              <DecimalField label={changeMode === "PERCENT" ? "Variação percentual (%)" : "Valor de referência"} value={criterion.thresholdNumeric ?? 0} onChange={(thresholdNumeric) => onChange({ ...criterion, thresholdNumeric })} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

const QUARTILE_COMPARATORS = ["EQUALS", "NOT_EQUALS"] as const

function PerformanceFields({ criterion, onChange }: { criterion: IndicatorCriterion; onChange: (next: IndicatorCriterion) => void }) {
  const { readOnly } = usePolicyEditor()
  const query = criterion.performanceQuery!
  const quartile = query.metric.endsWith("_QUARTILE")
  const prv = query.metric.startsWith("PRV_")
  const recurrence = query.recurrence
  const setQuery = (next: PerformanceQuery, outer: Partial<IndicatorCriterion>) => onChange({ ...criterion, ...outer, performanceQuery: next })

  function setMetric(metric: PerformanceMetric) {
    const base: PerformanceQuery = { kind: "EMPLOYEE_PERFORMANCE", metric, ...(metric.startsWith("PRV_") || !query.indicatorCode ? {} : { indicatorCode: query.indicatorCode }) }
    if (metric.endsWith("_QUARTILE")) setQuery(base, { comparator: "EQUALS", thresholdText: "Q4", thresholdNumeric: null })
    else setQuery(base, { comparator: "LT", thresholdNumeric: metric.endsWith("_ACHIEVEMENT") ? 100 : 0, thresholdText: undefined })
  }

  function setRecurrence(enabled: boolean) {
    if (enabled) setQuery({ ...query, recurrence: { periods: 3, matchQuartile: "Q4" } }, { comparator: "GTE", thresholdNumeric: 2, thresholdText: undefined })
    else setQuery({ kind: query.kind, metric: query.metric, ...(query.indicatorCode ? { indicatorCode: query.indicatorCode } : {}) }, { comparator: "EQUALS", thresholdText: "Q4", thresholdNumeric: null })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionSelect label="Resultado" value={query.metric} options={performanceMetricSchema.options.map((value) => ({ value, label: PERFORMANCE_METRIC_LABELS[value] }))} onChange={setMetric} />
        {prv ? <p className="self-end text-xs text-muted-foreground">O PRV é consolidado — não depende de um indicador.</p> : <IndicatorCodeField label="Indicador" value={query.indicatorCode} requirement="OFFICIAL" readOnly={readOnly} onChange={(code) => setQuery({ ...query, indicatorCode: code ?? undefined }, {})} />}
      </div>
      {quartile ? (
        <>
          <ToggleField label="Recorrência nos últimos fechamentos" description="Conta em quantos dos últimos fechamentos o quartil apareceu, em vez de olhar só o mais recente." checked={Boolean(recurrence)} onChange={setRecurrence} />
          {recurrence ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Últimos fechamentos" value={recurrence.periods} min={2} max={24} onChange={(value) => setQuery({ ...query, recurrence: { ...recurrence, periods: value ?? 2 } }, {})} />
              <OptionSelect label="Quartil procurado" value={recurrence.matchQuartile} options={QUARTILES.map((value) => ({ value, label: QUARTILE_LABELS[value] }))} onChange={(matchQuartile) => setQuery({ ...query, recurrence: { ...recurrence, matchQuartile } }, {})} />
              <ComparatorSelect label="Quantidade de fechamentos" value={criterion.comparator} onChange={(comparator) => onChange({ ...criterion, comparator })} />
              <NumberField label="Número de fechamentos" value={criterion.thresholdNumeric ?? 0} min={0} max={24} onChange={(value) => onChange({ ...criterion, thresholdNumeric: value ?? 0 })} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <OptionSelect label="Quartil oficial" value={(QUARTILE_COMPARATORS as readonly string[]).includes(criterion.comparator) ? (criterion.comparator as (typeof QUARTILE_COMPARATORS)[number]) : undefined} options={[{ value: "EQUALS", label: "é" }, { value: "NOT_EQUALS", label: "não é" }]} onChange={(comparator) => onChange({ ...criterion, comparator })} />
              <OptionSelect label="Quartil" value={QUARTILES.find((value) => value === criterion.thresholdText)} options={QUARTILES.map((value) => ({ value, label: QUARTILE_LABELS[value] }))} onChange={(thresholdText) => onChange({ ...criterion, thresholdText })} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Q1 = melhor quartil, Q4 = pior. O quartil vem pronto da fonte oficial — a INIA nunca o recalcula.</p>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComparatorSelect label={PERFORMANCE_METRIC_LABELS[query.metric]} value={criterion.comparator} onChange={(comparator) => onChange({ ...criterion, comparator })} />
          <DecimalField label={query.metric.endsWith("_ACHIEVEMENT") ? "Atingimento de referência (%)" : "Valor de referência"} value={criterion.thresholdNumeric ?? 0} onChange={(thresholdNumeric) => onChange({ ...criterion, thresholdNumeric })} />
        </div>
      )}
    </div>
  )
}

function describePeriod(period: NonNullable<HistoricalQuery["period"]>): string {
  if (period.kind === "ROLLING_DAYS") return `últimos ${period.days} dias`
  if (period.kind === "CLOSURES") return `últimos ${period.count} fechamentos mensais`
  return describeCalendarPeriod(period.unit, period.phase)
}
