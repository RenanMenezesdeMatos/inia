"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { SlidersHorizontal, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ListDateRangeFilter } from "@/components/admin/shared/list/list-filters"
import { getUsageTracker } from "@/lib/usage/usage-provider"
import { cn } from "@/lib/utils"
import { useUsabilityPeopleSearch } from "@/queries/admin/use-usability-queries"
import type { UsabilityContext } from "@/schemas/admin/usability.schema"
import type { UsabilityTab } from "@/services/admin/usability-service"

import {
  ACCOUNT_STATUS_LABELS,
  CHANNEL_LABELS,
  CONVERSATION_ORIGIN_LABELS,
  CONVERSION_MODE_LABELS,
  DEVICE_LABELS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_SOURCE_LABELS,
  FILTER_LABELS,
  PERSON_STATUS_LABELS,
  STRUCTURE_MODE_LABELS,
} from "./usability-format"
import { activeFilterKeys, type FilterKey, type UsabilityUrlState } from "./usability-url-state"
import { DatePicker } from "@/components/ui/date-picker"

/**
 * FILTROS da Monitoria — período e comparação sempre à vista; o restante num painel "Filtros" agrupado. Um filtro que a aba
 * atual não suporta aparece DESABILITADO com o motivo (nunca escondido nem ignorado em silêncio); se ele já estiver na URL, o
 * chip fica apagado com "não se aplica nesta aba". Pessoa e liderança só existem para quem vê pessoas identificadas.
 */
const ALL = "__all__"

/** Nome da pessoa escolhida no filtro — só em memória (o nome nunca vai para a URL). */
const personNames = new Map<string, string>()

type Props = {
  tab: UsabilityTab | "person"
  context: UsabilityContext
  values: UsabilityUrlState["values"]
  inapplicable: readonly FilterKey[]
  canViewPeople: boolean
  onChange: (changes: Partial<Record<FilterKey, string | undefined>>) => void
  onClear: () => void
}

