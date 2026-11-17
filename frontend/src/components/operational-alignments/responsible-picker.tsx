"use client"

import { useState } from "react"
import { Check, ChevronDown, Search, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"
import { useResponsibleOptionsQuery } from "@/queries/operational-alignments/use-operational-alignment-queries"
import type { ResponsibleOption } from "@/schemas/operational-alignments/operational-alignment.schema"

/**
 * Responsável pela decisão do alinhamento (221): quem DEFINIU a orientação — liderança ativa da organização, buscada no servidor pelo
 * nome. Vazio = quem está cadastrando. O cargo mostrado é o do cadastro; o servidor o copia ao salvar e ao publicar.
 */
export function ResponsiblePicker({ id, value, current, onChange }: { id: string; value: string | null; current: ResponsibleOption | null; onChange: (option: ResponsibleOption | null) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search.trim(), 250)
  const options = useResponsibleOptionsQuery(debounced, open)
  const label = value && current ? `${current.name}${current.jobTitle ? ` · ${current.jobTitle}` : ""}` : "Você (quem está cadastrando)"
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch("") }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className="w-full justify-between font-normal" aria-label="Responsável pela decisão">
          <span className="flex min-w-0 items-center gap-2"><UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{label}</span></span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar liderança pelo nome" aria-label="Buscar responsável" className="pl-8" />
        </div>
        <ul role="listbox" aria-label="Responsável" className="max-h-64 overflow-y-auto p-1">
          {options.isLoading ? <li className="px-2 py-3 text-center text-sm text-muted-foreground">Buscando…</li> : null}
          {options.isError ? <li className="px-2 py-3 text-center text-sm text-destructive">Não foi possível buscar agora.</li> : null}
          {options.data && options.data.length === 0 ? <li className="px-2 py-3 text-center text-sm text-muted-foreground">Nenhuma liderança encontrada.</li> : null}
          {(options.data ?? []).map((option) => {
            const selected = option.id === value
            return (
              <li key={option.id} role="option" aria-selected={selected}>
                <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { onChange(option); setOpen(false) }}>
                  <Check className={cn("size-4 shrink-0", selected ? "opacity-100 text-primary" : "opacity-0")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.jobTitle ? <span className="shrink-0 text-xs text-muted-foreground">{option.jobTitle}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
