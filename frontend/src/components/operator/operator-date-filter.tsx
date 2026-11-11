"use client"

import { useState } from "react"

import { DateRangePicker, presetRangeById, type CivilDateRange } from "@/components/ui/date-picker"

/**
 * Período do cabeçalho do feed do Acompanhamento, no MODELO ÚNICO de calendário do app (`DateRangePicker` do kit, com os atalhos).
 * Começa em "Hoje" (ou "Este mês"). Continua sem filtrar o conteúdo do feed — era assim antes da padronização (2026-11-10): ligar o
 * período ao que o feed mostra é outra mudança, ainda não pedida.
 */
export function OperatorDateFilter({ defaultMode = "today" }: { defaultMode?: "today" | "month" }) {
  const [range, setRange] = useState<CivilDateRange>(() => presetRangeById(defaultMode === "today" ? "today" : "this-month"))
  return <DateRangePicker value={range} onChange={setRange} aria-label="Período" className="bg-card" />
}
