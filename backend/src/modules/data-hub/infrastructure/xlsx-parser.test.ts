import { describe, expect, it } from "vitest"
import { widestRow } from "./xlsx-parser.js"

/**
 * Planilha grande (lote 3 da 4ª auditoria): a largura era `Math.max(...linhas)`, que estoura a pilha a partir de ~100 mil linhas
 * — um XLSX legítimo de 13 MB com 300 mil linhas falhava no upload e na carga agendada com "Maximum call stack size exceeded".
 */
describe("largura da planilha", () => {
  it("conta a linha mais larga em 500 mil linhas sem estourar a pilha", () => {
    const rows = Array.from({ length: 500_000 }, (_, index) => (index === 321_000 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3]))
    expect(widestRow(rows)).toBe(9)
  })

  it("planilha vazia tem largura zero", () => {
    expect(widestRow([])).toBe(0)
  })
})
