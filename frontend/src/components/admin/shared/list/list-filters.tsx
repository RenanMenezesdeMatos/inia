"use client"

import { useRef, useState, type ReactNode } from "react"
import { ChevronDown, FilterX, Search, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-picker"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFocusAfterRemoval } from "@/hooks/use-focus-after-removal"
import { cn } from "@/lib/utils"
import type { DateRangeFilter, SubjectScopeFilter } from "@/lib/admin/list-query"
import type { UniverseFilterValue } from "@/lib/operating-universe/hierarchy"
import type { Subject } from "@/schemas/admin/org-structure.schema"
import { OPERATING_UNIVERSES, type OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

// Área de filtros padrão das listagens administrativas. Layout em duas linhas: busca + modo de
// visualização em cima; seletores + "Limpar filtros" embaixo. Cada tela escolhe quais filtros
// entram — os componentes aqui só cuidam de aparência, acessibilidade e serialização.

const ALL = "__all__"

export type ActiveFilter = { key: string; label: string; onClear: () => void }

export function ListToolbar({
  search,
  viewToggle,
  hasActiveFilters,
  onClearFilters,
  activeFilters = [],
  children,
}: {
  search: ReactNode
  viewToggle?: ReactNode
  hasActiveFilters: boolean
  onClearFilters: () => void
  /** Filtros em vigor, um selo por filtro com o próprio "x" (além do "Limpar filtros"). */
  activeFilters?: readonly ActiveFilter[]
  children?: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">{search}</div>
        {viewToggle}
      </div>
      {children ? (
        <div role="group" aria-label="Filtros" className="flex flex-wrap items-center gap-2" data-usage-element="list.filter">
          {children}
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
              <FilterX data-icon="inline-start" /> Limpar filtros
            </Button>
          ) : null}
        </div>
      ) : null}
      <ActiveFilterChips filters={activeFilters} label="Filtros ativos" />
    </div>
  )
}

/** Selos acima disto ficam atrás de "Mostrar mais": muitos Grupos escolhidos não empurram a lista para fora da tela. */
const VISIBLE_CHIPS = 8

