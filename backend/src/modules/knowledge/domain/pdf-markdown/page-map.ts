import { diffText } from "../knowledge-version-diff.js"
import type { KnowledgeChunk } from "../knowledge-chunking.js"
import type { PdfExtraction } from "./layout.js"

/** As páginas de cada trecho, a partir do registro da conversão. Nada aqui muda o texto nem a divisão em trechos. */
export type PageRange = { from: number; to: number }

/** Imagem que cai dentro de um trecho. `at` = onde, a partir do começo do texto do trecho. Só serve à tela: a IA não recebe imagens. */
export type ChunkImage = { id: string; page: number; width: number; height: number; at: number }

type PageStart = { page: number; offset: number }

const startsOf = (extraction: Pick<PdfExtraction, "pages">): PageStart[] => extraction.pages.flatMap((entry) => (entry.offset === null ? [] : [{ page: entry.page, offset: entry.offset }])).sort((left, right) => left.offset - right.offset)

function pageAt(starts: readonly PageStart[], offset: number): number | null {
  let found: number | null = null
  for (const start of starts) {
    if (start.offset > offset) break
    found = start.page
  }
  return found
}

/** Trecho longo pode ter sido recomposto com espaços: o começo e o fim dele são procurados em tamanhos decrescentes, sempre para a frente. */
const PROBE_SIZES = [48, 24, 12]

function findHead(content: string, text: string, from: number): number {
  for (const size of PROBE_SIZES) {
    const at = content.indexOf(text.split("\n", 1)[0]!.slice(0, size), from)
    if (at >= 0) return at
  }
  return -1
}

function findTail(content: string, text: string, from: number): number {
  const lines = text.split("\n")
  const last = lines[lines.length - 1]!
  for (const size of PROBE_SIZES) {
    const probe = last.slice(-size)
    const at = content.indexOf(probe, from)
    if (at >= 0) return at + Math.max(probe.length - 1, 0)
  }
  return from
}

/**
 * Acrescenta `pages` e `images` aos trechos de um documento convertido, percorrendo o texto na ordem. Sem registro de páginas, devolve os trechos
 * como vieram. A imagem fica no primeiro trecho que termina no ponto dela ou depois: o título da seção não faz parte do texto do trecho, e o
 * print logo abaixo de um título é do trecho que vem a seguir, não do anterior.
 */
export function withChunkPages<T extends Pick<KnowledgeChunk, "text">>(chunks: readonly T[], content: string, extraction: Pick<PdfExtraction, "pages" | "images"> | null | undefined): (T & { pages?: PageRange; images?: ChunkImage[] })[] {
  if (!extraction) return [...chunks]
  const starts = startsOf(extraction)
  if (starts.length === 0) return [...chunks]
  let cursor = 0
  const spans: ({ start: number; end: number } | null)[] = []
  const located = chunks.map((chunk) => {
    const at = findHead(content, chunk.text, cursor)
    if (at < 0) {
      spans.push(null)
      return chunk
    }
    const end = findTail(content, chunk.text, at)
    spans.push({ start: at, end: end + 1 })
    cursor = at + 1
    const from = pageAt(starts, at)
    const to = pageAt(starts, end)
    return from === null ? chunk : { ...chunk, pages: { from, to: to === null || to < from ? from : to } }
  })
  const imagesOf = new Map<number, ChunkImage[]>()
  const lastSpan = spans.flatMap((span, index) => (span ? [index] : [])).pop()
  for (const image of extraction.images ?? []) {
    if (image.offset === null || lastSpan === undefined) continue
    const offset = image.offset
    const found = spans.findIndex((span) => span !== null && offset <= span.end)
    const holder = found >= 0 ? found : lastSpan
    imagesOf.set(holder, [...(imagesOf.get(holder) ?? []), { id: image.id, page: image.page, width: image.width, height: image.height, at: Math.max(0, offset - spans[holder]!.start) }])
  }
  return located.map((chunk, index) => (imagesOf.has(index) ? { ...chunk, images: imagesOf.get(index)! } : chunk))
}

