import { PDF_MARKDOWN_VERSION, type PdfExtraction, type PdfImagePlacement, type PdfMarkdownResult, type PdfPageCoverage, type PdfPageImage, type PdfPageLayout, type PdfPageStatus, type PdfRun } from "./layout.js"
import { buildLines, normalizeSpaces, type Line } from "./lines.js"
import { alignedTables, ruledTables, taggedTables, type TableBlock } from "./tables.js"

/**
 * DE PDF PARA MARKDOWN — a estrutura que o arquivo sustenta, para a busca e a IA. O que vem das tags do PDF vale primeiro; sem elas, a
 * aparência (tamanho e peso da fonte, recuo, marcador, grade desenhada). Na dúvida, o texto fica na melhor ordem disponível, sem título,
 * célula ou item inventado. O arquivo original nunca muda, e a página de origem fica no registro da conversão (`extraction.pages[].offset`),
 * fora do texto: quem lê `content` recebe Markdown limpo, como em qualquer base.
 */
/** De onde o bloco veio na página: é o que diz em que ponto do texto cada imagem entra. `item` = o item da lista; os outros blocos têm uma marca só. */
type Mark = { page: number; y: number; left: number; right: number; item: number | null }

type Block = { marks: Mark[] } & (
  | { kind: "heading"; page: number; level: number | null; size: number; text: string }
  | { kind: "paragraph"; page: number; text: string; pieces: { page: number; at: number }[]; size: number; lastFills: boolean }
  | { kind: "list"; page: number; items: { depth: number; marker: string; text: string }[] }
  | { kind: "code"; page: number; lines: string[] }
  | { kind: "table"; page: number; table: TableBlock; pieces: { page: number; rowIndex: number }[] }
)

const BULLET = /^(?:[•·▪▫◦●○■□‣⁃∙➢➤►▶✓✔\-–—*]|[\uE000-\uF8FF])\s+/u
const CHECKBOX = /^[☐☑☒]\s+/u
const NUMBERED = /^(\d{1,3}[.)])\s+/
const LETTERED = /^([a-z]\)|[a-z]\.|[A-Z]\)|[ivx]{1,4}\))\s+/
const LETTER = /\p{L}/u
const SENTENCE_END = /[.;:!?…]$/u
/** Linha de sumário ("Seção ... 12"): nunca se junta à seguinte, mesmo ocupando a largura toda. */
const TOC_ENTRY = / \.\.\. /