export function UsabilityFilters({ tab, context, values, inapplicable, canViewPeople, onChange, onClear }: Props) {
  const supported = useMemo(() => new Set(context.tabs[tab] ?? []), [context.tabs, tab])
  const period = values.period ?? "LAST_7_DAYS"
  const compare = values.compare !== "0"
  const active = activeFilterKeys(values)

  function change(key: FilterKey, value: string | undefined) {
    onChange({ [key]: value })
    try {
      getUsageTracker()?.filterApplied("usability", key)
    } catch {
      // observacional
    }
  }

  return (
    <div className="space-y-2" role="group" aria-label="Recorte da monitoria">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(next) => change("period", next === "LAST_7_DAYS" ? undefined : next)}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {context.periods.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "CUSTOM" ? (
          <ListDateRangeFilter
            label="Escolher datas"
            value={{ from: values.from, to: values.to }}
            onChange={(range) => onChange({ period: "CUSTOM", from: range.from, to: range.to })}
          />
        ) : null}
        <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
          <Switch checked={compare} onCheckedChange={(checked) => change("compare", checked ? undefined : "0")} aria-label="Comparar com o período anterior" />
          Comparar com o período anterior
        </label>
        <FiltersPanel context={context} values={values} supported={supported} canViewPeople={canViewPeople} activeCount={active.length} onChange={change} />
        {active.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X data-icon="inline-start" /> Limpar filtros
          </Button>
        ) : null}
      </div>
      {period === "CUSTOM" && (!values.from || !values.to) ? <p className="text-xs text-muted-foreground">Escolha a data inicial e a final para consultar o intervalo.</p> : null}
      {active.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtros aplicados">
          {active.map((key) => {
            const off = inapplicable.includes(key)
            const reason = context.notApplicableReasons[key] ?? "Não se aplica a esta aba."
            return (
              <li key={key}>
                <Badge variant={off ? "outline" : "secondary"} className={cn("gap-1 pr-1 font-normal", off && "text-muted-foreground line-through decoration-muted-foreground/60")} title={off ? reason : undefined}>
                  <span>
                    {FILTER_LABELS[key] ?? key}: {valueLabel(key, values[key], context)}
                  </span>
                  {off ? <span className="sr-only"> — não se aplica nesta aba: {reason}</span> : null}
                  <button type="button" className="rounded-sm p-0.5 hover:bg-foreground/10" aria-label={`Remover filtro ${FILTER_LABELS[key] ?? key}`} onClick={() => change(key, undefined)}>
                    <X className="size-3" aria-hidden />
                  </button>
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : null}
      {inapplicable.some((key) => active.includes(key)) ? (
        <p className="text-xs text-muted-foreground" role="note">
          Filtros riscados continuam guardados, mas não se aplicam a esta aba e não foram usados nestes números.
        </p>
      ) : null}
    </div>
  )
}

function valueLabel(key: FilterKey, value: string | undefined, context: UsabilityContext): string {
  if (!value) return ""
  const options = context.options
  switch (key) {
    case "teamId":
      return options.teams.find((team) => team.id === value)?.name ?? "Grupo fora do alcance"
    case "subteamId":
      return options.subteams.find((subteam) => subteam.id === value)?.name ?? "Subgrupo fora do alcance"
    case "leaderId":
      return options.leaders?.find((leader) => leader.id === value)?.name ?? "Liderança selecionada"
    case "personId":
      return personNames.get(value) ?? "Pessoa selecionada"
    case "accessRole":
      return options.accessRoles.find((role) => role.code === value)?.name ?? value
    case "screenKey":
      return options.screens.find((screen) => screen.key === value)?.label ?? value
    case "featureKey":
      return options.features.find((feature) => feature.key === value)?.label ?? value
    case "workflowId":
      return options.workflows.find((workflow) => workflow.id === value)?.name ?? "Workflow"
    case "workflowVersionId":
      return "Versão selecionada"
    case "structureMode":
      return STRUCTURE_MODE_LABELS[value] ?? value
    case "personStatus":
      return PERSON_STATUS_LABELS[value] ?? value
    case "accountStatus":
      return ACCOUNT_STATUS_LABELS[value] ?? value
    case "device":
      return DEVICE_LABELS[value] ?? value
    case "feedbackSource":
      return FEEDBACK_SOURCE_LABELS[value] ?? value
    case "feedbackKind":
      return FEEDBACK_KIND_LABELS[value] ?? value
    case "conversationOrigin":
      return CONVERSATION_ORIGIN_LABELS[value] ?? value
    case "channel":
      return CHANNEL_LABELS[value] ?? value
    case "conversionMode":
      return CONVERSION_MODE_LABELS[value] ?? value
    case "cohortWindow":
      return `${value} dia(s)`
    case "includeAdmin":
    case "includeTest":
    case "includeDemo":
    case "includeQa":
      return value === "1" ? "sim" : "não"
    case "referenceDate": {
      const [year, month, day] = value.split("-")
      return `${day}/${month}/${year}`
    }
    default:
      return value
  }
}

type PanelProps = {
  context: UsabilityContext
  values: UsabilityUrlState["values"]
  supported: ReadonlySet<string>
  canViewPeople: boolean
  activeCount: number
  onChange: (key: FilterKey, value: string | undefined) => void
}

function FiltersPanel({ context, values, supported, canViewPeople, activeCount, onChange }: PanelProps) {
  const options = context.options
  const reason = (key: FilterKey) => (supported.has(key) ? null : (context.notApplicableReasons[key] ?? "Não se aplica a esta aba."))
  const subteams = values.teamId ? options.subteams.filter((subteam) => subteam.teamId === values.teamId) : options.subteams
  const screensByArea = groupBy(options.screens, (screen) => screen.areaLabel)
  const select = (key: FilterKey, label: string, entries: { value: string; label: string }[], allLabel = "Todos") => (
    <FilterSelect key={key} id={`usability-filter-${key}`} label={label} value={values[key]} entries={entries} allLabel={allLabel} disabledReason={reason(key)} onChange={(value) => onChange(key, value)} />
  )
  const toggle = (key: FilterKey, label: string, hint: string) => (
    <FilterToggle key={key} id={`usability-filter-${key}`} label={label} hint={hint} checked={values[key] === "1"} disabledReason={reason(key)} onChange={(checked) => onChange(key, checked ? "1" : undefined)} />
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("gap-2", activeCount > 0 && "border-primary/50")} aria-label={`Filtros${activeCount ? ` (${activeCount} aplicados)` : ""}`}>
          <SlidersHorizontal data-icon="inline-start" /> Filtros
          {activeCount > 0 ? <Badge className="h-5 px-1.5 text-[11px]">{activeCount}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(80vh,640px)] w-[min(92vw,720px)] overflow-y-auto p-4">
        <div className="space-y-4">
          <FilterGroup title="Estrutura e população">
            {select("structureMode", "Estrutura usada", Object.entries(STRUCTURE_MODE_LABELS).map(([value, label]) => ({ value, label })), "Estrutura na data do uso")}
            {select("teamId", "Grupo", options.teams.map((team) => ({ value: team.id, label: team.name })))}
            {select("subteamId", "Subgrupo", subteams.map((subteam) => ({ value: subteam.id, label: subteam.name })))}
            {canViewPeople && options.leaders ? select("leaderId", "Liderança (estrutura abaixo)", options.leaders.map((leader) => ({ value: leader.id, label: leader.name }))) : null}
            {canViewPeople ? <PersonFilter value={values.personId} disabledReason={reason("personId")} onChange={(value) => onChange("personId", value)} /> : null}
            {/* Cargo, papel e situação isolam pessoas como o nome: só para quem vê pessoas identificadas (achado C18 da 4ª auditoria). */}
            {canViewPeople ? select("accessRole", "Papel de acesso", options.accessRoles.map((role) => ({ value: role.code, label: role.name }))) : null}
            {canViewPeople ? select("jobTitle", "Cargo", options.jobTitles.map((title) => ({ value: title, label: title }))) : null}
            {canViewPeople ? select("personStatus", "Situação da pessoa", Object.entries(PERSON_STATUS_LABELS).map(([value, label]) => ({ value, label })), "Todas") : null}
            {canViewPeople ? select("accountStatus", "Conta de acesso", Object.entries(ACCOUNT_STATUS_LABELS).map(([value, label]) => ({ value, label })), "Todas") : null}
          </FilterGroup>
          {!canViewPeople ? <p className="text-xs text-muted-foreground">Filtrar por pessoa, liderança, cargo, papel de acesso ou situação exige a permissão de ver pessoas identificadas. Os números só aparecem para recortes com 5 pessoas ou mais.</p> : null}

          <FilterGroup title="Uso do produto">
            <FilterSelectGrouped
              id="usability-filter-screenKey"
              label="Tela"
              value={values.screenKey}
              groups={Object.entries(screensByArea).map(([area, screens]) => ({ label: area, entries: screens.map((screen) => ({ value: screen.key, label: screen.label })) }))}
              disabledReason={reason("screenKey")}
              onChange={(value) => onChange("screenKey", value)}
            />
            {select("featureKey", "Funcionalidade", options.features.map((feature) => ({ value: feature.key, label: feature.label })), "Todas")}
            {select("device", "Dispositivo", (options.devices.length ? options.devices : Object.keys(DEVICE_LABELS)).map((device) => ({ value: device, label: DEVICE_LABELS[device] ?? device })))}
            {select("appVersion", "Versão da aplicação", options.appVersions.map((version) => ({ value: version, label: version })), "Todas")}
            {select("environment", "Ambiente", options.environments.map((environment) => ({ value: environment, label: environment })))}
          </FilterGroup>

          <FilterGroup title="Feedbacks, INIA e workflows">
            {select("feedbackSource", "Fonte do feedback", Object.entries(FEEDBACK_SOURCE_LABELS).map(([value, label]) => ({ value, label })), "Todas")}
            {select("feedbackKind", "Tipo de feedback", Object.entries(FEEDBACK_KIND_LABELS).map(([value, label]) => ({ value, label })))}
            {select("cohortWindow", "Janela da coorte", ["1", "7", "30"].map((value) => ({ value, label: `${value} dia(s)` })), "7 dias (padrão)")}
            {select("conversionMode", "Conversão", Object.entries(CONVERSION_MODE_LABELS).map(([value, label]) => ({ value, label })), "Janela após a entrega (padrão)")}
            {select("conversationOrigin", "Origem da conversa", Object.entries(CONVERSATION_ORIGIN_LABELS).map(([value, label]) => ({ value, label })), "Todas")}
            {select("channel", "Canal", Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label })))}
            {select("workflowId", "Workflow", options.workflows.map((workflow) => ({ value: workflow.id, label: workflow.active ? workflow.name : `${workflow.name} (inativo)` })))}
            <FilterDate id="usability-filter-referenceDate" label="Data de referência (DAU/WAU/MAU)" value={values.referenceDate} disabledReason={reason("referenceDate")} onChange={(value) => onChange("referenceDate", value)} />
          </FilterGroup>

          <FilterGroup title="Inclusões explícitas" description="Por padrão os números mostram só uso humano do produto.">
            {toggle("includeAdmin", "Incluir uso da Administração", "Telas administrativas e o próprio painel.")}
            {toggle("includeQa", "Incluir uso do QA", "QA Lab e revisão de qualidade.")}
            {toggle("includeTest", "Incluir contas de teste/automação", "Pessoas classificadas como teste ou automação.")}
            {toggle("includeDemo", "Incluir demonstração", "Pessoas da massa de demonstração.")}
          </FilterGroup>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FilterGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function DisabledReason({ id, reason }: { id: string; reason: string | null }) {
  return reason ? (
    <p id={id} className="text-[11px] text-muted-foreground">
      Indisponível nesta aba: {reason}
    </p>
  ) : null
}

