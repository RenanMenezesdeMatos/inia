import { stateCodeOfCapital } from "./brazilian-capitals.js"

/**
 * QUAL FERIADO VALE PARA QUEM — a partir da CAPITAL OPERACIONAL do colaborador:
 *   NATIONAL       → todos;
 *   STATE          → quem tem capital cuja UF derivada é a do feriado (CE não vale para Recife);
 *   MUNICIPAL_CAPITAL → quem tem exatamente aquela capital (Fortaleza não vale para Salvador);
 *   ORGANIZATION   → datas próprias da operação (organization_holidays), todos.
 * Sem capital informada: só NATIONAL + ORGANIZATION são conhecidos; estadual/municipal NÃO são
 * inferidos — a confiança fica CAPITAL_UNKNOWN (qualidade de dado, nunca palpite).
 * Feriado aplicável ≠ folga automática: quem decide é a escala (work-schedule.ts).
 */
export const HOLIDAY_SCOPES = ["NATIONAL", "STATE", "MUNICIPAL_CAPITAL", "ORGANIZATION"] as const
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number]

export type ApplicableHoliday = { date: string; name: string; scope: HolidayScope; stateCode: string | null; capitalCode: string | null }

export type HolidayConfidence = "CAPITAL_KNOWN" | "CAPITAL_UNKNOWN"

export function holidayAppliesTo(holiday: Pick<ApplicableHoliday, "scope" | "stateCode" | "capitalCode">, operationalCapitalCode: string | null): boolean {
  switch (holiday.scope) {
    case "NATIONAL":
    case "ORGANIZATION":
      return true
    case "STATE":
      return operationalCapitalCode !== null && stateCodeOfCapital(operationalCapitalCode) === holiday.stateCode
    case "MUNICIPAL_CAPITAL":
      return operationalCapitalCode !== null && holiday.capitalCode === operationalCapitalCode
  }
}

/** Datas (AAAA-MM-DD) com feriado aplicável a uma pessoa, a partir do catálogo carregado uma vez por janela. */
export function applicableHolidayDates(holidays: readonly ApplicableHoliday[], operationalCapitalCode: string | null): Map<string, ApplicableHoliday[]> {
  const byDate = new Map<string, ApplicableHoliday[]>()
  for (const holiday of holidays) {
    if (!holidayAppliesTo(holiday, operationalCapitalCode)) continue
    const list = byDate.get(holiday.date) ?? []
    list.push(holiday)
    byDate.set(holiday.date, list)
  }
  return byDate
}

export function holidayConfidenceFor(operationalCapitalCode: string | null): HolidayConfidence {
  return operationalCapitalCode ? "CAPITAL_KNOWN" : "CAPITAL_UNKNOWN"
}
