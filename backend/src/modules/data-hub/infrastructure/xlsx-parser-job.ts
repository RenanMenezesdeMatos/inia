import ExcelJS from "exceljs"
import type { ExcelOptions } from "./xlsx-parser.js"

/**
 * Roda SÓ no processo filho do parser isolado (`shared/infrastructure/isolated-parser`), nunca no processo da carga nem da API: é
 * aqui que o exceljs abre a planilha enviada. Quem chama é `xlsx-parser.ts` (`parseExcel`).
 *
 * A leitura é a mesma de antes do isolamento — exceljs com a pasta inteira na memória, `eachRow` sem linhas vazias, o mesmo
 * `cellToValue`. Muda só a saída: as linhas vão em lotes pelo IPC enquanto a aba é percorrida, em vez de uma tabela montada aqui e
 * copiada de uma vez (que ficaria em memória junto com a pasta inteira).
 */
export type XlsxCell = string | number | boolean | null
export type XlsxParseJob = { data: Uint8Array; options: ExcelOptions; limit: number | undefined }
/** Planilha que não dá para ler (aba inexistente, vazia, arquivo inválido) volta como resultado, não como erro do processo. */
export type XlsxParseResult = { ok: true; columns: string[]; totalRows: number; sheets: string[] } | { ok: false; message: string }

/** Linhas por lote enviado à carga. */
export const XLSX_ROW_BATCH = 2_000

function cellToValue(value: ExcelJS.CellValue): XlsxCell {
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

export async function run(job: XlsxParseJob, emit: (rows: XlsxCell[][]) => void): Promise<XlsxParseResult> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength) as unknown as ArrayBuffer)
  } catch {
    return { ok: false, message: "O arquivo não é um .xlsx válido." }
  }
  if (workbook.worksheets.length === 0) return { ok: false, message: "A planilha não tem nenhuma aba." }
  const sheets = workbook.worksheets.map((sheet) => sheet.name)
  const sheet = job.options.sheet ? workbook.getWorksheet(job.options.sheet) : workbook.worksheets[0]
  if (!sheet) return { ok: false, message: `Aba "${job.options.sheet}" não existe. Abas: ${sheets.join(", ")}.` }

  // `skipRows` conta linhas NÃO vazias; o cabeçalho é a primeira depois delas; a largura vale para a aba inteira (inclusive as
  // linhas além da amostra), como na leitura de antes.
  let skipped = 0
  let header = null as XlsxCell[] | null
  let width = 0
  let totalRows = 0
  let batch: XlsxCell[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (skipped < job.options.skipRows) {
      skipped += 1
      return
    }
    const cells = row.values as ExcelJS.CellValue[]
    const values: XlsxCell[] = []
    for (let index = 1; index < cells.length; index += 1) values[index - 1] = cellToValue(cells[index] ?? null)
    width = Math.max(width, values.length)
    if (job.options.hasHeader && header === null) {
      header = values
      return
    }
    totalRows += 1
    if (job.limit !== undefined && totalRows > job.limit) return
    batch.push(values)
    if (batch.length === XLSX_ROW_BATCH) {
      emit(batch)
      batch = []
    }
  })
  if (batch.length > 0) emit(batch)
  if (header === null && totalRows === 0) return { ok: false, message: "A aba selecionada está vazia." }
  const columns = Array.from({ length: width }, (_, index) => {
    const value = header?.[index]
    const text = value === null || value === undefined ? "" : String(value).trim()
    return text.length ? text : `coluna_${index + 1}`
  })
  return { ok: true, columns, totalRows, sheets }
}
