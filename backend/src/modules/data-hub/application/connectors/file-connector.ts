import { parseCsv, type ParsedTable } from "../../domain/csv-parser.js"
import { DataRunError } from "../../domain/error-codes.js"
import type { SourceRecord } from "../../domain/mapping.js"
import { fileFeedConfigSchema } from "../../domain/source-config.js"
import { parseExcel } from "../../infrastructure/xlsx-parser.js"
import type { z } from "zod"

export type FileFeedConfig = z.infer<typeof fileFeedConfigSchema>

export type FetchedBatch = {
  columns: string[]
  records: SourceRecord[]
  bytes: number
  totalRecords: number
  detail: string | null
  checkpointAfter?: Record<string, unknown> | null
  sheets?: string[]
}

export function inferFormatFromFilename(filename: string | null | undefined): "CSV" | "XLSX" | null {
  if (!filename) return null
  if (/\.xlsx$/i.test(filename)) return "XLSX"
  if (/\.csv$|\.txt$|\.tsv$/i.test(filename)) return "CSV"
  if (/\.xlsm?$|\.xls$/i.test(filename)) throw new DataRunError("DATA_FILE_INVALID", "Só .xlsx é aceito (sem macros, sem .xls legado).")
  return null
}

/** Lê um arquivo (CSV/XLSX) já em memória segundo a configuração do feed. `limit` = amostra. */
export async function parseFileBatch(config: FileFeedConfig, bytes: Uint8Array, limit?: number): Promise<FetchedBatch> {
  const options = fileFeedConfigSchema.parse(config)
  let table: ParsedTable & { sheets?: string[] }
  if (options.format === "XLSX") {
    table = await parseExcel(bytes, options.excel, limit)
  } else {
    table = parseCsv(bytes, options.csv, limit)
  }
  const detail = options.format === "XLSX" ? `Aba "${options.excel.sheet ?? table.sheets?.[0] ?? ""}", ${table.totalRows} linhas` : `Separador "${table.delimiter === "\t" ? "tab" : table.delimiter}", ${options.csv.encoding}, ${table.totalRows} linhas`
  const batch: FetchedBatch = { columns: table.columns, records: table.rows, bytes: bytes.byteLength, totalRecords: table.totalRows, detail }
  if (table.sheets) batch.sheets = table.sheets
  return batch
}
