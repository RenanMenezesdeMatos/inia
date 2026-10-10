"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"
import type { HistoricalAggregation, OperationalAggregationKind } from "@/schemas/admin/workflow-graph.schema"
import { defaultAggregationFor, MEASUREMENT_AGGREGATION_OPTION_LABELS } from "@/schemas/admin/workflow-graph.schema"

/**
 * Seletor ÚNICO de indicador do editor de Workflows — descobre o catálogo dinamicamente
 * (`useIndicatorsWithRulesQuery`, nunca enum) e filtra pela CAPACIDADE que o uso exige:
 * - OPERATIONAL: medição operacional habilitada (janelas de dias/semana, quartil operacional);
 * - OFFICIAL: fechamento oficial habilitado (atingimento/quartil/fechamentos);
 * - ANY: qualquer indicador ativo (Valor do indicador com período mensal, gatilho, agenda).
 * Indicador desativado ou incompatível nunca entra numa escolha NOVA; se um Workflow existente já
 * aponta pra ele, continua visível (marcado) pra auditoria — a referência nunca some sozinha.
 */
export type IndicatorRequirement = "ANY" | "OPERATIONAL" | "OFFICIAL"

export function indicatorMeetsRequirement(indicator: Pick<IndicatorWithRules, "dailySupported" | "officialClosureSupported">, requirement: IndicatorRequirement): boolean {
  if (requirement === "OPERATIONAL") return indicator.dailySupported
  if (requirement === "OFFICIAL") return indicator.officialClosureSupported
  return true
}

export function describeIndicatorMismatch(indicator: IndicatorWithRules | undefined, requirement: IndicatorRequirement): string | null {
  if (!indicator) return "não existe mais no catálogo"
  if (!indicator.active) return "desativado"
  if (!indicatorMeetsRequirement(indicator, requirement)) return requirement === "OPERATIONAL" ? "sem medição operacional" : "sem fechamento oficial"
  return null
}

export function useIndicatorCatalog() {
  const query = useIndicatorsWithRulesQuery()
  const byCode = new Map((query.data ?? []).map((indicator) => [indicator.code, indicator]))
  return { list: query.data ?? [], byCode, isLoading: query.isLoading }
}

/** Rótulo de uma opção de "Analisar": a agregação NATURAL do indicador ganha o texto funcional
 * derivado pelo catálogo (estratégia + unidade); as demais mantêm o rótulo genérico. */
export function aggregationOptionLabel(aggregation: HistoricalAggregation, indicator: IndicatorWithRules | undefined): string {
  if (indicator?.calculation && aggregation === defaultAggregationFor(indicator.operationalAggregation as OperationalAggregationKind)) {
    return `Cálculo no período: ${indicator.calculation.label}`
  }
  return MEASUREMENT_AGGREGATION_OPTION_LABELS[aggregation]
}

export function IndicatorSelect({
  value,
  requirement,
  onValueChange,
  ariaLabel = "Indicador",
}: {
  value: string | undefined
  requirement: IndicatorRequirement
  onValueChange: (indicatorCode: string, indicator: IndicatorWithRules | undefined) => void
  ariaLabel?: string
}) {
  const { list, byCode } = useIndicatorCatalog()
  const selectable = list.filter((indicator) => indicator.active && indicatorMeetsRequirement(indicator, requirement))
  const current = value ? byCode.get(value) : undefined
  const mismatch = value ? describeIndicatorMismatch(current, requirement) : null
  const showCurrentAsLegacy = Boolean(value) && mismatch !== null
  return (
    <div className="space-y-1">
      <Select value={value ?? ""} onValueChange={(code) => onValueChange(code, byCode.get(code))}>
        <SelectTrigger className="w-full" aria-label={ariaLabel}>
          <SelectValue placeholder="Selecione o indicador" />
        </SelectTrigger>
        <SelectContent>
          {showCurrentAsLegacy ? (
            <SelectItem value={value!}>
              {current?.name ?? value} ({mismatch})
            </SelectItem>
          ) : null}
          {selectable.map((indicator) => (
            <SelectItem key={indicator.code} value={indicator.code}>
              {indicator.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showCurrentAsLegacy ? (
        <p className="text-xs text-destructive">
          Este indicador está {mismatch} — a publicação vai rejeitar. Escolha outro indicador ou ajuste o catálogo.
        </p>
      ) : null}
    </div>
  )
}
