"use client"

import type { LucideIcon } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DISPLAY_ICONS, DISPLAY_ICON_KEYS, isDisplayIconKey, type DisplayIconKey } from "@/lib/display-icons"

const DEFAULT_VALUE = "__default__"

/**
 * Escolha do ícone de uma flag ou indicador (catálogo fechado). "Padrão" = sem ícone configurado: o Acompanhamento usa o ícone
 * pelo comportamento (tipo de valor da flag / unidade do indicador), mostrado aqui como prévia.
 */
export function DisplayIconSelect({ id, value, onChange, defaultIcon, defaultLabel, ariaLabel }: { id?: string; value: DisplayIconKey | null; onChange: (value: DisplayIconKey | null) => void; defaultIcon: LucideIcon; defaultLabel: string; ariaLabel: string }) {
  const DefaultIcon = defaultIcon
  return (
    <Select value={value ?? DEFAULT_VALUE} onValueChange={(next) => onChange(isDisplayIconKey(next) ? next : null)}>
      <SelectTrigger id={id} className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={DEFAULT_VALUE}>
          <DefaultIcon aria-hidden />
          {defaultLabel}
        </SelectItem>
        {DISPLAY_ICON_KEYS.map((key) => {
          const { icon: Icon, label } = DISPLAY_ICONS[key]
          return (
            <SelectItem key={key} value={key}>
              <Icon aria-hidden />
              {label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
