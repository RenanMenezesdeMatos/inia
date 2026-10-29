import ExcelJS from "exceljs"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import { z } from "zod"
import type { ParsedTable } from "../domain/csv-parser.js"
import { DataRunError } from "../domain/error-codes.js"

/**
 * Leitura de .xlsx via exceljs — SOMENTE leitura de células. Macros (.xlsm) e fórmulas nunca são
 * executadas: uma célula com fórmula entra pelo valor já calculado (cache do arquivo) ou vazia.
 */
export const excelOptionsSchema = z.object({
  sheet: z.string().min(1).optional(),
  hasHeader: z.boolean().default(true),
  skipRows: z.number().int().min(0).max(100).default(0),
})
export type ExcelOptions = z.infer<typeof excelOptionsSchema>

function cellToValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("")
    if ("result" in value) return cellToValue(value.result as ExcelJS.CellValue)
    if ("text" in value) return String(value.text)
    if ("error" in value) return null
  }
  return String(value)
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  // XLSX é ZIP: o diretório central é conferido ANTES de descompactar (zip bomb derrubaria o processo).
  const zip = inspectZip(bytes)
  if (!zip.ok) throw new DataRunError("DATA_FILE_INVALID", `O arquivo não é um .xlsx aceitável (${zip.reason}).`)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer)
  } catch {
    throw new DataRunError("DATA_FILE_INVALID", "O arquivo não é um .xlsx válido.")
  }
  if (workbook.worksheets.length === 0) throw new DataRunError("DATA_FILE_INVALID", "A planilha não tem nenhuma aba.")
  return workbook
}

/** Largura da planilha (a linha mais larga). Linha a linha: `Math.max(...linhas)` estoura a pilha a partir de ~100 mil linhas. */
export function widestRow(rows: readonly (readonly unknown[])[]): number {
  let width = 0
  for (const row of rows) if (row.length > width) width = row.length
  return width
}

export async function parseExcel(bytes: Uint8Array, options: ExcelOptions, limit?: number): Promise<ParsedTable & { sheets: string[] }> {
  const workbook = await loadWorkbook(bytes)
  const sheets = workbook.worksheets.map((sheet) => sheet.name)
  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0]
  if (!sheet) throw new DataRunError("DATA_FILE_INVALID", `Aba "${options.sheet}" não existe. Abas: ${sheets.join(", ")}.`)

  const matrix: (string | number | boolean | null)[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: (string | number | boolean | null)[] = []
    const cells = row.values as ExcelJS.CellValue[]
    for (let index = 1; index < cells.length; index += 1) values[index - 1] = cellToValue(cells[index] ?? null)
    matrix.push(values)
  })
  const all = matrix.slice(options.skipRows)
  if (all.length === 0) throw new DataRunError("DATA_FILE_INVALID", "A aba selecionada está vazia.")
  const width = widestRow(all)
  const columns = Array.from({ length: width }, (_, index) => {
    const header = options.hasHeader ? all[0]![index] : null
    const text = header === null || header === undefined ? "" : String(header).trim()
    return text.length ? text : `coluna_${index + 1}`
  })
  const body = options.hasHeader ? all.slice(1) : all
  const selected = limit === undefined ? body : body.slice(0, limit)
  const rows = selected.map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? null])))
  return { columns, rows, delimiter: "", totalRows: body.length, sheets }
}
