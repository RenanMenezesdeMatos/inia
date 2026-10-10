import { z } from "zod"

/**
 * Calendário operacional — feriados da organização (configuração administrativa pequena).
 * Regra: feriado cadastrado NÃO significa que ninguém trabalha — só vira folga no fallback seg–sex
 * de quem não tem escala explícita. Escala explícita vence feriado.
 */
export const HOLIDAY_SCOPES = ["ORGANIZATION", "NATIONAL", "STATE", "CITY"] as const
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number]
export const HOLIDAY_SCOPE_LABELS: Record<HolidayScope, string> = { ORGANIZATION: "Data da organização", NATIONAL: "Feriado nacional", STATE: "Feriado estadual", CITY: "Feriado municipal" }

export const holidaySchema = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
  scope: z.enum(HOLIDAY_SCOPES),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Holiday = z.infer<typeof holidaySchema>

export type HolidayInput = { date: string; name: string; scope: HolidayScope; active: boolean }

/** Reference data: as 27 capitais (código, nome, UF, IBGE). */
export const brazilianCapitalSchema = z.object({ code: z.string(), name: z.string(), stateCode: z.string(), ibgeCode: z.string() })
export type BrazilianCapital = z.infer<typeof brazilianCapitalSchema>
export const capitalsResponseSchema = z.object({ capitals: z.array(brazilianCapitalSchema), states: z.array(z.string()) })

/** Catálogo-base de feriados (read-only): nacional, estadual, municipal — com proveniência. */
export const CATALOG_SCOPES = ["NATIONAL", "STATE", "MUNICIPAL_CAPITAL"] as const
export type CatalogScope = (typeof CATALOG_SCOPES)[number]
export const CATALOG_SCOPE_LABELS: Record<CatalogScope, string> = { NATIONAL: "Feriado nacional", STATE: "Feriado estadual", MUNICIPAL_CAPITAL: "Feriado municipal" }
export const catalogHolidaySchema = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
  scope: z.enum(CATALOG_SCOPES),
  countryCode: z.string(),
  stateCode: z.string().nullable(),
  capitalCode: z.string().nullable(),
  sourceName: z.string(),
  sourceReference: z.string(),
  legalReference: z.string().nullable(),
  /** Força da verificação da fonte (migration 068) — null em linhas de seed anterior. */
  verification: z.enum(["OFFICIAL", "LEGAL_DATABASE", "SECONDARY"]).nullable().optional().default(null),
  active: z.boolean(),
})
export type CatalogHoliday = z.infer<typeof catalogHolidaySchema>
export const VERIFICATION_LABELS: Record<"OFFICIAL" | "LEGAL_DATABASE" | "SECONDARY", string> = { OFFICIAL: "Fonte oficial", LEGAL_DATABASE: "Base de legislação", SECONDARY: "Fonte secundária (lei citada)" }

export const holidayCatalogCoverageSchema = z.object({
  years: z.array(z.object({ year: z.number(), national: z.number(), capitalsWithStateHoliday: z.number(), capitalsWithMunicipalHoliday: z.number(), rows: z.number(), byVerification: z.object({ OFFICIAL: z.number(), LEGAL_DATABASE: z.number(), SECONDARY: z.number() }), unverifiedRows: z.number() })),
  totalRows: z.number(),
  gaps: z.array(z.object({ scope: z.enum(CATALOG_SCOPES), stateCode: z.string().optional(), capitalCode: z.string().optional(), years: z.array(z.number()), reason: z.string(), label: z.string() })),
  pendingVerifications: z.number(),
  capitalsWithoutMunicipalHoliday: z.array(z.string()),
  complete: z.literal(false),
})
export type HolidayCatalogCoverage = z.infer<typeof holidayCatalogCoverageSchema>
export type CatalogFilter = { year?: number; capital?: string; state?: string; scope?: CatalogScope }

/** Horizonte do calendário da organização — "até quando a escala é conhecida" (≠ freshness). */
export const workScheduleHorizonSchema = z.object({
  configured: z.boolean(),
  coverageFrom: z.string().nullable(),
  coverageUntil: z.string().nullable(),
  daysRemaining: z.number().nullable(),
  warningDays: z.number(),
  endingSoon: z.boolean(),
  peopleWithCalendarAhead: z.number().default(0),
})
export type WorkScheduleHorizon = z.infer<typeof workScheduleHorizonSchema>

export const calendarSettingsSchema = z.object({
  holidayFallbackPolicy: z.enum(["IGNORE", "EXCLUDE_APPLICABLE_HOLIDAYS"]),
  scheduleHorizonWarningDays: z.number(),
  horizon: workScheduleHorizonSchema,
})
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>
export type CalendarSettingsInput = { holidayFallbackPolicy?: "IGNORE" | "EXCLUDE_APPLICABLE_HOLIDAYS"; scheduleHorizonWarningDays?: number }
