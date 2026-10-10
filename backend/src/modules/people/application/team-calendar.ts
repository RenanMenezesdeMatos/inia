import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { resolveWorkdaysBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import type { AnalyticsReadRepository, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { accessCovers, accessDenied, directOperatorsOf, loadViewerScope, operatorsBelow, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { ROLE_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { EMPLOYMENT_STATUS_LABELS, type EmploymentStatus } from "../domain/employment-status.js"
import { SCHEDULE_EXCEPTION_LABELS, SCHEDULE_EXCEPTION_ORIGIN_LABELS, SUPERVISOR_PROVISIONABLE_CODES, type ScheduleExceptionCode, type ScheduleExceptionOrigin } from "../domain/schedule-exception.js"
import { describeWorkActivityEvidence, evidenceSourcesEnabled, type WorkActivityEvidenceSources } from "../domain/work-activity-evidence.js"
import { SCHEDULE_BASIS_LABELS, SCHEDULE_TYPE_LABELS, SCHEDULE_TYPES, type ScheduleBasis, type ScheduleType } from "../domain/work-schedule.js"
import { RESOLVED_WORKDAY_STATE_LABELS, type PlannedNonWorkingCause, type ResolvedWorkdayState, type WorkdayConflict } from "../domain/workday-resolution.js"
import { AVAILABILITY_SOURCE_GROUP_LABELS, WORKDAY_AVAILABILITY_LABELS, type AvailabilitySourceGroup, type WorkdayAvailabilityState } from "../domain/workday-data-availability.js"
import { JUSTIFIED_ABSENCE_REASONS, JUSTIFIED_ABSENCE_REASON_LABELS, WORKDAY_CLASSIFICATIONS, WORKDAY_CLASSIFICATION_LABELS, type ClassificationSupersededReason, type JustifiedAbsenceReason, type WorkdayClassificationKind } from "../domain/workday-classification.js"
import { cancelScheduleException, listScheduleExceptions, loadScheduleExceptionAudit, provisionScheduleExceptions, validateProvisionRange, type ProvisionOutcome, type ScheduleExceptionRecord } from "./schedule-exception-service.js"
import { classifyWorkday, loadClassificationHistory, type ClassifyWorkdayOutcome, type WorkdayClassificationRecord } from "./workday-classification-service.js"
import { listReconciliations, RECONCILIATION_KIND_LABELS, RECONCILIATION_RESOLUTION_LABELS, type ReconciliationKind, type ReconciliationResolution, type ReconciliationStatus } from "./workday-reconciliation-service.js"

/**
 * CALENDÁRIO DA EQUIPE — superfície de PROVISIONAMENTO/CORREÇÃO operacional do Supervisor (não é WFM:
 * sem drag-and-drop, sem geração de escala, sem troca de turno, sem banco de horas, sem folha).
 * Por colaborador × dia mostra o estado RESOLVIDO (PLANEJADO × OBSERVADO): trabalha/folga/day off/
 * banco/atestado/férias/INSS…, produção observada e pendência. O Supervisor registra ANTES da data
 * (ou corrige depois) uma exceção — a MESMA tabela que a Central alimenta, com origem e auditoria.
 *
 * Autorização = o escopo de analytics (`loadViewerScope` com `calendar.manage`): a âncora precisa ser o próprio viewer ou
 * alguém visível — a subárvore real (regra operacional de quem lidera) ∪ o escopo da permission `calendar.manage` da conta
 * (organização/Grupo/Subgrupo). Provisionar: operadores ativos da subárvore ou pessoas ativas desse escopo (V1.5.8 — o
 * nível hierárquico, inclusive o legado "ADMIN", nunca amplia a visão).
 * O backend é a autoridade; o frontend só reflete o que veio daqui.
 */
export const MAX_CALENDAR_RANGE_DAYS = 42
export const DEFAULT_CALENDAR_PAGE_SIZE = 10

/**
 * Filtros da lista de colaboradores do calendário — o MESMO padrão das listagens administrativas
 * (busca + seletores + paginação). "Atenção" filtra pelo que o período resolvido mostra por pessoa
 * (pendência aberta, aguardando dados, fonte atrasada, falta injustificada, divergência, inconsistência);
 * cargo = `people.job_title` (as opções vêm dos próprios operadores da equipe, nunca de lista fixa).
 */
export const CALENDAR_ATTENTION_KINDS = ["MISSING_PRODUCTION", "WAITING_FOR_DATA", "DATA_SOURCE_DELAY", "UNJUSTIFIED_ABSENCE", "DIVERGENCE", "CONFLICT"] as const
export type CalendarAttentionKind = (typeof CALENDAR_ATTENTION_KINDS)[number]
export const CALENDAR_ATTENTION_LABELS: Record<CalendarAttentionKind, string> = {
  MISSING_PRODUCTION: "Com pendência (sem produção)",
  WAITING_FOR_DATA: "Aguardando dados",
  DATA_SOURCE_DELAY: "Fonte atrasada",
  UNJUSTIFIED_ABSENCE: "Com falta injustificada",
  DIVERGENCE: "Com divergência (produção fora do plano)",
  CONFLICT: "Com inconsistência (produção em situação não produtiva)",
}
/** "Sem escala configurada" como valor de filtro — regime é metadata opcional (`scheduleType` null). */
export const CALENDAR_SCHEDULE_NONE = "NONE"

export type TeamCalendarFilters = {
  search?: string | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  jobTitles?: readonly string[] | undefined
  scheduleTypes?: readonly string[] | undefined
  attention?: readonly CalendarAttentionKind[] | undefined
  /** true = escalados para HOJE (dia elegível: esperado trabalhar); false = fora hoje (folga/day off/situação/atestado/escala desconhecida). */
  scheduledToday?: boolean | undefined
}

export type TeamCalendarDay = {
  date: string
  state: ResolvedWorkdayState
  stateLabel: string
  eligible: boolean
  plannedToWork: boolean
  plannedBasis: ScheduleBasis
  plannedBasisLabel: string
  plannedCause: PlannedNonWorkingCause | null
  holiday: boolean
  status: { code: EmploymentStatus; label: string } | null
  exception: { id: string; code: ScheduleExceptionCode; label: string; origin: ScheduleExceptionOrigin; originLabel: string; manualOverride: boolean } | null
  cancelledExceptions: number
  observed: boolean
  evidence: string | null
  overridesPlan: boolean
  conflict: WorkdayConflict | null
  shiftStart: string | null
  shiftEnd: string | null
  reconciliation: { id: string; kind: ReconciliationKind; kindLabel: string; status: ReconciliationStatus; resolution: ReconciliationResolution | null; resolutionLabel: string | null } | null
  /** DISPONIBILIDADE dos dados do dia (organização): fechados / aguardando D-1/D-2 ou RH / fonte atrasada / SLA não configurado. */
  availability: { state: WorkdayAvailabilityState; label: string; decidedBy: AvailabilitySourceGroup | null; decidedByLabel: string | null; workActivityExpectedAt: string | null; employmentExpectedAt: string | null }
  /** CLASSIFICAÇÃO humana vigente (falta injustificada / ausência justificada / dados não chegaram), revisável. */
  classification: { id: string; classification: WorkdayClassificationKind; reasonCode: JustifiedAbsenceReason | null; label: string; classifiedByName: string | null; classifiedAt: string; contradictedBy: "WORK_EVIDENCE" | "AUTHORITATIVE_STATUS" | null } | null
}

export type TeamCalendarPerson = {
  personId: string
  name: string
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  jobTitle: string | null
  scheduleType: string | null
  scheduleTypeLabel: string | null
  days: TeamCalendarDay[]
  summary: { plannedWork: number; workedObserved: number; nonWorking: number; missingProduction: number; divergences: number; conflicts: number; waitingForData: number; dataSourceDelay: number; unjustifiedAbsences: number }
}

export type TeamCalendarView = {
  anchor: { personId: string; name: string; role: string; roleLabel: string }
  availableAnchors: { personId: string; name: string; roleLabel: string; teamName: string | null }[]
  range: { from: string; to: string }
  today: string
  timeZone: string
  evidenceSources: WorkActivityEvidenceSources & { enabled: boolean }
  provisionableCodes: { code: ScheduleExceptionCode; label: string }[]
  /** Classificações que o Supervisor pode registrar/rever DEPOIS do fato + motivos de ausência justificada. */
  classifications: { code: WorkdayClassificationKind; label: string }[]
  justifiedReasons: { code: JustifiedAbsenceReason; label: string }[]
  canProvision: boolean
  /** Todos os operadores diretos da âncora (sem filtro/página) — para o seletor de "Provisionar exceção". */
  provisionablePeople: { personId: string; name: string }[]
  /** Opções de filtro derivadas da própria equipe: grupos/subgrupos, cargos (`job_title`) e regimes presentes. */
  filterOptions: { teams: { id: string; name: string; subteams: { id: string; name: string }[] }[]; jobTitles: string[]; scheduleTypes: { code: string; label: string }[]; attention: { code: CalendarAttentionKind; label: string }[] }
  /** Página corrente da lista de colaboradores: `total` = após os filtros; `totalPeople` = operadores diretos da âncora. */
  pagination: { page: number; pageSize: number; total: number; totalPeople: number }
  people: TeamCalendarPerson[]
}

function anchorsWithTeams(scope: ViewerScope): PersonNode[] {
  const candidates = [scope.viewer, ...scope.nodes.values()].filter((node) => node.active && directOperatorsOf(scope, node.id).length > 0)
  return candidates.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

function resolveAnchor(scope: ViewerScope, anchorId: string | null): PersonNode {
  if (!anchorId || anchorId === scope.viewer.id) return scope.viewer
  const node = scope.nodes.get(anchorId)
  if (!node || !node.active) throw accessDenied()
  return node
}

export function validateCalendarRange(from: string, to: string): void {
  const dates = validateProvisionRange(from, to)
  if (dates.length > MAX_CALENDAR_RANGE_DAYS) throw new DomainError(`O calendário mostra no máximo ${MAX_CALENDAR_RANGE_DAYS} dias por vez.`, "TEAM_CALENDAR_RANGE_TOO_LONG", 422)
}

export async function buildTeamCalendar(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, input: { anchorId: string | null; from: string; to: string; now?: Date; filters?: TeamCalendarFilters; page?: number; pageSize?: number }): Promise<TeamCalendarView> {
  validateCalendarRange(input.from, input.to)
  const now = input.now ?? new Date()
  const page = Math.max(1, Math.trunc(input.page ?? 1))
  const pageSize = Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_CALENDAR_PAGE_SIZE))
  const [scope, timeZone] = await Promise.all([loadViewerScope(analytics, user, "calendar.manage"), resolveOrganizationTimezone(db, user.organizationId)])
  const anchor = resolveAnchor(scope, input.anchorId)
  const people = directOperatorsOf(scope, anchor.id)
  const ids = people.map((person) => person.id)
  const window = { start: startOfLocalDate(input.from, timeZone), end: startOfLocalDate(addDays(input.to, 1), timeZone) }
  const [workdays, exceptions, reconciliations] = await Promise.all([
    resolveWorkdaysBySubject(db, ids, window, timeZone, { now }),
    listScheduleExceptions(db, { organizationId: user.organizationId, personIds: ids, from: input.from, to: input.to }),
    listReconciliations(db, { organizationId: user.organizationId, personIds: ids, from: input.from, to: input.to }),
  ])
  const schedule = ids.length > 0 ? await db.query<{ person_id: string; schedule_date: string; shift_start: string | null; shift_end: string | null }>(`select person_id, schedule_date::text schedule_date, shift_start::text shift_start, shift_end::text shift_end from employee_schedule_days where person_id = any($1::uuid[]) and schedule_date between $2::date and $3::date`, [ids, input.from, input.to]) : { rows: [] }
  const shiftByKey = new Map(schedule.rows.map((row) => [`${row.person_id}|${row.schedule_date}`, row]))
  const exceptionsByKey = new Map<string, ScheduleExceptionRecord[]>()
  for (const exception of exceptions) {
    const key = `${exception.personId}|${exception.date}`
    exceptionsByKey.set(key, [...(exceptionsByKey.get(key) ?? []), exception])
  }
  const reconciliationByKey = new Map(reconciliations.map((row) => [`${row.personId}|${row.workday}|${row.kind}`, row]))
  const first = [...workdays.values()][0]
  const sources = first?.evidenceSources ?? { interactions: false, indicatorCodes: [] }
  const today = localDateOf(now, timeZone)
  const availabilityOf = (date: string): TeamCalendarDay["availability"] => {
    const day = first?.availability.get(date)
    if (!day) return { state: "AVAILABILITY_UNKNOWN", label: WORKDAY_AVAILABILITY_LABELS.AVAILABILITY_UNKNOWN, decidedBy: null, decidedByLabel: null, workActivityExpectedAt: null, employmentExpectedAt: null }
    return { state: day.state, label: WORKDAY_AVAILABILITY_LABELS[day.state], decidedBy: day.decidedBy, decidedByLabel: day.decidedBy ? AVAILABILITY_SOURCE_GROUP_LABELS[day.decidedBy] : null, workActivityExpectedAt: day.workActivity.expectedAt, employmentExpectedAt: day.employment.expectedAt }
  }
  const classificationIds = new Set<string>()
  for (const subject of workdays.values()) for (const day of subject.days) if (day.classification) classificationIds.add(day.classification.id)
  const classifiedBy = new Map<string, { name: string | null; at: string }>()
  if (classificationIds.size > 0) {
    const rows = await db.query<{ id: string; name: string | null; classified_at: string }>(`select c.id, p.name, c.classified_at from workday_classifications c left join people p on p.id = c.classified_by_person_id where c.id = any($1::uuid[])`, [[...classificationIds]])
    for (const row of rows.rows) classifiedBy.set(row.id, { name: row.name, at: new Date(row.classified_at).toISOString() })
  }
  const resolvedPeople: TeamCalendarPerson[] = people.map((person) => {
      const subject = workdays.get(person.id)
      const days: TeamCalendarDay[] = (subject?.days ?? []).map((day) => {
        const key = `${person.id}|${day.date}`
        const dayExceptions = exceptionsByKey.get(key) ?? []
        const active = dayExceptions.find((exception) => exception.active && exception.code === day.planned.exception?.code) ?? dayExceptions.find((exception) => exception.active) ?? null
        const shift = shiftByKey.get(key)
        const missing = reconciliationByKey.get(`${key}|MISSING_EXPECTED_PRODUCTION`)
        const divergence = reconciliationByKey.get(`${key}|PRODUCTION_ON_NON_WORKING_DAY`) ?? reconciliationByKey.get(`${key}|PRODUCTION_WITH_NON_ELIGIBLE_STATUS`)
        const reconciliation = missing ?? divergence ?? null
        return {
          date: day.date,
          state: day.state,
          stateLabel: RESOLVED_WORKDAY_STATE_LABELS[day.state],
          eligible: day.eligible,
          plannedToWork: day.plannedToWork,
          plannedBasis: day.planned.basis,
          plannedBasisLabel: SCHEDULE_BASIS_LABELS[day.planned.basis],
          plannedCause: day.plannedCause,
          holiday: day.planned.holiday,
          status: day.status ? { code: day.status, label: EMPLOYMENT_STATUS_LABELS[day.status] } : null,
          exception: active ? { id: active.id, code: active.code, label: active.label, origin: active.origin, originLabel: SCHEDULE_EXCEPTION_ORIGIN_LABELS[active.origin], manualOverride: active.manualOverride } : null,
          cancelledExceptions: dayExceptions.filter((exception) => !exception.active).length,
          observed: day.observed,
          evidence: day.evidence ? describeWorkActivityEvidence(day.evidence) : null,
          overridesPlan: day.overridesPlan,
          conflict: day.conflict,
          shiftStart: shift?.shift_start ?? null,
          shiftEnd: shift?.shift_end ?? null,
          reconciliation: reconciliation ? { id: reconciliation.id, kind: reconciliation.kind, kindLabel: RECONCILIATION_KIND_LABELS[reconciliation.kind], status: reconciliation.status, resolution: reconciliation.resolution, resolutionLabel: reconciliation.resolution ? RECONCILIATION_RESOLUTION_LABELS[reconciliation.resolution] : null } : null,
          availability: availabilityOf(day.date),
          classification: day.classification
            ? {
                id: day.classification.id,
                classification: day.classification.classification,
                reasonCode: day.classification.reasonCode,
                label: day.classification.classification === "JUSTIFIED_ABSENCE" && day.classification.reasonCode ? `${WORKDAY_CLASSIFICATION_LABELS.JUSTIFIED_ABSENCE} · ${JUSTIFIED_ABSENCE_REASON_LABELS[day.classification.reasonCode]}` : WORKDAY_CLASSIFICATION_LABELS[day.classification.classification],
                classifiedByName: classifiedBy.get(day.classification.id)?.name ?? null,
                classifiedAt: classifiedBy.get(day.classification.id)?.at ?? "",
                contradictedBy: day.classificationContradictedBy,
              }
            : null,
        }
      })
      const scheduleType = subject?.scheduleConfidence.scheduleType ?? null
      return {
        personId: person.id,
        name: person.name,
        teamId: person.teamId,
        teamName: person.teamName,
        subteamId: person.subteamId,
        subteamName: person.subteamName,
        jobTitle: person.jobTitle,
        scheduleType,
        scheduleTypeLabel: scheduleType ? SCHEDULE_TYPE_LABELS[scheduleType] : null,
        days,
        summary: {
          plannedWork: days.filter((day) => day.state === "PLANNED_WORK" || day.state === "MISSING_EXPECTED_PRODUCTION" || day.state === "WAITING_FOR_SOURCES" || day.state === "DATA_SOURCE_DELAY" || day.state === "CLASSIFIED_WORKED_DATA_MISSING").length,
          workedObserved: days.filter((day) => day.state === "WORKED_OBSERVED").length,
          nonWorking: days.filter((day) => day.state === "PLANNED_NON_WORKING" || day.state === "NON_ELIGIBLE_EMPLOYMENT_STATUS" || day.state === "CLASSIFIED_JUSTIFIED_ABSENCE").length,
          missingProduction: days.filter((day) => day.reconciliation?.kind === "MISSING_EXPECTED_PRODUCTION" && day.reconciliation.status === "OPEN").length,
          divergences: days.filter((day) => day.overridesPlan).length,
          conflicts: days.filter((day) => day.conflict !== null).length,
          waitingForData: days.filter((day) => day.state === "WAITING_FOR_SOURCES").length,
          dataSourceDelay: days.filter((day) => day.state === "DATA_SOURCE_DELAY").length,
          unjustifiedAbsences: days.filter((day) => day.state === "CLASSIFIED_UNJUSTIFIED_ABSENCE").length,
        },
      }
  })
  const filtered = applyCalendarFilters(resolvedPeople, input.filters ?? {}, input.filters?.scheduledToday === undefined ? undefined : await eligibleTodayBySubject(db, ids, resolvedPeople, today, timeZone, now))
  return {
    anchor: { personId: anchor.id, name: anchor.name, role: anchor.role, roleLabel: ROLE_LABELS[anchor.role as keyof typeof ROLE_LABELS] ?? anchor.role },
    availableAnchors: anchorsWithTeams(scope).map((node) => ({ personId: node.id, name: node.name, roleLabel: ROLE_LABELS[node.role as keyof typeof ROLE_LABELS] ?? node.role, teamName: node.teamName })),
    range: { from: input.from, to: input.to },
    today,
    timeZone,
    evidenceSources: { ...sources, enabled: evidenceSourcesEnabled(sources) },
    provisionableCodes: SUPERVISOR_PROVISIONABLE_CODES.map((code) => ({ code, label: SCHEDULE_EXCEPTION_LABELS[code] })),
    classifications: WORKDAY_CLASSIFICATIONS.map((code) => ({ code, label: WORKDAY_CLASSIFICATION_LABELS[code] })),
    justifiedReasons: JUSTIFIED_ABSENCE_REASONS.map((code) => ({ code, label: JUSTIFIED_ABSENCE_REASON_LABELS[code] })),
    canProvision: people.length > 0,
    provisionablePeople: people.map((person) => ({ personId: person.id, name: person.name })),
    filterOptions: calendarFilterOptions(resolvedPeople),
    pagination: { page, pageSize, total: filtered.length, totalPeople: resolvedPeople.length },
    people: filtered.slice((page - 1) * pageSize, page * pageSize),
  }
}

/**
 * "Escalado para hoje" = o dia de HOJE resolvido como elegível (mesma regra do domínio: esperado trabalhar —
 * inclui trabalhou, aguardando dados, sem produção e falta injustificada; exclui folga/day off/situação não
 * produtiva/atestado/escala desconhecida). Quando o período visível não contém hoje, resolve só o dia de hoje.
 */
async function eligibleTodayBySubject(db: Database, ids: string[], people: TeamCalendarPerson[], today: string, timeZone: string, now: Date): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>()
  const inRange = people.length > 0 && people[0]!.days.some((day) => day.date === today)
  if (inRange) {
    for (const person of people) result.set(person.personId, person.days.find((day) => day.date === today)?.eligible ?? false)
    return result
  }
  const window = { start: startOfLocalDate(today, timeZone), end: startOfLocalDate(addDays(today, 1), timeZone) }
  const workdays = await resolveWorkdaysBySubject(db, ids, window, timeZone, { now })
  for (const id of ids) result.set(id, workdays.get(id)?.days.find((day) => day.date === today)?.eligible ?? false)
  return result
}

function personNeedsAttention(person: TeamCalendarPerson, kind: CalendarAttentionKind): boolean {
  switch (kind) {
    case "MISSING_PRODUCTION": return person.summary.missingProduction > 0
    case "WAITING_FOR_DATA": return person.summary.waitingForData > 0
    case "DATA_SOURCE_DELAY": return person.summary.dataSourceDelay > 0
    case "UNJUSTIFIED_ABSENCE": return person.summary.unjustifiedAbsences > 0
    case "DIVERGENCE": return person.summary.divergences > 0
    case "CONFLICT": return person.summary.conflicts > 0
  }
}

/** Busca (nome/cargo, sem acento e sem caixa), grupo/subgrupo, cargo, regime e "atenção" (qualquer um dos marcados). Pura — testável sem banco. */
export function applyCalendarFilters(people: TeamCalendarPerson[], filters: TeamCalendarFilters, eligibleToday?: ReadonlyMap<string, boolean>): TeamCalendarPerson[] {
  const term = filters.search ? fold(filters.search) : ""
  const jobTitles = filters.jobTitles?.length ? new Set(filters.jobTitles) : null
  const scheduleTypes = filters.scheduleTypes?.length ? new Set(filters.scheduleTypes) : null
  const attention = filters.attention?.length ? filters.attention : null
  return people.filter((person) => {
    if (term && !fold(person.name).includes(term) && !(person.jobTitle && fold(person.jobTitle).includes(term))) return false
    if (filters.teamId && person.teamId !== filters.teamId) return false
    if (filters.subteamId && person.subteamId !== filters.subteamId) return false
    if (jobTitles && !(person.jobTitle !== null && jobTitles.has(person.jobTitle))) return false
    if (scheduleTypes && !scheduleTypes.has(person.scheduleType ?? CALENDAR_SCHEDULE_NONE)) return false
    if (attention && !attention.some((kind) => personNeedsAttention(person, kind))) return false
    if (filters.scheduledToday !== undefined && (eligibleToday?.get(person.personId) ?? false) !== filters.scheduledToday) return false
    return true
  })
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim()
}

function calendarFilterOptions(people: TeamCalendarPerson[]): TeamCalendarView["filterOptions"] {
  const jobTitles = [...new Set(people.map((person) => person.jobTitle).filter((title): title is string => title !== null))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const present = new Set(people.map((person) => person.scheduleType ?? CALENDAR_SCHEDULE_NONE))
  const scheduleTypes = [...SCHEDULE_TYPES.filter((type): type is ScheduleType => present.has(type)).map((type) => ({ code: type as string, label: SCHEDULE_TYPE_LABELS[type] })), ...(present.has(CALENDAR_SCHEDULE_NONE) ? [{ code: CALENDAR_SCHEDULE_NONE, label: "Sem escala configurada" }] : [])]
  const teams = new Map<string, { id: string; name: string; subteams: Map<string, string> }>()
  for (const person of people) {
    if (!person.teamId) continue
    const team = teams.get(person.teamId) ?? { id: person.teamId, name: person.teamName ?? person.teamId, subteams: new Map<string, string>() }
    if (person.subteamId) team.subteams.set(person.subteamId, person.subteamName ?? person.subteamId)
    teams.set(person.teamId, team)
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR")
  const teamOptions = [...teams.values()].map((team) => ({ id: team.id, name: team.name, subteams: [...team.subteams].map(([id, name]) => ({ id, name })).sort(byName) })).sort(byName)
  return { teams: teamOptions, jobTitles, scheduleTypes, attention: CALENDAR_ATTENTION_KINDS.map((code) => ({ code, label: CALENDAR_ATTENTION_LABELS[code] })) }
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Provisionar/classificar (V1.5.8): operadores ativos da PRÓPRIA estrutura (regra operacional de quem lidera) OU qualquer
 * pessoa ativa que o escopo de `calendar.manage` da conta alcança. O nível hierárquico (inclusive o legado "ADMIN") não amplia nada.
 */
async function assertCanManage(analytics: AnalyticsReadRepository, user: AuthTokenPayload, personId: string): Promise<void> {
  const scope = await loadViewerScope(analytics, user, "calendar.manage")
  const person = scope.nodes.get(personId)
  const allowed = operatorsBelow(scope, scope.viewer.id).some((node) => node.id === personId) || (person !== undefined && person.active && accessCovers(scope.access, person))
  if (!allowed) throw accessDenied()
}

export async function provisionForTeam(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, input: { personId: string; code: ScheduleExceptionCode; from: string; to: string }): Promise<ProvisionOutcome> {
  await assertCanManage(analytics, user, input.personId)
  return provisionScheduleExceptions(db, { organizationId: user.organizationId, personId: input.personId, code: input.code, from: input.from, to: input.to, actorPersonId: user.personId })
}

/**
 * CLASSIFICAR (ou REVISAR) um dia pelo Calendário da equipe — mesmo serviço da Surface Pendências
 * (`classifyWorkday`): histórico por revisão, auditoria, reconciliação do dia sincronizada. Escopo real.
 */
export async function classifyForTeam(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, input: { personId: string; date: string; classification: WorkdayClassificationKind; reasonCode?: JustifiedAbsenceReason | null | undefined }): Promise<ClassifyWorkdayOutcome> {
  await assertCanManage(analytics, user, input.personId)
  validateProvisionRange(input.date, input.date)
  return classifyWorkday(db, { organizationId: user.organizationId, personId: input.personId, workday: input.date, classification: input.classification, reasonCode: input.reasonCode ?? null, actorPersonId: user.personId })
}

export type ClassificationHistoryEntry = WorkdayClassificationRecord & { supersededReasonLabel: string | null }

/** Histórico completo das classificações de um dia (todas as revisões, cronológico) — só dentro do escopo. */
export async function classificationHistoryForTeam(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, input: { personId: string; date: string }): Promise<ClassificationHistoryEntry[]> {
  await assertCanManage(analytics, user, input.personId)
  return loadClassificationHistory(db, user.organizationId, input.personId, input.date)
}

export type { ClassificationSupersededReason }

/** Trilha de auditoria de uma exceção — só de colaborador do escopo (achado U-F11: antes bastava o id; o código pode ser
 * ATESTADO, dado de saúde). Fora do escopo = o mesmo 404 de inexistente. */
export async function exceptionAuditForTeam(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, exceptionId: string) {
  const owner = await db.query<{ person_id: string }>(`select person_id from employee_schedule_exceptions where id = $1 and organization_id = $2`, [exceptionId, user.organizationId])
  if (!owner.rows[0]) throw new DomainError("Exceção de calendário não encontrada.", "SCHEDULE_EXCEPTION_NOT_FOUND", 404)
  try {
    await assertCanManage(analytics, user, owner.rows[0].person_id)
  } catch {
    throw new DomainError("Exceção de calendário não encontrada.", "SCHEDULE_EXCEPTION_NOT_FOUND", 404)
  }
  return loadScheduleExceptionAudit(db, user.organizationId, exceptionId)
}

export async function cancelForTeam(db: Database, analytics: AnalyticsReadRepository, user: AuthTokenPayload, exceptionId: string): Promise<ScheduleExceptionRecord> {
  const owner = await db.query<{ person_id: string }>(`select person_id from employee_schedule_exceptions where id = $1 and organization_id = $2`, [exceptionId, user.organizationId])
  if (!owner.rows[0]) throw new DomainError("Exceção de calendário não encontrada.", "SCHEDULE_EXCEPTION_NOT_FOUND", 404)
  await assertCanManage(analytics, user, owner.rows[0].person_id)
  return cancelScheduleException(db, { organizationId: user.organizationId, exceptionId, actorPersonId: user.personId })
}
