"use client"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { MemoryFilters } from "@/schemas/diagnostics/diagnostics-memory.schema"
import { memoryExportHref } from "@/services/diagnostics/diagnostics-memory-service"

/**
 * Abrir as chamadas de um recorte, já na situação pedida (desvios por padrão). `kind` diz o que é o recorte (o cabeçalho e o painel de
 * "quem/onde mais erra" mudam com ele); `context` = o tema/grupo ao lado do título; `description` = a conduta completa de um ponto.
 */
export type DrillKind = "POINT" | "DOCUMENT" | "PERSON" | "GROUP" | "SUBJECT"
export type Drill = { title: string; filters: MemoryFilters; status?: "DEVIATION" | "MET"; kind?: DrillKind; context?: string | null; description?: string | null }

export function ExportLink({ filters, view, extra }: { filters: MemoryFilters; view: string; extra?: Record<string, string | null | undefined> }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={memoryExportHref(filters, view, extra)} download><Download data-icon="inline-start" /> Exportar CSV</a>
    </Button>
  )
}

export const plural = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`

/** Taxa em % com uma casa (a mesma regra das taxas do backend); sem denominador = null ("—"). */
export const rateOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
