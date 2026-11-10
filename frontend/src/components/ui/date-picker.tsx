"use client"

import { useId, useState } from "react"
import { format, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import type { DateRange, Matcher } from "react-day-picker"
import { CalendarDays, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * SELETORES DE DATA DO APP (kit): botão contornado com o ícone de calendário e a data em `dd/MM/aaaa`; ao clicar, o calendário do
 * kit em português num Popover (setas e Page Up/Down navegam; Enter escolhe; Esc fecha). O valor é sempre a DATA CIVIL
 * "AAAA-MM-DD" (sem hora nem fuso): quem usa continua aplicando as próprias regras de fuso, limites e validação.
 *  - `DatePicker`: uma data (prazo, data de feriado, "a partir de").
 *  - `DateRangePicker`: um período (filtros de relatório e de lista). O primeiro clique marca um dia; o segundo fecha o período.
 * Rótulo: `<Label htmlFor={id}>` aponta para o botão; a data escolhida vai para leitores de tela pela descrição do botão.
 */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseCivilDate(value: string | null | undefined): Date | undefined {
  if (!value || !CIVIL_DATE.test(value)) return undefined
  const [year, month, day] = value.split("-").map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  return isValid(date) && date.getMonth() === month - 1 ? date : undefined
}

export const toCivilDate = (date: Date) => format(date, "yyyy-MM-dd")
const shortText = (date: Date) => format(date, "dd/MM/yyyy")
const longText = (date: Date) => format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })

function limits(min?: string, max?: string): Matcher[] {
  const before = parseCivilDate(min)
  const after = parseCivilDate(max)
  return [...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]
}

type TriggerProps = {
  id?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  "aria-label"?: string | undefined
  "aria-describedby"?: string | undefined
  "aria-invalid"?: boolean | undefined
}

export type DatePickerProps = TriggerProps & {
  value: string | null | undefined
  onChange: (value: string) => void
  /** Limites inclusivos, "AAAA-MM-DD". */
  min?: string | undefined
  max?: string | undefined
  placeholder?: string
  /** Mostra "Limpar data" (o valor volta a ""). */
  clearable?: boolean
}

export function DatePicker({ value, onChange, min, max, placeholder = "dd/mm/aaaa", clearable = false, id, disabled, className, ...aria }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const valueId = useId()
  const selected = parseCivilDate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-slot="date-picker"
          className={cn("w-full justify-start font-normal sm:w-44", !selected && "text-muted-foreground", className)}
          aria-label={aria["aria-label"]}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={[valueId, aria["aria-describedby"]].filter(Boolean).join(" ")}
        >
          <CalendarDays data-icon="inline-start" className="text-muted-foreground" />
          <span className="tabular-nums">{selected ? shortText(selected) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <span id={valueId} className="sr-only">
        {selected ? `Data escolhida: ${longText(selected)}` : "Nenhuma data escolhida"}
      </span>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? parseCivilDate(max) ?? undefined}
          disabled={limits(min, max)}
          autoFocus
          onSelect={(date) => {
            if (!date) return
            onChange(toCivilDate(date))
            setOpen(false)
          }}
        />
        {clearable && selected ? (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              <X data-icon="inline-start" /> Limpar data
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export type CivilDateRange = { from?: string | undefined; to?: string | undefined }

export type DateRangePickerProps = TriggerProps & {
  value: CivilDateRange
  onChange: (value: CivilDateRange) => void
  min?: string | undefined
  max?: string | undefined
  placeholder?: string
  /** Mostra "Limpar período" (o valor volta a vazio). Filtros obrigatórios (ex.: período de um relatório) não limpam. */
  clearable?: boolean
  /** Destaca o botão quando há período escolhido (filtros de lista). */
  highlightActive?: boolean
  /**
   * Período obrigatório com confirmação: a escolha fica num rascunho dentro do calendário e só vale com "Aplicar" (desabilitado
   * enquanto o período estiver incompleto ou inválido; o motivo aparece ali). Fechar sem aplicar descarta o rascunho.
   */
  confirm?: { validate?: (range: { from: string; to: string }) => string | null }
}

export function rangeText(value: CivilDateRange, placeholder: string): string {
  const from = parseCivilDate(value.from)
  const to = parseCivilDate(value.to)
  if (from && to) return from.getTime() === to.getTime() ? shortText(from) : `${shortText(from)} – ${shortText(to)}`
  if (from) return `a partir de ${shortText(from)}`
  if (to) return `até ${shortText(to)}`
  return placeholder
}

export function DateRangePicker({ value, onChange, min, max, placeholder = "Selecionar período", clearable = false, highlightActive = false, confirm, id, disabled, className, ...aria }: DateRangePickerProps) {
  const valueId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CivilDateRange>(value)
  const from = parseCivilDate(value.from)
  const to = parseCivilDate(value.to)
  const active = Boolean(from || to)
  const shown = confirm ? draft : value
  const shownFrom = parseCivilDate(shown.from)
  const selected: DateRange | undefined = shownFrom ? { from: shownFrom, to: parseCivilDate(shown.to) } : undefined
  const draftError = confirm ? (draft.from && draft.to ? (confirm.validate?.({ from: draft.from, to: draft.to }) ?? null) : "Escolha o início e o fim do período.") : null
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-slot="date-range-picker"
          className={cn("w-full justify-start font-normal sm:w-auto", !active && "text-muted-foreground", highlightActive && active && "border-primary/50", className)}
          aria-label={aria["aria-label"]}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={[valueId, aria["aria-describedby"]].filter(Boolean).join(" ")}
        >
          <CalendarDays data-icon="inline-start" className="text-muted-foreground" />
          <span className="tabular-nums">{rangeText(value, placeholder)}</span>
        </Button>
      </PopoverTrigger>
      <span id={valueId} className="sr-only">
        {from && to ? `Período: de ${longText(from)} a ${longText(to)}` : from ? `A partir de ${longText(from)}` : "Nenhum período escolhido"}
      </span>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={shownFrom ?? parseCivilDate(max) ?? undefined}
          disabled={limits(min, max)}
          autoFocus
          onSelect={(range) => {
            const next = { from: range?.from ? toCivilDate(range.from) : undefined, to: range?.to ? toCivilDate(range.to) : undefined }
            if (confirm) setDraft(next)
            else onChange(next)
          }}
        />
        {confirm ? (
          <div className="max-w-72 space-y-2 border-t p-3">
            <p className="text-sm tabular-nums">{rangeText(draft, "Nenhum período escolhido")}</p>
            {draftError ? (
              <p role="alert" className="text-xs text-destructive">
                {draftError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={draftError !== null}
                onClick={() => {
                  onChange(draft)
                  setOpen(false)
                }}
              >
                Aplicar
              </Button>
            </div>
          </div>
        ) : null}
        {clearable && active ? (
          <div className="border-t p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => onChange({})}>
              <X data-icon="inline-start" /> Limpar período
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
