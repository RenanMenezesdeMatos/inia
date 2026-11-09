import { describe, expect, it } from "vitest"
import { appendRecords } from "./database-run.js"

/**
 * Carga única de banco externo: uma leitura sem ordenação (ou um grupo empatado) chega até `maxRowsPerRun` linhas (até 1.000.000).
 * `records.push(...linhas)` estourava a pilha do V8 acima de ~125 mil argumentos; o acréscimo é um a um.
 */
describe("database-run — acréscimo das linhas lidas", () => {
  it("250 mil linhas numa página, na ordem, sem estourar a pilha; páginas seguintes continuam no fim", () => {
    const records: Record<string, unknown>[] = []
    const page = Array.from({ length: 250_000 }, (_, index) => ({ record: { id: index }, position: [String(index)] }))
    appendRecords(records, page)
    appendRecords(records, [{ record: { id: "último" } }])
    expect(records).toHaveLength(250_001)
    expect(records[0]).toEqual({ id: 0 })
    expect(records[249_999]).toEqual({ id: 249_999 })
    expect(records[250_000]).toEqual({ id: "último" })
    expect(records[123]).toBe(page[123]!.record)
  })
})
