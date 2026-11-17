"use client"

import { CalendarDays, CalendarX2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateRangePicker, rangeText } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/states"
import type { FollowUpPeriod } from "./follow-up-timeline"

/**
 * Calendário do Acompanhamento — o `DateRangePicker` do kit (atalhos + Limpar). Vazio = visão inicial: todas as ações. Um clique
 * escolhe um dia; o segundo fecha o período. O recorte filtra o feed pelo mesmo instante que dá o rótulo do dia de cada item.
 */
export function FollowUpPeriodPicker({ value, onChange }: { value: FollowUpPeriod; onChange: (value: FollowUpPeriod) => void }) {
  return <DateRangePicker value={value} onChange={onChange} placeholder="Todo o período" clearable highlightActive aria-label="Filtrar o Acompanhamento por período" className="bg-card" />
}

const isActive = (period: FollowUpPeriod) => Boolean(period.from || period.to)

/** Faixa logo abaixo do cabeçalho enquanto há recorte: diz qual é e como voltar a ver tudo (some na visão inicial). */
export function FollowUpPeriodBar({ value, onClear }: { value: FollowUpPeriod; onClear: () => void }) {
  if (!isActive(value)) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/5 px-5 py-2 text-sm" data-testid="follow-up-period-bar" role="status">
      <CalendarDays aria-hidden className="size-4 shrink-0 text-primary dark:text-chart-4" />
      <p className="min-w-0 flex-1">
        <span className="text-muted-foreground"><span className="max-sm:hidden">Mostrando ações</span><span className="sm:hidden">Ações</span> de </span>
        <strong className="whitespace-nowrap font-medium tabular-nums">{rangeText(value, "")}</strong>
      </p>
      <Button type="button" variant="ghost" size="sm" className="-my-1 h-8" onClick={onClear} aria-label="Ver todo o período">
        <X data-icon="inline-start" /> <span className="sm:hidden">Ver tudo</span><span className="max-sm:hidden">Ver todo o período</span>
      </Button>
    </div>
  )
}

/** Nada no recorte: a seção continua montada (cabeçalho, faixa do período) e o vazio oferece o caminho de volta. */
export function FollowUpPeriodEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="py-6">
      <EmptyState
        icon={CalendarX2}
        title="Nenhuma ação neste período"
        description="Escolha outro dia ou período no calendário."
        action={<Button type="button" variant="outline" size="sm" onClick={onClear}>Ver todo o período</Button>}
      />
    </div>
  )
}
