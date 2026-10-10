/**
 * CSV da Monitoria de usabilidade — padrão para planilhas brasileiras: UTF-8 com BOM, separador `;`, decimal com vírgula,
 * datas com o fuso explícito. Todo campo textual é escapado (aspas dobradas) e campos que começam com `=`, `+`, `-`, `@`,
 * TAB ou CR têm a fórmula neutralizada com um apóstrofo (CSV injection). O arquivo começa com um bloco de METADADOS do recorte
 * (período, fuso, filtros, versão das definições, cobertura) separado das linhas por uma linha em branco.
 */
export const CSV_SEPARATOR = ";"
const FORMULA_START = /^[=+\-@\t\r]/

export type CsvCell = string | number | boolean | null | undefined | Date

export function csvCell(value: CsvCell, timeZone?: string): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", ",") : ""
  if (typeof value === "boolean") return value ? "sim" : "não"
  const text = value instanceof Date ? formatInstant(value, timeZone) : value
  const neutralized = FORMULA_START.test(text) ? `'${text}` : text
  return /[";\n\r]/.test(neutralized) || neutralized !== text ? `"${neutralized.replace(/"/g, '""')}"` : neutralized
}

/** "06/10/2026 14:05:00 (America/Fortaleza)". */
export function formatInstant(instant: Date, timeZone = "America/Fortaleza"): string {
  const formatted = new Intl.DateTimeFormat("pt-BR", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(instant).replace(",", "")
  return `${formatted} (${timeZone})`
}

export type CsvMetadata = { title: string; period: string; timeZone: string; filters: string; definitionsVersion: string; coverage: string; generatedAt: Date; notes?: string[] }

export function buildCsv(metadata: CsvMetadata, header: readonly string[], rows: readonly CsvCell[][]): string {
  const meta: CsvCell[][] = [
    ["Monitoria de usabilidade — INIA"],
    ["Recorte", metadata.title],
    ["Período", metadata.period],
    ["Fuso", metadata.timeZone],
    ["Filtros", metadata.filters],
    ["Versão das definições", metadata.definitionsVersion],
    ["Cobertura", metadata.coverage],
    ["Gerado em", metadata.generatedAt],
    ...(metadata.notes ?? []).map((note) => ["Nota", note] as CsvCell[]),
  ]
  const lines = [...meta.map((row) => row.map((cell) => csvCell(cell, metadata.timeZone)).join(CSV_SEPARATOR)), "", header.map((cell) => csvCell(cell)).join(CSV_SEPARATOR), ...rows.map((row) => row.map((cell) => csvCell(cell, metadata.timeZone)).join(CSV_SEPARATOR))]
  return `\uFEFF${lines.join("\r\n")}\r\n`
}
