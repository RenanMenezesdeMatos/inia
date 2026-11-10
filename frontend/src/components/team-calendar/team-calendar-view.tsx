"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, ClipboardCheck, Info } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsCard, AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { ListBooleanFilter, ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { ListNoResultsState } from "@/components/admin/shared/list/list-states"
import { useAdminListState, useClampListPage } from "@/hooks/use-admin-list-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useCancelScheduleExceptionMutation, useClassificationHistoryQuery, useClassifyWorkdayMutation, useProvisionScheduleExceptionMutation, useScheduleExceptionAuditQuery, useTeamCalendarQuery } from "@/queries/team-calendar/use-team-calendar"
import { AUDIT_ACTION_LABELS, type CalendarAttentionKind, type JustifiedAbsenceReason, type ResolvedWorkdayState, type TeamCalendarDay, type TeamCalendarListParams, type TeamCalendarPerson, type TeamCalendarView as TeamCalendarData, type WorkdayClassificationKind } from "@/schemas/team-calendar/team-calendar.schema"

import { describeRange, rangeFor, shiftRange, WEEKDAY_SHORT, weekdayOf, type CalendarMode } from "./calendar-dates"
import { SectionLabel } from "@/components/ui/surface"

export type TeamCalendarState = { calendarDate: string | null; calendarPerson: string | null; calendarAnchor: string | null }

// Filtros da lista de colaboradores — mesmo estado/UX das listagens administrativas (busca debounced,
// "Limpar filtros", paginação). Todos os filtros são seletores SIMPLES com o mesmo desenho ("Qualquer …"
// como padrão); cargo = `job_title`; as opções vêm do backend, derivadas da própria equipe.
type CalendarFilters = { search: string; teamId: string | undefined; subteamId: string | undefined; jobTitle: string | undefined; scheduleType: string | undefined; attention: CalendarAttentionKind | undefined; scheduledToday: boolean | undefined }
const DEFAULT_FILTERS: CalendarFilters = { search: "", teamId: undefined, subteamId: undefined, jobTitle: undefined, scheduleType: undefined, attention: undefined, scheduledToday: undefined }

/**
 * CALENDÁRIO DA EQUIPE — superfície de provisionamento/correção operacional do Supervisor (não é WFM).
 * Por colaborador × dia: PLANEJADO (escala/exceção/situação) × OBSERVADO (produção) × DISPONIBILIDADE
 * dos dados (D-1/D-2, RH) × CLASSIFICAÇÃO humana = estado resolvido. Provisionar registra uma exceção
 * (dia ou período) ANTES da data; classificar explica um dia sem produção DEPOIS de os dados fecharem
 * (falta injustificada / ausência justificada / dados não chegaram) — revisável, com histórico. Cancelar
 * não apaga — o backend decide o que é permitido (escopo real) e audita tudo.
 */
