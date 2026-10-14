"use client"

import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { IndicatorSelect, indicatorMeetsRequirement, useIndicatorCatalog, type IndicatorRequirement } from "@/components/admin/workflows/indicator-select"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { useEditorCatalogQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

/**
 * Indicador de uma política, condição ou competência — o MESMO seletor dos Workflows (catálogo dinâmico, filtrado pela
 * capacidade que o uso exige). Quem edita políticas sem acesso à tela de indicadores escolhe pelo catálogo do editor de
 * políticas (código, nome e capacidades), com o mesmo filtro; a publicação confere de novo no backend.
 */
export function IndicatorCodeField({
  label,
  value,
  requirement = "ANY",
  clearLabel,
  readOnly = false,
  onChange,
}: {
  label: string
  value: string | null | undefined
  requirement?: IndicatorRequirement
  /** Quando definido, o campo aceita "nenhum" (null) e mostra este texto para a escolha vazia. */
  clearLabel?: string
  readOnly?: boolean
  onChange: (code: string | null, indicator: IndicatorWithRules | undefined) => void
}) {
  const id = useId()
  const query = useIndicatorsWithRulesQuery()
  const { byCode } = useIndicatorCatalog()
  const editorCatalog = useEditorCatalogQuery()
  const fallback = editorCatalog.data?.indicators ?? []
  const current = value ? byCode.get(value) : undefined
  const fallbackCurrent = value ? fallback.find((indicator) => indicator.code === value) : undefined
  const fallbackOptions = fallback.filter((indicator) => indicator.code === value || (indicator.active && indicatorMeetsRequirement(indicator, requirement)))

  if (readOnly) {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        <p className="text-sm">{value ? (current?.name ?? fallbackCurrent?.name ?? value) : (clearLabel ?? "—")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {query.isError ? (
        <Select value={value ?? undefined} onValueChange={(code) => onChange(code, undefined)}>
          <SelectTrigger id={id} className="w-full" aria-label={label}>
            <SelectValue placeholder={editorCatalog.isLoading ? "Carregando…" : "Escolha o indicador"} />
          </SelectTrigger>
          <SelectContent>
            {fallbackOptions.map((indicator) => (
              <SelectItem key={indicator.code} value={indicator.code}>
                {indicator.name} · {indicator.code}
                {indicator.active ? "" : " (desativado)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <IndicatorSelect value={value ?? undefined} requirement={requirement} ariaLabel={label} onValueChange={(code, indicator) => onChange(code, indicator)} />
      )}
      {clearLabel ? (
        value ? (
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => onChange(null, undefined)}>
            Usar: {clearLabel}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Atual: {clearLabel}</p>
        )
      ) : null}
    </div>
  )
}
