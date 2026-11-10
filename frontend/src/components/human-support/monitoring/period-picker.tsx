"use client"

import { useId } from "react"

import { DateRangePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"

/** Período do painel: datas civis ("AAAA-MM-DD", no fuso da organização no servidor), de 1 a 92 dias contando os dois extremos. */
export type PanelPeriod = { from: string; to: string }
export const MAX_PANEL_DAYS = 92
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000
const fromDayNumber = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10)

/** Hoje no calendário de quem está vendo. */
export function civilToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** Padrão: os últimos 30 dias, incluindo hoje. */
export function defaultPanelPeriod(now: Date = new Date()): PanelPeriod {
  const to = civilToday(now)
  return { from: fromDayNumber(dayNumber(to) - 29), to }
}

/** A mesma regra do servidor (que responde 422 `PERIOD_TOO_LONG` acima de 92 dias). */
export function panelPeriodError(period: PanelPeriod): string | null {
  if (!CIVIL_DATE.test(period.from) || !CIVIL_DATE.test(period.to)) return "Informe as duas datas."
  const days = dayNumber(period.to) - dayNumber(period.from) + 1
  if (days < 1) return "A data inicial precisa ser antes da final."
  if (days > MAX_PANEL_DAYS) return `Escolha um período de até ${MAX_PANEL_DAYS} dias.`
  return null
}

/**
 * Período do painel no seletor de período do app (calendário em português, `dd/MM/aaaa`), com "Aplicar": o painel só muda com um
 * período completo e válido (1 a 92 dias); um período inválido não pode ser aplicado e o motivo aparece no próprio calendário.
 */
export function PeriodPicker({ value, onChange }: { value: PanelPeriod; onChange: (period: PanelPeriod) => void }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">Período</Label>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          id={id}
          value={value}
          confirm={{ validate: panelPeriodError }}
          onChange={(next) => {
            if (next.from && next.to) onChange({ from: next.from, to: next.to })
          }}
          className="sm:min-w-60"
        />
        <span className="text-xs text-muted-foreground">Até {MAX_PANEL_DAYS} dias.</span>
      </div>
    </div>
  )
}
