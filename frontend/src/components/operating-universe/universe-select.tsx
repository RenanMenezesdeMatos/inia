"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OPERATING_UNIVERSE_DESCRIPTIONS, OPERATING_UNIVERSES, type OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const PENDING = "__PENDING__"

/**
 * Seletor do universo de atuação (B2B, B2C, B2X). `allowPending` só para registro legado ainda não classificado (a organização sem a
 * exigência ativa); `allowed` restringe às opções compatíveis (ex.: produtos de uma base B2B). O backend confere tudo de novo.
 */
export function UniverseSelect({
  id,
  value,
  onChange,
  allowPending = false,
  disabled,
  allowed,
  "aria-describedby": describedBy,
}: {
  id?: string
  value: OperatingUniverse | null
  onChange: (value: OperatingUniverse | null) => void
  allowPending?: boolean
  disabled?: boolean
  allowed?: readonly OperatingUniverse[]
  "aria-describedby"?: string
}) {
  const options = OPERATING_UNIVERSES.filter((universe) => !allowed || allowed.includes(universe))
  return (
    <Select value={value ?? (allowPending ? PENDING : "")} onValueChange={(next) => onChange(next === PENDING ? null : (next as OperatingUniverse))} disabled={disabled}>
      <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
        <SelectValue placeholder="Escolha o universo" />
      </SelectTrigger>
      <SelectContent>
        {options.map((universe) => (
          <SelectItem key={universe} value={universe}>
            {universe} — {OPERATING_UNIVERSE_DESCRIPTIONS[universe]}
          </SelectItem>
        ))}
        {allowPending ? <SelectItem value={PENDING}>Pendente (classificar depois)</SelectItem> : null}
      </SelectContent>
    </Select>
  )
}
