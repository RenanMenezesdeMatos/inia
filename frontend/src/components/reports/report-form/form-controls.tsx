"use client"

import type { ReactNode } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Peças pequenas do formulário de report. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function OptionSelect<V extends string>({ value, onChange, options, placeholder, ariaLabel }: { value: V | undefined; onChange: (value: V) => void; options: { value: V; label: string }[]; placeholder?: string; ariaLabel: string }) {
  return (
    <Select value={value ?? ""} onValueChange={(next) => onChange(next as V)}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder ?? "Escolha"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Seleção múltipla em fichas (sem Popover: legível em telas pequenas e em teste). */
export function ChipToggleGroup({ options, selected, onChange, ariaLabel, empty }: { options: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void; ariaLabel: string; empty?: string }) {
  if (options.length === 0) return <p className="text-xs text-muted-foreground">{empty ?? "Nenhuma opção."}</p>
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((value) => value !== option.value) : [...selected, option.value])}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