export function TeamCalendarView({ state, onStateChange, employeeHref, pendingHref }: { state: TeamCalendarState; onStateChange: (patch: Partial<TeamCalendarState>) => void; employeeHref?: (personId: string) => string; pendingHref?: (reconciliationId: string) => string }) {
  const [mode, setMode] = useState<CalendarMode>("WEEK")
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const anchorDate = state.calendarDate ?? today
  const range = useMemo(() => rangeFor(mode, anchorDate), [mode, anchorDate])
  const list = useAdminListState({ storageKey: "team-calendar", defaultFilters: DEFAULT_FILTERS })
  const listParams: TeamCalendarListParams = useMemo(() => ({ search: list.params.search, teamId: list.params.teamId, subteamId: list.params.subteamId, jobTitle: list.params.jobTitle, scheduleType: list.params.scheduleType, attention: list.params.attention, scheduledToday: list.params.scheduledToday, page: list.params.page, pageSize: list.params.pageSize }), [list.params])
  const query = useTeamCalendarQuery({ from: range.from, to: range.to, anchorId: state.calendarAnchor, list: listParams })
  const [selected, setSelected] = useState<{ person: TeamCalendarPerson; day: TeamCalendarDay } | null>(null)
  const [provision, setProvision] = useState<{ personId: string | null; from: string; to: string } | null>(null)
  const [classify, setClassify] = useState<{ person: TeamCalendarPerson; day: TeamCalendarDay } | null>(null)
  const data = query.data ?? null
  const currentToday = data?.today ?? today
  const pageResult = useMemo(() => (data ? { items: data.people, total: data.pagination.total, page: data.pagination.page, pageSize: data.pagination.pageSize } : undefined), [data])
  useClampListPage(pageResult, list.page, list.pageSize, list.setPage)
  const teamOptions = useMemo(() => (data?.filterOptions.teams ?? []).map((team) => ({ value: team.id, label: team.name })), [data])
  // Subgrupos do grupo escolhido; sem grupo, todos os subgrupos da equipe (prefixados pelo grupo).
  const subteamOptions = useMemo(() => {
    const teams = data?.filterOptions.teams ?? []
    const selected = list.filters.teamId ? teams.filter((team) => team.id === list.filters.teamId) : teams
    return selected.flatMap((team) => team.subteams.map((subteam) => ({ value: subteam.id, label: selected.length > 1 || !list.filters.teamId ? `${team.name} › ${subteam.name}` : subteam.name })))
  }, [data, list.filters.teamId])
  const jobTitleOptions = useMemo(() => (data?.filterOptions.jobTitles ?? []).map((title) => ({ value: title, label: title })), [data])
  const scheduleOptions = useMemo(() => (data?.filterOptions.scheduleTypes ?? []).map((entry) => ({ value: entry.code, label: entry.label })), [data])
  const attentionOptions = useMemo(() => (data?.filterOptions.attention ?? []).map((entry) => ({ value: entry.code as CalendarAttentionKind, label: entry.label })), [data])

  return (
    <section className="w-full space-y-4" data-testid="team-calendar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionLabel as="p" className="mb-1">Provisionamento e correção operacional</SectionLabel>
          <h2 className="text-2xl font-semibold tracking-tight">Calendário da equipe</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Planejado (escala, folga, day off, banco de horas, atestado, situação funcional) × observado (produção real). Registre antes da data o que sai da produção; depois que os dados fecham, um dia sem produção vira pendência para você classificar. Ausência de dado não é ausência do colaborador: antes do prazo das fontes o dia fica &quot;aguardando dados&quot;.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.availableAnchors.length > 1 ? (
            <Select value={data.anchor.personId} onValueChange={(value) => { list.setPage(1); onStateChange({ calendarAnchor: value }) }}>
              <SelectTrigger className="w-56" aria-label="Equipe" data-testid="calendar-anchor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.availableAnchors.map((anchor) => (
                  <SelectItem key={anchor.personId} value={anchor.personId}>{anchor.name} · {anchor.roleLabel}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex items-center rounded-lg border border-border">
            <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={() => onStateChange({ calendarDate: shiftRange(mode, anchorDate, -1) })}><ChevronLeft className="size-4" /></Button>
            <span className="min-w-36 px-2 text-center text-sm font-medium" data-testid="calendar-range">{describeRange(mode, range)}</span>
            <Button variant="ghost" size="icon" aria-label="Próximo período" onClick={() => onStateChange({ calendarDate: shiftRange(mode, anchorDate, 1) })}><ChevronRight className="size-4" /></Button>
          </div>
          <Button variant={mode === "WEEK" ? "secondary" : "outline"} size="sm" onClick={() => setMode("WEEK")}>Semana</Button>
          <Button variant={mode === "MONTH" ? "secondary" : "outline"} size="sm" onClick={() => setMode("MONTH")}>Mês</Button>
          <Button variant="outline" size="sm" onClick={() => onStateChange({ calendarDate: currentToday })}>Hoje</Button>
          <Button size="sm" disabled={!data?.canProvision} onClick={() => setProvision({ personId: null, from: currentToday, to: currentToday })} data-testid="calendar-provision">
            <CalendarPlus className="size-4" aria-hidden /> Provisionar exceção
          </Button>
        </div>
      </div>

      {data ? <EvidenceSourcesLine data={data} /> : null}

      {data && data.pagination.totalPeople > 0 ? (
        <ListToolbar
          search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar colaborador por nome ou cargo" ariaLabel="Buscar colaborador" pending={list.isSearchPending} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          {teamOptions.length > 0 ? <ListSelectFilter value={list.filters.teamId} onChange={(value) => list.patchFilters({ teamId: value, subteamId: undefined })} options={teamOptions} allLabel="Qualquer grupo" ariaLabel="Filtrar por grupo" /> : null}
          {teamOptions.length > 0 ? (
            subteamOptions.length > 0 ? (
              <ListSelectFilter value={list.filters.subteamId} onChange={(value) => list.setFilter("subteamId", value)} options={subteamOptions} allLabel="Qualquer subgrupo" ariaLabel="Filtrar por subgrupo" />
            ) : (
              <Select value="__none__" disabled>
                <SelectTrigger className="w-full sm:w-auto sm:min-w-36" aria-label="Filtrar por subgrupo"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">{list.filters.teamId ? "Sem subgrupos neste grupo" : "Sem subgrupos nesta equipe"}</SelectItem></SelectContent>
              </Select>
            )
          ) : null}
          <ListSelectFilter value={list.filters.jobTitle} onChange={(value) => list.setFilter("jobTitle", value)} options={jobTitleOptions} allLabel="Qualquer cargo" ariaLabel="Filtrar por cargo" />
          <ListSelectFilter value={list.filters.scheduleType} onChange={(value) => list.setFilter("scheduleType", value)} options={scheduleOptions} allLabel="Qualquer escala" ariaLabel="Filtrar por escala" />
          <ListSelectFilter value={list.filters.attention} onChange={(value) => list.setFilter("attention", value)} options={attentionOptions} allLabel="Qualquer situação no período" ariaLabel="Filtrar por situação no período" />
          <ListBooleanFilter value={list.filters.scheduledToday} onChange={(value) => list.setFilter("scheduledToday", value)} allLabel="Hoje: todos" trueLabel="Hoje: trabalham" falseLabel="Hoje: não trabalham (folga, situação, atestado)" ariaLabel="Filtrar por quem trabalha hoje" />
        </ListToolbar>
      ) : null}

      {query.isPending ? (
        <AnalyticsCard>
          <TableSkeleton rows={5} />
        </AnalyticsCard>
      ) : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {data && data.pagination.totalPeople === 0 ? (
        <AnalyticsCard>
          <div className="py-6">
            <AnalyticsEmptyState icon={CalendarDays} title="Nenhum operador direto nesta equipe" description={data.availableAnchors.length > 1 ? "Escolha uma equipe acima para ver o calendário dos operadores." : "O calendário mostra os operadores que reportam diretamente a você."} />
          </div>
        </AnalyticsCard>
      ) : null}
      {data && data.pagination.totalPeople > 0 && data.pagination.total === 0 ? <ListNoResultsState title="Nenhum colaborador corresponde aos filtros" onClear={list.resetFilters} /> : null}
      {data && data.people.length > 0 ? (
        <div aria-busy={query.isFetching} className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
        <AnalyticsCard className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="calendar-grid">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th scope="col" className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">Colaborador</th>
                {data.people[0]!.days.map((day) => (
                  <th key={day.date} scope="col" className={cn("px-1 py-2 text-center font-medium", day.date === currentToday && "border-x border-primary/40 text-primary")} data-today={day.date === currentToday || undefined}>
                    <span className="block">{WEEKDAY_SHORT[weekdayOf(day.date)]}</span>
                    <span className="block tabular-nums">{day.date.slice(8, 10)}/{day.date.slice(5, 7)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.people.map((person) => (
                <tr key={person.personId} className={cn("border-b border-border/60", state.calendarPerson === person.personId && "bg-primary/5")} data-testid="calendar-person-row">
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal">
                    <span className="block truncate font-medium">{employeeHref ? <a href={employeeHref(person.personId)} className="hover:underline">{person.name}</a> : person.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {person.scheduleTypeLabel ? `Escala ${person.scheduleTypeLabel}` : "Sem escala configurada"}
                      {person.summary.missingProduction > 0 ? ` · ${person.summary.missingProduction} pendência(s)` : ""}
                      {person.summary.waitingForData > 0 ? ` · ${person.summary.waitingForData} aguardando dados` : ""}
                      {person.summary.unjustifiedAbsences > 0 ? ` · ${person.summary.unjustifiedAbsences} falta(s) injustificada(s)` : ""}
                      {person.summary.divergences > 0 ? ` · ${person.summary.divergences} divergência(s)` : ""}
                    </span>
                  </th>
                  {person.days.map((day) => (
                    <td key={day.date} className={cn("px-1 py-1 text-center align-top", day.date === currentToday && "border-x border-primary/40 bg-primary/5")} data-today={day.date === currentToday || undefined}>
                      <DayCell day={day} onClick={() => setSelected({ person, day })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </AnalyticsCard>
        </div>
      ) : null}
      {data && data.pagination.total > 0 ? (
        <ListPagination page={list.page} pageSize={list.pageSize} total={data.pagination.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} itemLabel={["colaborador", "colaboradores"]} isFetching={query.isFetching} />
      ) : null}

      <Legend />

      <DayDetailSheet selection={selected} onOpenChange={(open) => (!open ? setSelected(null) : undefined)} onProvision={(personId, date) => { setSelected(null); setProvision({ personId, from: date, to: date }) }} onClassify={(person, day) => { setSelected(null); setClassify({ person, day }) }} pendingHref={pendingHref} />
      {data ? <ProvisionDialog data={data} draft={provision} onOpenChange={(open) => (!open ? setProvision(null) : undefined)} /> : null}
      {data ? <ClassifyDialog data={data} draft={classify} onOpenChange={(open) => (!open ? setClassify(null) : undefined)} /> : null}
    </section>
  )
}

function EvidenceSourcesLine({ data }: { data: TeamCalendarData }) {
  const sources = [data.evidenceSources.interactions ? "interações registradas" : null, data.evidenceSources.indicatorCodes.length > 0 ? `indicador(es) ${data.evidenceSources.indicatorCodes.join(", ")}` : null].filter(Boolean).join(" e ")
  return (
    <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="calendar-evidence-sources">
      {data.evidenceSources.enabled ? <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />}
      {data.evidenceSources.enabled ? <span>Evidência de produção: {sources}. Produção observada torna o dia trabalhado mesmo que o plano dissesse folga; um dia programado sem produção vira pendência só depois de as fontes fecharem (D-1/D-2 e RH dentro do SLA) — fonte atrasada gera alerta administrativo, nunca falta.</span> : <span>Sem fonte de evidência de produção configurada (nenhuma interação registrada nem indicador marcado como evidência): o calendário mostra só o planejado e a ausência de produção não gera pendência.</span>}
    </p>
  )
}

const STATE_STYLE: Record<ResolvedWorkdayState, { label: string; className: string }> = {
  WORKED_OBSERVED: { label: "Trabalhou", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
  PLANNED_WORK: { label: "Trabalha", className: "bg-sky-500/10 text-sky-800 dark:text-sky-200" },
  WAITING_FOR_SOURCES: { label: "Aguardando dados", className: "bg-sky-500/10 text-sky-800 dark:text-sky-200 border border-dashed border-sky-500/50" },
  DATA_SOURCE_DELAY: { label: "Fonte atrasada", className: "bg-orange-500/15 text-orange-900 dark:text-orange-100 border border-dashed border-orange-500/60" },
  MISSING_EXPECTED_PRODUCTION: { label: "Sem produção · classificar", className: "bg-amber-500/20 text-amber-900 dark:text-amber-100" },
  CLASSIFIED_UNJUSTIFIED_ABSENCE: { label: "Falta injustificada", className: "bg-red-500/15 text-red-900 dark:text-red-100" },
  CLASSIFIED_JUSTIFIED_ABSENCE: { label: "Ausência justificada", className: "bg-muted text-muted-foreground" },
  CLASSIFIED_WORKED_DATA_MISSING: { label: "Trabalhou · dados não recebidos", className: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-dashed border-emerald-500/50" },
  PLANNED_NON_WORKING: { label: "Folga", className: "bg-muted text-muted-foreground" },
  NON_ELIGIBLE_EMPLOYMENT_STATUS: { label: "Situação", className: "bg-violet-500/10 text-violet-800 dark:text-violet-200" },
  INDETERMINATE: { label: "Escala ?", className: "bg-muted text-muted-foreground border border-dashed border-border" },
  BEFORE_HIRE: { label: "—", className: "text-muted-foreground" },
}

const REASON_LABELS: Record<JustifiedAbsenceReason, string> = { ATESTADO: "Atestado", DAY_OFF: "Day off", BANCO_HORAS: "Banco de horas", FOLGA_EXTRAORDINARIA: "Folga extraordinária", OTHER_JUSTIFIED: "Outro motivo" }

function formatExpected(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** "Aguardando D-1" / "Aguardando RH": qual grupo de fontes ainda pode explicar o dia e até quando. */
function waitingDetail(day: TeamCalendarDay): string {
  const availability = day.availability
  if (availability.decidedBy === "EMPLOYMENT") return `RH até ${formatExpected(availability.employmentExpectedAt)}`
  return `dados até ${formatExpected(availability.workActivityExpectedAt)}`
}

function cellLabel(day: TeamCalendarDay): string {
  if (day.state === "NON_ELIGIBLE_EMPLOYMENT_STATUS" && day.status) return day.status.label
  if (day.state === "PLANNED_NON_WORKING" && day.exception) return day.exception.label
  if (day.state === "PLANNED_NON_WORKING" && day.holiday) return "Feriado"
  if (day.state === "CLASSIFIED_JUSTIFIED_ABSENCE" && day.classification?.reasonCode) return REASON_LABELS[day.classification.reasonCode]
  if (day.state === "WAITING_FOR_SOURCES") return day.availability.decidedBy === "EMPLOYMENT" ? "Aguardando RH" : "Aguardando dados"
  return STATE_STYLE[day.state].label
}

function cellSublabel(day: TeamCalendarDay): string | null {
  if (day.state === "WAITING_FOR_SOURCES") return waitingDetail(day)
  if (day.state === "CLASSIFIED_UNJUSTIFIED_ABSENCE" || day.state === "CLASSIFIED_JUSTIFIED_ABSENCE") return day.classification?.classifiedByName ? `por ${day.classification.classifiedByName.split(" ")[0]}` : null
  if (day.state === "WORKED_OBSERVED" && day.classification?.contradictedBy === "WORK_EVIDENCE") return `era ${day.classification.label.toLowerCase()}`
  return null
}

function DayCell({ day, onClick }: { day: TeamCalendarDay; onClick: () => void }) {
  const style = STATE_STYLE[day.state]
  const pending = day.reconciliation?.kind === "MISSING_EXPECTED_PRODUCTION" && day.reconciliation.status === "OPEN"
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`calendar-day-${day.state}`}
      data-date={day.date}
      title={`${formatCivilDate(day.date)} · ${day.stateLabel}`}
      className={cn("flex w-full min-w-16 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] leading-tight transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60", style.className)}
    >
      <span className="font-medium">{cellLabel(day)}</span>
      {cellSublabel(day) ? <span className="text-[10px] opacity-80">{cellSublabel(day)}</span> : null}
      {day.overridesPlan && day.exception ? <span className="text-[10px] opacity-80">era {day.exception.label.toLowerCase()}</span> : null}
      {day.overridesPlan && !day.exception ? <span className="text-[10px] opacity-80">fora do plano</span> : null}
      {pending ? <span className="rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white" aria-label="Pendência aberta">!</span> : null}
      {day.conflict ? <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white" aria-label="Inconsistência">produção</span> : null}
      {day.exception?.manualOverride ? <span className="text-[10px] opacity-80">conflito Central</span> : null}
    </button>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Legenda">
      {(["WORKED_OBSERVED", "PLANNED_WORK", "WAITING_FOR_SOURCES", "DATA_SOURCE_DELAY", "MISSING_EXPECTED_PRODUCTION", "CLASSIFIED_UNJUSTIFIED_ABSENCE", "CLASSIFIED_JUSTIFIED_ABSENCE", "CLASSIFIED_WORKED_DATA_MISSING", "PLANNED_NON_WORKING", "NON_ELIGIBLE_EMPLOYMENT_STATUS", "INDETERMINATE"] as const).map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-5 rounded", STATE_STYLE[state].className)} aria-hidden />
          {state === "PLANNED_NON_WORKING" ? "Folga / day off / banco / atestado / feriado" : state === "NON_ELIGIBLE_EMPLOYMENT_STATUS" ? "Férias / INSS / outras situações" : state === "INDETERMINATE" ? "Escala 6x1 sem calendário" : state === "WAITING_FOR_SOURCES" ? "Aguardando dados (D-1/D-2) ou RH" : state === "CLASSIFIED_JUSTIFIED_ABSENCE" ? "Ausência justificada (classificada)" : STATE_STYLE[state].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5"><span className="rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white">!</span> pendência aberta</li>
      <li className="flex items-center gap-1.5"><span className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">produção</span> produção com situação não produtiva</li>
    </ul>
  )
}

function DayDetailSheet({ selection, onOpenChange, onProvision, onClassify, pendingHref }: { selection: { person: TeamCalendarPerson; day: TeamCalendarDay } | null; onOpenChange: (open: boolean) => void; onProvision: (personId: string, date: string) => void; onClassify: (person: TeamCalendarPerson, day: TeamCalendarDay) => void; pendingHref?: (reconciliationId: string) => string }) {
  const cancel = useCancelScheduleExceptionMutation()
  const audit = useScheduleExceptionAuditQuery(selection?.day.exception?.id ?? null)
  const day = selection?.day ?? null
  const person = selection?.person ?? null
  const classifiable = day !== null && (day.state === "MISSING_EXPECTED_PRODUCTION" || day.state === "CLASSIFIED_UNJUSTIFIED_ABSENCE" || day.state === "CLASSIFIED_JUSTIFIED_ABSENCE" || day.state === "CLASSIFIED_WORKED_DATA_MISSING" || (day.classification !== null && day.state === "WORKED_OBSERVED"))
  // Histórico também para dias cuja classificação foi superada (produção tardia, RH tardio): a pendência resolvida indica que houve classificação.
  const hasClassificationTrail = day !== null && (day.classification !== null || classifiable || (day.reconciliation?.kind === "MISSING_EXPECTED_PRODUCTION" && day.reconciliation.status === "RESOLVED"))
  const history = useClassificationHistoryQuery(hasClassificationTrail ? (person?.personId ?? null) : null, hasClassificationTrail ? (day?.date ?? null) : null)
  const supersededHistory = day !== null && day.classification === null && (history.data?.length ?? 0) > 0
  return (
    <Sheet open={selection !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-lg" data-testid="calendar-day-sheet">
        {day && person ? (
          <>
            <SheetHeader className="border-b">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("border-0", STATE_STYLE[day.state].className)}>{day.stateLabel}</Badge>
                {day.overridesPlan ? <Badge variant="outline" className="border-0 bg-amber-500/15 text-amber-900 dark:text-amber-100">Divergência plano × realidade</Badge> : null}
                {day.conflict ? <Badge variant="outline" className="border-0 bg-red-500/15 text-red-800 dark:text-red-200">Inconsistência de dados</Badge> : null}
              </div>
              <SheetTitle className="text-lg">{person.name} · {formatCivilDate(day.date)}</SheetTitle>
              <SheetDescription>Planejado × observado deste dia. Nada aqui recalcula a escala da fonte: exceções são registradas por cima, com auditoria.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Planejado</dt>
                  <dd className="mt-0.5 font-medium" data-testid="day-planned">
                    {day.status ? day.status.label : day.exception ? `${day.exception.label} (${day.exception.originLabel})` : day.plannedToWork ? `Trabalha${day.shiftStart && day.shiftEnd ? ` · ${day.shiftStart.slice(0, 5)}–${day.shiftEnd.slice(0, 5)}` : ""}` : day.holiday ? "Feriado aplicável (política de feriados)" : day.plannedCause === "UNKNOWN_SCHEDULE" ? "Escala desconhecida (6x1 sem calendário)" : "Folga"}
                    <span className="block text-xs font-normal text-muted-foreground">{day.plannedBasisLabel}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Observado</dt>
                  <dd className="mt-0.5 font-medium" data-testid="day-observed">{day.observed ? `Produção registrada: ${day.evidence}` : "Nenhuma evidência de produção"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Disponibilidade dos dados</dt>
                  <dd className="mt-0.5 font-medium" data-testid="day-availability">
                    {day.availability.label}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {day.availability.state === "WAITING_FOR_SOURCES" ? `Ainda podem chegar: ${waitingDetail(day)}. Nada é cobrado antes disso.` : day.availability.state === "DATA_SOURCE_DELAY" ? `${day.availability.decidedByLabel ?? "Fonte"} não entregou no prazo — problema de dado, não do colaborador (alerta na Central de Dados).` : day.availability.state === "AVAILABILITY_UNKNOWN" ? "Sem SLA de disponibilidade configurado na Central: a INIA não assume D-1 e não conclui ausência." : "Todas as fontes relevantes já entregaram este dia."}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Resultado</dt>
                  <dd className="mt-0.5 font-medium">{day.eligible ? "Dia elegível para os cálculos operacionais" : "Dia fora dos cálculos operacionais"}{day.overridesPlan ? " — trabalhou embora o plano dissesse que não; o planejamento fica registrado" : ""}{day.conflict ? " — produção com situação funcional não produtiva: a situação não muda automaticamente; verifique a fonte de situação" : ""}</dd>
                </div>
                {day.reconciliation ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">{day.reconciliation.kindLabel}</dt>
                    <dd className="mt-0.5 font-medium">
                      {day.reconciliation.status === "OPEN" ? "Pendência aberta — aguardando sua classificação" : day.reconciliation.status === "NOTED" ? "Aviso registrado" : `Resolvida · ${day.reconciliation.resolutionLabel ?? ""}`}
                      {day.reconciliation.kind === "MISSING_EXPECTED_PRODUCTION" && pendingHref ? (
                        <a href={pendingHref(day.reconciliation.id)} className="ml-2 text-primary hover:underline">abrir pendência</a>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {day.cancelledExceptions > 0 ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Histórico</dt>
                    <dd className="mt-0.5 font-medium">{day.cancelledExceptions} exceção(ões) cancelada(s) neste dia</dd>
                  </div>
                ) : null}
              </dl>

              {day.classification || classifiable || supersededHistory ? (
                <section className="space-y-2 border-t border-border p-4 text-sm" data-testid="day-classification">
                  <h3 className="font-semibold">Classificação operacional</h3>
                  {day.classification ? (
                    <p>
                      <span className="font-medium">{day.classification.label}</span>
                      <span className="block text-xs text-muted-foreground">Classificada por {day.classification.classifiedByName ?? "—"}{day.classification.classifiedAt ? ` em ${formatDateTime(day.classification.classifiedAt)}` : ""}</span>
                      {day.classification.contradictedBy === "WORK_EVIDENCE" ? <span className="block text-xs text-amber-700 dark:text-amber-300">Contrariada por evidência de trabalho posterior: o dia conta como trabalhado; a classificação fica no histórico.</span> : null}
                      {day.classification.contradictedBy === "AUTHORITATIVE_STATUS" ? <span className="block text-xs text-amber-700 dark:text-amber-300">A situação funcional da fonte autoritativa prevalece; a classificação fica no histórico.</span> : null}
                      {day.state === "CLASSIFIED_WORKED_DATA_MISSING" ? <span className="block text-xs text-muted-foreground">Confirmado pelo Supervisor. Nenhum indicador foi criado pela INIA — o dado real entra quando chegar.</span> : null}
                      {day.state === "CLASSIFIED_UNJUSTIFIED_ABSENCE" ? <span className="block text-xs text-muted-foreground">O dia continua contando como dia esperado de trabalho; nenhuma medição foi criada.</span> : null}
                    </p>
                  ) : supersededHistory ? (
                    <p className="text-xs text-muted-foreground">A classificação anterior foi superada por um fato mais forte ({history.data?.at(-1)?.supersededReasonLabel?.toLowerCase() ?? "dado posterior"}); ela fica preservada no histórico.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem produção depois de as fontes fecharem. Classifique o que aconteceu — a INIA nunca decide isso sozinha.</p>
                  )}
                  {history.data && (history.data.length > 1 || supersededHistory) ? (
                    <ul className="space-y-1 text-xs text-muted-foreground" data-testid="day-classification-history">
                      {history.data.map((entry) => (
                        <li key={entry.id}>
                          {formatDateTime(entry.classifiedAt)} · {entry.label}{entry.classifiedByName ? ` · ${entry.classifiedByName}` : ""}{entry.supersededReason ? ` → ${entry.supersededReason === "REVISED" ? `alterada${entry.supersededAt ? ` em ${formatDateTime(entry.supersededAt)}` : ""}` : entry.supersededReasonLabel?.toLowerCase()}` : " (vigente)"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {day.state !== "WORKED_OBSERVED" && day.state !== "NON_ELIGIBLE_EMPLOYMENT_STATUS" ? (
                    <Button size="sm" variant={day.classification ? "outline" : "default"} onClick={() => onClassify(person, day)} data-testid="day-classify">
                      <ClipboardCheck className="size-4" aria-hidden /> {day.classification ? "Editar classificação" : "Classificar"}
                    </Button>
                  ) : null}
                </section>
              ) : null}

              {day.exception ? (
                <section className="space-y-2 border-t border-border p-4 text-sm">
                  <h3 className="font-semibold">Exceção vigente: {day.exception.label}</h3>
                  <p className="text-xs text-muted-foreground">Origem: {day.exception.originLabel}{day.exception.manualOverride ? " · alterada pelo Supervisor após vir da Central (a Central não sobrescreve; conflitos ficam auditáveis)" : ""}</p>
                  {audit.data && audit.data.length > 0 ? (
                    <ul className="space-y-1 text-xs text-muted-foreground" data-testid="day-audit">
                      {audit.data.map((entry, index) => (
                        <li key={index}>{AUDIT_ACTION_LABELS[entry.action] ?? entry.action} por {entry.actorName ?? "sistema"} em {formatDateTime(entry.createdAt)}</li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancel.isPending}
                    data-testid="day-cancel-exception"
                    onClick={() =>
                      cancel.mutate(day.exception!.id, {
                        onSuccess: () => {
                          toast.success("Exceção cancelada — o dia volta a seguir a escala.")
                          onOpenChange(false)
                        },
                        onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível cancelar."),
                      })
                    }
                  >
                    Cancelar exceção
                  </Button>
                </section>
              ) : day.state !== "NON_ELIGIBLE_EMPLOYMENT_STATUS" && day.state !== "BEFORE_HIRE" ? (
                <section className="border-t border-border p-4">
                  <Button size="sm" onClick={() => onProvision(person.personId, day.date)} data-testid="day-provision">
                    <CalendarPlus className="size-4" aria-hidden /> Provisionar exceção neste dia
                  </Button>
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ProvisionDialog({ data, draft, onOpenChange }: { data: TeamCalendarData; draft: { personId: string | null; from: string; to: string } | null; onOpenChange: (open: boolean) => void }) {
  const [personId, setPersonId] = useState<string>("")
  const [code, setCode] = useState<string>(data.provisionableCodes[0]?.code ?? "DAY_OFF")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [key, setKey] = useState<string | null>(null)
  const provision = useProvisionScheduleExceptionMutation()
  // Reinicia o formulário a cada abertura (rascunho novo), sem efeitos: chave derivada do rascunho.
  const draftKey = draft ? `${draft.personId ?? ""}|${draft.from}|${draft.to}` : null
  if (draft && key !== draftKey) {
    setKey(draftKey)
    setPersonId(draft.personId ?? data.provisionablePeople[0]?.personId ?? "")
    setFrom(draft.from)
    setTo(draft.to)
  }
  const spanDays = from && to && to >= from ? Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1 : 0
  const valid = personId !== "" && from !== "" && to !== "" && to >= from && spanDays <= 31

  function submit() {
    if (!valid) return
    provision.mutate(
      { personId, code, from, to },
      {
        onSuccess: (outcome) => {
          const label = data.provisionableCodes.find((option) => option.code === code)?.label ?? code
          toast.success(`${label} registrado(a): ${outcome.created.length} dia(s) novo(s)${outcome.reactivated.length ? `, ${outcome.reactivated.length} reativado(s)` : ""}${outcome.unchanged.length ? `, ${outcome.unchanged.length} já existia(m)` : ""}.`)
          onOpenChange(false)
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível provisionar."),
      },
    )
  }

  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="provision-dialog">
        <DialogHeader>
          <DialogTitle>Provisionar exceção de calendário</DialogTitle>
          <DialogDescription>Registre antes da data que o colaborador não estará em produção. A escala enviada pela fonte não é alterada; a exceção fica auditável e a Central não a sobrescreve em silêncio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="provision-person">Colaborador</Label>
            <Select value={personId} onValueChange={setPersonId}>
              <SelectTrigger id="provision-person" data-testid="provision-person"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {data.provisionablePeople.map((person) => (
                  <SelectItem key={person.personId} value={person.personId}>{person.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provision-code">Motivo</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger id="provision-code" data-testid="provision-code"><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.provisionableCodes.map((option) => (
                  <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {code === "ATESTADO" ? <p className="text-xs text-muted-foreground">Atestado é só um motivo operacional: a INIA não armazena diagnóstico, CID, descrição médica nem documento.</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="provision-from">De</Label>
              <Input id="provision-from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); if (to < event.target.value) setTo(event.target.value) }} data-testid="provision-from" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provision-to">Até</Label>
              <Input id="provision-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} data-testid="provision-to" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{spanDays > 0 ? `${spanDays} dia(s)${spanDays > 31 ? " — máximo 31" : ""}` : "Informe um dia ou um período (até 31 dias)."}{from && from < data.today ? " · data no passado: registrada como correção operacional." : ""}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={provision.isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || provision.isPending} data-testid="provision-submit">{provision.isPending ? "Registrando..." : "Registrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClassifyDialog({ data, draft, onOpenChange }: { data: TeamCalendarData; draft: { person: TeamCalendarPerson; day: TeamCalendarDay } | null; onOpenChange: (open: boolean) => void }) {
  const [classification, setClassification] = useState<WorkdayClassificationKind | "">("")
  const [reasonCode, setReasonCode] = useState<JustifiedAbsenceReason>(data.justifiedReasons[0]?.code ?? "ATESTADO")
  const [key, setKey] = useState<string | null>(null)
  const classify = useClassifyWorkdayMutation()
  const draftKey = draft ? `${draft.person.personId}|${draft.day.date}|${draft.day.classification?.id ?? ""}` : null
  if (draft && key !== draftKey) {
    setKey(draftKey)
    setClassification("")
    setReasonCode(draft.day.classification?.reasonCode ?? data.justifiedReasons[0]?.code ?? "ATESTADO")
  }
  const current = draft?.day.classification ?? null
  const chosen: WorkdayClassificationKind | null = classification === "" ? null : classification
  const sameAsCurrent = current !== null && chosen === current.classification && (chosen !== "JUSTIFIED_ABSENCE" || reasonCode === current.reasonCode)
  const valid = chosen !== null && !sameAsCurrent

  function submit() {
    if (!draft || !valid || chosen === null) return
    classify.mutate(
      { personId: draft.person.personId, date: draft.day.date, classification: chosen, reasonCode: chosen === "JUSTIFIED_ABSENCE" ? reasonCode : null },
      {
        onSuccess: (outcome) => {
          toast.success(outcome.previous ? `Classificação alterada: ${outcome.previous.label} → ${outcome.current.label}.` : `Classificado como ${outcome.current.label}.`)
          onOpenChange(false)
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível classificar."),
      },
    )
  }

  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="classify-dialog">
        <DialogHeader>
          <DialogTitle>{current ? "Editar classificação" : "Classificar o dia"}</DialogTitle>
          <DialogDescription>{draft ? `${draft.person.name} · ${formatCivilDate(draft.day.date)}. ` : ""}A classificação explica um dia sem produção depois de as fontes fecharem. Não altera a escala; cada mudança fica no histórico.</DialogDescription>
        </DialogHeader>
        {current ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm" data-testid="classify-current">
            <span className="text-xs text-muted-foreground">Classificação atual</span>
            <span className="block font-medium">{current.label}</span>
          </p>
        ) : null}
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">{current ? "Nova classificação" : "O que aconteceu?"}</Label>
          <RadioGroup value={classification} onValueChange={(value) => setClassification(value as WorkdayClassificationKind)} className="space-y-2" data-testid="classify-options">
            {data.classifications.map((option) => (
              <label key={option.code} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-2 hover:bg-muted/60">
                <RadioGroupItem value={option.code} id={`classify-${option.code}`} className="mt-1" />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {option.code === "UNJUSTIFIED_ABSENCE" ? "O dia continua esperado como trabalho. Produção configurada com contribuição zero recebe 0 lógico; TMA/Qualidade ficam sem amostra. Nenhuma medição é criada." : option.code === "JUSTIFIED_ABSENCE" ? "O dia sai dos cálculos operacionais. Só o motivo é guardado." : "O dia continua esperado; nenhum indicador é inventado. Quando o dado chegar, a reconciliação é automática."}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          {classification === "JUSTIFIED_ABSENCE" ? (
            <div className="space-y-1.5">
              <Label htmlFor="classify-reason">Motivo</Label>
              <Select value={reasonCode} onValueChange={(value) => setReasonCode(value as JustifiedAbsenceReason)}>
                <SelectTrigger id="classify-reason" data-testid="classify-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.justifiedReasons.map((option) => (
                    <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reasonCode === "ATESTADO" ? <p className="text-xs text-muted-foreground">Atestado é só um motivo operacional: a INIA não armazena diagnóstico, CID, descrição médica nem documento.</p> : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={classify.isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={!valid || classify.isPending} data-testid="classify-submit">{classify.isPending ? "Registrando..." : current ? "Alterar classificação" : "Classificar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
