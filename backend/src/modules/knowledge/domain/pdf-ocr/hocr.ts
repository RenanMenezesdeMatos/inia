/**
 * O que o Tesseract leu numa página, a partir do hOCR que ele devolve. Puro: as posições chegam em pixels da imagem lida e saem em pontos da página
 * (a mesma medida da leitura do texto do PDF), divididas pela escala com que a página foi desenhada.
 *
 * Os blocos que o próprio Tesseract classifica como imagem (`ocr_photo`) não são usados: medidos em 4 conjuntos de páginas (07/11/2026), eles acharam
 * menos prints que a regra de `print-regions.ts` e tiraram do texto de 31 a 422 palavras reais por conjunto; somados à regra, de 11 a 372.
 */
export type OcrBox = { left: number; top: number; right: number; bottom: number }

export type OcrWord = OcrBox & { text: string; confidence: number }

export type OcrLine = OcrBox & {
  /** Linha de base no início da linha. */
  baseline: number
  /** Altura da linha pelo modelo do próprio Tesseract (do alto das letras altas ao fim das que descem), igual para as linhas do mesmo bloco. */
  size: number
  words: OcrWord[]
}

export type OcrPage = { lines: OcrLine[] }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decode(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const value = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ""
      }
      return ENTITIES[code.toLowerCase()] ?? entity
    })
}

function property(title: string, name: string): number[] | null {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(title)
  if (!match) return null
  const values = match[1]!.trim().split(/\s+/).map(Number)
  return values.every(Number.isFinite) ? values : null
}

function boxOf(title: string, scale: number): OcrBox | null {
  const bbox = property(title, "bbox")
  if (!bbox || bbox.length < 4) return null
  return { left: bbox[0]! / scale, top: bbox[1]! / scale, right: bbox[2]! / scale, bottom: bbox[3]! / scale }
}

const ELEMENT = /<(div|span)\s+class='(ocr_carea|ocr_photo|ocr_line|ocr_header|ocr_textfloat|ocr_caption|ocrx_word)'[^>]*?title=(?:"([^"]*)"|'([^']*)')[^>]*>/g

export function parseHocr(hocr: string, scale: number): OcrPage {
  const lines: OcrLine[] = []
  let line: OcrLine | null = null
  for (const match of hocr.matchAll(ELEMENT)) {
    const kind = match[2]!
    const title = match[3] ?? match[4] ?? ""
    const box = boxOf(title, scale)
    if (!box) continue
    if (kind === "ocr_carea" || kind === "ocr_photo") {
      // Bloco novo: palavra solta depois dele não pertence à linha anterior.
      line = null
    } else if (kind === "ocrx_word") {
      // O texto da palavra vai até o fechamento do span dela (o Tesseract pode marcar trechos dentro com <strong>/<em>).
      const start = match.index! + match[0].length
      const end = hocr.indexOf("</span>", start)
      const text = decode(hocr.slice(start, end < 0 ? undefined : end)).trim()
      if (!text || !line) continue
      line.words.push({ ...box, text, confidence: property(title, "x_wconf")?.[0] ?? 0 })
    } else {
      const baseline = property(title, "baseline")
      const size = property(title, "x_size")?.[0]
      line = { ...box, baseline: box.bottom + (baseline?.[1] ?? 0) / scale, size: size && size > 0 ? size / scale : box.bottom - box.top, words: [] }
      lines.push(line)
    }
  }
  return { lines: lines.filter((entry) => entry.words.length > 0) }
}

/** As palavras da página, na ordem de leitura do Tesseract. */
export const wordsOf = (page: { lines: readonly OcrLine[] }): OcrWord[] => page.lines.flatMap((line) => line.words)
