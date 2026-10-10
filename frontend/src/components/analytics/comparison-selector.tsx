"use client"

import { GitCompareArrows } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_OPERATIONAL_COMPARISON, OPERATIONAL_COMPARISON_LABELS, operationalComparisonSchema, type OperationalComparison } from "@/schemas/analytics/analytics.schema"

/**
 * Seletor da COMPARAÇÃO do acompanhamento operacional (camada 1 — medição diária): qual janela
 * "atual" × "anterior" os cards operacionais usam. Não mexe no fechamento oficial (competência):
 * são duas coisas diferentes, lado a lado no cabeçalho. `null` = padrão (últimos 7 dias × 7
 * anteriores), que nem vai pra URL.
 */
export function ComparisonSelector({ value, onChange, disabled }: { value: OperationalComparison | null; onChange: (comparison: OperationalComparison | null) => void; disabled?: boolean }) {
  return (
    <Select value={value ?? DEFAULT_OPERATIONAL_COMPARISON} onValueChange={(next) => onChange(next === DEFAULT_OPERATIONAL_COMPARISON ? null : operationalComparisonSchema.parse(next))} disabled={disabled}>
      <SelectTrigger className="w-full bg-card sm:w-[22rem]" aria-label="Comparação operacional">
        <GitCompareArrows className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue placeholder="Comparação operacional" />
      </SelectTrigger>
      <SelectContent>
        {operationalComparisonSchema.options.map((option) => (
          <SelectItem key={option} value={option}>
            {OPERATIONAL_COMPARISON_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