function FilterSelect({ id, label, value, entries, allLabel, disabledReason, onChange }: { id: string; label: string; value: string | undefined; entries: { value: string; label: string }[]; allLabel: string; disabledReason: string | null; onChange: (value: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={cn("text-xs", disabledReason && "text-muted-foreground")}>
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : next)} disabled={Boolean(disabledReason)}>
        <SelectTrigger id={id} className="w-full" aria-describedby={disabledReason ? `${id}-reason` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {entries.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DisabledReason id={`${id}-reason`} reason={disabledReason} />
    </div>
  )
}

function FilterSelectGrouped({ id, label, value, groups, disabledReason, onChange }: { id: string; label: string; value: string | undefined; groups: { label: string; entries: { value: string; label: string }[] }[]; disabledReason: string | null; onChange: (value: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={cn("text-xs", disabledReason && "text-muted-foreground")}>
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : next)} disabled={Boolean(disabledReason)}>
        <SelectTrigger id={id} className="w-full" aria-describedby={disabledReason ? `${id}-reason` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas</SelectItem>
          {groups.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.entries.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <DisabledReason id={`${id}-reason`} reason={disabledReason} />
    </div>
  )
}

function FilterToggle({ id, label, hint, checked, disabledReason, onChange }: { id: string; label: string; hint: string; checked: boolean; disabledReason: string | null; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-2.5">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={Boolean(disabledReason)} aria-describedby={`${id}-hint`} />
      <div className="space-y-0.5">
        <Label htmlFor={id} className={cn("text-sm", disabledReason && "text-muted-foreground")}>
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {disabledReason ? `Indisponível nesta aba: ${disabledReason}` : hint}
        </p>
      </div>
    </div>
  )
}

function FilterDate({ id, label, value, disabledReason, onChange }: { id: string; label: string; value: string | undefined; disabledReason: string | null; onChange: (value: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={cn("text-xs", disabledReason && "text-muted-foreground")}>
        {label}
      </Label>
      <DatePicker id={id} value={value ?? ""} disabled={Boolean(disabledReason)} clearable onChange={(next) => onChange(next || undefined)} aria-describedby={disabledReason ? `${id}-reason` : undefined} />
      <DisabledReason id={`${id}-reason`} reason={disabledReason} />
    </div>
  )
}

/** Busca de pessoa (mínimo 2 letras); o resultado escolhido vira só o id na URL. */
function PersonFilter({ value, disabledReason, onChange }: { value: string | undefined; disabledReason: string | null; onChange: (value: string | undefined) => void }) {
  const [term, setTerm] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300)
    return () => clearTimeout(timer)
  }, [term])
  const results = useUsabilityPeopleSearch(debounced)
  useEffect(() => {
    if (!results.data || debounced.trim().length < 2) return
    try {
      getUsageTracker()?.search("usability", debounced.trim().length, results.data.length)
    } catch {
      // observacional
    }
  }, [results.data, debounced])
  const selectedName = value ? (personNames.get(value) ?? "Pessoa selecionada") : null
  return (
    <div className="space-y-1 sm:col-span-2">
      <Label htmlFor="usability-filter-person" className={cn("text-xs", disabledReason && "text-muted-foreground")}>
        Pessoa
      </Label>
      {selectedName ? (
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
          <span className="truncate">{selectedName}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            Trocar
          </Button>
        </div>
      ) : (
        <>
          <Input id="usability-filter-person" type="search" placeholder="Buscar por nome ou matrícula (mín. 2 letras)" value={term} disabled={Boolean(disabledReason)} onChange={(event) => setTerm(event.target.value)} data-usage-element="list.search" autoComplete="off" />
          {debounced.trim().length >= 2 ? (
            <ul className="max-h-48 overflow-y-auto rounded-md border" aria-label="Pessoas encontradas" aria-busy={results.isFetching}>
              {results.data?.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">Ninguém no seu alcance com esse nome.</li> : null}
              {results.data?.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      personNames.set(person.id, person.name)
                      setTerm("")
                      onChange(person.id)
                    }}
                  >
                    {person.name}
                    <span className="ml-2 text-xs text-muted-foreground">{[person.matricula, person.teamName].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <DisabledReason id="usability-filter-person-reason" reason={disabledReason} />
    </div>
  )
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) (result[key(item)] ??= []).push(item)
  return result
}
