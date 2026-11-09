"use client"

import { useState } from "react"
import { Columns3, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ExplorerColumn } from "@/schemas/admin/data-explorer.schema"

import { COLUMN_TYPE_LABELS } from "./explorer-filter-model"

/** Colunas do conjunto, com o tipo de cada uma. A troca só vale ao fechar: cada consulta conta no limite por minuto, então marcar três colunas não gasta três. */
export function ColumnPicker({ columns, selected, maxSelected, onApply }: { columns: readonly ExplorerColumn[]; selected: readonly string[]; maxSelected: number; onApply: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([...selected])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setDraft([...selected])
      return
    }
    const ordered = columns.filter((column) => draft.includes(column.key)).map((column) => column.key)
    const changed = ordered.length !== selected.length || ordered.some((key) => !selected.includes(key))
    if (changed && ordered.length > 0) onApply(ordered)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 data-icon="inline-start" /> Colunas ({selected.length} de {columns.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border p-3">
          <p className="text-sm font-medium">Colunas e tipos</p>
          <p className="text-xs text-muted-foreground">Até {maxSelected} colunas. Vale ao fechar esta lista.</p>
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
          {columns.map((column) => {
            const checked = draft.includes(column.key)
            return (
              <li key={column.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={checked} disabled={!checked && draft.length >= maxSelected} onCheckedChange={(value) => setDraft((current) => (value === true ? [...current, column.key] : current.filter((key) => key !== column.key)))} />
                  <span className="min-w-0 flex-1 truncate">{column.label}</span>
                  {column.personal ? <ShieldAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Dado pessoal" /> : null}
                  <span className="shrink-0 text-xs text-muted-foreground">{COLUMN_TYPE_LABELS[column.type]}</span>
                </label>
              </li>
            )
          })}
        </ul>
        {draft.length === 0 ? <p className="border-t border-border p-3 text-xs text-destructive">Escolha ao menos uma coluna.</p> : null}
      </PopoverContent>
    </Popover>
  )
}
