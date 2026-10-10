"use client"

import { LayoutGrid, List } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ListViewMode } from "@/hooks/use-admin-list-state"

export function ListViewToggle({ value, onChange }: { value: ListViewMode; onChange: (value: ListViewMode) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label="Modo de visualização"
      className="shrink-0 self-start sm:self-auto"
      onValueChange={(next) => {
        // Radix devolve "" ao clicar no item já ativo — o modo atual continua selecionado.
        if (next === "list" || next === "cards") onChange(next)
      }}
    >
      <ToggleGroupItem value="list" aria-label="Lista">
        <List /> <span className="hidden sm:inline">Lista</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="cards" aria-label="Cards">
        <LayoutGrid /> <span className="hidden sm:inline">Cards</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
