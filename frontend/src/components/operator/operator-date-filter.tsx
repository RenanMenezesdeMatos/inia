"use client"

import { useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function OperatorDateFilter({ defaultMode = "today" }: { defaultMode?: "today" | "month" }) {
  const now = new Date()
  const [range, setRange] = useState<DateRange | undefined>(defaultMode === "today" ? { from: now, to: now } : { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now })
  const label = range?.from ? range.to && range.to.toDateString() !== range.from.toDateString() ? `${format(range.from, "dd MMM", { locale: ptBR })} – ${format(range.to, "dd MMM", { locale: ptBR })}` : format(range.from, "dd 'de' MMMM", { locale: ptBR }) : "Selecionar período"
  return <Popover><PopoverTrigger asChild><Button variant="outline" className="bg-card font-normal"><CalendarDays />{label}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="end"><Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={1}/></PopoverContent></Popover>
}
