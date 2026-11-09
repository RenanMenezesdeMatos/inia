import { z } from "zod"
import { createIsolatedParser, IsolatedParserError, siblingModule, type IsolatedParserLimits } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import type { ParsedTable } from "../domain/csv-parser.js"
import { DataRunError } from "../domain/error-codes.js"
import type { XlsxCell, XlsxParseJob, XlsxParseResult } from "./xlsx-parser-job.js"

/**
 * Leitura de .xlsx via exceljs — SOMENTE leitura de células. Macros (.xlsm) e fórmulas nunca são
 * executadas: uma célula com fórmula entra pelo valor já calculado (cache do arquivo) ou vazia.
 *
 * O exceljs roda num processo filho com teto de memória e de tempo (R-24; job em `xlsx-parser-job.ts`): ele monta a pasta
 * inteira na memória, e uma planilha que passa pela guarda de ZIP (até 300 MB descompactados) ainda pode pedir gigabytes. Estourou,
 * travou ou o filho morreu: a carga recebe `DATA_FILE_INVALID` com o motivo, e o processo da carga (ou da API, no upload e na
 * amostra) segue de pé.
 */
export const excelOptionsSchema = z.object({
  sheet: z.string().min(1).optional(),
  hasHeader: z.boolean().default(true),
  skipRows: z.number().int().min(0).max(100).default(0),
})
export type ExcelOptions = z.infer<typeof excelOptionsSchema>

/**
 * Teto próprio da planilha (o de PDF/DOCX é 768 MB): o exceljs guarda cada célula como objeto, ~650 bytes por célula no pico.
 * Medido no filho (18/10/2026, macOS, Node 24, aba de 10 colunas): 20 mil linhas ≈ 310 MB e 0,5 s; 200 mil ≈ 1,3–1,4 GB e
 * 2,8 s; 380 mil ≈ 1,9 GB e 5,6 s — perto do máximo (~3,5 milhões de células). 820 mil linhas (47 MB, 302 MB descompactados:
 * passa no limite do upload e na guarda de ZIP) é recusada em ~10 s. Heap abaixo da residente de propósito: com os dois em
 * 2.048 MB o GC deixa a residente subir e 380 mil linhas já não passam; com heap de 768 MB nem 200 mil passam.
 */
export const XLSX_PARSER_LIMITS: IsolatedParserLimits = { heapMb: 1_536, rssMb: 2_048, timeoutMs: 60_000 }

const XLSX_PARSER_JOB = siblingModule(import.meta.url, "xlsx-parser-job")

/**
 * Um filho por vez neste processo (cada um pode chegar ao teto) e fila curta: no upload e na amostra, a API; na carga, o
 * processamento. Além da fila, `DATA_FILE_READER_BUSY` (transitório: a carga é tentada de novo).
 */
const runXlsxIsolated = createIsolatedParser({ maxRunning: 1, maxWaiting: 4 })

/** Falha do processo de leitura → erro da carga, com o que fazer escrito para quem enviou a planilha. */
export function xlsxReadFailure(error: IsolatedParserError, limits: IsolatedParserLimits): DataRunError {
  switch (error.reason) {
    case "MEMORY":
      return new DataRunError("DATA_FILE_INVALID", `A planilha é grande demais para ser lida com segurança: a leitura passou do teto de ${limits.rssMb} MB de memória. Divida o arquivo em partes menores ou envie em CSV.`)
    case "TIMEOUT":
      return new DataRunError("DATA_FILE_INVALID", `A leitura da planilha passou do prazo de ${Math.max(1, Math.round(limits.timeoutMs / 1000))} s. Divida o arquivo em partes menores ou envie em CSV.`)
    case "CRASHED":
      // O V8 às vezes aborta o processo inteiro ao bater o teto de heap (em vez de avisar): grande demais ou corrompido.
      return new DataRunError("DATA_FILE_INVALID", "A leitura da planilha foi interrompida antes do fim — o arquivo é grande demais ou está corrompido. Divida o arquivo em partes menores ou envie em CSV.", { reason: error.message })
    case "BUSY":
      return new DataRunError("DATA_FILE_READER_BUSY", "Há muitas planilhas sendo lidas neste momento. Tente de novo em instantes.")
    case "FAILED":
      return new DataRunError("DATA_FILE_INVALID", "A planilha não pôde ser lida.", { reason: error.message })
  }
}

export async function parseExcel(bytes: Uint8Array, options: ExcelOptions, limit?: number, limits: IsolatedParserLimits = XLSX_PARSER_LIMITS): Promise<ParsedTable & { sheets: string[] }> {
  // XLSX é ZIP: o diretório central é conferido ANTES de descompactar — zip bomb é recusada aqui, sem abrir processo de leitura.
  const zip = await inspectZip(bytes)
  if (!zip.ok) throw new DataRunError("DATA_FILE_INVALID", `O arquivo não é um .xlsx aceitável (${zip.reason}).`)

  const cells: XlsxCell[][] = []
  let result: XlsxParseResult
  try {
    result = await runXlsxIsolated<XlsxParseResult>(XLSX_PARSER_JOB, { data: bytes, options, limit } satisfies XlsxParseJob, limits, (batch) => {
      for (const row of batch as XlsxCell[][]) cells.push(row)
    })
  } catch (error) {
    if (error instanceof IsolatedParserError) throw xlsxReadFailure(error, limits)
    throw error
  }
  if (!result.ok) throw new DataRunError("DATA_FILE_INVALID", result.message)
  const { columns } = result
  const rows = cells.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])))
  return { columns, rows, delimiter: "", totalRows: result.totalRows, sheets: result.sheets }
}