/** Tamanho de fonte da maior parte do texto do documento. */
function bodySizeOf(pages: readonly PdfPageLayout[]): number {
  const bySize = new Map<number, number>()
  for (const page of pages) for (const run of page.runs) {
    const size = Math.round(run.fontSize * 2) / 2
    bySize.set(size, (bySize.get(size) ?? 0) + run.text.trim().length)
  }
  return [...bySize.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0
}

const repeatedKey = (text: string) => normalizeSpaces(text).toLowerCase().replace(/\d+/g, "#")
const inMargin = (line: Line, height: number) => line.y <= height * 0.1 || line.y >= height * 0.9
const onlyPageNumber = (text: string) => /^\W*\d{1,4}\W*$/.test(text)

/**
 * Cabeçalho e rodapé: o mesmo texto na margem em ao menos metade das páginas (mínimo de 3). Com número variável ("Página 3 de 9") sai
 * sempre; o texto fixo fica na primeira ocorrência, para nenhuma informação sumir do documento.
 */
function findRepeatedLines(pages: readonly { lines: Line[]; height: number }[]): { isRepeated: (line: Line, firstSeen: Set<string>) => boolean } {
  const counts = new Map<string, number>()
  for (const page of pages) {
    const seen = new Set<string>()
    for (const line of page.lines) if (inMargin(line, page.height)) seen.add(repeatedKey(line.text))
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const half = Math.ceil(pages.filter((page) => page.lines.length > 0).length * 0.5)
  return {
    isRepeated: (line, firstSeen) => {
      const key = repeatedKey(line.text)
      const count = counts.get(key) ?? 0
      // Com número que muda ("Página 3 de 9"), duas páginas já mostram o padrão; texto fixo pede ao menos três.
      if (count < Math.max(key.includes("#") ? 2 : 3, half)) return false
      if (key.includes("#")) return true
      if (firstSeen.has(key)) return true
      firstSeen.add(key)
      return false
    },
  }
}

/** Palavras do próprio documento: é o que decide se o hífen no fim da linha era só a quebra da palavra. */
function vocabularyOf(pages: readonly PdfPageLayout[]): Set<string> {
  const words = new Set<string>()
  for (const page of pages) for (const run of page.runs) for (const word of run.text.toLowerCase().match(/\p{L}+(?:-\p{L}+)*/gu) ?? []) words.add(word)
  return words
}

/** Junta a linha quebrada: palavra partida só perde o hífen quando o documento usa a forma inteira em outro lugar. */
function joinWrapped(left: string, right: string, vocabulary: ReadonlySet<string>): string {
  const match = /(\p{L}+)-$/u.exec(left)
  const next = /^(\p{Ll}+)/u.exec(right)
  if (match && next) {
    const whole = `${match[1]}${next[1]}`.toLowerCase()
    return vocabulary.has(whole) ? `${left.slice(0, -1)}${right}` : `${left}${right}`
  }
  return `${left} ${right}`
}

const headingHintOf = (line: Line) => line.fragments.find((fragment) => fragment.hint?.kind === "HEADING")?.hint ?? null
const listHintOf = (line: Line) => line.fragments.find((fragment) => fragment.hint?.kind === "LIST_ITEM")?.hint ?? null
const codeHintOf = (line: Line) => line.fragments.some((fragment) => fragment.hint?.kind === "CODE")

/** Título pela aparência, só quando o PDF não traz títulos nas tags: fonte maior que o corpo, ou negrito sozinho numa linha curta. */
function looksLikeHeading(line: Line, next: Line | null, previous: Line | null, bodySize: number): boolean {
  const text = line.text
  if (!LETTER.test(text) || text.length > 160 || line.fragments.length > 1) return false
  if (/[.;,]$/.test(text)) return false
  if (BULLET.test(text) || CHECKBOX.test(text)) return false
  if (line.fontSize >= bodySize * 1.15) return true
  if (!line.bold || line.fontSize < bodySize - 0.5 || text.length > 110 || NUMBERED.test(text) && text.length > 70) return false
  // Negrito no tamanho do corpo: precisa estar sozinho (com vão antes dele) e ser seguido de texto que não é negrito.
  const gapBefore = previous ? line.y - previous.y : Number.POSITIVE_INFINITY
  return (next ? !next.bold : true) && (gapBefore <= 0 || gapBefore >= line.fontSize * 1.3)
}

function listMarkerOf(text: string): { marker: string; rest: string } | null {
  const checkbox = CHECKBOX.exec(text)
  if (checkbox) return { marker: "-", rest: text }
  const bullet = BULLET.exec(text)
  if (bullet) return { marker: "-", rest: text.slice(bullet[0].length).trimStart() }
  const numbered = NUMBERED.exec(text)
  if (numbered) return { marker: numbered[1]!, rest: text.slice(numbered[0].length).trimStart() }
  const lettered = LETTERED.exec(text)
  // "a)" não existe em Markdown: o rótulo do documento continua no texto do item.
  if (lettered) return { marker: "-", rest: text }
  return null
}

type PageInput = { layout: PdfPageLayout; lines: Line[]; tables: TableBlock[] }

/** As linhas e tabelas de uma página viram blocos, na ordem de leitura. */
function blocksOfPage(input: PageInput, context: { bodySize: number; hasHeadingTags: boolean; monoDocument: boolean; vocabulary: ReadonlySet<string> }): Block[] {
  const { layout } = input
  const blocks: Block[] = []
  const aligned = alignedTables(input.lines)
  const spanAt = new Map(aligned.map((span) => [span.start, span]))
  const pendingTables = [...input.tables].sort((left, right) => left.y - right.y)
  const markOfLine = (line: Line, item: number | null = null): Mark => ({ page: layout.page, y: line.y, left: line.x0, right: line.blockRight, item })
  const tableBlock = (table: TableBlock): Block => ({ kind: "table", page: layout.page, table, pieces: [], marks: [{ page: layout.page, y: table.y, left: table.x, right: layout.width, item: null }] })
  const placeTablesBefore = (y: number) => {
    while (pendingTables[0] && pendingTables[0].y <= y) blocks.push(tableBlock(pendingTables.shift()!))
  }
  let index = 0
  while (index < input.lines.length) {
    const span = spanAt.get(index)
    if (span) {
      placeTablesBefore(span.table.y)
      blocks.push(tableBlock(span.table))
      index = span.end
      continue
    }
    const line = input.lines[index]!
    const previous = input.lines[index - 1] ?? null
    const next = input.lines[index + 1] ?? null
    placeTablesBefore(line.y)

    const hint = headingHintOf(line)
    if (hint?.kind === "HEADING" || (!context.hasHeadingTags && looksLikeHeading(line, next, previous, context.bodySize))) {
      let text = line.text.replace(/\t/g, " ")
      let cursor = index + 1
      // Título quebrado em duas linhas: o mesmo bloco nas tags, ou o mesmo tamanho logo abaixo pela aparência.
      while (cursor < input.lines.length) {
        const other = input.lines[cursor]!
        const otherHint = headingHintOf(other)
        const sameBlock = hint?.kind === "HEADING" ? otherHint?.kind === "HEADING" && otherHint.blockId === hint.blockId : !context.hasHeadingTags && Math.abs(other.fontSize - line.fontSize) < 0.3 && other.bold === line.bold && other.y - input.lines[cursor - 1]!.y <= line.fontSize * 1.5 && other.y > input.lines[cursor - 1]!.y && line.fontSize >= context.bodySize * 1.15 && looksLikeHeading(other, input.lines[cursor + 1] ?? null, null, context.bodySize)
        if (!sameBlock) break
        text = `${text} ${other.text.replace(/\t/g, " ")}`
        cursor += 1
      }
      blocks.push({ kind: "heading", page: layout.page, level: hint?.kind === "HEADING" ? hint.level : null, size: line.bold ? line.fontSize + 0.01 : line.fontSize, text, marks: [markOfLine(line)] })
      index = cursor
      continue
    }

    // Bloco de código: o PDF declara, ou ao menos duas linhas seguidas em fonte monoespaçada. Rótulo solto nessa fonte continua texto.
    const isCode = !context.monoDocument && line.mono && (codeHintOf(line) || Boolean(next?.mono) || Boolean(previous?.mono))
    if (isCode) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === "code") last.lines.push(line.text.replace(/\t/g, "    "))
      else blocks.push({ kind: "code", page: layout.page, lines: [line.text.replace(/\t/g, "    ")], marks: [markOfLine(line)] })
      index += 1
      continue
    }

    const hintedItem = listHintOf(line)
    const marker = listMarkerOf(line.text.replace(/\t/g, " "))
    if (marker || hintedItem?.kind === "LIST_ITEM") {
      const item = { depth: hintedItem?.kind === "LIST_ITEM" ? hintedItem.depth : 0, marker: marker?.marker ?? "-", text: marker?.rest ?? line.text.replace(/\t/g, " ") }
      const textStart = line.fragments.length > 1 ? line.fragments[1]!.x0 : line.x0 + line.fontSize
      let cursor = index + 1
      // Continuação do item: linha sem marcador, recuada até o texto do item, ou do mesmo item nas tags.
      while (cursor < input.lines.length) {
        const other = input.lines[cursor]!
        const otherText = other.text.replace(/\t/g, " ")
        const otherHint = listHintOf(other)
        const sameItem = hintedItem?.kind === "LIST_ITEM" && otherHint?.kind === "LIST_ITEM" ? otherHint.blockId === hintedItem.blockId : !otherHint && !listMarkerOf(otherText) && !headingHintOf(other) && Math.abs(other.fontSize - line.fontSize) < 0.6 && other.x0 >= textStart - 3 && other.y > input.lines[cursor - 1]!.y && other.y - input.lines[cursor - 1]!.y <= line.fontSize * 1.7
        if (!sameItem || listMarkerOf(otherText) && hintedItem?.kind !== "LIST_ITEM") break
        item.text = joinWrapped(item.text, otherText, context.vocabulary)
        cursor += 1
      }
      const last = blocks[blocks.length - 1]
      const baseX = last?.kind === "list" && previous ? previous.x0 : line.x0
      if (!hintedItem && last?.kind === "list" && line.x0 > baseX + 8 && last.items.length > 0) item.depth = Math.min(last.items[last.items.length - 1]!.depth + 1, 3)
      if (last?.kind === "list") {
        last.marks.push(markOfLine(line, last.items.length))
        last.items.push(item)
      } else blocks.push({ kind: "list", page: layout.page, items: [item], marks: [markOfLine(line, 0)] })
      index = cursor
      continue
    }

    // Parágrafo: linhas seguidas, mesmo tamanho, vão normal. Linha que terminou porque a palavra seguinte não cabia se junta à seguinte; a que
    // acabou antes disso mantém a quebra do documento. Palavra partida por hífen sempre se junta.
    const fills = (candidate: Line, following: Line | null) => {
      const firstWord = following?.text.split(/\s/, 1)[0] ?? ""
      const room = candidate.blockRight - candidate.x1
      // Bloco estreito (lista de nomes, formulário) não é prova de quebra automática: todas as linhas parecem cheias só porque são curtas.
      const wideBlock = candidate.blockRight - candidate.x0 >= layout.width * 0.35
      return (wideBlock && room <= (firstWord.length + 1) * candidate.fontSize * 0.55) || (Boolean(following) && /\p{L}-$/u.test(candidate.text) && /^\p{Ll}/u.test(following!.text))
    }
    let text = line.text
    let cursor = index + 1
    let tail = line
    while (cursor < input.lines.length) {
      const other = input.lines[cursor]!
      if (spanAt.has(cursor) || other.columnStart || other.fragments.length > 1 || tail.fragments.length > 1) break
      const gap = other.y - tail.y
      if (gap <= 0 || gap > tail.fontSize * 1.7 || Math.abs(other.fontSize - tail.fontSize) > 0.6) break
      if (headingHintOf(other) || (!context.hasHeadingTags && looksLikeHeading(other, input.lines[cursor + 1] ?? null, tail, context.bodySize))) break
      if (listMarkerOf(other.text) || listHintOf(other) || (!context.monoDocument && other.mono)) break
      if (TOC_ENTRY.test(tail.text) || TOC_ENTRY.test(other.text)) {
        text = `${text}\n${other.text}`
        tail = other
        cursor += 1
        continue
      }
      if (pendingTables[0] && pendingTables[0].y <= other.y) break
      text = fills(tail, other) ? joinWrapped(text, other.text, context.vocabulary) : `${text}\n${other.text}`
      tail = other
      cursor += 1
    }
    blocks.push({ kind: "paragraph", page: layout.page, text, pieces: [], size: line.fontSize, lastFills: tail.x1 >= tail.blockRight - tail.fontSize * 4, marks: [markOfLine(line)] })
    index = cursor
  }
  placeTablesBefore(Number.POSITIVE_INFINITY)
  return blocks
}

