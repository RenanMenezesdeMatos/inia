"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Blocos visuais simples do laboratório (controles nativos: é uma ferramenta de desenvolvimento). */

export function LabSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

export function LabSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: ReadonlyArray<Option<T>>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm font-normal disabled:opacity-60"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function LabRange({
  label,
  value,
  min,
  max,
  step,
  format = (current) => current.toFixed(2),
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-2 text-xs">
      <span className="font-medium">{label}</span>
      <input type="range" aria-label={label} className="accent-primary" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="text-right font-mono tabular-nums text-muted-foreground">{format(value)}</span>
    </label>
  )
}

export function LabCheckbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium">
      <input type="checkbox" className="accent-primary" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

export function LabNumber({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium">
      {label}
      <input
        type="number"
        className="h-7 w-20 rounded-md border bg-background px-2 text-sm font-normal tabular-nums"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
        }}
      />
      {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
    </label>
  )
}
