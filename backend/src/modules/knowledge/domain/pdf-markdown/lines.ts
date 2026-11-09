import type { PdfPageLayout, PdfRun, PdfRunHint } from "./layout.js"

/**
 * Das peças de texto às LINHAS da página, na ordem de leitura. Uma linha pode ter mais de um fragmento quando há um vão largo entre
 * eles (células alinhadas ou colunas). Duas colunas de texto corrido só são lidas coluna por coluna quando os dois lados parecem
 * prosa; em dúvida, fica a ordem de cima para baixo, sem separar nada.
 */
export type Fragment = { text: string; x0: number; x1: number; y: number; fontSize: number; bold: boolean; mono: boolean; hint: PdfRunHint | null }

export type Line = {
  page: number
  fragments: Fragment[]
  y: number
  x0: number
  x1: number
  fontSize: number
  bold: boolean
  mono: boolean
  /** A margem direita do bloco onde a linha está: é o que diz se ela terminou por falta de espaço. */
  blockRight: number
  /** Primeira linha depois de uma troca de coluna: nunca continua o parágrafo anterior. */
  columnStart: boolean
  text: string
}

const WIDE_GAP_EM = 1.5
const MIN_WIDE_GAP = 9

export const normalizeSpaces = (text: string) => text.replace(/\u00ad/g, "").replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\.(?:\s?\.){3,}/g, " ... ").replace(/\s+/g, " ").trim()

/** A maior parte dos caracteres cumpre `pick`? Sem texto, não. */
function dominant(runs: readonly PdfRun[], pick: (run: PdfRun) => boolean): boolean {
  const total = runs.reduce((sum, run) => sum + run.text.length, 0)
  return total > 0 && runs.filter(pick).reduce((sum, run) => sum + run.text.length, 0) / total >= 0.9
}

function dominantSize(runs: readonly PdfRun[]): number {
  const bySize = new Map<number, number>()
  for (const run of runs) bySize.set(run.fontSize, (bySize.get(run.fontSize) ?? 0) + run.text.length)
  return [...bySize.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0
}

function fragmentOf(runs: readonly PdfRun[]): Fragment | null {
  let text = ""
  let right = runs[0]?.x ?? 0
  for (const run of runs) {
    const gap = run.x - right
    if (text && gap > run.fontSize * 0.18 && !/\s$/.test(text) && !/^\s/.test(run.text)) text += " "
    text += run.text
    // O pdf.js preenche o vão entre dois textos com um "espaço" da largura do vão: ele não conta como texto até ali.
    if (run.text.trim()) right = Math.max(right, run.x + run.width)
  }
  const clean = normalizeSpaces(text)
  if (!clean) return null
  const first = runs[0]!
  return { text: clean, x0: first.x, x1: right, y: first.y, fontSize: dominantSize(runs), bold: dominant(runs, (run) => run.bold), mono: dominant(runs, (run) => run.mono), hint: runs.find((run) => run.hint)?.hint ?? null }
}

/** Mesma peça desenhada duas vezes quase no mesmo lugar: é o truque do "falso negrito", não dois textos. */
const isOverprint = (previous: PdfRun, run: PdfRun) => previous.text === run.text && Math.abs(previous.x - run.x) < Math.max(1.5, run.fontSize * 0.15) && Math.abs(previous.y - run.y) < 1.5

/** Marcador sozinho antes do texto ("•", "1.", "a)"): o vão é o recuo da lista, não uma coluna. Sem isto, uma lista bem recuada pareceria uma tabela. */
const LONE_MARKER = /^(?:[•·▪▫◦●○■□‣⁃∙➢➤►▶✓✔☐☑☒\-–—*]|[\uE000-\uF8FF]|\d{1,3}[.)]|[a-zA-Z][.)]|[ivx]{1,4}\))$/u

function joinMarker(fragments: Fragment[]): Fragment[] {
  const [first, second, ...rest] = fragments
  if (!first || !second || !LONE_MARKER.test(first.text)) return fragments
  return [{ ...second, text: `${first.text} ${second.text}`, x0: first.x0 }, ...rest]
}

/** Agrupa pela linha de base e corta nos vãos largos. */
export function buildRows(runs: readonly PdfRun[]): Fragment[][] {
  const sorted = runs.filter((run) => run.text.length > 0).map((run, index) => ({ run, index })).sort((left, right) => left.run.y - right.run.y || left.index - right.index)
  const rows: PdfRun[][] = []
  let rowY = 0
  let rowSize = 0
  for (const { run } of sorted) {
    const current = rows[rows.length - 1]
    if (current && Math.abs(run.y - rowY) <= 0.4 * Math.max(rowSize, run.fontSize)) {
      current.push(run)
      if (run.fontSize > rowSize) {
        rowSize = run.fontSize
        rowY = run.y
      }
      continue
    }
    rows.push([run])
    rowY = run.y
    rowSize = run.fontSize
  }
  return rows.flatMap((row) => {
    const ordered = [...row].sort((left, right) => left.x - right.x)
    const fragments: Fragment[] = []
    let group: PdfRun[] = []
    let right = 0
    const flush = () => {
      const fragment = group.length > 0 ? fragmentOf(group) : null
      if (fragment) fragments.push(fragment)
      group = []
    }
    for (const run of ordered) {
      const previous = group[group.length - 1]
      if (previous && isOverprint(previous, run)) continue
      if (!run.text.trim()) {
        if (group.length > 0) group.push(run)
        continue
      }
      if (group.length > 0 && run.x - right > Math.max(run.fontSize * WIDE_GAP_EM, MIN_WIDE_GAP)) flush()
      group.push(run)
      right = Math.max(right, run.x + run.width)
    }
    flush()
    return fragments.length > 0 ? [joinMarker(fragments)] : []
  })
}

