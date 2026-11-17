"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type PickerOption = { value: string; label: string; hint?: string | null }

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR")
/** Itens mostrados de uma vez (catálogos com milhares de produtos): a busca estreita. */
const VISIBLE_LIMIT = 80

/**
 * Escolha com busca num Popover (Grupos, Subgrupos, produto relacionado). `multiple` = marca vários; senão escolher fecha.
 * Os escolhidos aparecem como selos removíveis abaixo do gatilho (quem lê vê o público sem abrir nada).
 */
export function SearchablePicker({ id, label, placeholder, options, values, onChange, multiple = false, emptyText = "Nada encontrado." }: {
  id: string
  label: string
  placeholder: string
  options: readonly PickerOption[]
  values: readonly string[]
  onChange: (values: string[]) => void
  multiple?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const term = normalize(query.trim())
    const matches = term ? options.filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(term)) : options
    return matches.slice(0, VISIBLE_LIMIT)
  }, [options, query])
  const selected = values.map((value) => options.find((option) => option.value === value) ?? { value, label: "Item indisponível" })

  function toggle(value: string) {
    if (!multiple) {
      onChange(values.includes(value) ? [] : [value])
      setOpen(false)
      return
    }
    onChange(values.includes(value) ? values.filter((current) => current !== value) : [...values, value])
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="w-full justify-between font-normal" aria-label={label}>
            <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
              {values.length === 0 ? placeholder : multiple ? `${values.length} ${values.length === 1 ? "selecionado" : "selecionados"}` : selected[0]?.label}
            </span>
            <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`} className="pl-8" />
          </div>
          <ul role="listbox" aria-multiselectable={multiple} aria-label={label} className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? <li className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</li> : null}
            {filtered.map((option) => {
              const checked = values.includes(option.value)
              return (
                <li key={option.value} role="option" aria-selected={checked}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => toggle(option.value)}>
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border border-border", checked && "border-primary bg-primary text-primary-foreground")}>{checked ? <Check className="size-3" /> : null}</span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint ? <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
      {multiple && selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <Badge key={option.value} variant="secondary" className="gap-1 pr-1">
              {option.label}
              <button type="button" className="rounded-full p-0.5 hover:bg-foreground/10" aria-label={`Remover ${option.label}`} onClick={() => toggle(option.value)}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
