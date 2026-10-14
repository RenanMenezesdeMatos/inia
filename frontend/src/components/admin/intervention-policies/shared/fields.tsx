"use client"

import { useId, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { NUMERIC_COMPARATOR_LABELS, NUMERIC_COMPARATORS, type ConfigIssue, type NumericComparator } from "@/schemas/admin/intervention-policy.schema"

/** Peças de formulário da administração de políticas: rótulo sempre ligado ao controle, sem estado escondido. */

/**
 * Inteiro com limites: enquanto se digita o texto fica livre (dá para apagar e redigitar); ao sair do campo o valor volta para
 * dentro dos limites — o estado nunca fica vazio quando o contrato exige número.
 */
export function NumberField({ label, value, min, max, disabled, hint, allowEmpty = false, emptyPlaceholder, className, onChange }: { label: string; value: number | null; min: number; max: number; disabled?: boolean; hint?: string; allowEmpty?: boolean; emptyPlaceholder?: string; className?: string; onChange: (value: number | null) => void }) {
  const id = useId()
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value === null ? "" : String(value))
  const outOfRange = value !== null && (value < min || value > max)
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="w-32"
        min={min}
        max={max}
        value={shown}
        placeholder={emptyPlaceholder}
        disabled={disabled}
        aria-invalid={outOfRange || undefined}
        onChange={(event) => {
          const raw = event.target.value.trim()
          setText(raw)
          if (raw === "") {
            if (allowEmpty) onChange(null)
            return
          }
          const parsed = Math.round(Number(raw))
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
        onBlur={() => {
          const raw = text
          setText(null)
          if (raw === "" && !allowEmpty) onChange(value ?? min)
          else if (value !== null && outOfRange) onChange(Math.min(max, Math.max(min, value)))
        }}
      />
      {outOfRange ? <p className="text-xs text-destructive">Use um valor entre {min} e {max}.</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Número decimal livre (limiares de indicador): o backend valida a combinação. */
export function DecimalField({ label, value, disabled, hint, onChange }: { label: string; value: number | null | undefined; disabled?: boolean; hint?: string; onChange: (value: number) => void }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} type="number" step="any" className="w-36" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(Number(event.target.value) || 0)} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function OptionSelect<V extends string>({ label, value, options, disabled, placeholder, className, onChange }: { label: string; value: V | undefined; options: { value: V; label: string }[]; disabled?: boolean; placeholder?: string; className?: string; onChange: (value: V) => void }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? ""} onValueChange={(next) => onChange(next as V)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={placeholder ?? "Selecione"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ComparatorSelect({ label, value, disabled, only, onChange }: { label: string; value: string; disabled?: boolean; only?: readonly NumericComparator[]; onChange: (value: NumericComparator) => void }) {
  const comparators = only ?? NUMERIC_COMPARATORS
  return <OptionSelect label={label} value={(comparators as readonly string[]).includes(value) ? (value as NumericComparator) : undefined} disabled={disabled} options={comparators.map((comparator) => ({ value: comparator, label: NUMERIC_COMPARATOR_LABELS[comparator] }))} onChange={onChange} />
}

export function ToggleField({ label, description, checked, disabled, onChange }: { label: string; description?: ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

export function CheckboxList<V extends string>({ legend, options, values, disabled, emptyText, onChange }: { legend: string; options: { value: V; label: string; description?: string; disabled?: boolean }[]; values: readonly V[]; disabled?: boolean; emptyText?: string; onChange: (values: V[]) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">{legend}</legend>
      {options.length === 0 ? <p className="text-xs text-muted-foreground">{emptyText ?? "Nenhuma opção disponível."}</p> : null}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map((option) => {
          const checked = values.includes(option.value)
          return (
            <label key={option.value} className={cn("flex items-start gap-2 text-sm", (disabled || option.disabled) && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={checked}
                disabled={disabled || option.disabled}
                onChange={(event) => onChange(event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value))}
              />
              <span>
                {option.label}
                {option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Lista de chaves digitadas (KP-…, KC-…, BEHAVIOR:…): o padrão é conferido antes de entrar; o backend confere de novo. */
export function KeyChipsInput({ label, values, pattern, placeholder, hint, disabled, normalize, onChange }: { label: string; values: string[]; pattern: RegExp; placeholder: string; hint: string; disabled?: boolean; normalize?: (raw: string) => string; onChange: (values: string[]) => void }) {
  const id = useId()
  const [draft, setDraft] = useState("")
  const value = normalize ? normalize(draft) : draft.trim()
  const invalid = value !== "" && !pattern.test(value)
  const duplicated = values.includes(value)
  const add = () => {
    if (!value || invalid || duplicated) return
    onChange([...values, value])
    setDraft("")
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((item) => (
          <Badge key={item} variant="outline" className="gap-1 font-mono">
            {item}
            {disabled ? null : (
              <button type="button" aria-label={`Remover ${item}`} onClick={() => onChange(values.filter((current) => current !== item))}>
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        {values.length === 0 ? <span className="text-xs text-muted-foreground">Nenhuma.</span> : null}
      </div>
      {disabled ? null : (
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                add()
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={!value || invalid || duplicated} onClick={add}>
            Adicionar
          </Button>
        </div>
      )}
      <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>{invalid ? `Formato inválido. ${hint}` : duplicated ? "Esta chave já está na lista." : hint}</p>
    </div>
  )
}

export function Note({ tone = "info", children, className }: { tone?: "info" | "warning"; children: ReactNode; className?: string }) {
  const Icon = tone === "warning" ? AlertTriangle : Info
  return (
    <div className={cn("flex items-start gap-2 rounded-md p-2 text-xs", tone === "warning" ? "border border-amber-500/30 bg-amber-500/5 text-foreground" : "bg-muted/50 text-muted-foreground", className)}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "warning" && "text-amber-600 dark:text-amber-400")} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

/** Pendências de configuração devolvidas pelo backend (validação ou publicação). */
export function IssuesPanel({ title = "Antes de publicar", issues, success }: { title?: string; issues: ConfigIssue[]; success?: string | null }) {
  if (issues.length === 0) {
    if (!success) return null
    return (
      <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-sm" role="status">
        <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> {success}
      </p>
    )
  }
  return (
    <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert" data-testid="config-issues">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.path}:${issue.code}:${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  )
}

export function InlineIssues({ issues }: { issues: ConfigIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
      {issues.map((issue, index) => (
        <li key={`${issue.path}:${issue.code}:${index}`}>{issue.message}</li>
      ))}
    </ul>
  )
}
