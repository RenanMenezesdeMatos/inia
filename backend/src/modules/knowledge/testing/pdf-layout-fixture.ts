import { deflateSync } from "node:zlib"

/**
 * PDF de verdade com layout controlado, sem nenhuma dependência: texto com fonte e posição, traços, retângulos finos e imagens. É o que
 * os testes e a medição (`scripts/dev/pdf-markdown-eval`) usam para ter tabela com grade, duas colunas, página digitalizada e PDF misto.
 * As coordenadas são as da página, com a origem no canto superior esquerdo.
 */
export type FixtureFont = "regular" | "bold" | "mono"
export type FixtureOp =
  | { kind: "text"; x: number; y: number; text: string; size?: number; font?: FixtureFont }
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "thinRect"; x: number; y: number; width: number; height: number }
  /** `turned`: o arquivo guarda a imagem deitada e a página mostra girada um quarto de volta, como em PDF de página girada. */
  | { kind: "image"; x: number; y: number; width: number; height: number; image: FixtureImage; turned?: boolean }

export type FixtureImage = { format: "gray"; pixels: Buffer; width: number; height: number } | { format: "jpeg"; data: Buffer; width: number; height: number }
export type FixturePage = FixtureOp[]

export const PAGE_WIDTH = 595
export const PAGE_HEIGHT = 842
const FONT_NAMES: Record<FixtureFont, string> = { regular: "F1", bold: "F2", mono: "F3" }

const WIN_ANSI_EXTRA: Record<string, number> = { "•": 0x95, "–": 0x96, "—": 0x97, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "…": 0x85 }

function literal(text: string): string {
  let out = ""
  for (const char of text) {
    const code = WIN_ANSI_EXTRA[char] ?? char.codePointAt(0)!
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`
    else if (code > 126 || code < 32) out += `\\${code.toString(8).padStart(3, "0")}`
    else out += char
  }
  return `(${out})`
}

const fixed = (value: number) => Number(value.toFixed(2))

function pageStream(ops: FixturePage, images: Map<FixtureImage, string>): string {
  return ops
    .map((op) => {
      if (op.kind === "text") return `BT /${FONT_NAMES[op.font ?? "regular"]} ${op.size ?? 11} Tf ${fixed(op.x)} ${fixed(PAGE_HEIGHT - op.y)} Td ${literal(op.text)} Tj ET`
      if (op.kind === "line") return `0.5 w ${fixed(op.x0)} ${fixed(PAGE_HEIGHT - op.y0)} m ${fixed(op.x1)} ${fixed(PAGE_HEIGHT - op.y1)} l S`
      if (op.kind === "thinRect") return `${fixed(op.x)} ${fixed(PAGE_HEIGHT - op.y - op.height)} ${fixed(op.width)} ${fixed(op.height)} re f`
      if (op.turned) return `q 0 ${fixed(-op.height)} ${fixed(op.width)} 0 ${fixed(op.x)} ${fixed(PAGE_HEIGHT - op.y)} cm /${images.get(op.image)} Do Q`
      return `q ${fixed(op.width)} 0 0 ${fixed(op.height)} ${fixed(op.x)} ${fixed(PAGE_HEIGHT - op.y - op.height)} cm /${images.get(op.image)} Do Q`
    })
    .join("\n")
}

/** Monta o arquivo: fontes-padrão com acentuação WinAnsi, um objeto de conteúdo por página e cada imagem uma vez. */
export function buildFixturePdf(pages: readonly FixturePage[]): Buffer {
  const objects: Buffer[] = []
  const add = (content: string | Buffer) => {
    objects.push(typeof content === "string" ? Buffer.from(content, "latin1") : content)
    return objects.length
  }
  const streamObject = (dictionary: string, body: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${body.length} >>\nstream\n`, "latin1"), body, Buffer.from("\nendstream", "latin1")])
  add("<< /Type /Catalog /Pages 2 0 R >>")
  add("PAGES")
  const fonts = {
    F1: add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    F2: add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    F3: add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"),
  }
  const imageNames = new Map<FixtureImage, string>()
  const imageRefs: string[] = []
  for (const op of pages.flat()) {
    if (op.kind !== "image" || imageNames.has(op.image)) continue
    const image = op.image
    const id = image.format === "jpeg"
      ? add(streamObject(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, image.data))
      : add(streamObject(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(image.pixels)))
    const name = `Im${imageNames.size + 1}`
    imageNames.set(image, name)
    imageRefs.push(`/${name} ${id} 0 R`)
  }
  const resources = `<< /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R /F3 ${fonts.F3} 0 R >> /XObject << ${imageRefs.join(" ")} >> >>`
  const kids: number[] = []
  for (const ops of pages) {
    const content = add(streamObject("", deflateSync(Buffer.from(pageStream(ops, imageNames), "latin1"))).toString("latin1").replace("<<  /Length", "<< /Filter /FlateDecode /Length"))
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${content} 0 R /Resources ${resources} >>`))
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1")

  const chunks: Buffer[] = [Buffer.from("%PDF-1.5\n", "latin1")]
  let position = chunks[0]!.length
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(position)
    const piece = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), object, Buffer.from("\nendobj\n", "latin1")])
    chunks.push(piece)
    position += piece.length
  })
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`, "latin1"))
  return Buffer.concat(chunks)
}

