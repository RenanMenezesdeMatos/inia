import { z } from "zod"

/**
 * SITUAÇÃO FUNCIONAL — espelho do domínio do backend (people/domain/employment-status.ts).
 * As NOVE situações reais do negócio; só EM_PRODUCAO é operacionalmente elegível. Os códigos
 * legados (058) continuam aceitos na LEITURA por compatibilidade — a UI mostra o rótulo legado e
 * nunca os oferece em formulários novos.
 */
export const EMPLOYMENT_STATUSES = ["EM_PRODUCAO", "TRANSFERIDO", "FERIAS", "INSS", "PILOTO", "MATERNIDADE", "PATERNIDADE", "APOSENTADO", "ATIVIDADE_OFF"] as const
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  EM_PRODUCAO: "EM PRODUÇÃO",
  TRANSFERIDO: "TRANSFERIDO",
  FERIAS: "FÉRIAS",
  INSS: "INSS",
  PILOTO: "PILOTO",
  MATERNIDADE: "MATERNIDADE",
  PATERNIDADE: "PATERNIDADE",
  APOSENTADO: "APOSENTADO",
  ATIVIDADE_OFF: "ATIVIDADE OFF",
}

export const LEGACY_EMPLOYMENT_STATUSES = ["ACTIVE", "VACATION", "LEAVE", "INACTIVE"] as const
export type LegacyEmploymentStatus = (typeof LEGACY_EMPLOYMENT_STATUSES)[number]
export const LEGACY_EMPLOYMENT_STATUS_LABELS: Record<LegacyEmploymentStatus, string> = { ACTIVE: "Ativo (legado)", VACATION: "Férias (legado)", LEAVE: "Afastado (legado)", INACTIVE: "Inativo (legado)" }

/** Leitura tolerante: aceita real ou legado (dual-read). Formulários usam `employmentStatusSchema` (só os nove). */
export const employmentStatusReadSchema = z.enum([...EMPLOYMENT_STATUSES, ...LEGACY_EMPLOYMENT_STATUSES])
export type EmploymentStatusRead = z.infer<typeof employmentStatusReadSchema>
export const employmentStatusSchema = z.enum(EMPLOYMENT_STATUSES)

export function employmentStatusLabel(status: string): string {
  return (EMPLOYMENT_STATUS_LABELS as Record<string, string>)[status] ?? (LEGACY_EMPLOYMENT_STATUS_LABELS as Record<string, string>)[status] ?? status
}

/** Regra positiva única (espelho): só EM PRODUÇÃO (ou o legado ACTIVE) produz. */
export function isOperationallyEligibleStatus(status: string): boolean {
  return status === "EM_PRODUCAO" || status === "ACTIVE"
}

export const SCHEDULE_TYPES = ["FIVE_BY_TWO", "SIX_BY_ONE"] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = { FIVE_BY_TWO: "5x2", SIX_BY_ONE: "6x1" }

export const SCHEDULE_BASIS_LABELS = {
  EXPLICIT_SCHEDULE: "Escala informada pela fonte",
  LEGACY_WEEKDAY_FALLBACK: "Segunda a sexta (compatibilidade — sem escala configurada)",
  UNKNOWN_SCHEDULE: "Escala desconhecida (regime 6x1 sem folga informada)",
  MIXED: "Escala parcialmente informada",
} as const

