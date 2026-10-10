"use client"

import { CalendarDays } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Seletor global de competência (AAAA-MM) — a fonte oficial só existe por mês fechado, então não
 * há intervalo livre de dias aqui. Uma única competência governa todos os cards da tela. */
export function PeriodSelector({ periods, value, onChange, disabled }: { periods: { period: string; label: string }[]; value: string | null; onChange: (period: string) => void; disabled?: boolean }) {
  const options = value && !periods.some((entry) => entry.period === value) ? [{ period: value, label: value }, ...periods] : periods
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <SelectTrigger className="w-full bg-card sm:w-52" aria-label="Período">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue placeholder="Período" />
      </SelectTrigger>
      <SelectContent>
        {options.map((entry) => (
          <SelectItem key={entry.period} value={entry.period}>
            {entry.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