const lettersOf = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length
const unreadableShare = (runs: readonly PdfRun[]) => {
  const text = runs.map((run) => run.text).join("").replace(/\s/g, "")
  if (text.length < 20) return 0
  let unreadable = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x20 || code === 0xfffd || (code >= 0xe000 && code <= 0xf8ff)) unreadable += 1
  }
  return unreadable / text.length
}

function classify(layout: PdfPageLayout, runs: readonly PdfRun[], chars: number): PdfPageStatus {
  if (unreadableShare(runs) > 0.3) return "UNREADABLE"
  if (chars === 0) return layout.imageCount > 0 || layout.drawnPaths > 10 ? "NO_TEXT" : "BLANK"
  // Carimbo ou número de página sobre uma imagem de página inteira: é digitalizada, mesmo com esse pouco de texto.
  if (chars < 40 && layout.imageShare >= 0.5) return "NO_TEXT"
  return layout.imageShare >= 0.3 ? "PARTIAL" : "TEXT"
}

/** Última página que um bloco alcançou, contando o que já foi juntado a ele. */
const lastPageOf = (block: Block) => (block.kind === "table" || block.kind === "paragraph" ? (block.pieces[block.pieces.length - 1]?.page ?? block.page) : block.page)

/**
 * Junta o que uma virada de página cortou, entre páginas seguidas. Tabela: mesmas colunas, sem cabeçalho próprio ou com o mesmo cabeçalho (cabeçalho
 * diferente é outra tabela). Parágrafo: continua em minúscula, depois de uma linha cheia sem ponto final.
 */