/** Exceções individuais de calendário (banco de horas, day off, folga extraordinária) — espelho de people/domain/schedule-exception.ts. */
export const SCHEDULE_EXCEPTION_CODES = ["BANCO_HORAS", "DAY_OFF", "FOLGA_EXTRAORDINARIA", "ATESTADO", "AJUSTE_ESCALA"] as const
export type ScheduleExceptionCode = (typeof SCHEDULE_EXCEPTION_CODES)[number]
export const SCHEDULE_EXCEPTION_LABELS: Record<ScheduleExceptionCode, string> = { BANCO_HORAS: "Banco de horas", DAY_OFF: "Day off", FOLGA_EXTRAORDINARIA: "Folga extraordinária", ATESTADO: "Atestado", AJUSTE_ESCALA: "Ajuste de escala" }
/** Motivos que o Supervisor pode provisionar no Calendário da equipe (AJUSTE_ESCALA só nasce de "Corrigir escala"). */
export const SUPERVISOR_PROVISIONABLE_CODES = ["DAY_OFF", "BANCO_HORAS", "ATESTADO", "FOLGA_EXTRAORDINARIA"] as const
export const SCHEDULE_EXCEPTION_ORIGINS = ["CENTRAL_DATA", "SUPERVISOR_MANUAL", "SYSTEM_RECONCILIATION"] as const
export type ScheduleExceptionOrigin = (typeof SCHEDULE_EXCEPTION_ORIGINS)[number]
export const SCHEDULE_EXCEPTION_ORIGIN_LABELS: Record<ScheduleExceptionOrigin, string> = { CENTRAL_DATA: "Central de Dados", SUPERVISOR_MANUAL: "Registrada pelo Supervisor", SYSTEM_RECONCILIATION: "Reconciliação do sistema" }
export function scheduleExceptionLabel(code: string): string {
  return (SCHEDULE_EXCEPTION_LABELS as Record<string, string>)[code] ?? code
}

/** Política de feriado no fallback seg–sex (organizations.holiday_fallback_policy) — escala explícita sempre vence. */
export const HOLIDAY_FALLBACK_POLICIES = ["IGNORE", "EXCLUDE_APPLICABLE_HOLIDAYS"] as const
export type HolidayFallbackPolicy = (typeof HOLIDAY_FALLBACK_POLICIES)[number]
export const HOLIDAY_FALLBACK_POLICY_LABELS: Record<HolidayFallbackPolicy, string> = {
  IGNORE: "Ignorar feriados (dia útil continua programado)",
  EXCLUDE_APPLICABLE_HOLIDAYS: "Excluir feriados aplicáveis à capital operacional",
}

/** Capital operacional — jurisdição de feriados (não é endereço nem lotação). */
export const operationalCapitalViewSchema = z.object({ code: z.string(), name: z.string(), stateCode: z.string(), label: z.string() }).nullable()
export type OperationalCapitalView = z.infer<typeof operationalCapitalViewSchema>

export const freshnessBlockSchema = z.object({ state: z.enum(["FRESH", "STALE", "UNKNOWN"]), lastSuccessAt: z.string().nullable(), cadenceLabel: z.string().nullable(), sourceName: z.string().nullable(), feedName: z.string().nullable() })
export const UNKNOWN_FRESHNESS = { state: "UNKNOWN" as const, lastSuccessAt: null, cadenceLabel: null, sourceName: null, feedName: null }
export const originSchema = z.object({ sourceName: z.string(), feedName: z.string(), feedId: z.string(), sourceId: z.string() }).nullable()

/** Escala do colaborador para perfil/admin: regime, base, próxima folga (só explícita), origem. */
export const workScheduleViewSchema = z.object({
  scheduleType: z.enum(SCHEDULE_TYPES).nullable(),
  scheduleTypeLabel: z.string().nullable(),
  basis: z.enum(["EXPLICIT_SCHEDULE", "LEGACY_WEEKDAY_FALLBACK", "UNKNOWN_SCHEDULE"]),
  basisLabel: z.string(),
  nextDayOff: z.string().nullable(),
  knownDaysAhead: z.number().default(0),
  freshness: freshnessBlockSchema.default(UNKNOWN_FRESHNESS),
  origin: originSchema.default(null),
  todayScheduleId: z.string().nullable().optional(),
  /** Até que data a fonte informou o calendário (horizonte conhecido da pessoa). */
  knownUntil: z.string().nullable().default(null),
  upcomingExceptions: z.array(z.object({ id: z.string(), date: z.string(), code: z.string(), label: z.string(), rawReason: z.string().nullable() })).default([]),
  todayException: z.object({ id: z.string(), code: z.string(), label: z.string(), rawReason: z.string().nullable() }).nullable().default(null),
})
export type WorkScheduleView = z.infer<typeof workScheduleViewSchema>