/** Uma coluna de prosa: a maioria das linhas ocupa boa parte da largura disponível. Listas e células curtas não passam nesta conta. */
function looksLikeProse(fragments: readonly Fragment[]): boolean {
  if (fragments.length < 4) return false
  const left = Math.min(...fragments.map((fragment) => fragment.x0))
  const right = Math.max(...fragments.map((fragment) => fragment.x1))
  const width = right - left
  if (width <= 0) return false
  return fragments.filter((fragment) => fragment.x1 - fragment.x0 >= width * 0.7).length / fragments.length >= 0.6
}

const crosses = (fragment: Fragment, x: number) => fragment.x0 < x - 1 && fragment.x1 > x + 1

/** O melhor corredor vertical no miolo da página: o x que menos linhas atravessam. */
function bestGutter(rows: readonly Fragment[][], width: number): number | null {
  const bothSides = rows.filter((row) => row.length >= 2)
  if (bothSides.length < 4) return null
  let best: { x: number; crossings: number } | null = null
  for (let x = Math.round(width * 0.3); x <= width * 0.7; x += 2) {
    const crossings = rows.filter((row) => row.some((fragment) => crosses(fragment, x))).length
    if (!best || crossings < best.crossings) best = { x, crossings }
  }
  if (!best) return null
  // O vão real: o centro do corredor vazio em volta do melhor ponto.
  let from = best.x
  let to = best.x
  while (from > width * 0.2 && rows.filter((row) => row.some((fragment) => crosses(fragment, from - 2))).length === best.crossings) from -= 2
  while (to < width * 0.8 && rows.filter((row) => row.some((fragment) => crosses(fragment, to + 2))).length === best.crossings) to += 2
  return (from + to) / 2
}

type Ordered = { row: Fragment[]; columnStart: boolean }

/** Trechos da página separados pelas linhas que cruzam o corredor (título ou nota em largura total). Cada trecho vira colunas ou fica como está. */
function orderRows(rows: readonly Fragment[][], width: number): Ordered[] {
  const gutter = bestGutter(rows, width)
  const plain = (list: readonly Fragment[][]): Ordered[] => list.map((row) => ({ row, columnStart: false }))
  if (gutter === null) return plain(rows)
  const ordered: Ordered[] = []
  let zone: Fragment[][] = []
  const flushZone = () => {
    if (zone.length === 0) return
    const sides = { left: zone.flatMap((row) => row.filter((fragment) => fragment.x1 <= gutter + 1)), right: zone.flatMap((row) => row.filter((fragment) => fragment.x0 >= gutter - 1)) }
    const twoColumns = looksLikeProse(sides.left) && looksLikeProse(sides.right) && zone.filter((row) => row.length >= 2).length >= zone.length * 0.3
    if (twoColumns) {
      sides.left.forEach((fragment, index) => ordered.push({ row: [fragment], columnStart: index === 0 }))
      sides.right.forEach((fragment, index) => ordered.push({ row: [fragment], columnStart: index === 0 }))
    } else {
      ordered.push(...plain(zone))
    }
    zone = []
  }
  for (const row of rows) {
    if (row.some((fragment) => crosses(fragment, gutter))) {
      flushZone()
      ordered.push({ row, columnStart: true })
      continue
    }
    zone.push(row)
  }
  flushZone()
  return ordered
}

function toLine(page: number, { row, columnStart }: Ordered): Line {
  const first = row[0]!
  const last = row[row.length - 1]!
  return {
    page,
    fragments: row,
    y: first.y,
    x0: first.x0,
    x1: last.x1,
    fontSize: Math.max(...row.map((fragment) => fragment.fontSize)),
    bold: row.every((fragment) => fragment.bold),
    mono: row.every((fragment) => fragment.mono),
    blockRight: last.x1,
    columnStart,
    // Tabulação entre fragmentos: o vão existe no arquivo, e nada aqui afirma que seja uma célula.
    text: row.map((fragment) => fragment.text).join("\t"),
  }
}

/** A margem direita de cada sequência de linhas sem troca de coluna. */
function assignBlockRight(lines: Line[]): Line[] {
  let start = 0
  const close = (end: number) => {
    const right = Math.max(...lines.slice(start, end).map((line) => line.x1))
    for (let index = start; index < end; index += 1) lines[index]!.blockRight = right
  }
  lines.forEach((line, index) => {
    if (line.columnStart && index > start) {
      close(index)
      start = index
    }
  })
  if (lines.length > start) close(lines.length)
  return lines
}

export function buildLines(layout: Pick<PdfPageLayout, "page" | "width">, runs: readonly PdfRun[]): Line[] {
  const flat = runs.filter((run) => !run.rotated)
  const rotated = runs.filter((run) => run.rotated)
  const lines = assignBlockRight(orderRows(buildRows(flat), layout.width).map((entry) => toLine(layout.page, entry)))
  // Texto girado vai para o fim da página, um por linha: não entra no meio do que está na horizontal.
  for (const run of rotated) {
    const fragment = fragmentOf([run])
    if (fragment) lines.push({ ...toLine(layout.page, { row: [fragment], columnStart: true }), blockRight: fragment.x1 })
  }
  return lines
}