function mergeAcrossPages(blocks: Block[]): Block[] {
  const merged: Block[] = []
  for (const block of blocks) {
    const last = merged[merged.length - 1]
    if (last && block.page === lastPageOf(last) + 1) {
      if (last.kind === "table" && block.kind === "table") {
        const width = (table: TableBlock) => table.header?.length ?? table.rows[0]?.length ?? 0
        const sameRow = (left: readonly string[] | null | undefined, right: readonly string[] | null | undefined) => Boolean(left && right && left.join("|") === right.join("|"))
        const continues = width(last.table) === width(block.table) && (block.table.header === null || sameRow(block.table.header, last.table.header))
        if (continues) {
          const rows = sameRow(block.table.rows[0], last.table.header) ? block.table.rows.slice(1) : block.table.rows
          last.pieces.push({ page: block.page, rowIndex: last.table.rows.length })
          last.table = { ...last.table, rows: [...last.table.rows, ...rows] }
          last.marks.push(...block.marks)
          continue
        }
      }
      if (last.kind === "paragraph" && block.kind === "paragraph" && last.lastFills && !SENTENCE_END.test(last.text) && /^\p{Ll}/u.test(block.text) && Math.abs(last.size - block.size) <= 0.6) {
        last.pieces.push({ page: block.page, at: last.text.length + 1 })
        last.text = `${last.text} ${block.text}`
        last.lastFills = block.lastFills
        last.marks.push(...block.marks)
        continue
      }
    }
    merged.push(block)
  }
  return merged
}

