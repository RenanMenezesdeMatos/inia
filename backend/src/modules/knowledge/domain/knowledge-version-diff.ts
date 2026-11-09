/**
 * Comparação de duas versões de uma base (PEN-008): puro, sem banco. O texto é comparado linha a linha (subsequência comum mais
 * longa), e uma linha removida seguida de uma adicionada no mesmo ponto vira "alterada", para a visão lado a lado. Linha em branco não é
 * conteúdo e fica de fora: o mesmo texto extraído de PDF e de DOCX só difere nos parágrafos, e cada um deles viraria uma diferença falsa. O
 * número de cada linha continua sendo o do texto original.
 */
export type TextDiffRow =
  | { kind: "UNCHANGED"; leftLine: number; rightLine: number; left: string; right: string }
  | { kind: "ADDED"; rightLine: number; right: string }
  | { kind: "REMOVED"; leftLine: number; left: string }
  | { kind: "CHANGED"; leftLine: number; rightLine: number; left: string; right: string }

export type TextDiff = { rows: TextDiffRow[]; added: number; removed: number; changed: number; unchanged: number }

/** Teto da tabela da comparação (linhas diferentes × linhas diferentes): além disso a comparação não é feita, e a tela diz isso. */
export const MAX_DIFF_CELLS = 16_000_000

type Lines = { text: string[]; number: number[] }
function linesOf(content: string): Lines {
  const lines: Lines = { text: [], number: [] }
  content.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    const text = line.trimEnd()
    if (text === "") return
    lines.text.push(text)
    lines.number.push(index + 1)
  })
  return lines
}

/** null = grande demais para comparar dentro do teto. */
export function diffText(left: string, right: string, maxCells: number = MAX_DIFF_CELLS): TextDiff | null {
  const { text: a, number: leftNumber } = linesOf(left)
  const { text: b, number: rightNumber } = linesOf(right)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const n = endA - start
  const m = endB - start
  if (n * m > maxCells) return null
  // Tabela da subsequência comum mais longa do trecho que difere (o começo e o fim iguais ficam de fora).
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[start + i] === b[start + j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const rows: TextDiffRow[] = []
  const unchangedRow = (leftIndex: number, rightIndex: number): TextDiffRow => ({ kind: "UNCHANGED", leftLine: leftNumber[leftIndex]!, rightLine: rightNumber[rightIndex]!, left: a[leftIndex]!, right: b[rightIndex]! })
  for (let index = 0; index < start; index += 1) rows.push(unchangedRow(index, index))
  // Blocos de diferença: as remoções e adições do mesmo ponto são pareadas como alteração, na ordem.
  let removed: number[] = []
  let added: number[] = []
  const flush = () => {
    const pairs = Math.min(removed.length, added.length)
    for (let index = 0; index < pairs; index += 1) rows.push({ kind: "CHANGED", leftLine: leftNumber[removed[index]!]!, rightLine: rightNumber[added[index]!]!, left: a[removed[index]!]!, right: b[added[index]!]! })
    for (const leftIndex of removed.slice(pairs)) rows.push({ kind: "REMOVED", leftLine: leftNumber[leftIndex]!, left: a[leftIndex]! })
    for (const rightIndex of added.slice(pairs)) rows.push({ kind: "ADDED", rightLine: rightNumber[rightIndex]!, right: b[rightIndex]! })
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush()
      rows.push(unchangedRow(start + i, start + j))
      i += 1
      j += 1
    } else if (j >= m || (i < n && table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      removed.push(start + i)
      i += 1
    } else {
      added.push(start + j)
      j += 1
    }
  }
  flush()
  for (let offset = 0; offset < a.length - endA; offset += 1) rows.push(unchangedRow(endA + offset, endB + offset))
  const count = (kind: TextDiffRow["kind"]) => rows.filter((row) => row.kind === kind).length
  return { rows, added: count("ADDED"), removed: count("REMOVED"), changed: count("CHANGED"), unchanged: count("UNCHANGED") }
}

export type WordDiff = { words: number; onlyInFrom: number; onlyInTo: number; examplesFrom: string[]; examplesTo: string[] }

const MAX_WORD_EXAMPLES = 12

/**
 * Compara só as PALAVRAS, em qualquer ordem e posição: reconverter o mesmo arquivo muda quebras de linha, títulos e tabelas, e a comparação por
 * linha acusaria quase tudo. Aqui fica o que interessa saber: se algum texto entrou ou saiu. Palavra partida por hífen no fim da linha conta como uma só.
 */
export function diffWords(from: string, to: string): WordDiff {
  const counts = (text: string) => {
    const map = new Map<string, number>()
    for (const word of text.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2").toLowerCase().match(/[\p{L}\p{N}]+(?:[-,.'’/][\p{L}\p{N}]+)*/gu) ?? []) map.set(word, (map.get(word) ?? 0) + 1)
    return map
  }
  const left = counts(from)
  const right = counts(to)
  const surplus = (a: Map<string, number>, b: Map<string, number>) => {
    let total = 0
    const examples: string[] = []
    for (const [word, count] of a) {
      const extra = count - (b.get(word) ?? 0)
      if (extra <= 0) continue
      total += extra
      if (examples.length < MAX_WORD_EXAMPLES) examples.push(word)
    }
    return { total, examples }
  }
  const onlyFrom = surplus(left, right)
  const onlyTo = surplus(right, left)
  return { words: [...left.values()].reduce((sum, count) => sum + count, 0), onlyInFrom: onlyFrom.total, onlyInTo: onlyTo.total, examplesFrom: onlyFrom.examples, examplesTo: onlyTo.examples }
}

/** Uma linha da comparação de configuração: valores já em linguagem de tela. */
export type ConfigDiffRow = { field: string; label: string; kind: "ADDED" | "REMOVED" | "CHANGED"; from: string[]; to: string[] }

/** Compara um campo: conjuntos (alcance, produtos) dizem o que entrou e saiu; valor único diz de → para. */
export function diffConfigField(field: string, label: string, from: readonly string[], to: readonly string[]): ConfigDiffRow | null {
  const before = [...from].sort()
  const after = [...to].sort()
  if (before.length === after.length && before.every((value, index) => value === after[index])) return null
  const kind = before.length === 0 ? "ADDED" : after.length === 0 ? "REMOVED" : "CHANGED"
  return { field, label, kind, from: [...from], to: [...to] }
}
