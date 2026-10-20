"use client"

import { useId, useMemo, useState } from "react"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { ClarificationOption, ClarificationStep } from "@/schemas/knowledge-clarification/clarification.schema"

/** A partir de quantas opções a lista ganha busca (nenhuma opção é escondida sem a pessoa pedir). */
export const SEARCHABLE_FROM = 8
const NONE = "__none__"

export type ClarificationFormAnswer = { optionIds: string[]; freeText?: string; noneMatched: boolean }

type ClarificationFormProps = {
  step: ClarificationStep
  /** Correção: a escolha anterior vem marcada. */
  initial?: { optionIds: string[]; freeText: string | null; noneMatched: boolean } | null
  disabled?: boolean
  submitLabel?: string
  onSubmit: (answer: ClarificationFormAnswer) => void
  onCancel?: () => void
}

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/**
 * Formulário de UMA etapa do esclarecimento pelas bases, dentro do chat. Seleção única (rádio) quando as alternativas se excluem,
 * múltipla (caixas) quando a etapa permite; sempre com "nenhuma das opções corresponde" e um complemento em texto livre. Muitas
 * opções ganham busca e, quando as fontes agrupam os cenários, grupos — as selecionadas nunca somem da lista. Tudo texto puro:
 * rótulos e descrições vêm validados do backend. A fonte de cada opção não aparece aqui (conversa natural): fica na trilha de
 * auditoria (Monitoramento › Conversas com a INIA).
 */
export function ClarificationForm({ step, initial = null, disabled = false, submitLabel = "Continuar", onSubmit, onCancel }: ClarificationFormProps) {
  const baseId = useId()
  const [selected, setSelected] = useState<string[]>(initial?.optionIds ?? [])
  const [noneMatched, setNoneMatched] = useState(initial?.noneMatched ?? false)
  const [freeText, setFreeText] = useState(initial?.freeText ?? "")
  const [query, setQuery] = useState("")
  const multiple = step.selectionMode === "MULTIPLE"
  const searchable = step.options.length >= SEARCHABLE_FROM

  const visible = useMemo(() => {
    const term = normalize(query.trim())
    if (!term) return step.options
    return step.options.filter((option) => selected.includes(option.id) || [option.label, option.description ?? "", option.group ?? "", ...option.evidence.map((source) => source.documentTitle)].some((text) => normalize(text).includes(term)))
  }, [query, step.options, selected])

  // Grupos só quando as fontes agruparam os cenários; a ordem é a de chegada.
  const groups = useMemo(() => {
    if (!step.options.some((option) => option.group)) return [{ name: null as string | null, options: visible }]
    const names = [...new Set(step.options.map((option) => option.group ?? "Outros cenários"))]
    return names.map((name) => ({ name, options: visible.filter((option) => (option.group ?? "Outros cenários") === name) })).filter((group) => group.options.length > 0)
  }, [step.options, visible])

  const text = freeText.trim()
  const valid = noneMatched ? text.length > 0 : selected.length > 0 || text.length > 0
  const choose = (optionId: string, checked: boolean) => {
    setNoneMatched(false)
    setSelected((current) => (multiple ? (checked ? [...current, optionId] : current.filter((id) => id !== optionId)) : checked ? [optionId] : []))
  }
  const chooseNone = (checked: boolean) => {
    setNoneMatched(checked)
    if (checked) setSelected([])
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || disabled) return
    onSubmit({ optionIds: noneMatched ? [] : selected, noneMatched, ...(text ? { freeText: text.slice(0, 1_000) } : {}) })
  }

  const optionRow = (option: ClarificationOption) => {
    const id = `${baseId}-${option.id}`
    const checked = selected.includes(option.id)
    return (
      <label key={option.id} htmlFor={id} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50", checked && "border-primary/60 bg-primary/5")} data-option-id={option.id}>
        {multiple ? <Checkbox id={id} checked={checked} onCheckedChange={(value) => choose(option.id, value === true)} className="mt-0.5" /> : <RadioGroupItem id={id} value={option.id} className="mt-0.5" />}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-sm leading-snug font-medium break-words">{option.label}</span>
          {option.description ? <span className="block text-xs leading-snug text-muted-foreground break-words">{option.description}</span> : null}
        </span>
      </label>
    )
  }

  const noneRow = (
    <label htmlFor={`${baseId}-none`} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50", noneMatched && "border-primary/60 bg-primary/5")}>
      {multiple ? <Checkbox id={`${baseId}-none`} checked={noneMatched} onCheckedChange={(value) => chooseNone(value === true)} /> : <RadioGroupItem id={`${baseId}-none`} value={NONE} />}
      Nenhuma das opções corresponde ao meu caso
    </label>
  )

  const list = (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.name ?? "todas"} role={group.name ? "group" : undefined} aria-label={group.name ?? undefined} className="space-y-1.5">
          {group.name ? <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group.name}</p> : null}
          {group.options.map(optionRow)}
        </div>
      ))}
      {visible.length === 0 ? <p className="text-xs text-muted-foreground" role="status">Nenhuma opção com esse termo. Se o seu caso não está na lista, marque a última opção e descreva-o.</p> : null}
      {noneRow}
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-3" data-testid="clarification-form" aria-labelledby={`${baseId}-legend`}>
      <fieldset disabled={disabled} className="space-y-3">
        <legend id={`${baseId}-legend`} className="text-xs font-medium text-muted-foreground">
          <span className="sr-only">{step.question} </span>
          {multiple ? "Escolha uma ou mais opções" : "Escolha uma opção"}
        </legend>
        {searchable ? (
          <div className="space-y-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar entre as ${step.options.length} opções`} aria-label="Buscar entre as opções" className="h-8 pl-8 text-sm" />
            </div>
            {query.trim() ? <p className="text-[11px] text-muted-foreground" aria-live="polite">Mostrando {visible.length} de {step.options.length} opções</p> : null}
          </div>
        ) : null}
        {multiple ? list : (
          <RadioGroup value={noneMatched ? NONE : (selected[0] ?? "")} onValueChange={(value) => (value === NONE ? chooseNone(true) : choose(value, true))} aria-label={step.question} className="gap-0">
            {list}
          </RadioGroup>
        )}
        <div className="space-y-1">
          <Label htmlFor={`${baseId}-text`} className="text-xs font-medium text-muted-foreground">{noneMatched ? "Descreva o seu caso" : "Complementar (opcional)"}</Label>
          <Textarea id={`${baseId}-text`} value={freeText} onChange={(event) => setFreeText(event.target.value)} maxLength={1_000} rows={2} placeholder={noneMatched ? "O que torna o seu caso diferente das opções?" : "Algum detalhe que ajude a responder"} className="min-h-0 text-sm" aria-required={noneMatched} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel ? <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button> : null}
          <Button type="submit" size="sm" disabled={!valid || disabled}>{submitLabel}</Button>
        </div>
      </fieldset>
    </form>
  )
}
