import type { ScheduleException } from "./schedule-exception.js"

/**
 * ESCALA DE TRABALHO — domínio único (nunca "weekday < 5" espalhado por Condition/Ranking/Analytics).
 *
 * Dois conceitos que não se misturam:
 *  - REGIME (5x2 / 6x1): metadata do contrato de trabalho — diz o padrão, não diz o dia.
 *  - CALENDÁRIO PROGRAMADO: a evidência real — "nesta data a pessoa estava programada para
 *    trabalhar (true) ou de folga (false)?". Um 6x1 tem a folga agendada em qualquer dia da
 *    semana; domingo não é folga por suposição e quarta pode ser.
 *
 * Ausência de linha no calendário NUNCA significa folga: significa "a fonte não informou". O que a
 * INIA faz nesse caso está em `resolveScheduledDay` (fallback legado seg–sex só para quem não tem
 * nenhuma configuração de escala; regime 6x1 conhecido sem folga informada = DESCONHECIDO, nunca
 * seg–sex inventado). A INIA RECEBE a escala — não é WFM: não gera, não aprova, não infere folga.
 */
export const SCHEDULE_TYPES = ["FIVE_BY_TWO", "SIX_BY_ONE"] as const
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]
export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = { FIVE_BY_TWO: "5x2", SIX_BY_ONE: "6x1" }

/** Texto da fonte → regime. Só mapeamentos explícitos ("5X2", "5 X 2", "FIVE_BY_TWO", "6X1"…); o resto é null. */
export function normalizeScheduleType(raw: string | null | undefined): ScheduleType | null {
  if (raw === null || raw === undefined) return null
  const key = raw.toUpperCase().replace(/\s+/g, "").replace(/-/g, "_")
  if (key === "5X2" || key === "FIVE_BY_TWO" || key === "5_X_2") return "FIVE_BY_TWO"
  if (key === "6X1" || key === "SIX_BY_ONE" || key === "6_X_1") return "SIX_BY_ONE"
  return null
}

/**
 * De onde veio a resposta "programado para trabalhar?" de um dia:
 *  - EXPLICIT_SCHEDULE: linha do calendário informada pela fonte (trabalha ou folga);
 *  - LEGACY_WEEKDAY_FALLBACK: pessoa SEM configuração real de escala (nem calendário, nem regime 6x1)
 *    → seg–sex como compatibilidade temporária; feriado cadastrado vira folga SÓ aqui;
 *  - UNKNOWN_SCHEDULE: regime 6x1 conhecido mas a folga dessa data não foi informada — a INIA não
 *    inventa; o dia não é elegível, mas também não vira "deveria ter produzido".
 */
export type ScheduleBasis = "EXPLICIT_SCHEDULE" | "LEGACY_WEEKDAY_FALLBACK" | "UNKNOWN_SCHEDULE"
export const SCHEDULE_BASIS_LABELS: Record<ScheduleBasis, string> = {
  EXPLICIT_SCHEDULE: "Escala informada pela fonte",
  LEGACY_WEEKDAY_FALLBACK: "Segunda a sexta (compatibilidade — sem escala configurada)",
  UNKNOWN_SCHEDULE: "Escala desconhecida (regime 6x1 sem folga informada)",
}

export type ScheduleDay = {
  /** AAAA-MM-DD. */
  date: string
  scheduledToWork: boolean
  shiftStart: string | null
  shiftEnd: string | null
}

/**
 * Política de FERIADO NO FALLBACK (organizations.holiday_fallback_policy). Só vale para quem está no
 * fallback seg–sex (sem escala explícita): IGNORE (default — feriado não muda o dia) ou
 * EXCLUDE_APPLICABLE_HOLIDAYS (feriado aplicável à capital operacional vira dia não programado).
 * Escala explícita SEMPRE vence feriado, com qualquer política.
 */
export const HOLIDAY_FALLBACK_POLICIES = ["IGNORE", "EXCLUDE_APPLICABLE_HOLIDAYS"] as const
export type HolidayFallbackPolicy = (typeof HOLIDAY_FALLBACK_POLICIES)[number]
export const DEFAULT_HOLIDAY_FALLBACK_POLICY: HolidayFallbackPolicy = "IGNORE"

export type ScheduledDayResolution = {
  scheduledToWork: boolean
  basis: ScheduleBasis
  /** true quando o dia foi tratado como folga por feriado aplicável (só no fallback legado, só com política EXCLUDE). */
  holiday: boolean
  /** Exceção individual NON_WORKING que tirou a pessoa da produção nesta data (vence a escala). */
  exception: ScheduleException | null
}

/** Dia da semana (0 = domingo … 6 = sábado) de uma data local AAAA-MM-DD, sem depender de fuso. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

export function isLegacyBusinessDay(date: string): boolean {
  const weekday = weekdayOf(date)
  return weekday >= 1 && weekday <= 5
}

/**
 * Decide se a pessoa estava programada para trabalhar numa data. Precedência (única no sistema):
 *   exceção individual NON_WORKING > calendário explícito (trabalha/folga) >
 *   (regime 6x1 sem calendário → desconhecido, NUNCA seg–sex inventado) >
 *   fallback seg–sex, onde feriado aplicável só conta com política EXCLUDE_APPLICABLE_HOLIDAYS.
 * Feriado NUNCA vence uma escala explícita: call center opera em feriado quando a escala diz.
 * A situação funcional (EM_PRODUCAO) é decidida ANTES, pelo resolvedor de elegibilidade.
 */
export function resolveScheduledDay(input: { date: string; explicit: ScheduleDay | undefined; scheduleType: ScheduleType | null; holiday: boolean; holidayPolicy?: HolidayFallbackPolicy; exception?: ScheduleException | null }): ScheduledDayResolution {
  const exception = input.exception && input.exception.effect === "NON_WORKING" ? input.exception : null
  const basis: ScheduleBasis = input.explicit ? "EXPLICIT_SCHEDULE" : input.scheduleType === "SIX_BY_ONE" ? "UNKNOWN_SCHEDULE" : "LEGACY_WEEKDAY_FALLBACK"
  if (exception) return { scheduledToWork: false, basis, holiday: false, exception }
  if (input.explicit) return { scheduledToWork: input.explicit.scheduledToWork, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null }
  if (input.scheduleType === "SIX_BY_ONE") return { scheduledToWork: false, basis: "UNKNOWN_SCHEDULE", holiday: false, exception: null }
  if (input.holiday && isLegacyBusinessDay(input.date) && (input.holidayPolicy ?? DEFAULT_HOLIDAY_FALLBACK_POLICY) === "EXCLUDE_APPLICABLE_HOLIDAYS") return { scheduledToWork: false, basis: "LEGACY_WEEKDAY_FALLBACK", holiday: true, exception: null }
  return { scheduledToWork: isLegacyBusinessDay(input.date), basis: "LEGACY_WEEKDAY_FALLBACK", holiday: false, exception: null }
}

/** Próxima folga EXPLÍCITA a partir de uma data (inclusive) — nunca inferida do regime. */
export function nextScheduledDayOff(days: ScheduleDay[], fromDate: string): ScheduleDay | null {
  return days.filter((day) => !day.scheduledToWork && day.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