function headingLevels(blocks: readonly Block[]): Map<number, number> {
  const sizes = [...new Set(blocks.flatMap((block) => (block.kind === "heading" && block.level === null ? [block.size] : [])))].sort((left, right) => right - left)
  return new Map(sizes.map((size, index) => [size, Math.min(index + 1, 4)]))
}

/** Tabela grande sai em partes com o cabeçalho repetido: cada trecho que a busca entrega continua dizendo o que é cada coluna. */
export const MAX_TABLE_PART_CHARS = 1_100
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")

function renderTableParts(table: TableBlock, pageBreaks: ReadonlySet<number> = new Set()): { text: string; firstRow: number }[] {
  const width = table.header?.length ?? table.rows[0]?.length ?? 0
  const head = [`| ${(table.header ?? Array.from({ length: width }, () => "")).map(cell).join(" | ")} |`, `|${" --- |".repeat(width)}`].join("\n")
  const parts: { text: string; firstRow: number }[] = []
  let current: string[] = []
  let chars = head.length
  let firstRow = 0
  table.rows.forEach((row, index) => {
    const line = `| ${Array.from({ length: width }, (_, column) => cell(row[column] ?? "")).join(" | ")} |`
    // A virada de página também corta a parte: cada trecho da tabela aponta para a página certa.
    if (current.length > 0 && (chars + line.length + 1 > MAX_TABLE_PART_CHARS || pageBreaks.has(index))) {
      parts.push({ text: `${head}\n${current.join("\n")}`, firstRow })
      current = []
      chars = head.length
      firstRow = index
    }
    current.push(line)
    chars += line.length + 1
  })
  if (current.length > 0) parts.push({ text: `${head}\n${current.join("\n")}`, firstRow })
  return parts
}

const MAX_LIST_PART_CHARS = 1_000

/** `ends`: onde termina a linha de cada item no texto da lista. Um print entre dois passos entra entre os dois, não no fim da lista. */
function renderList(items: readonly { depth: number; marker: string; text: string }[]): { text: string; ends: number[] } {
  const parts: string[] = []
  const ends: number[] = []
  let current = ""
  let before = 0
  for (const item of items) {
    const line = `${"  ".repeat(item.depth)}${item.marker} ${item.text}`
    if (current && current.length + line.length + 1 > MAX_LIST_PART_CHARS) {
      parts.push(current)
      before += current.length + 2
      current = line
    } else {
      current = current ? `${current}\n${line}` : line
    }
    ends.push(before + current.length)
  }
  if (current) parts.push(current)
  return { text: parts.join("\n\n"), ends }
}

