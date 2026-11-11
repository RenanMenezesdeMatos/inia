import type { PdfRule, PdfRun } from "./layout.js"
import { minOf, normalizeSpaces, type Line } from "./lines.js"

/**
 * TABELAS. Só vira tabela o que o arquivo sustenta: as tags do PDF, uma grade desenhada ou colunas alinhadas em várias linhas seguidas.
 * Célula vazia fica vazia, célula mesclada aparece na primeira coluna dela, e o que não fecha nesses critérios continua como texto.
 */
export type TableBlock = { y: number; x: number; rows: string[][]; header: string[] | null }

/** Texto de uma célula: pelas linhas de base, de cima para baixo. */
function cellText(runs: readonly PdfRun[]): string {
  const sorted = runs.filter((run) => run.text.trim()).map((run, index) => ({ run, index })).sort((left, right) => (Math.abs(left.run.y - right.run.y) < 2 ? left.run.x - right.run.x || left.index - right.index : left.run.y - right.run.y))
  let text = ""
  let previous: PdfRun | null = null
  for (const { run } of sorted) {
    if (previous && !/\s$/.test(text) && !/^\s/.test(run.text)) {
      const newLine = Math.abs(run.y - previous.y) >= 2
      if (newLine || run.x - (previous.x + previous.width) > run.fontSize * 0.18) text += " "
    }
    text += run.text
    previous = run
  }
  return normalizeSpaces(text)
}

function trimEmptyColumns(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((row) => row.length))
  const keep = Array.from({ length: width }, (_, column) => rows.some((row) => (row[column] ?? "").length > 0))
  return rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? "").filter((_, column) => keep[column]))
}

/** Grade de verdade: ao menos 2 linhas e 2 colunas, com mais de uma linha usando mais de uma coluna. Caixa de diagrama não passa. */
const isRealGrid = (rows: readonly string[][]) => rows.length >= 2 && (rows[0]?.length ?? 0) >= 2 && rows.filter((row) => row.filter(Boolean).length >= 2).length >= 2

/** Tabelas declaradas nas tags do PDF. O que não fecha como grade volta para o texto corrido. */
export function taggedTables(runs: readonly PdfRun[]): { tables: TableBlock[]; used: Set<PdfRun> } {
  const groups = new Map<string, PdfRun[]>()
  for (const run of runs) {
    if (run.hint?.kind !== "TABLE_CELL" || run.rotated) continue
    const group = groups.get(run.hint.tableId) ?? []
    group.push(run)
    groups.set(run.hint.tableId, group)
  }
  const tables: TableBlock[] = []
  const used = new Set<PdfRun>()
  for (const group of groups.values()) {
    const byRow = new Map<number, Map<number, PdfRun[]>>()
    const headerRows = new Set<number>()
    const bodyRows = new Set<number>()
    for (const run of group) {
      if (run.hint?.kind !== "TABLE_CELL") continue
      const row = byRow.get(run.hint.row) ?? new Map<number, PdfRun[]>()
      // Acumula no próprio array (linear): espalhar a cada execução era quadrático numa célula cheia (auditoria run-3 C03).
      const bucket = row.get(run.hint.col)
      if (bucket) bucket.push(run)
      else row.set(run.hint.col, [run])
      byRow.set(run.hint.row, row)
      if (run.hint.header) headerRows.add(run.hint.row)
      else bodyRows.add(run.hint.row)
    }
    const orderedRows = [...byRow.keys()].sort((left, right) => left - right)
    const startOf = (runs: readonly PdfRun[]) => minOf(runs, (run) => run.x)
    // A posição de cada coluna vem da linha mais completa. Célula mesclada não está nas tags como mesclada, e numa linha com menos células a ordem não diz a
    // coluna: quem diz é onde o texto começa. Sem isso, o valor iria parar sob o cabeçalho errado.
    const fullest = [...byRow.values()].reduce((best, row) => (row.size > best.size ? row : best), new Map<number, PdfRun[]>())
    const columnStarts = [...fullest.keys()].sort((left, right) => left - right).map((column) => startOf(fullest.get(column)!))
    const columnAt = (x: number) => columnStarts.reduce((best, start, index) => (Math.abs(start - x) < Math.abs(columnStarts[best]! - x) ? index : best), 0)
    const rows = orderedRows.map((rowId) => {
      const row = byRow.get(rowId)!
      const line = Array.from({ length: columnStarts.length }, () => [] as PdfRun[])
      for (const [column, runs] of [...row.entries()].sort((left, right) => left[0] - right[0])) line[row.size === columnStarts.length ? column : columnAt(startOf(runs))]!.push(...runs)
      return line.map(cellText)
    })
    const cleaned = trimEmptyColumns(rows).filter((row) => row.some(Boolean))
    if (!isRealGrid(cleaned)) continue
    for (const run of group) used.add(run)
    const firstIsHeader = orderedRows[0] !== undefined && headerRows.has(orderedRows[0]) && !bodyRows.has(orderedRows[0])
    tables.push({ y: minOf(group, (run) => run.y), x: minOf(group, (run) => run.x), rows: firstIsHeader ? cleaned.slice(1) : cleaned, header: firstIsHeader ? cleaned[0]! : null })
  }
  return { tables, used }
}