/** Filtros em vigor, um selo por escolha com o próprio "x". */
export function ActiveFilterChips({ filters, label, className }: { filters: readonly ActiveFilter[]; label: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const removing = useFocusAfterRemoval(listRef, filters.length)
  if (filters.length === 0) return null
  const hidden = filters.length - VISIBLE_CHIPS
  const visible = expanded || hidden <= 1 ? filters : filters.slice(0, VISIBLE_CHIPS)
  return (
    <ul ref={listRef} className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label={label}>
      {visible.map((filter, index) => (
        <li key={filter.key} className="min-w-0 max-w-full">
          <Badge variant="outline" className="max-w-[min(20rem,100%)] gap-1 border-primary/40 bg-card py-1 pr-1 font-normal">
            <span className="truncate" title={filter.label}>{filter.label}</span>
            <button type="button" data-removable className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remover filtro ${filter.label}`} onClick={() => { removing(index); filter.onClear() }}>
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        </li>
      ))}
      {hidden > 1 ? (
        <li>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Mostrar menos" : `Mostrar mais ${hidden}`}
          </Button>
        </li>
      ) : null}
    </ul>
  )
}

export function ListSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  pending = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  pending?: boolean
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-busy={pending}
        className="pl-8"
      />
    </div>
  )
}

export type FilterOption<V extends string = string> = { value: V; label: string }

// Seletor de valor único com a opção "todos" como padrão (undefined).
export function ListSelectFilter<V extends string>({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  className,
}: {
  value: V | undefined
  onChange: (value: V | undefined) => void
  options: readonly FilterOption<V>[]
  allLabel: string
  ariaLabel: string
  className?: string
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : (next as V))}>
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-36", value !== undefined && "border-primary/50 text-foreground", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Sim/não/qualquer — status ativo/inativo, publicado/rascunho, com/sem arquivo etc.
export function ListBooleanFilter({
  value,
  onChange,
  allLabel,
  trueLabel,
  falseLabel,
  ariaLabel,
}: {
  value: boolean | undefined
  onChange: (value: boolean | undefined) => void
  allLabel: string
  trueLabel: string
  falseLabel: string
  ariaLabel: string
}) {
  return (
    <ListSelectFilter
      value={value === undefined ? undefined : value ? "true" : "false"}
      onChange={(next) => onChange(next === undefined ? undefined : next === "true")}
      options={[
        { value: "true", label: trueLabel },
        { value: "false", label: falseLabel },
      ]}
      allLabel={allLabel}
      ariaLabel={ariaLabel}
    />
  )
}

// Seleção múltipla num menu com checkboxes; o gatilho mostra quantos valores estão marcados.
export function ListMultiSelectFilter<V extends string>({
  label,
  values,
  onChange,
  options,
}: {
  label: string
  values: readonly V[]
  onChange: (values: V[]) => void
  options: readonly FilterOption<V>[]
}) {
  const active = values.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className={cn("w-full justify-between font-normal sm:w-auto", active && "border-primary/50")} aria-label={`Filtrar por ${label.toLocaleLowerCase("pt-BR")}`}>
          <span className="inline-flex items-center gap-1.5">
            {label}
            {active ? (
              <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 text-[11px]">
                {values.length}
              </Badge>
            ) : null}
          </span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const checked = values.includes(option.value)
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={checked}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(next) => onChange(next ? [...values, option.value] : values.filter((value) => value !== option.value))}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          )
        })}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => onChange([])}>
              <X data-icon="inline-start" /> Limpar seleção
            </Button>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Intervalo de datas (inclusivo) — serializado como YYYY-MM-DD para a API. Mesmo seletor de período do resto do app.
export function ListDateRangeFilter({ label, value, onChange }: { label: string; value: DateRangeFilter; onChange: (value: DateRangeFilter) => void }) {
  return <DateRangePicker value={value} onChange={(next) => onChange({ from: next.from, to: next.to })} placeholder={label} clearable highlightActive aria-label={`Filtrar por ${label.toLocaleLowerCase("pt-BR")}`} />
}

const UNIVERSE_FILTER_OPTIONS: FilterOption<UniverseFilterValue>[] = [
  ...OPERATING_UNIVERSES.map((universe) => ({ value: universe, label: universe })),
  { value: "PENDING", label: "Pendente (sem universo)" },
]

/**
 * Filtro "Universo" das listagens (topo da hierarquia: universo → Grupo → Subgrupo). Um valor só; `PENDING` = ainda sem classificação.
 * A tela passa o valor escolhido ao `ListOrgScopeFilter` e limpa o Grupo incompatível ao trocar.
 */
export function ListUniverseFilter({ value, onChange }: { value: UniverseFilterValue | undefined; onChange: (value: UniverseFilterValue | undefined) => void }) {
  return <ListSelectFilter<UniverseFilterValue> value={value} onChange={onChange} options={UNIVERSE_FILTER_OPTIONS} allLabel="Qualquer universo" ariaLabel="Filtrar por universo de atuação" />
}

/** Escolha de universo (para encadear) a partir do valor do filtro: pendente não restringe as opções de baixo. */
export function universeChoiceOf(value: UniverseFilterValue | undefined): OperatingUniverse | undefined {
  return value === "PENDING" ? undefined : value
}

export function ListSubjectScopeFilter({
  value,
  onChange,
  subjects,
}: {
  value: SubjectScopeFilter
  onChange: (value: SubjectScopeFilter) => void
  subjects: readonly Pick<Subject, "id" | "name">[] | undefined
}) {
  const encoded = value.subjectId ? `subject:${value.subjectId}` : value.subjectScopeType === "ALL_SUBJECTS" ? "global" : ALL
  return (
    <Select
      value={encoded}
      disabled={!subjects}
      onValueChange={(next) => onChange(next === "global" ? { subjectScopeType: "ALL_SUBJECTS" } : next.startsWith("subject:") ? { subjectId: next.slice(8) } : {})}
    >
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-40", encoded !== ALL && "border-primary/50")} aria-label="Filtrar por assunto">
        <SelectValue placeholder="Qualquer assunto" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Qualquer assunto</SelectItem>
        <SelectItem value="global">Somente globais (todos os assuntos)</SelectItem>
        {subjects?.map((subject) => (
          <SelectItem key={subject.id} value={`subject:${subject.id}`}>
            {subject.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Converte um Record de labels (ex.: AGENT_TYPE_LABELS) em opções de filtro.
export function optionsFromLabels<V extends string>(labels: Record<V, string>): FilterOption<V>[] {
  return (Object.entries(labels) as [V, string][]).map(([value, label]) => ({ value, label }))
}
