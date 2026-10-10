import { z } from "zod"

/** Espelho de backend/src/modules/people/application/team-calendar.ts (Calendário da equipe). */
export const RESOLVED_WORKDAY_STATES = [
  "BEFORE_HIRE",
  "NON_ELIGIBLE_EMPLOYMENT_STATUS",
  "WORKED_OBSERVED",
  "CLASSIFIED_UNJUSTIFIED_ABSENCE",
  "CLASSIFIED_JUSTIFIED_ABSENCE",
  "CLASSIFIED_WORKED_DATA_MISSING",
  "PLANNED_WORK",
  "WAITING_FOR_SOURCES",
  "DATA_SOURCE_DELAY",
  "MISSING_EXPECTED_PRODUCTION",
  "PLANNED_NON_WORKING",
  "INDETERMINATE",
] as const
export const resolvedWorkdayStateSchema = z.enum(RESOLVED_WORKDAY_STATES)
export type ResolvedWorkdayState = z.infer<typeof resolvedWorkdayStateSchema>

export const RESOLVED_WORKDAY_STATE_LABELS: Record<ResolvedWorkdayState, string> = {
  BEFORE_HIRE: "Antes da admissão",
  NON_ELIGIBLE_EMPLOYMENT_STATUS: "Situação funcional não produtiva",
  WORKED_OBSERVED: "Trabalhou (produção observada)",
  CLASSIFIED_UNJUSTIFIED_ABSENCE: "Falta injustificada",
  CLASSIFIED_JUSTIFIED_ABSENCE: "Ausência justificada",
  CLASSIFIED_WORKED_DATA_MISSING: "Trabalhou — dados não recebidos",
  PLANNED_WORK: "Trabalha (planejado)",
  WAITING_FOR_SOURCES: "Aguardando dados",
  DATA_SOURCE_DELAY: "Fonte de dados atrasada",
  MISSING_EXPECTED_PRODUCTION: "Sem produção · classificar",
  PLANNED_NON_WORKING: "Não trabalha (planejado)",
  INDETERMINATE: "Escala desconhecida",
}

export const WORKDAY_AVAILABILITY_STATES = ["READY", "WAITING_FOR_SOURCES", "DATA_SOURCE_DELAY", "AVAILABILITY_UNKNOWN"] as const
export type WorkdayAvailabilityState = (typeof WORKDAY_AVAILABILITY_STATES)[number]

/** Classificações humanas revisáveis (people/domain/workday-classification.ts). */
export const WORKDAY_CLASSIFICATIONS = ["UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING"] as const
export type WorkdayClassificationKind = (typeof WORKDAY_CLASSIFICATIONS)[number]
export const WORKDAY_CLASSIFICATION_LABELS: Record<WorkdayClassificationKind, string> = {
  UNJUSTIFIED_ABSENCE: "Falta injustificada",
  JUSTIFIED_ABSENCE: "Ausência justificada",
  WORKED_DATA_MISSING: "Trabalhou — dados não chegaram",
}
export const JUSTIFIED_ABSENCE_REASONS = ["ATESTADO", "DAY_OFF", "BANCO_HORAS", "FOLGA_EXTRAORDINARIA", "OTHER_JUSTIFIED"] as const
export type JustifiedAbsenceReason = (typeof JUSTIFIED_ABSENCE_REASONS)[number]

export const teamCalendarAvailabilitySchema = z.object({
  state: z.enum(WORKDAY_AVAILABILITY_STATES),
  label: z.string(),
  decidedBy: z.enum(["WORK_ACTIVITY", "EMPLOYMENT"]).nullable(),
  decidedByLabel: z.string().nullable(),
  workActivityExpectedAt: z.string().nullable(),
  employmentExpectedAt: z.string().nullable(),
})
export type TeamCalendarAvailability = z.infer<typeof teamCalendarAvailabilitySchema>

