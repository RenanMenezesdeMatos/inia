"use client"

import type { ReactNode } from "react"
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { DateRangeFilter, OrgScopeFilter, SubjectScopeFilter } from "@/lib/admin/list-query"
import type { Subject, Team } from "@/schemas/admin/org-structure.schema"

// Área de filtros padrão das listagens administrativas. Layout em duas linhas: busca + modo de
// visualização em cima; seletores + "Limpar filtros" embaixo. Cada tela escolhe quais filtros
// entram — os componentes aqui só cuidam de aparência, acessibilidade e serialização.

const ALL = "__all__"

export function ListToolbar({
  search,
  viewToggle,
  hasActiveFilters,
  onClearFilters,
  children,
}: {
  search: ReactNode
  viewToggle?: ReactNode
  hasActiveFilters: boolean
  onClearFilters: () => void
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
    </div>
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

// Grupo/subgrupo: "qualquer" (sem filtro), só globais, um grupo (inclui subgrupos) ou um subgrupo.
function encodeOrgScope(value: OrgScopeFilter) {
  if (value.subteamId) return `subteam:${value.subteamId}`
  if (value.teamId) return `team:${value.teamId}`
  if (value.scopeType === "ALL_TEAMS") return "global"
  return ALL
}

function decodeOrgScope(encoded: string, teams: Team[]): OrgScopeFilter {
  if (encoded === "global") return { scopeType: "ALL_TEAMS" }
  if (encoded.startsWith("team:")) return { teamId: encoded.slice(5) }
  if (encoded.startsWith("subteam:")) {
    const subteamId = encoded.slice(8)
    const team = teams.find((entry) => entry.subteams.some((subteam) => subteam.id === subteamId))
    return { teamId: team?.id, subteamId }
  }
  return {}
}

export function ListOrgScopeFilter({
  value,
  onChange,
  teams,
  globalLabel = "Somente globais (todos os grupos)",
}: {
  value: OrgScopeFilter
  onChange: (value: OrgScopeFilter) => void
  teams: Team[] | undefined
  globalLabel?: string
}) {
  const encoded = encodeOrgScope(value)
  return (
    <Select value={encoded} onValueChange={(next) => onChange(decodeOrgScope(next, teams ?? []))} disabled={!teams}>
      <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-40", encoded !== ALL && "border-primary/50")} aria-label="Filtrar por grupo">
        <SelectValue placeholder="Qualquer grupo" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Qualquer grupo</SelectItem>
        <SelectItem value="global">{globalLabel}</SelectItem>
        {teams?.map((team) => (
          <SelectGroup key={team.id}>
            <SelectLabel>{team.name}</SelectLabel>
            <SelectItem value={`team:${team.id}`}>{team.name} (grupo inteiro)</SelectItem>
            {team.subteams.map((subteam) => (
              <SelectItem key={subteam.id} value={`subteam:${subteam.id}`}>
                {team.name} › {subteam.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ListSubjectScopeFilter({
  value,
  onChange,
  subjects,
}: {
  value: SubjectScopeFilter
  onChange: (value: SubjectScopeFilter) => void
  subjects: Subject[] | undefined
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
