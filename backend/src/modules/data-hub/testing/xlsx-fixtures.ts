import { PassThrough } from "node:stream"
import ExcelJS from "exceljs"
import type { ParsedTable } from "../domain/csv-parser.js"
import type { ExcelOptions } from "../infrastructure/xlsx-parser.js"

/**
 * Planilhas de teste da leitura de XLSX (R-24) e a leitura de ANTES do isolamento, com o exceljs no próprio processo — o oráculo
 * que prova que a leitura no processo filho devolve exatamente a mesma tabela.
 */

/**
 * O que costuma aparecer numa exportação de cliente: texto, número, data, sim/não, fórmula (resultado numérico, texto, data,
 * sim/não e erro), texto rico, link, erro, célula vazia, coluna além do cabeçalho, linha vazia e linha só com formatação no meio,
 * célula mesclada e uma segunda aba.
 */
export async function variedWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Medições")
  sheet.addRow(["matricula", "nome", "data", "valor", "ativo", "dobro", "status", "observacao", "portal", "erro"])
  sheet.addRow(["M001", "Ana", new Date(Date.UTC(2026, 8, 15)), 42.5, true, { formula: "D2*2", result: 85 }, { formula: 'IF(E2,"ok","não")', result: "ok" }, { richText: [{ text: "Atendeu " }, { font: { bold: true }, text: "bem" }] }, { text: "manual", hyperlink: "https://example.com/manual" }, { error: "#N/A" }])
  sheet.addRow(["M002", "Bruno", new Date(Date.UTC(2026, 8, 16, 13, 30)), -3, false, { formula: "D3*2", result: -6 }, { formula: "1/0", result: { error: "#DIV/0!" } }, null, null, null, "além do cabeçalho"])
  sheet.addRow(["M003", "Carla", { formula: "DATE(2026,9,17)", result: new Date(Date.UTC(2026, 8, 17)) }, 0, { formula: "TRUE()", result: true }, { formula: "D4*2", result: 0 }, 7])
  sheet.getCell("B6").font = { bold: true }
  sheet.getCell("A7").value = "M004"
  sheet.getCell("B7").value = "Mesclado"
  sheet.mergeCells("B7:C7")
  sheet.getCell("D7").value = 1
  sheet.getColumn(3).numFmt = "dd/mm/yyyy"
  const other = workbook.addWorksheet("Outra")
  other.addRow(["a", "b"])
  other.addRow([1, 2])
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Aba "Medições" com `rows` linhas de 10 colunas, como uma carga de indicadores (texto repetido, datas, números), escrita em fluxo. */
export async function measurementWorkbook(rows: number): Promise<Uint8Array> {
  const output = new PassThrough()
  const parts: Buffer[] = []
  output.on("data", (part: Buffer) => parts.push(part))
  const done = new Promise<void>((resolve, reject) => {
    output.on("end", resolve)
    output.on("error", reject)
  })
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useSharedStrings: true, useStyles: true })
  const sheet = writer.addWorksheet("Medições")
  sheet.addRow(["matricula", "nome", "data", "indicador", "valor", "numerador", "denominador", "grupo", "subgrupo", "observacao"]).commit()
  const groups = ["Retenção", "Suporte Técnico", "Faturamento", "Cadastro"]
  const indicators = ["TMA", "FCR", "RECHAMADA", "MONITORIA", "NPS"]
  for (let index = 0; index < rows; index += 1) {
    const person = index % 2_100
    sheet
      .addRow([
        `M${String(100_000 + person).padStart(7, "0")}`,
        `Colaborador ${person} da Silva`,
        new Date(Date.UTC(2026, 0, 1 + (index % 270))),
        indicators[index % 5],
        ((index * 37) % 10_000) / 100,
        (index * 13) % 500,
        500,
        groups[index % 4],
        `Subgrupo ${index % 37}`,
        index % 7 === 0 ? `Observação livre número ${index}` : null,
      ])
      .commit()
  }
  await sheet.commit()
  await writer.commit()
  await done
  return new Uint8Array(Buffer.concat(parts))
}

// ---- Leitura de antes do isolamento (cópia do `parseExcel` que rodava no processo da carga, sem a guarda de ZIP) -------------

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

export async function parseExcelInProcess(bytes: Uint8Array, options: ExcelOptions, limit?: number): Promise<ParsedTable & { sheets: string[] }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer)
  const sheets = workbook.worksheets.map((sheet) => sheet.name)
  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0]
  if (!sheet) throw new Error(`Aba "${options.sheet}" não existe.`)

  const matrix: (string | number | boolean | null)[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: (string | number | boolean | null)[] = []
    const cells = row.values as ExcelJS.CellValue[]
    for (let index = 1; index < cells.length; index += 1) values[index - 1] = cellToValue(cells[index] ?? null)
    matrix.push(values)
  })
  const all = matrix.slice(options.skipRows)
  if (all.length === 0) throw new Error("A aba selecionada está vazia.")
  const width = Math.max(...all.map((row) => row.length))
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