/** `#` no começo de uma linha viraria título para quem divide os trechos. No bloco de código, o recuo evita isso sem mexer no texto. */
const renderCode = (lines: readonly string[]) => ["```", ...lines.map((line) => (/^\s{0,3}#/.test(line) ? `    ${line}` : line)), "```"].join("\n")
const escapeLeading = (text: string) => text.split("\n").map((line) => (/^\s{0,3}#{1,6}\s/.test(line) ? `\\${line}` : line)).join("\n")

/** Quando a estrutura deixaria texto de fora, a página sai como linhas simples. É a garantia de que converter nunca perde conteúdo. */
function plainBlocks(lines: readonly Line[], tables: readonly TableBlock[], page: number): Block[] {
  const tableText = tables.flatMap((table) => [table.header, ...table.rows].flatMap((row) => (row ? [row.join("\t")] : [])))
  const text = [...lines.map((line) => line.text), ...tableText].join("\n")
  return text ? [{ kind: "paragraph", page, text, pieces: [], size: 0, lastFills: false, marks: [{ page, y: lines[0]?.y ?? 0, left: 0, right: Number.POSITIVE_INFINITY, item: null }] }] : []
}

function blockLetters(block: Block): number {
  if (block.kind === "heading" || block.kind === "paragraph") return lettersOf(block.text)
  if (block.kind === "code") return lettersOf(block.lines.join(" "))
  if (block.kind === "list") return lettersOf(block.items.map((item) => `${item.marker} ${item.text}`).join(" "))
  return lettersOf([...(block.table.header ?? []), ...block.table.rows.flat()].join(" "))
}

/** Logo e fundo de página não são conteúdo: a mesma imagem nas margens de ao menos 2 páginas, ou em ao menos metade delas (mínimo de 3). */
function withoutDecoration(images: readonly PdfPageImage[], pages: readonly PdfPageLayout[]): PdfPageImage[] {
  const heightOf = new Map(pages.map((page) => [page.page, page.height]))
  const seenOn = new Map<string, Set<number>>()
  const inMarginOn = new Map<string, Set<number>>()
  const add = (map: Map<string, Set<number>>, image: PdfPageImage) => map.set(image.id, (map.get(image.id) ?? new Set()).add(image.page))
  for (const image of images) {
    add(seenOn, image)
    const height = heightOf.get(image.page) ?? 0
    if (image.bottom <= height * 0.1 || image.top >= height * 0.9) add(inMarginOn, image)
  }
  const half = Math.max(3, Math.ceil(pages.length / 2))
  return images.filter((image) => seenOn.get(image.id)!.size < half && (inMarginOn.get(image.id)?.size ?? 0) < 2)
}

/** Uma folga de 2 pontos: a linha de base do texto logo acima pode encostar no topo da imagem. */
const IMAGE_TOP_TOLERANCE = 2

/**
 * Cada imagem entra depois do último texto acima dela na mesma coluna. Sem texto acima (print no topo da página), ela segue o passo que veio
 * antes, na página anterior: cabeçalho e rodapé repetidos já ficaram de fora do texto e nunca seguram uma imagem.
 */
function placeImages(images: readonly PdfPageImage[], anchors: readonly (Mark & { end: number })[]): PdfImagePlacement[] {
  return [...images].sort((left, right) => left.page - right.page || left.top - right.top || left.left - right.left).map((image) => {
    let offset = 0
    for (const anchor of anchors) {
      const above = anchor.page === image.page && anchor.y <= image.top + IMAGE_TOP_TOLERANCE && anchor.left < image.right && anchor.right > image.left
      if (anchor.page < image.page || above) offset = anchor.end
    }
    return { id: image.id, page: image.page, offset, width: image.width, height: image.height }
  })
}

/** `images`: o que a leitura das imagens achou, ou nada quando ela não aconteceu. Com ou sem imagens, o Markdown é o mesmo, caractere por caractere. */
export function pdfLayoutToMarkdown(pages: readonly PdfPageLayout[], images?: { images: readonly PdfPageImage[]; omitted: number }): PdfMarkdownResult {
  const context = {
    bodySize: bodySizeOf(pages),
    hasHeadingTags: pages.some((page) => page.runs.some((run) => run.hint?.kind === "HEADING")),
    monoDocument: (() => {
      const all = pages.flatMap((page) => page.runs)
      const total = all.reduce((sum, run) => sum + run.text.length, 0)
      return total > 0 && all.filter((run) => run.mono).reduce((sum, run) => sum + run.text.length, 0) / total >= 0.6
    })(),
    vocabulary: vocabularyOf(pages),
  }
  const prepared = pages.map((layout) => {
    const unreadable = unreadableShare(layout.runs) > 0.3
    const runs = unreadable ? [] : layout.runs
    const tagged = taggedTables(runs)
    const remaining = runs.filter((run) => !tagged.used.has(run))
    const ruled = ruledTables(layout.rules, remaining)
    const flow = remaining.filter((run) => !ruled.used.has(run))
    return { layout, tables: [...tagged.tables, ...ruled.tables], lines: buildLines(layout, flow.map((run) => (run.hint?.kind === "TABLE_CELL" ? { ...run, hint: null } : run))), height: layout.height }
  })

  const repeated = findRepeatedLines(prepared)
  const firstSeen = new Set<string>()
  let repeatedLinesRemoved = 0
  const allBlocks: Block[] = []
  for (const entry of prepared) {
    const before = entry.lines.length
    const kept = entry.lines.filter((line) => !((inMargin(line, entry.height) && onlyPageNumber(line.text) && pages.length > 1) || (inMargin(line, entry.height) && repeated.isRepeated(line, firstSeen))))
    repeatedLinesRemoved += before - kept.length
    let blocks = blocksOfPage({ layout: entry.layout, lines: kept, tables: entry.tables }, context)
    const expected = lettersOf(kept.map((line) => line.text).join(" ")) + lettersOf(entry.tables.flatMap((table) => [...(table.header ?? []), ...table.rows.flat()]).join(" "))
    const produced = blocks.reduce((sum, block) => sum + blockLetters(block), 0)
    if (produced < expected * 0.98) blocks = plainBlocks(kept, entry.tables, entry.layout.page)
    allBlocks.push(...blocks)
  }

  const merged = mergeAcrossPages(allBlocks)
  const levels = headingLevels(merged)
  const parts: string[] = []
  let length = 0
  const offsets = new Map<number, number>()
  const headingCount = new Map<number, number>()
  const tableCount = new Map<number, number>()
  const charsOn = new Map<number, number>()
  const bump = (map: Map<number, number>, page: number, by = 1) => map.set(page, (map.get(page) ?? 0) + by)
  const anchors: (Mark & { end: number })[] = []
  const anchorAt = (block: Block, end: number) => {
    for (const mark of block.marks) anchors.push({ ...mark, end })
  }
  const push = (text: string, page: number) => {
    const at = length + (parts.length > 0 ? 2 : 0)
    if (!offsets.has(page)) offsets.set(page, at)
    parts.push(text)
    length = at + text.length
    bump(charsOn, page, text.replace(/\s/g, "").length)
    return at
  }
  for (const block of merged) {
    if (block.kind === "heading") {
      push(`${"#".repeat(block.level ?? levels.get(block.size) ?? 2)} ${block.text}`, block.page)
      bump(headingCount, block.page)
      anchorAt(block, length)
    } else if (block.kind === "paragraph") {
      const at = push(escapeLeading(block.text), block.page)
      for (const piece of block.pieces) {
        if (!offsets.has(piece.page)) offsets.set(piece.page, at + piece.at)
        bump(charsOn, piece.page, 1)
      }
      anchorAt(block, length)
    } else if (block.kind === "list") {
      const { text, ends } = renderList(block.items)
      const at = push(text, block.page)
      for (const mark of block.marks) anchors.push({ ...mark, end: at + ends[mark.item ?? ends.length - 1]! })
    } else if (block.kind === "code") {
      push(renderCode(block.lines), block.page)
      anchorAt(block, length)
    } else {
      bump(tableCount, block.page)
      for (const part of renderTableParts(block.table, new Set(block.pieces.map((piece) => piece.rowIndex)))) {
        push(part.text, [...block.pieces].reverse().find((piece) => piece.rowIndex <= part.firstRow)?.page ?? block.page)
      }
      anchorAt(block, length)
    }
  }
  const markdown = parts.join("\n\n")
  const coverage: PdfPageCoverage[] = pages.map((layout) => {
    const chars = charsOn.get(layout.page) ?? 0
    return { page: layout.page, status: classify(layout, layout.runs, chars), chars, headings: headingCount.get(layout.page) ?? 0, tables: tableCount.get(layout.page) ?? 0, offset: offsets.get(layout.page) ?? null }
  })
  const extraction: PdfExtraction = {
    version: PDF_MARKDOWN_VERSION,
    pageCount: pages.length,
    pages: coverage,
    headings: coverage.reduce((sum, page) => sum + page.headings, 0),
    tables: coverage.reduce((sum, page) => sum + page.tables, 0),
    repeatedLinesRemoved,
    taggedPages: pages.filter((page) => page.tagged).length,
    edited: false,
    ...(images ? { images: placeImages(withoutDecoration(images.images, pages), anchors), ...(images.omitted > 0 ? { imagesOmitted: images.omitted } : {}) } : {}),
  }
  return { markdown, extraction }
}
