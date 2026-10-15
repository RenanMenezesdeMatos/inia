import { z } from "zod"
import { DataRunError } from "./error-codes.js"
import type { SourceRecord } from "./mapping.js"

/**
 * Parser CSV próprio (RFC 4180 + realidade brasileira): separador `,` `;` tab `|` com
 * autodetecção e override, aspas duplas com escape `""`, CRLF/LF, BOM, e encoding UTF-8 ou
 * Windows-1252/Latin-1 (via TextDecoder do Node — nunca "adivinha" byte a byte).
 */
export const CSV_ENCODINGS = ["utf-8", "windows-1252", "latin1"] as const
export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const

export const csvOptionsSchema = z.object({
  encoding: z.enum(CSV_ENCODINGS).default("utf-8"),
  delimiter: z.enum(["auto", ...CSV_DELIMITERS]).default("auto"),
  hasHeader: z.boolean().default(true),
  skipRows: z.number().int().min(0).max(100).default(0),
})
export type CsvOptions = z.infer<typeof csvOptionsSchema>

export type ParsedTable = { columns: string[]; rows: SourceRecord[]; delimiter: string; totalRows: number }

export function decodeBytes(bytes: Uint8Array, encoding: (typeof CSV_ENCODINGS)[number]): string {
  const label = encoding === "latin1" ? "iso-8859-1" : encoding
  let text = new TextDecoder(label).decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

/** Quantas linhas lógicas (não vazias) a autodetecção lê, e até onde ela vai no texto (um campo entre aspas sem fim não varre o arquivo inteiro). */
const DETECTION_ROWS = 10
const DETECTION_MAX_CHARS = 1_000_000

/**
 * Autodetecção do separador pelas primeiras linhas LÓGICAS do arquivo, com a mesma leitura de aspas do `splitCsv`: um campo
 * entre aspas com vírgulas ou quebras de linha (ex.: transcrição) não conta separador nem vira linha nova.
 */
export function detectDelimiter(text: string): string {
  let best = ","
  let bestScore = -1
  for (const delimiter of CSV_DELIMITERS) {
    const counts = countDelimitersPerRow(text, delimiter)
    if (counts.length === 0) continue
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    // Bom separador: aparece em toda linha e de forma consistente.
    const score = min > 0 && min === max ? min * 10 : min > 0 ? min : 0
    if (score > bestScore) {
      bestScore = score
      best = delimiter
    }
  }
  return best
}

/** Separadores fora de aspas em cada uma das primeiras linhas lógicas não vazias. */
function countDelimitersPerRow(text: string, delimiter: string): number[] {
  const counts: number[] = []
  const end = Math.min(text.length, DETECTION_MAX_CHARS)
  let count = 0
  let hasContent = false
  let inQuotes = false
  let index = 0
  for (; index < end && counts.length < DETECTION_ROWS; index += 1) {
    const char = text[index]!
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') index += 1
        else inQuotes = false
      }
      continue
    }
    if (char === "\n" || char === "\r") {
      if (hasContent) counts.push(count)
      count = 0
      hasContent = false
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === delimiter) count += 1
    if (char.trim().length > 0) hasContent = true
  }
  // Última linha sem quebra no fim; uma linha cortada pelo limite só conta se for a única.
  if (hasContent && counts.length < DETECTION_ROWS && (index >= text.length || counts.length === 0)) counts.push(count)
  return counts
}

/** Divide o texto em linhas de células, respeitando aspas (quebra de linha dentro de aspas é preservada). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else inQuotes = false
      } else cell += char
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0))
}

export function parseCsv(bytes: Uint8Array, options: CsvOptions, limit?: number): ParsedTable {
  let text: string
  try {
    text = decodeBytes(bytes, options.encoding)
  } catch {
    throw new DataRunError("DATA_FILE_INVALID", `Não foi possível decodificar o arquivo como ${options.encoding}.`)
  }
  const delimiter = options.delimiter === "auto" ? detectDelimiter(text) : options.delimiter
  const all = splitCsv(text, delimiter).slice(options.skipRows)
  if (all.length === 0) throw new DataRunError("DATA_FILE_INVALID", "O arquivo está vazio.")
  const columns = options.hasHeader ? all[0]!.map((name, index) => (name.trim().length ? name.trim() : `coluna_${index + 1}`)) : all[0]!.map((_, index) => `coluna_${index + 1}`)
  const body = options.hasHeader ? all.slice(1) : all
  const selected = limit === undefined ? body : body.slice(0, limit)
  const rows = selected.map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""])))
  return { columns, rows, delimiter, totalRows: body.length }
}