export const teamCalendarClassificationSchema = z.object({
  id: z.string(),
  classification: z.enum(WORKDAY_CLASSIFICATIONS),
  reasonCode: z.enum(JUSTIFIED_ABSENCE_REASONS).nullable(),
  label: z.string(),
  classifiedByName: z.string().nullable(),
  classifiedAt: z.string(),
  contradictedBy: z.enum(["WORK_EVIDENCE", "AUTHORITATIVE_STATUS"]).nullable(),
})
export type TeamCalendarClassification = z.infer<typeof teamCalendarClassificationSchema>

export const teamCalendarDaySchema = z.object({
  date: z.string(),
  state: resolvedWorkdayStateSchema,
  stateLabel: z.string(),
  eligible: z.boolean(),
  plannedToWork: z.boolean(),
  plannedBasis: z.enum(["EXPLICIT_SCHEDULE", "LEGACY_WEEKDAY_FALLBACK", "UNKNOWN_SCHEDULE"]),
  plannedBasisLabel: z.string(),
  plannedCause: z.enum(["EXCEPTION", "SCHEDULED_DAY_OFF", "HOLIDAY", "UNKNOWN_SCHEDULE"]).nullable(),
  holiday: z.boolean(),
  status: z.object({ code: z.string(), label: z.string() }).nullable(),
  exception: z.object({ id: z.string(), code: z.string(), label: z.string(), origin: z.string(), originLabel: z.string(), manualOverride: z.boolean() }).nullable(),
  cancelledExceptions: z.number(),
  observed: z.boolean(),
  evidence: z.string().nullable(),
  overridesPlan: z.boolean(),
  conflict: z.enum(["PRODUCTION_WITH_NON_ELIGIBLE_STATUS"]).nullable(),
  shiftStart: z.string().nullable(),
  shiftEnd: z.string().nullable(),
  reconciliation: z.object({ id: z.string(), kind: z.enum(["MISSING_EXPECTED_PRODUCTION", "PRODUCTION_ON_NON_WORKING_DAY", "PRODUCTION_WITH_NON_ELIGIBLE_STATUS"]), kindLabel: z.string(), status: z.enum(["OPEN", "NOTED", "RESOLVED"]), resolution: z.string().nullable(), resolutionLabel: z.string().nullable() }).nullable(),
  availability: teamCalendarAvailabilitySchema,
  classification: teamCalendarClassificationSchema.nullable(),
})
export type TeamCalendarDay = z.infer<typeof teamCalendarDaySchema>

export const teamCalendarPersonSchema = z.object({
  personId: z.string(),
  name: z.string(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  scheduleType: z.string().nullable(),
  scheduleTypeLabel: z.string().nullable(),
  days: z.array(teamCalendarDaySchema),
  summary: z.object({ plannedWork: z.number(), workedObserved: z.number(), nonWorking: z.number(), missingProduction: z.number(), divergences: z.number(), conflicts: z.number(), waitingForData: z.number(), dataSourceDelay: z.number(), unjustifiedAbsences: z.number() }),
})
export type TeamCalendarPerson = z.infer<typeof teamCalendarPersonSchema>

/** "Atenção" — filtro por situação do período resolvido por colaborador (rótulos vêm do backend em `filterOptions.attention`). */
export const CALENDAR_ATTENTION_KINDS = ["MISSING_PRODUCTION", "WAITING_FOR_DATA", "DATA_SOURCE_DELAY", "UNJUSTIFIED_ABSENCE", "DIVERGENCE", "CONFLICT"] as const
export type CalendarAttentionKind = (typeof CALENDAR_ATTENTION_KINDS)[number]
export const CALENDAR_SCHEDULE_NONE = "NONE"

/** Filtros da lista (um valor por seletor — o backend aceita listas, a UI padroniza em seletores simples). */
export type TeamCalendarListParams = { search?: string; teamId?: string; subteamId?: string; jobTitle?: string; scheduleType?: string; attention?: CalendarAttentionKind; scheduledToday?: boolean; page: number; pageSize: number }

export const teamCalendarViewSchema = z.object({
  anchor: z.object({ personId: z.string(), name: z.string(), role: z.string(), roleLabel: z.string() }),
  availableAnchors: z.array(z.object({ personId: z.string(), name: z.string(), roleLabel: z.string(), teamName: z.string().nullable() })),
  range: z.object({ from: z.string(), to: z.string() }),
  today: z.string(),
  timeZone: z.string(),
  evidenceSources: z.object({ interactions: z.boolean(), indicatorCodes: z.array(z.string()), enabled: z.boolean() }),
  provisionableCodes: z.array(z.object({ code: z.string(), label: z.string() })),
  classifications: z.array(z.object({ code: z.enum(WORKDAY_CLASSIFICATIONS), label: z.string() })),
  justifiedReasons: z.array(z.object({ code: z.enum(JUSTIFIED_ABSENCE_REASONS), label: z.string() })),
  canProvision: z.boolean(),
  provisionablePeople: z.array(z.object({ personId: z.string(), name: z.string() })),
  filterOptions: z.object({ teams: z.array(z.object({ id: z.string(), name: z.string(), subteams: z.array(z.object({ id: z.string(), name: z.string() })) })), jobTitles: z.array(z.string()), scheduleTypes: z.array(z.object({ code: z.string(), label: z.string() })), attention: z.array(z.object({ code: z.enum(CALENDAR_ATTENTION_KINDS), label: z.string() })) }),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPeople: z.number().int().nonnegative() }),
  people: z.array(teamCalendarPersonSchema),
})
export type TeamCalendarView = z.infer<typeof teamCalendarViewSchema>

