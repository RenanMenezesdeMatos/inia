"use client"

import { useId, useState } from "react"
import { endOfMonth, format, isValid, startOfMonth, subDays, subMonths } from "date-fns"
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
 *  - `DateRangePicker`: um período (filtros de relatório e de lista). O primeiro clique marca um dia; o segundo fecha o período. Ao
 *    lado do calendário, atalhos prontos ("Hoje", "Últimos 7 dias", "Últimas 2 semanas", "Último mês", "Este mês", "Mês passado",
 *    "Últimos 3 meses", "Últimos 6 meses"), contados a partir de hoje no calendário de quem está vendo: um clique aplica e fecha. Atalho
 *    fora dos limites (`min`/`max`) ou recusado pela validação do filtro fica desabilitado; o que corresponde ao período atual fica
 *    marcado. Filtro que pode ficar vazio (`clearable`) tem "Limpar" no fim da mesma coluna.
 * MODELO ÚNICO dos calendários do app (decisão do responsável em 2026-11-10): Popover branco inteiro — o calendário não tem fundo
 * próprio (antes era um bloco cinza ao lado da coluna branca dos atalhos e parecia quebrado) e ocupa a coluna até o separador; atalhos à
 * esquerda (em cima no celular) separados por uma linha; ações (Aplicar, Limpar) no rodapé ou na coluna dos atalhos. Nenhuma tela usa
 * o `Calendar` direto para escolher data de filtro.
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
      <PopoverContent className="w-auto p-0" align="start" collisionPadding={16}>
        <Calendar
          className="bg-transparent"
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

/** Atalho de período: datas civis calculadas a partir de "hoje" (o dia de quem está vendo). */
export type DateRangePreset = { id: string; label: string; range: (today: Date) => { from: Date; to: Date } }

const lastDays = (days: number) => (today: Date) => ({ from: subDays(today, days - 1), to: today })

/** "Último mês", "Últimos 3 meses" e "Últimos 6 meses" são janelas de 30, 90 e 180 dias até hoje; "Este mês" e "Mês passado" seguem o calendário. */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: "today", label: "Hoje", range: lastDays(1) },
  { id: "last-7-days", label: "Últimos 7 dias", range: lastDays(7) },
  { id: "last-2-weeks", label: "Últimas 2 semanas", range: lastDays(14) },
  { id: "last-month", label: "Último mês", range: lastDays(30) },
  { id: "this-month", label: "Este mês", range: (today) => ({ from: startOfMonth(today), to: today }) },
  { id: "previous-month", label: "Mês passado", range: (today) => ({ from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) }) },
  { id: "last-3-months", label: "Últimos 3 meses", range: lastDays(90) },
  { id: "last-6-months", label: "Últimos 6 meses", range: lastDays(180) },
]

/** O período de um atalho pelo id (ex.: "last-month" = os 30 dias até hoje), para o valor inicial de um filtro. */
export function presetRangeById(id: string, today: Date = new Date()): { from: string; to: string } {
  const preset = DATE_RANGE_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Atalho de período desconhecido: ${id}`)
  return presetRange(preset, today)
}

const civilDayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000

/** Validação de período com teto em dias (contando os dois extremos), para `confirm.validate`. */
export function periodWithinDays(maxDays: number) {
  return ({ from, to }: { from: string; to: string }): string | null => {
    const days = civilDayNumber(to) - civilDayNumber(from) + 1
    if (days < 1) return "A data inicial precisa ser antes da final."
    return days > maxDays ? `Escolha um período de até ${maxDays} dias.` : null
  }
}

/** O período de um atalho em datas civis "AAAA-MM-DD". */
export function presetRange(preset: DateRangePreset, today: Date = new Date()): { from: string; to: string } {
  const range = preset.range(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  return { from: toCivilDate(range.from), to: toCivilDate(range.to) }
}

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
  /** Atalhos ao lado do calendário (padrão: `DATE_RANGE_PRESETS`); `false` tira os atalhos. */
  presets?: readonly DateRangePreset[] | false
}

export function rangeText(value: CivilDateRange, placeholder: string): string {
  const from = parseCivilDate(value.from)
  const to = parseCivilDate(value.to)
  if (from && to) return from.getTime() === to.getTime() ? shortText(from) : `${shortText(from)} – ${shortText(to)}`
  if (from) return `a partir de ${shortText(from)}`
  if (to) return `até ${shortText(to)}`
  return placeholder
}

export function DateRangePicker({ value, onChange, min, max, placeholder = "Selecionar período", clearable = false, highlightActive = false, confirm, presets = DATE_RANGE_PRESETS, id, disabled, className, ...aria }: DateRangePickerProps) {
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
  const shortcuts = open && presets ? presetOptions(presets, { min, max, validate: confirm?.validate, current: shown }) : []
  const applyPreset = (range: { from: string; to: string }) => {
    setDraft(range)
    onChange(range)
    setOpen(false)
  }
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
      <PopoverContent className="flex w-auto max-w-[calc(100vw-2rem)] flex-col p-0 sm:flex-row" align="start" collisionPadding={16}>
        {/* `relative`: a navegação de mês do calendário é absoluta e precisa ficar presa ao calendário, não ao lado dos atalhos. */}
        <div className="relative flex flex-col sm:flex-1">
          <Calendar
            className="mx-auto bg-transparent sm:mx-0 sm:w-full"
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
          {clearable && active && shortcuts.length === 0 ? (
            <div className="border-t p-2">
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => onChange({})}>
                <X data-icon="inline-start" /> Limpar período
              </Button>
            </div>
          ) : null}
        </div>
        {/* Atalhos à esquerda (em cima no celular) só pela ordem visual: no código vêm depois, e o foco ao abrir continua no calendário. */}
        {shortcuts.length > 0 ? (
          <div role="group" aria-label="Atalhos de período" className="order-first flex flex-wrap gap-1 border-b p-2 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
            {shortcuts.map((shortcut) => (
              <Button
                key={shortcut.id}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary dark:aria-pressed:text-chart-4"
                aria-pressed={shortcut.active}
                disabled={shortcut.disabledReason !== null}
                title={shortcut.disabledReason ?? rangeText(shortcut.range, "")}
                onClick={() => applyPreset(shortcut.range)}
              >
                {shortcut.label}
              </Button>
            ))}
            {clearable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start text-muted-foreground sm:mt-auto sm:border-t sm:pt-2"
                disabled={!active}
                onClick={() => {
                  onChange({})
                  setDraft({})
                  setOpen(false)
                }}
              >
                <X data-icon="inline-start" /> Limpar
              </Button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

type PresetOption = { id: string; label: string; range: { from: string; to: string }; active: boolean; disabledReason: string | null }

/** Cada atalho com o período de hoje, marcado quando é o período atual e desabilitado (com o motivo) fora dos limites do filtro. */
function presetOptions(presets: readonly DateRangePreset[], rules: { min?: string | undefined; max?: string | undefined; validate?: ((range: { from: string; to: string }) => string | null) | undefined; current: CivilDateRange }): PresetOption[] {
  const today = new Date()
  return presets.map((preset) => {
    const range = presetRange(preset, today)
    const outOfLimits = (rules.min && range.from < rules.min) || (rules.max && range.to > rules.max) ? "Fora do período permitido neste filtro." : null
    return {
      id: preset.id,
      label: preset.label,
      range,
      active: rules.current.from === range.from && rules.current.to === range.to,
      disabledReason: outOfLimits ?? rules.validate?.(range) ?? null,
    }
  })
}
