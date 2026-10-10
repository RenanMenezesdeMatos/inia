import { DomainError } from "../../../shared/domain/domain-error.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { localDateParts } from "../../workflows/application/schedule-recurrence.js"

/**
 * Competência mensal "AAAA-MM" — a MESMA granularidade de `reference_period` das tabelas oficiais
 * de performance (employee_indicator_performance / employee_prv_performance). Toda a área de
 * Indicadores/Equipe trabalha em competência, nunca em intervalo livre de dias: a fonte oficial
 * só existe por mês, então oferecer "intervalo" seria inventar dado onde não há.
 */
export type ReferencePeriod = string

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isReferencePeriod(value: unknown): value is ReferencePeriod {
  return typeof value === "string" && PERIOD_PATTERN.test(value)
}

export function parseReferencePeriod(value: unknown): ReferencePeriod {
  if (!isReferencePeriod(value)) throw new DomainError("Competência inválida — use o formato AAAA-MM.", "INVALID_PERIOD", 400)
  return value
}

/** Competência "de agora" no calendário LOCAL da organização (timezone IANA — nunca offset fixo, nunca UTC silencioso). */
export function currentReferencePeriod(now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): ReferencePeriod {
  return localDateParts(now, timeZone).date.slice(0, 7)
}

export function shiftReferencePeriod(period: ReferencePeriod, months: number): ReferencePeriod {
  const [yearPart, monthPart] = period.split("-")
  const year = Number(yearPart)
  const monthIndex = Number(monthPart) - 1 + months
  const date = new Date(Date.UTC(year, monthIndex, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export function previousReferencePeriod(period: ReferencePeriod): ReferencePeriod {
  return shiftReferencePeriod(period, -1)
}

/** Janela de histórico terminando em `period` (inclusive), do mais antigo pro mais recente. */
export function referencePeriodWindow(period: ReferencePeriod, length: number): ReferencePeriod[] {
  return Array.from({ length }, (_, index) => shiftReferencePeriod(period, index - (length - 1)))
}

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
const MONTH_LABELS_LONG = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

/** "set/26" — pra eixo de gráfico e comparações curtas. */
export function shortPeriodLabel(period: ReferencePeriod): string {
  const [year, month] = period.split("-")
  return `${MONTH_LABELS[Number(month) - 1]}/${year?.slice(2)}`
}

/** "Setembro 2026" — pro seletor de competência e títulos. */
export function longPeriodLabel(period: ReferencePeriod): string {
  const [year, month] = period.split("-")
  return `${MONTH_LABELS_LONG[Number(month) - 1]} ${year}`
}
