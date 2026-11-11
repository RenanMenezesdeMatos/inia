import { describe, expect, it } from "vitest"
import type { PdfPageLayout, PdfRule, PdfRun } from "./layout.js"
import { buildLines } from "./lines.js"
import { pdfLayoutToMarkdown } from "./pdf-markdown.js"
import { ruledTables } from "./tables.js"

/**
 * O conversor roda na thread da API depois do processo filho (duas vezes por envio): a conta precisa ser limitada pelo que o arquivo traz, não pela
 * geometria que ele declara (auditoria de segurança, rodada 2). Os prazos abaixo têm folga larga; no código antigo, estes casos levavam de 11 s a 37 s.
 */
const run = (text: string, x: number, y: number): PdfRun => ({ text, x, y, width: text.length * 5, fontSize: 10, bold: false, mono: false, rotated: false, hint: null })
const page = (overrides: Partial<PdfPageLayout>): PdfPageLayout => ({ page: 1, width: 595, height: 842, runs: [], rules: [], imageShare: 0, imageCount: 0, drawnPaths: 0, tagged: false, ...overrides })

/** Grade de `lines` traços em cada direção, todos se cruzando. */
function crossingGrid(lines: number, origin = 0, gap = 4): PdfRule[] {
  const span = { from: origin, to: origin + (lines - 1) * gap }
  return [
    ...Array.from({ length: lines }, (_, index): PdfRule => ({ orientation: "H", at: origin + index * gap, ...span })),
    ...Array.from({ length: lines }, (_, index): PdfRule => ({ orientation: "V", at: origin + index * gap, ...span })),
  ]
}

describe("PDF → Markdown — custo limitado na thread da API", () => {
  it("grade de 4.000 traços que se cruzam sai em menos de 1 s (antes: 37 s) e, gigante demais para ser tabela, fica como texto", () => {
    const rules = crossingGrid(2_000)
    const started = performance.now()
    const { tables } = ruledTables(rules, [run("célula", 6, 6)])
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(tables).toEqual([])
    const markdownStarted = performance.now()
    expect(pdfLayoutToMarkdown([page({ rules, runs: [run("célula", 6, 6)], drawnPaths: rules.length })]).markdown).toContain("célula")
    expect(performance.now() - markdownStarted).toBeLessThan(1_000)
  })

  it("duas grades separadas continuam duas tabelas (a união dos traços não junta o que não se toca)", () => {
    const rules = [...crossingGrid(3, 50, 40), ...crossingGrid(3, 300, 40)]
    const runs = [run("A", 55, 75), run("B", 95, 75), run("C", 55, 115), run("D", 95, 115), run("E", 305, 325), run("F", 345, 325), run("G", 305, 365), run("H", 345, 365)]
    const { tables } = ruledTables(rules, runs)
    expect(tables.map((table) => table.rows)).toEqual([[["A", "B"], ["C", "D"]], [["E", "F"], ["G", "H"]]])
  })

  it("largura de página absurda no MediaBox (1e9) não faz a procura de colunas andar por ela (antes: 11 s)", () => {
    const rows = (width: number) => Array.from({ length: 6 }, (_, index) => [run("texto da coluna esquerda", 10, 20 + index * 14), run("texto da coluna direita", width * 0.8, 20 + index * 14)]).flat()
    const started = performance.now()
    const lines = buildLines({ page: 1, width: 1e9 }, rows(1e9))
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(lines).toHaveLength(12)
    expect(buildLines({ page: 1, width: Number.POSITIVE_INFINITY }, rows(600))).toHaveLength(6)
  })
})