const isSpace = (code: number | undefined) => code === 32 || code === 9 || code === 10 || code === 13 || code === 160

/** Onde `text` termina em `content` a partir de `start`, ignorando só espaços e quebras de linha; -1 se qualquer outro caractere não bater. */
function endOfExactMatch(content: string, text: string, start: number): number {
  let at = start
  for (let index = 0; index < text.length; index += 1) {
    if (isSpace(text.charCodeAt(index))) continue
    while (isSpace(content.charCodeAt(at))) at += 1
    if (content.charCodeAt(at) !== text.charCodeAt(index)) return -1
    at += 1
  }
  return at
}

/**
 * Cada trecho como está escrito no documento, para a TELA. Parágrafo grande demais é recomposto com espaços ao ser dividido
 * (`splitOversizedParagraph`): para a busca e a IA não faz diferença, mas na leitura vira um bloco só. Aqui voltam as quebras de linha do
 * documento, e nada além delas: se qualquer outro caractere não bater, ou o trecho já estiver igual, fica null e vale o texto do trecho.
 * O que a IA recebe continua sendo `chunk.text`.
 */
export function chunkDisplayTexts(chunks: readonly Pick<KnowledgeChunk, "text">[], content: string): (string | null)[] {
  let cursor = 0
  return chunks.map((chunk) => {
    const first = chunk.text.trim().split(/\s/, 1)[0]
    if (!first) return null
    for (let start = content.indexOf(first, cursor); start >= 0; start = content.indexOf(first, start + 1)) {
      const end = endOfExactMatch(content, chunk.text, start)
      if (end < 0) continue
      cursor = end
      const written = content.slice(start, end)
      return written === chunk.text ? null : written
    }
    return null
  })
}

/** Início de cada linha do texto. */
function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) if (content[index] === "\n") starts.push(index + 1)
  return starts
}

/**
 * Quem edita o texto de um rascunho não perde a origem das páginas: cada página continua começando na mesma linha, onde quer que ela
 * tenha ido parar. A linha que sumiu cede o lugar à seguinte que continuou. Grande demais para comparar, ou sem texto em comum: a origem
 * das páginas sai do registro, e a cobertura fica. `edited` diz que o texto já não é o da conversão.
 */
export function remapExtraction(extraction: PdfExtraction, before: string, after: string): PdfExtraction {
  const diff = diffText(before, after)
  const unlinked = (): PdfExtraction => ({ ...extraction, edited: true, pages: extraction.pages.map((entry) => ({ ...entry, offset: null })), ...(extraction.images ? { images: extraction.images.map((image) => ({ ...image, offset: null })) } : {}) })
  if (!diff) return unlinked()
  const beforeStarts = lineStarts(before)
  const afterStarts = lineStarts(after)
  const lineOfBefore = (offset: number) => {
    let line = 1
    for (let index = 0; index < beforeStarts.length && beforeStarts[index]! <= offset; index += 1) line = index + 1
    return line
  }
  const kept = diff.rows.flatMap((row) => (row.kind === "UNCHANGED" || row.kind === "CHANGED" ? [{ left: row.leftLine, right: row.rightLine }] : []))
  if (kept.length === 0) return unlinked()
  return {
    ...extraction,
    edited: true,
    pages: extraction.pages.map((entry) => {
      if (entry.offset === null) return entry
      const line = lineOfBefore(entry.offset)
      const target = kept.find((row) => row.left >= line)
      return { ...entry, offset: target ? (afterStarts[target.right - 1] ?? null) : null }
    }),
    // A imagem continua depois da mesma linha. Se a linha sumiu, vale a última que continuou antes dela.
    ...(extraction.images
      ? {
          images: extraction.images.map((image) => {
            if (image.offset === null || image.offset === 0) return image
            const line = lineOfBefore(image.offset)
            const target = kept.filter((row) => row.left <= line).pop()
            if (!target) return { ...image, offset: 0 }
            const next = afterStarts[target.right]
            return { ...image, offset: next === undefined ? after.length : next - 1 }
          }),
        }
      : {}),
  }
}
