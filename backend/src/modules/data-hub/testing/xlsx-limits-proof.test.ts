import { describe, expect, it } from "vitest"
import { inspectZip } from "../../../shared/infrastructure/zip-guard.js"
import { DataRunError } from "../domain/error-codes.js"
import { parseExcel, XLSX_PARSER_LIMITS } from "../infrastructure/xlsx-parser.js"
import { measurementWorkbook } from "./xlsx-fixtures.js"

/**
 * PROVA DOS TETOS DA PLANILHA (R-24) com os limites REAIS de `XLSX_PARSER_LIMITS` — pesada (gera ~50 MB de planilha e sobe um
 * filho até 2 GB), por isso só com a variável:
 *   INIA_XLSX_PROOF=1 npx vitest run xlsx-limits-proof
 * Serve para reconferir os números em outra máquina (ex.: a VM Windows de homologação). Medido em 18/10/2026 (macOS, Node 24):
 * 200 mil linhas lidas em ~3 s; 820 mil linhas recusadas em ~10 s (~40 s com a máquina carregada; o prazo é 60 s).
 */
const MB = 1024 * 1024
const DEFAULT = { hasHeader: true, skipRows: 0 }

describe.skipIf(!process.env.INIA_XLSX_PROOF)("tetos da leitura de XLSX no processo filho (R-24)", () => {
  it("carga legítima de 200 mil linhas × 10 colunas é lida inteira com os tetos reais", async () => {
    const bytes = await measurementWorkbook(200_000)
    const table = await parseExcel(bytes, DEFAULT)
    expect(table.rows).toHaveLength(200_000)
    expect(table.totalRows).toBe(200_000)
  }, 120_000)

  it("planilha de 820 mil linhas que passa no limite do upload e na guarda de ZIP é recusada sem levar este processo junto", async () => {
    const bytes = await measurementWorkbook(820_000)
    expect(bytes.byteLength).toBeLessThan(50 * MB)
    expect((await inspectZip(bytes)).ok).toBe(true)
    const before = process.memoryUsage.rss()
    const startedAt = Date.now()
    const error = await parseExcel(bytes, DEFAULT).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(DataRunError)
    expect((error as DataRunError).code).toBe("DATA_FILE_INVALID")
    expect(Date.now() - startedAt).toBeLessThan(XLSX_PARSER_LIMITS.timeoutMs)
    // Os ~2 GB da leitura ficam no filho e a guarda de ZIP confere em fluxo: aqui sobe ~50 MB (antes da guarda em fluxo, ~0,6 GB).
    expect(process.memoryUsage.rss() - before).toBeLessThan(256 * MB)
  }, 180_000)
})