const snap = (values: readonly number[], tolerance: number): number[] => {
  const unique: number[] = []
  for (const value of [...values].sort((left, right) => left - right)) {
    const last = unique[unique.length - 1]
    if (last === undefined || value - last > tolerance) unique.push(value)
  }
  return unique
}

/** Grupos de traços que se tocam: cada grupo é uma tabela candidata. */
function connectedRules(rules: readonly PdfRule[]): PdfRule[][] {
  const horizontals = rules.flatMap((rule, index) => (rule.orientation === "H" ? [index] : []))
  const verticals = rules.flatMap((rule, index) => (rule.orientation === "V" ? [index] : []))
  const touches = (h: PdfRule, v: PdfRule) => v.at >= h.from - 2.5 && v.at <= h.to + 2.5 && h.at >= v.from - 2.5 && h.at <= v.to + 2.5
  // União com compressão de caminho e por tamanho, sobre índices: cada consulta é quase constante. Sem isso, uma grade de 4.000 traços levava 37 s
  // na thread da API.
  const parent = Int32Array.from(rules, (_, index) => index)
  const size = new Int32Array(rules.length).fill(1)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]!
    for (let node = index; node !== root; ) {
      const up = parent[node]!
      parent[node] = root
      node = up
    }
    return root
  }
  for (const h of horizontals) {
    for (const v of verticals) {
      if (!touches(rules[h]!, rules[v]!)) continue
      const [a, b] = [find(h), find(v)]
      if (a === b) continue
      const [big, small] = size[a]! >= size[b]! ? [a, b] : [b, a]
      parent[small] = big
      size[big]! += size[small]!
    }
  }
  const groups = new Map<number, PdfRule[]>()
  rules.forEach((rule, index) => {
    const root = find(index)
    const group = groups.get(root)
    if (group) group.push(rule)
    else groups.set(root, [rule])
  })
  return [...groups.values()]
}

const MAX_RULES = 4_000
/** Grade com mais células que isso não é tabela de documento (uma página cheia tem poucas centenas): vira texto, e a conta fica limitada. */
const MAX_GRID_CELLS = 10_000