export const scheduleExceptionRecordSchema = z.object({
  id: z.string(),
  personId: z.string(),
  date: z.string(),
  code: z.string(),
  label: z.string(),
  origin: z.string(),
  active: z.boolean(),
  rawReason: z.string().nullable(),
  source: z.string(),
  createdByPersonId: z.string().nullable(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledByPersonId: z.string().nullable(),
  manualOverride: z.boolean(),
  provisionGroupId: z.string().nullable(),
})
export type ScheduleExceptionRecord = z.infer<typeof scheduleExceptionRecordSchema>

export const provisionOutcomeSchema = z.object({ created: z.array(scheduleExceptionRecordSchema), reactivated: z.array(scheduleExceptionRecordSchema), unchanged: z.array(scheduleExceptionRecordSchema), provisionGroupId: z.string() })
export type ProvisionOutcome = z.infer<typeof provisionOutcomeSchema>

export const scheduleExceptionAuditSchema = z.array(z.object({ action: z.string(), actorPersonId: z.string().nullable(), actorName: z.string().nullable(), createdAt: z.string(), payload: z.record(z.string(), z.unknown()) }))
export type ScheduleExceptionAudit = z.infer<typeof scheduleExceptionAuditSchema>

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  SCHEDULE_EXCEPTION_PROVISIONED: "Provisionada",
  SCHEDULE_EXCEPTION_REACTIVATED: "Reativada",
  SCHEDULE_EXCEPTION_CANCELLED: "Cancelada",
}

export const workdayClassificationRecordSchema = z.object({
  id: z.string(),
  personId: z.string(),
  workday: z.string(),
  classification: z.enum(WORKDAY_CLASSIFICATIONS),
  reasonCode: z.enum(JUSTIFIED_ABSENCE_REASONS).nullable(),
  label: z.string(),
  reasonLabel: z.string().nullable(),
  classifiedByPersonId: z.string().nullable(),
  classifiedByName: z.string().nullable(),
  classifiedAt: z.string(),
  supersedesId: z.string().nullable(),
  supersededAt: z.string().nullable(),
  supersededByName: z.string().nullable(),
  supersededReason: z.enum(["REVISED", "CONTRADICTED_BY_WORK_EVIDENCE", "SUPERSEDED_BY_AUTHORITATIVE_STATUS"]).nullable(),
  supersededReasonLabel: z.string().nullable(),
})
export type WorkdayClassificationRecord = z.infer<typeof workdayClassificationRecordSchema>

export const classifyOutcomeSchema = z.object({ current: workdayClassificationRecordSchema, previous: workdayClassificationRecordSchema.nullable(), changed: z.boolean() })
export type ClassifyOutcome = z.infer<typeof classifyOutcomeSchema>
