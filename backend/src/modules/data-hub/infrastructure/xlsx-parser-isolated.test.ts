import ExcelJS from "exceljs"
import { beforeAll, describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { IsolatedParserError } from "../../../shared/infrastructure/isolated-parser/isolated-parser.js"
import { parseFileBatchForRequest } from "../application/connectors/file-connector.js"
import { DataRunError } from "../domain/error-codes.js"
import { measurementWorkbook, parseExcelInProcess, variedWorkbook } from "../testing/xlsx-fixtures.js"
import { XLSX_ROW_BATCH } from "./xlsx-parser-job.js"
import { parseExcel, XLSX_PARSER_LIMITS, xlsxReadFailure, type ExcelOptions } from "./xlsx-parser.js"

const MB = 1024 * 1024
const DEFAULT: ExcelOptions = { hasHeader: true, skipRows: 0 }

async function failureOf(promise: Promise<unknown>): Promise<DataRunError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(DataRunError)
  return error as DataRunError
}

describe("leitura de XLSX da Central de Dados no processo filho (R-24, achado DATA-1)", () => {
  let large: Uint8Array
  beforeAll(async () => {
    large = await measurementWorkbook(20_000)
  })

  it("planilha variada: a tabela lida no filho é idêntica à do exceljs no processo (aba, cabeçalho, linhas puladas e amostra)", async () => {
    const bytes = await variedWorkbook()
    const table = await parseExcel(bytes, DEFAULT)
    expect(table).toEqual(await parseExcelInProcess(bytes, DEFAULT))
    // A comparação não é vazia: datas, fórmulas, texto rico, link, erro, coluna além do cabeçalho e célula mesclada.
    expect(table.sheets).toEqual(["Medições", "Outra"])
    expect(table.columns.at(-1)).toBe("coluna_11")
    expect(table.rows[0]).toMatchObject({ data: "2026-09-15T00:00:00.000Z", valor: 42.5, ativo: true, dobro: 85, status: "ok", observacao: "Atendeu bem", portal: "manual", erro: null })
    expect(table.rows[2]).toMatchObject({ data: "2026-09-17T00:00:00.000Z", ativo: true })
    expect(table.rows[3]).toMatchObject({ nome: "Mesclado", data: "Mesclado" })

    const variants: [ExcelOptions, number | undefined][] = [
      [{ ...DEFAULT, sheet: "Outra" }, undefined],
      [{ hasHeader: false, skipRows: 0 }, undefined],
      [{ hasHeader: true, skipRows: 2 }, undefined],
      [DEFAULT, 2],
    ]
    for (const [options, limit] of variants) expect(await parseExcel(bytes, options, limit)).toEqual(await parseExcelInProcess(bytes, options, limit))
  })

  it("20 mil linhas chegam inteiras e na ordem, em vários lotes, iguais à leitura no processo; a amostra conta o total", async () => {
    expect(20_000).toBeGreaterThan(3 * XLSX_ROW_BATCH)
    const table = await parseExcel(large, DEFAULT)
    expect(table.rows).toHaveLength(20_000)
    expect(table).toEqual(await parseExcelInProcess(large, DEFAULT))

    const sample = await parseExcel(large, DEFAULT, 20)
    expect(sample).toMatchObject({ columns: table.columns, totalRows: 20_000, sheets: ["Medições"] })
    expect(sample.rows).toEqual(table.rows.slice(0, 20))
  })

  it("aba inexistente, aba vazia e pasta sem aba continuam DATA_FILE_INVALID com a mensagem de antes", async () => {
    const bytes = await variedWorkbook()
    expect(await failureOf(parseExcel(bytes, { ...DEFAULT, sheet: "Nada" }))).toMatchObject({ code: "DATA_FILE_INVALID", message: 'Aba "Nada" não existe. Abas: Medições, Outra.' })
    expect(await failureOf(parseExcel(bytes, { hasHeader: true, skipRows: 50 }))).toMatchObject({ code: "DATA_FILE_INVALID", message: "A aba selecionada está vazia." })
    const noSheets = new Uint8Array(await new ExcelJS.Workbook().xlsx.writeBuffer())
    expect(await failureOf(parseExcel(noSheets, DEFAULT))).toMatchObject({ code: "DATA_FILE_INVALID", message: "A planilha não tem nenhuma aba." })
  })

  it("a guarda de ZIP continua antes: pacote truncado ou que não é ZIP é recusado por ela, sem chegar ao exceljs", async () => {
    const bytes = await variedWorkbook()
    expect(await failureOf(parseExcel(bytes.subarray(0, bytes.length - 200), DEFAULT))).toMatchObject({ code: "DATA_FILE_INVALID", message: "O arquivo não é um .xlsx aceitável (pacote sem diretório central)." })
    expect(await failureOf(parseExcel(new TextEncoder().encode("matricula;valor\nM001;1"), DEFAULT))).toMatchObject({ code: "DATA_FILE_INVALID", message: "O arquivo não é um .xlsx aceitável (pacote sem diretório central)." })
  })

  it("planilha acima do teto de memória é recusada (DATA_FILE_INVALID) sem a memória deste processo subir", async () => {
    const before = process.memoryUsage.rss()
    const error = await failureOf(parseExcel(large, DEFAULT, undefined, { heapMb: 1_536, rssMb: 200, timeoutMs: 20_000 }))
    expect(error.code).toBe("DATA_FILE_INVALID")
    expect(error.message).toContain("grande demais")
    expect(error.transient).toBe(false)
    expect(process.memoryUsage.rss() - before).toBeLessThan(64 * MB)
  })

  it("leitura que passa do prazo é recusada (DATA_FILE_INVALID) e diz o prazo", async () => {
    const error = await failureOf(parseExcel(large, DEFAULT, undefined, { heapMb: 1_536, rssMb: 2_048, timeoutMs: 200 }))
    expect(error.code).toBe("DATA_FILE_INVALID")
    expect(error.message).toContain("prazo")
  })

  it("falha do processo de leitura vira erro da carga: arquivo recusado (definitivo) ou leitores ocupados (transitório, tenta de novo)", () => {
    for (const reason of ["MEMORY", "TIMEOUT", "CRASHED", "FAILED"] as const) {
      const error = xlsxReadFailure(new IsolatedParserError(reason, "detalhe"), XLSX_PARSER_LIMITS)
      expect(error.code).toBe("DATA_FILE_INVALID")
      expect(error.transient).toBe(false)
    }
    expect(xlsxReadFailure(new IsolatedParserError("MEMORY", "detalhe"), XLSX_PARSER_LIMITS).message).toContain("2048 MB")
    expect(xlsxReadFailure(new IsolatedParserError("TIMEOUT", "detalhe"), XLSX_PARSER_LIMITS).message).toContain("60 s")
    const busy = xlsxReadFailure(new IsolatedParserError("BUSY", "detalhe"), XLSX_PARSER_LIMITS)
    expect(busy.code).toBe("DATA_FILE_READER_BUSY")
    expect(busy.transient).toBe(true)
  })

  it("no upload e na amostra o erro de leitura volta como 422 com o código estável, não como erro interno", async () => {
    const config = { format: "XLSX" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: DEFAULT }
    const error = await parseFileBatchForRequest(config, new TextEncoder().encode("não é zip"), 20).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: "DATA_FILE_INVALID", statusCode: 422 })
  })
})