/** Imagem cinza lisa, do tamanho pedido: basta para simular uma página digitalizada sem camada de texto. */
export function grayImage(width = 40, height = 56, value = 200): FixtureImage {
  return { format: "gray", pixels: Buffer.alloc(width * height, value), width, height }
}

/** Largura aproximada da Helvetica: suficiente para quebrar linhas como um gerador de PDF faria. */
const lineWidth = (text: string, size: number) => text.length * size * 0.5

/** Quebra um texto em linhas que cabem em `width`. */
export function wrapText(text: string, width: number, size: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word
    if (lineWidth(candidate, size) > width && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Escreve um parágrafo a partir de `y` e devolve as operações e o próximo `y`. */
export function paragraph(text: string, at: { x: number; y: number; width: number; size?: number; font?: FixtureFont; leading?: number }): { ops: FixtureOp[]; y: number } {
  const size = at.size ?? 11
  const leading = at.leading ?? size * 1.35
  const ops: FixtureOp[] = []
  let y = at.y
  for (const line of wrapText(text, at.width, size)) {
    ops.push({ kind: "text", x: at.x, y, text: line, size, font: at.font ?? "regular" })
    y += leading
  }
  return { ops, y }
}

/** Grade desenhada: bordas em traço (`stroke`) ou em retângulo fino (`thin`, como sai do Word). */
export function gridTable(rows: readonly (readonly string[])[], at: { x: number; y: number; columnWidths: readonly number[]; rowHeight?: number; size?: number; style: "stroke" | "thin"; boldHeader?: boolean }): { ops: FixtureOp[]; y: number } {
  const size = at.size ?? 10
  const leading = size * 1.25
  const baseHeight = at.rowHeight ?? 18
  const width = at.columnWidths.reduce((sum, value) => sum + value, 0)
  const ops: FixtureOp[] = []
  const wrapped = rows.map((row) => row.map((text, column) => (text ? wrapText(text, at.columnWidths[column]! - 8, size) : [])))
  const heights = wrapped.map((row) => Math.max(baseHeight, Math.max(1, ...row.map((lines) => lines.length)) * leading + 6))
  const horizontal = (y: number): FixtureOp => (at.style === "stroke" ? { kind: "line", x0: at.x, y0: y, x1: at.x + width, y1: y } : { kind: "thinRect", x: at.x, y: y - 0.25, width, height: 0.5 })
  const vertical = (x: number, y0: number, y1: number): FixtureOp => (at.style === "stroke" ? { kind: "line", x0: x, y0, x1: x, y1 } : { kind: "thinRect", x: x - 0.25, y: y0, width: 0.5, height: y1 - y0 })
  let top = at.y
  wrapped.forEach((row, rowIndex) => {
    ops.push(horizontal(top))
    let x = at.x
    row.forEach((lines, column) => {
      lines.forEach((text, lineIndex) => ops.push({ kind: "text", x: x + 4, y: top + size + 2 + lineIndex * leading, text, size, font: rowIndex === 0 && at.boldHeader !== false ? "bold" : "regular" }))
      x += at.columnWidths[column]!
    })
    top += heights[rowIndex]!
  })
  const bottom = top
  ops.push(horizontal(bottom))
  let x = at.x
  for (const columnWidth of [...at.columnWidths, 0]) {
    ops.push(vertical(x, at.y, bottom))
    x += columnWidth
  }
  return { ops, y: bottom }
}