/** Tabelas com grade desenhada (bordas em linha ou em retângulo fino, como sai do Word). Linha de texto cai na célula pela posição. */
export function ruledTables(rules: readonly PdfRule[], runs: readonly PdfRun[]): { tables: TableBlock[]; used: Set<PdfRun> } {
  const tables: TableBlock[] = []
  const used = new Set<PdfRun>()
  if (rules.length === 0 || rules.length > MAX_RULES) return { tables, used }
  for (const group of connectedRules(rules)) {
    const xs = snap(group.filter((rule) => rule.orientation === "V").map((rule) => rule.at), 3)
    const ys = snap(group.filter((rule) => rule.orientation === "H").map((rule) => rule.at), 3)
    if (xs.length < 3 || ys.length < 3 || (xs.length - 1) * (ys.length - 1) > MAX_GRID_CELLS) continue
    const left = xs[0]!
    const right = xs[xs.length - 1]!
    const top = ys[0]!
    const bottom = ys[ys.length - 1]!
    const inside = runs.filter((run) => !run.rotated && !run.hint && run.text.trim() && run.x >= left - 1 && run.x <= right + 1 && run.y >= top - 1 && run.y <= bottom + 1)
    const cells = new Map<string, PdfRun[]>()
    for (const run of inside) {
      // A linha de base fica dentro da célula, e o começo do texto diz a coluna.
      const row = ys.findIndex((y, index) => index + 1 < ys.length && run.y >= y - 1 && run.y < ys[index + 1]! - 0.5)
      const column = xs.findIndex((x, index) => index + 1 < xs.length && run.x >= x - 1 && run.x < xs[index + 1]! - 0.5)
      if (row < 0 || column < 0) continue
      const key = `${row}:${column}`
      const cell = cells.get(key)
      if (cell) cell.push(run)
      else cells.set(key, [run])
    }
    const raw = Array.from({ length: ys.length - 1 }, (_, row) => Array.from({ length: xs.length - 1 }, (_, column) => cellText(cells.get(`${row}:${column}`) ?? [])))
    const rows = trimEmptyColumns(raw).filter((row) => row.some(Boolean))
    if (!isRealGrid(rows)) continue
    for (const run of inside) used.add(run)
    // A primeira linha só é cabeçalho se o arquivo a distingue: toda em negrito, com o resto da tabela sem negrito.
    const firstRow = raw.findIndex((row) => row.some(Boolean))
    const firstRowRuns = [...cells.entries()].filter(([key]) => key.startsWith(`${firstRow}:`)).flatMap(([, value]) => value).filter((run) => run.text.trim())
    const firstBold = firstRowRuns.length > 0 && firstRowRuns.every((run) => run.bold) && inside.some((run) => run.text.trim() && !run.bold)
    tables.push({ y: top, x: left, rows: firstBold ? rows.slice(1) : rows, header: firstBold ? rows[0]! : null })
  }
  return { tables, used }
}

const ALIGN_TOLERANCE = 4
const MIN_ALIGNED_ROWS = 3

function alignsWith(line: Line, anchors: Line["fragments"]): boolean {
  if (line.fragments.length !== anchors.length) return false
  return line.fragments.every((fragment, index) => {
    const anchor = anchors[index]!
    return Math.abs(fragment.x0 - anchor.x0) <= ALIGN_TOLERANCE || Math.abs(fragment.x1 - anchor.x1) <= ALIGN_TOLERANCE
  })
}

/** A continuação de uma célula que não é a primeira: uma peça só, alinhada a uma coluna depois da primeira. Na primeira coluna, a dúvida fica como texto. */
function continuationColumn(line: Line, anchors: Line["fragments"]): number {
  if (line.fragments.length !== 1) return -1
  const fragment = line.fragments[0]!
  for (let column = 1; column < anchors.length; column += 1) if (Math.abs(fragment.x0 - anchors[column]!.x0) <= ALIGN_TOLERANCE) return column
  return -1
}

export type AlignedSpan = { start: number; end: number; table: TableBlock }

/** Colunas alinhadas sem grade: ao menos 3 linhas seguidas com o mesmo número de peças nas mesmas posições. */
export function alignedTables(lines: readonly Line[]): AlignedSpan[] {
  const spans: AlignedSpan[] = []
  let index = 0
  while (index < lines.length) {
    const first = lines[index]!
    if (first.fragments.length < 2 || first.fragments.some((fragment) => fragment.hint?.kind === "HEADING")) {
      index += 1
      continue
    }
    const anchors = first.fragments
    const rows: string[][] = [anchors.map((fragment) => fragment.text)]
    let fullRows = 1
    let cursor = index + 1
    let end = index + 1
    while (cursor < lines.length) {
      const line = lines[cursor]!
      const previous = lines[cursor - 1]!
      if (line.y - previous.y > Math.max(line.fontSize, previous.fontSize) * 3 || line.y < previous.y) break
      if (alignsWith(line, anchors)) {
        rows.push(line.fragments.map((fragment) => fragment.text))
        fullRows += 1
        cursor += 1
        end = cursor
        continue
      }
      const column = continuationColumn(line, anchors)
      if (column < 0) break
      const last = rows[rows.length - 1]!
      last[column] = `${last[column]} ${line.fragments[0]!.text}`
      cursor += 1
      end = cursor
    }
    if (fullRows >= MIN_ALIGNED_ROWS) {
      const firstBold = first.fragments.every((fragment) => fragment.bold) && lines.slice(index + 1, end).some((line) => !line.bold)
      spans.push({ start: index, end, table: { y: first.y, x: first.x0, rows: firstBold ? rows.slice(1) : rows, header: firstBold ? rows[0]! : null } })
      index = end
      continue
    }
    index += 1
  }
  return spans
}
