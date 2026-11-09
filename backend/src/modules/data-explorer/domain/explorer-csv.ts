import type { ExplorerColumn } from "./explorer-catalog-types.js"

/**
 * CSV DA CONSULTA, no padrão das planilhas brasileiras do projeto: UTF-8 com BOM, separador `;`, decimal com vírgula. Texto que uma planilha
 * interpretaria como fórmula recebe um apóstrofo na frente. Vale também depois de espaços, caracteres de controle e invisíveis, para as variantes de largura total que alguns
 * aplicativos normalizam e depois de um separador dentro do texto: um Excel com lista por vírgula, ou uma importação por tabulação, partiria "Fulano,=1+1" em duas
 * células, e as aspas do CSV não protegem nesse leitor. Só o tipo NUMBER escapa da neutralização, porque o valor é conferido como número antes.
 */
export const CSV_SEPARATOR = ";"
export const CSV_BOM = "\uFEFF"
export const CSV_LINE_END = "\r\n"

// eslint-disable-next-line no-control-regex -- os caracteres de controle no começo do texto são parte do ataque
const FORMULA_START = /^[\s\u0000-\u001f\u0080-\u009f\u200b-\u200f\u2028-\u202f\u2060\ufeff]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/
const NUMBER_VALUE = /^-?\d+(\.\d+)?$/

const FORMULA_AFTER_SEPARATOR = /([,;|\t\r\n][^\S\r\n]*)([=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/g

export function neutralizeFormula(text: string): string {
  const inner = text.replace(FORMULA_AFTER_SEPARATOR, "$1'$2")
  return FORMULA_START.test(inner) ? `'${inner}` : inner
}

function quoted(text: string): string {
  return /[";,\t\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

const textCell = (text: string) => quoted(neutralizeFormula(text))

/** Formatador reaproveitado por exportação: criar um `Intl.DateTimeFormat` por célula pesaria em milhares de linhas. */
export function createInstantFormatter(timeZone: string): (iso: string) => string {
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  return (iso) => {
    const instant = new Date(iso)
    return Number.isNaN(instant.getTime()) ? "" : formatter.format(instant)
  }
}

export function csvValue(column: Pick<ExplorerColumn, "type">, value: string | null, formatInstant: (iso: string) => string): string {
  if (value === null) return ""
  switch (column.type) {
    case "NUMBER":
      return NUMBER_VALUE.test(value) ? value.replace(".", ",") : textCell(value)
    case "BOOLEAN":
      return value === "true" ? "sim" : value === "false" ? "não" : textCell(value)
    case "DATETIME":
      return formatInstant(value)
    default:
      return textCell(value)
  }
}

export const csvHeaderLine = (columns: readonly Pick<ExplorerColumn, "label">[]) => `${CSV_BOM}${columns.map((column) => textCell(column.label)).join(CSV_SEPARATOR)}${CSV_LINE_END}`

export function csvRowLine(columns: readonly Pick<ExplorerColumn, "type">[], row: readonly (string | null)[], formatInstant: (iso: string) => string): string {
  return `${columns.map((column, index) => csvValue(column, row[index] ?? null, formatInstant)).join(CSV_SEPARATOR)}${CSV_LINE_END}`
}
