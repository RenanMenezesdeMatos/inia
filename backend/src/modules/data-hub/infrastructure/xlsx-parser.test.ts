import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseExcel } from "./xlsx-parser.js"

/**
 * Planilha grande (lote 3 da 4ª auditoria): a largura era `Math.max(...linhas)`, que estoura a pilha a partir de ~100 mil linhas
 * — um XLSX legítimo de 13 MB com 300 mil linhas falhava no upload e na carga agendada. Hoje a largura e o total são contados
 * linha a linha, sem montar uma segunda cópia da aba; a prévia (`limit`) só monta as linhas que mostra.
 */
async function workbook(rows: (string | number)[][]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("Dados")
  for (const row of rows) sheet.addRow(row)
  book.addWorksheet("Outra")
  return new Uint8Array(await book.xlsx.writeBuffer())
}

describe("leitura de planilha", () => {
  const rows: (string | number)[][] = [["matrícula", "nome", "valor"], ...Array.from({ length: 2_000 }, (_, index) => (index === 1_700 ? [`M${index}`, `Pessoa ${index}`, index, "extra", "mais larga"] : [`M${index}`, `Pessoa ${index}`, index]))]

  it("a prévia devolve as mesmas colunas, as mesmas primeiras linhas e o mesmo total da leitura completa — a linha mais larga lá no fim conta", async () => {
    const bytes = await workbook(rows)
    const full = await parseExcel(bytes, { hasHeader: true, skipRows: 0 })
    const preview = await parseExcel(bytes, { hasHeader: true, skipRows: 0 }, 20)
    expect(full.columns).toEqual(["matrícula", "nome", "valor", "coluna_4", "coluna_5"])
    expect(preview.columns).toEqual(full.columns)
    expect(preview.rows).toEqual(full.rows.slice(0, 20))
    expect(preview.totalRows).toBe(2_000)
    expect(full.totalRows).toBe(2_000)
    expect(preview.sheets).toEqual(["Dados", "Outra"])
  })

  it("linhas puladas e sem cabeçalho: mesmo resultado com e sem limite", async () => {
    const bytes = await workbook(rows)
    for (const options of [{ hasHeader: false, skipRows: 0 }, { hasHeader: true, skipRows: 3 }, { hasHeader: false, skipRows: 1_999 }]) {
      const full = await parseExcel(bytes, options)
      for (const limit of [0, 1, 5]) {
        const preview = await parseExcel(bytes, options, limit)
        expect(preview.columns).toEqual(full.columns)
        expect(preview.rows).toEqual(full.rows.slice(0, limit))
        expect(preview.totalRows).toBe(full.totalRows)
      }
    }
  })

  it("aba vazia depois das linhas puladas é DATA_FILE_INVALID", async () => {
    await expect(parseExcel(await workbook([["a"], ["b"]]), { hasHeader: true, skipRows: 2 }, 20)).rejects.toMatchObject({ code: "DATA_FILE_INVALID" })
  })
})
