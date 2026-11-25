"use client"

import { useMemo, useRef, type ReactNode } from "react"
import { SlidersHorizontal, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ListDateRangeFilter } from "@/components/admin/shared/list/list-filters"
import { OrgUnitMultiFilter, parentsOf } from "@/components/admin/shared/list/org-unit-multi-filter"
import { useUnitSelection, type OrgUnitChange } from "@/components/admin/shared/list/team-subteam-filters"
import { PersonCombobox, usePersonLabel } from "@/components/admin/shared/person-combobox"
import { useFocusAfterRemoval } from "@/hooks/use-focus-after-removal"
import { coversUnit, idsOrUndefined, type OrgUnitIds } from "@/lib/admin/unit-selection"
import { getUsageTracker } from "@/lib/usage/usage-provider"
import { cn } from "@/lib/utils"
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

/** Grupo, Subgrupo, pessoa e liderança no alcance do observador, em lotes (na URL da tela só vai o id, nunca o nome). */
const OPTIONS_SOURCE = { path: "/api/v1/admin/usability/users/options" }
const LEADERS_SOURCE = { path: "/api/v1/admin/usability/users/options", params: { of: "leaders" } }

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

  function changeMany(changes: Partial<Record<FilterKey, string | undefined>>) {
    onChange(changes)
    try {
      // Só o que mudou de valor: escolher um Grupo não conta como filtro de Subgrupo.
      for (const key of Object.keys(changes) as FilterKey[]) if (changes[key] !== values[key]) getUsageTracker()?.filterApplied("usability", key)
    } catch {
      // observacional
    }
  }
  const change = (key: FilterKey, value: string | undefined) => changeMany({ [key]: value })
  const { person } = usePersonLabel(OPTIONS_SOURCE, values.personId)
  // Grupo → Subgrupo → pessoa: a pessoa que deixou de caber sai (a mesma regra no painel e nos selos).
  const changeUnits: OrgUnitChange = (next, parents) =>
    changeMany({ teamId: next.teamId?.join(","), subteamId: next.subteamId?.join(","), ...(person && !coversUnit(next, person, parents) ? { personId: undefined } : {}) })
  const units: OrgUnitIds = { teamId: idsOrUndefined(idsOf(values.teamId)), subteamId: idsOrUndefined(idsOf(values.subteamId)) }
  // Um selo por Grupo e por Subgrupo; os demais filtros, um por filtro.
  const unitChips = useUnitSelection(OPTIONS_SOURCE, units, changeUnits).chips
  const chips = active.flatMap((key): { id: string; key: FilterKey; content: ReactNode; removeLabel: string; onRemove: () => void }[] =>
    key === "teamId" || key === "subteamId"
      ? unitChips.filter((chip) => chip.key.startsWith(key === "teamId" ? "team:" : "subteam:")).map((chip) => ({ id: chip.key, key, content: <>{chip.label}</>, removeLabel: chip.label, onRemove: chip.onClear }))
      : [{ id: key, key, content: <>{FILTER_LABELS[key] ?? key}: <FilterValue filterKey={key} value={values[key]} context={context} /></>, removeLabel: FILTER_LABELS[key] ?? key, onRemove: () => change(key, undefined) }],
  )
  const chipsRef = useRef<HTMLUListElement>(null)
  const removing = useFocusAfterRemoval(chipsRef, chips.length)

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
        <FiltersPanel context={context} values={values} supported={supported} canViewPeople={canViewPeople} activeCount={active.length} onChange={changeMany} onUnitsChange={changeUnits} />
        {active.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X data-icon="inline-start" /> Limpar filtros
          </Button>
        ) : null}
      </div>
      {period === "CUSTOM" && (!values.from || !values.to) ? <p className="text-xs text-muted-foreground">Escolha a data inicial e a final para consultar o intervalo.</p> : null}
      {active.length > 0 ? (
        <ul ref={chipsRef} className="flex flex-wrap gap-1.5" aria-label="Filtros aplicados">
          {chips.map(({ id, key, content, removeLabel, onRemove }, index) => {
            const off = inapplicable.includes(key)
            const reason = context.notApplicableReasons[key] ?? "Não se aplica a esta aba."
            return (
              <li key={id} className="min-w-0 max-w-full">
                <Badge variant={off ? "outline" : "secondary"} className={cn("max-w-full gap-1 pr-1 font-normal", off && "text-muted-foreground line-through decoration-muted-foreground/60")} title={off ? reason : undefined}>
                  <span className="truncate">{content}</span>
                  {off ? <span className="sr-only"> — não se aplica nesta aba: {reason}</span> : null}
                  <button type="button" data-removable className="rounded-sm p-0.5 hover:bg-foreground/10" aria-label={`Remover filtro ${removeLabel}`} onClick={() => { removing(index); onRemove() }}>
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

/** Vários ids num filtro da URL (`a,b`). */
const idsOf = (value: string | undefined): string[] => value?.split(",").filter(Boolean) ?? []

/** Valor do filtro no selo: pessoa e liderança têm o nome resolvido pelo id (mesmo fora do lote carregado). */
function FilterValue({ filterKey, value, context }: { filterKey: FilterKey; value: string | undefined; context: UsabilityContext }) {
  const person = usePersonLabel(OPTIONS_SOURCE, filterKey === "personId" || filterKey === "leaderId" ? value : null)
  return <>{person.label ?? valueLabel(filterKey, value, context)}</>
}

function valueLabel(key: FilterKey, value: string | undefined, context: UsabilityContext): string {
  if (!value) return ""
  const options = context.options
  switch (key) {
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
  onChange: (changes: Partial<Record<FilterKey, string | undefined>>) => void
  onUnitsChange: OrgUnitChange
}

function FiltersPanel({ context, values, supported, canViewPeople, activeCount, onChange, onUnitsChange }: PanelProps) {
  const options = context.options
  const reason = (key: FilterKey) => (supported.has(key) ? null : (context.notApplicableReasons[key] ?? "Não se aplica a esta aba."))
  const { teamIds, subteamIds, chooseTeams, chooseSubteams } = useUnitSelection(OPTIONS_SOURCE, { teamId: idsOf(values.teamId), subteamId: idsOf(values.subteamId) }, onUnitsChange)
  const describedBy = (key: FilterKey, id: string = key) => (reason(key) ? `usability-filter-${id}-reason` : undefined)
  const screensByArea = groupBy(options.screens, (screen) => screen.areaLabel)
  const select = (key: FilterKey, label: string, entries: { value: string; label: string }[], allLabel = "Todos") => (
    <FilterSelect key={key} id={`usability-filter-${key}`} label={label} value={values[key]} entries={entries} allLabel={allLabel} disabledReason={reason(key)} onChange={(value) => onChange({ [key]: value })} />
  )
  const toggle = (key: FilterKey, label: string, hint: string) => (
    <FilterToggle key={key} id={`usability-filter-${key}`} label={label} hint={hint} checked={values[key] === "1"} disabledReason={reason(key)} onChange={(checked) => onChange({ [key]: checked ? "1" : undefined })} />
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
            <FilterField id="usability-filter-teamId" label="Grupo" disabledReason={reason("teamId")}>
              <OrgUnitMultiFilter id="usability-filter-teamId" kind="TEAM" source={OPTIONS_SOURCE} variant="field" value={teamIds} onChange={(ids) => chooseTeams(ids)} otherSelected={subteamIds.length} anyLabel="Todos" ariaLabel="Grupo" ariaDescribedBy={describedBy("teamId")} disabled={Boolean(reason("teamId"))} />
            </FilterField>
            <FilterField id="usability-filter-subteamId" label="Subgrupo" disabledReason={reason("subteamId")}>
              <OrgUnitMultiFilter id="usability-filter-subteamId" kind="SUBTEAM" source={OPTIONS_SOURCE} variant="field" teamIds={teamIds} value={subteamIds} onChange={(ids, chosen) => chooseSubteams(ids, parentsOf(chosen))} otherSelected={teamIds.length} anyLabel="Todos" ariaLabel="Subgrupo" ariaDescribedBy={describedBy("subteamId")} disabled={Boolean(reason("subteamId"))} />
            </FilterField>
            {canViewPeople ? (
              <FilterField id="usability-filter-leaderId" label="Liderança (estrutura abaixo)" disabledReason={reason("leaderId")}>
                <PersonCombobox id="usability-filter-leaderId" source={LEADERS_SOURCE} variant="field" value={values.leaderId} onChange={(person) => onChange({ leaderId: person?.id })} emptyLabel="Todas" emptyText="Nenhuma liderança no seu alcance." ariaLabel="Liderança" searchesMatricula ariaDescribedBy={describedBy("leaderId")} disabled={Boolean(reason("leaderId"))} />
              </FilterField>
            ) : null}
            {canViewPeople ? (
              <FilterField id="usability-filter-person" label="Pessoa" disabledReason={reason("personId")} className="sm:col-span-2">
                <PersonCombobox id="usability-filter-person" source={OPTIONS_SOURCE} variant="field" value={values.personId} onChange={(person) => onChange({ personId: person?.id })} teamId={teamIds} subteamId={subteamIds} emptyLabel="Todas" ariaLabel="Pessoa" searchesMatricula usageSurface="usability" ariaDescribedBy={describedBy("personId", "person")} disabled={Boolean(reason("personId"))} />
              </FilterField>
            ) : null}
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
              onChange={(value) => onChange({ screenKey: value })}
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
            <FilterDate id="usability-filter-referenceDate" label="Data de referência (DAU/WAU/MAU)" value={values.referenceDate} disabledReason={reason("referenceDate")} onChange={(value) => onChange({ referenceDate: value })} />
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

/** Campo com rótulo e o motivo de estar indisponível nesta aba. */
function FilterField({ id, label, disabledReason, className, children }: { id: string; label: string; disabledReason: string | null; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className={cn("text-xs", disabledReason && "text-muted-foreground")}>
        {label}
      </Label>
      {children}
      <DisabledReason id={`${id}-reason`} reason={disabledReason} />
    </div>
  )
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) (result[key(item)] ??= []).push(item)
  return result
}
